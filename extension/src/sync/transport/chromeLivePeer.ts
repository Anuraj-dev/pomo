import { bufferOf } from "../../shared/bytes";
import { bytesToHex, hexToBytes } from "../../shared/hex";
import { CoseOperationSigner, CoseOperationVerifier } from "../crypto/CoseOperation";
import { allowAllOperationAuthorization, OperationKernel } from "../kernel/OperationKernel";
import { SharedPreferenceProjection } from "../materialize/sharedPreferences";
import { IndexedDbKernelJournal } from "../storage/IndexedDbKernelJournal";
import { IndexedDbOperationDao } from "../storage/IndexedDbOperationDao";
import { envelopesFrom } from "./ordinaryDrain";
import type { SyncEnvelope } from "./directSync";
import {
  ReplicaLanSession,
  decodeLanRequest,
  decodeLanResponse,
  encodeLanRequest,
  encodeLanResponse,
  httpReplicaPeer,
  installReplicaLan,
  type ReplicaLanPeer,
  type ReplicaLanResponse,
} from "./replicaLan";
import {
  configureWebRtcIce,
  installWebRtcInboxRoutes,
  packagedWebRtcInbox,
  webRtcInboxDrainRoute,
  type WebRtcInboxStore,
} from "./webRtcInbox";
import {
  importRendezvousSignalKey,
  installNostrRendezvousRoutes,
  NostrRendezvousSession,
  WebRtcRendezvousSignaling,
  type NostrSyncEvent,
  type NostrSyncTransport,
} from "./nostrRendezvous";
import { installWebDavMailboxFromConfig, type MailboxEndpointConfig } from "./webDavMailbox";
import {
  ensureWebRtcOffscreenDocument,
  reconstructRoutePeers,
  type DurableRouteObligation,
  type IceProviderConfig,
} from "./WebRtcRouteManager";

export const LIVE_PEER_IDENTITY_KEY = "pomo:sync:live-peer-identity";
export const LIVE_PEERS_KEY = "pomo:sync:live-peers";
export const LIVE_PEER_ICE_KEY = "pomo:sync:webrtc-ice";
export const RENDEZVOUS_KEY = "pomo:sync:rendezvous";
export const MAILBOX_KEY = "pomo:sync:mailboxes";

const EXCHANGE_TIMEOUT_MS = 5_000;

export interface LivePeerStorage {
  get(keys: readonly string[]): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface LivePeerIdentity {
  readonly deviceId: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: CryptoKey;
  readonly publicCryptoKey: CryptoKey;
}

export interface LivePeerPipe {
  ensureDocument(): Promise<void>;
  open(routeId: string, iceServers: readonly RTCIceServer[], remoteDescription?: RTCSessionDescriptionInit): Promise<{ readonly description?: RTCSessionDescriptionInit | null }>;
  setRemoteDescription(routeId: string, remoteDescription: RTCSessionDescriptionInit): Promise<void>;
  waitUntilOpen(routeId: string): Promise<void>;
  addCandidate(routeId: string, candidate: RTCIceCandidateInit): Promise<void>;
  send(routeId: string, bytes: Uint8Array): Promise<void>;
  close(routeId: string): Promise<void>;
}

export interface LivePeerDirectoryEntry {
  readonly deviceId: string;
  readonly endpoint?: string;
}

interface StoredIdentity {
  readonly privateJwk: JsonWebKey;
  readonly publicJwk: JsonWebKey;
}

let current: LivePeerRuntime | null = null;
const runtimes = new Set<LivePeerRuntime>();

export function chromeLivePeerStorage(): LivePeerStorage {
  return {
    get: (keys) => chrome.storage.local.get([...keys]),
    set: (items) => chrome.storage.local.set(items),
  };
}

export async function loadOrCreateLivePeerIdentity(storage: LivePeerStorage): Promise<LivePeerIdentity> {
  const stored = await storage.get([LIVE_PEER_IDENTITY_KEY]);
  const record = stored[LIVE_PEER_IDENTITY_KEY];
  if (isStoredIdentity(record)) return importIdentity(record);
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const next: StoredIdentity = {
    privateJwk: await crypto.subtle.exportKey("jwk", pair.privateKey),
    publicJwk: await crypto.subtle.exportKey("jwk", pair.publicKey),
  };
  await storage.set({ [LIVE_PEER_IDENTITY_KEY]: next });
  return importIdentity(next);
}

export function linkMemoryPipes(): [MemoryLivePipe, MemoryLivePipe] {
  const left = new MemoryLivePipe();
  const right = new MemoryLivePipe();
  left.attach(right);
  right.attach(left);
  return [left, right];
}

export class MemoryLivePipe implements LivePeerPipe {
  onBytes: ((routeId: string, bytes: Uint8Array) => Promise<void> | void) | null = null;
  private peer: MemoryLivePipe | null = null;

  attach(peer: MemoryLivePipe): void {
    this.peer = peer;
  }

  async ensureDocument(): Promise<void> {}
  async open(_routeId: string, _iceServers: readonly RTCIceServer[], _remoteDescription?: RTCSessionDescriptionInit): Promise<{ readonly description?: RTCSessionDescriptionInit | null }> {
    return {};
  }
  async setRemoteDescription(_routeId: string, _remoteDescription: RTCSessionDescriptionInit): Promise<void> {}
  async waitUntilOpen(_routeId: string): Promise<void> {}
  async addCandidate(_routeId: string, _candidate: RTCIceCandidateInit): Promise<void> {}
  async close(_routeId: string): Promise<void> {}
  async send(routeId: string, bytes: Uint8Array): Promise<void> {
    const peer = this.peer;
    if (peer === null) throw new Error("memory live pipe has no peer");
    await peer.onBytes?.(routeId, bytes.slice());
  }
}

export class ChromeOffscreenPipe implements LivePeerPipe {
  async ensureDocument(): Promise<void> {
    await ensureWebRtcOffscreenDocument();
  }

  async open(routeId: string, iceServers: readonly RTCIceServer[], remoteDescription?: RTCSessionDescriptionInit): Promise<{ readonly description?: RTCSessionDescriptionInit | null }> {
    await this.ensureDocument();
    const result = await chrome.runtime.sendMessage({
      type: "POMO_WEBRTC_OPEN",
      routeId,
      iceServers,
      remoteDescription,
    });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC open failed");
    return { description: result?.description ?? null };
  }

  async setRemoteDescription(routeId: string, remoteDescription: RTCSessionDescriptionInit): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: "POMO_WEBRTC_REMOTE", routeId, remoteDescription });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC remote description failed");
  }

  async waitUntilOpen(routeId: string): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: "POMO_WEBRTC_WAIT_OPEN", routeId });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC datachannel failed");
  }

  async addCandidate(routeId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: "POMO_WEBRTC_CANDIDATE", routeId, candidate });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC candidate failed");
  }

  async send(routeId: string, bytes: Uint8Array): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: "POMO_WEBRTC_SEND", routeId, bytes: [...bytes] });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC send failed");
  }

  async close(routeId: string): Promise<void> {
    const result = await chrome.runtime.sendMessage({ type: "POMO_WEBRTC_CLOSE", routeId });
    if (result?.ok === false) throw new Error(result.error ?? "WebRTC close failed");
  }
}

class LivePeerRuntime {
  closed = false;
  readonly pending = new Map<string, { resolve(response: ReplicaLanResponse): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }>();

  constructor(
    readonly identity: LivePeerIdentity,
    readonly session: ReplicaLanSession,
    readonly pipe: LivePeerPipe | null,
    readonly inbox: WebRtcInboxStore | null,
    readonly ingest: (wire: Uint8Array) => Promise<string> | string,
  ) {}

  async receive(routeId: string, bytes: Uint8Array): Promise<void> {
    try {
      const request = decodeLanRequest(bytes);
      if (this.pipe === null) return;
      await this.pipe.send(routeId, encodeLanResponse(await this.session.handle(request)));
      return;
    } catch {
      // not a replica request
    }
    try {
      const response = decodeLanResponse(bytes);
      const waiter = this.pending.get(routeId);
      if (waiter !== undefined) {
        clearTimeout(waiter.timer);
        this.pending.delete(routeId);
        waiter.resolve(response);
      }
      return;
    } catch {
      // not a replica response
    }
    await this.ingest(bytes.slice());
  }

  async pumpInbox(): Promise<void> {
    if (this.inbox === null) return;
    for (const message of await this.inbox.takeAll()) {
      await this.receive(message.routeId, message.bytes);
    }
  }

  waitForResponse(routeId: string): Promise<ReplicaLanResponse> {
    return new Promise((resolve, reject) => {
      const previous = this.pending.get(routeId);
      if (previous !== undefined) {
        clearTimeout(previous.timer);
        previous.reject(new Error("live peer exchange superseded"));
      }
      const timer = setTimeout(() => {
        this.pending.delete(routeId);
        reject(new Error("live peer exchange timed out"));
      }, EXCHANGE_TIMEOUT_MS);
      this.pending.set(routeId, { resolve, reject, timer });
    });
  }

  reset(): void {
    this.closed = true;
    for (const waiter of this.pending.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("live peer reset"));
    }
    this.pending.clear();
  }
}

export async function installChromeLivePeer(input: {
  readonly storage: LivePeerStorage;
  readonly ingest: (wire: Uint8Array) => Promise<string> | string;
  readonly outbox: () => readonly SyncEnvelope[] | Promise<readonly SyncEnvelope[]>;
  readonly pipe?: LivePeerPipe;
  readonly inbox?: WebRtcInboxStore;
  readonly obligations?: readonly DurableRouteObligation[];
  readonly identity?: LivePeerIdentity;
  readonly signalingTransport?: NostrSyncTransport;
}): Promise<LivePeerIdentity> {
  for (const runtime of runtimes) runtime.reset();
  runtimes.clear();
  current = null;
  const identity = input.identity ?? await loadOrCreateLivePeerIdentity(input.storage);
  const stored = await input.storage.get([LIVE_PEER_ICE_KEY, LIVE_PEERS_KEY, RENDEZVOUS_KEY]);
  const ice = iceFrom(stored);
  configureWebRtcIce(ice);
  const session = new ReplicaLanSession(identity.deviceId, identity.publicKey, identity.privateKey, input.ingest, input.outbox);
  const pipe = input.pipe ?? (typeof chrome !== "undefined" && chrome.offscreen !== undefined ? new ChromeOffscreenPipe() : null);
  const inbox = input.inbox ?? (typeof indexedDB !== "undefined" ? packagedWebRtcInbox() : null);
  const runtime = new LivePeerRuntime(identity, session, pipe, inbox, input.ingest);
  const rendezvous = parseRendezvous(stored[RENDEZVOUS_KEY]);
  const signaling = rendezvous === null
    ? null
    : new WebRtcRendezvousSignaling(
      identity.deviceId,
      rendezvous.sessionId,
      await importRendezvousSignalKey(rendezvous.contentKey),
      input.signalingTransport ?? new WebSocketNostrTransport(rendezvous.relays),
      identity.deviceId,
    );
  const directory = directoryFrom(stored);
  const peerIds = uniquePeerIds(identity.deviceId, directory, input.obligations ?? [], rendezvous?.peerDeviceIds ?? []);
  const injectedPipe = input.pipe !== undefined;
  const peers: ReplicaLanPeer[] = peerIds.flatMap((deviceId) => {
    const endpoint = directory.find((entry) => entry.deviceId === deviceId)?.endpoint;
    if (endpoint !== undefined && endpoint.length > 0) return [httpReplicaPeer(deviceId, endpoint)];
    if (pipe === null) return [];
    if (signaling === null && !injectedPipe) return [];
    const servers = iceServers(ice);
    return [{
      deviceId,
      exchange: async (request) => {
        if (signaling !== null) {
          await createRemoteOffer({
            localDeviceId: identity.deviceId,
            peerDeviceId: deviceId,
            pipe,
            signaling,
            iceServers: servers,
          });
        } else {
          await pipe.ensureDocument();
          await pipe.open(deviceId, servers);
        }
        await pipe.waitUntilOpen(deviceId);
        const response = runtime.waitForResponse(deviceId);
        await pipe.send(deviceId, encodeLanRequest(request));
        return response;
      },
    }];
  });
  installReplicaLan({ session, peers, ingest: input.ingest });
  installWebRtcInboxRoutes(inbox === null ? [] : [webRtcInboxDrainRoute({ inbox, ingest: input.ingest })]);
  if (pipe instanceof MemoryLivePipe) pipe.onBytes = (routeId, bytes) => runtime.receive(routeId, bytes);
  runtimes.add(runtime);
  current = runtime;
  if (signaling !== null && pipe !== null) {
    void watchIncomingOffers({ runtime, peerIds, directory, pipe, signaling, iceServers: iceServers(ice) });
  }
  await runtime.pumpInbox();
  return identity;
}

export async function ensurePackagedChromeLivePeer(): Promise<LivePeerIdentity | null> {
  if (typeof chrome === "undefined" || chrome.storage?.local === undefined) return current?.identity ?? null;
  if (current !== null) return current.identity;
  const storage = chromeLivePeerStorage();
  const identity = await loadOrCreateLivePeerIdentity(storage);
  const keys = new Map<string, CryptoKey>([[identity.deviceId, identity.publicCryptoKey]]);
  const dao = new IndexedDbOperationDao();
  const kernel = new OperationKernel(
    new CoseOperationVerifier((deviceId) => keys.get(deviceId)),
    new CoseOperationSigner(identity.privateKey),
    new IndexedDbKernelJournal(dao),
    new SharedPreferenceProjection(),
    allowAllOperationAuthorization,
  );
  await installChromeLivePeer({
    storage,
    identity,
    ingest: (wire) => kernel.ingest(wire),
    outbox: async () => envelopesFrom(await dao.reconstruct()),
  });
  await installConfiguredCatchUpRoutes(storage, identity, (wire) => kernel.ingest(wire));
  return identity;
}

async function installConfiguredCatchUpRoutes(
  storage: LivePeerStorage,
  identity: LivePeerIdentity,
  ingest: (wire: Uint8Array) => Promise<string> | string,
): Promise<void> {
  const stored = await storage.get([MAILBOX_KEY, RENDEZVOUS_KEY]);
  const mailboxes = mailboxConfigs(stored[MAILBOX_KEY]);
  if (mailboxes.length > 0) {
    await installWebDavMailboxFromConfig({
      deviceId: identity.deviceId,
      publicKey: identity.publicKey,
      privateKey: identity.privateKey,
      endpoints: mailboxes,
      ingest,
    });
  }
  const rendezvous = stored[RENDEZVOUS_KEY];
  if (typeof rendezvous === "object" && rendezvous !== null) {
    const record = rendezvous as {
      sessionId?: unknown;
      contentKeyHex?: unknown;
      relays?: unknown;
      peerDeviceIds?: unknown;
    };
    if (typeof record.sessionId === "string" && typeof record.contentKeyHex === "string" && /^[0-9a-f]{64}$/.test(record.contentKeyHex)) {
      const contentKey = hexToBytes(record.contentKeyHex);
      const peerDeviceIds = Array.isArray(record.peerDeviceIds) ? record.peerDeviceIds.filter((id): id is string => typeof id === "string") : [];
      const relays = Array.isArray(record.relays) ? record.relays.filter((url): url is string => typeof url === "string") : [];
      const session = new NostrRendezvousSession(
        identity.deviceId,
        identity.publicKey,
        identity.privateKey,
        record.sessionId,
        contentKey,
        new WebSocketNostrTransport(relays),
        peerDeviceIds,
        ingest,
        identity.deviceId,
      );
      installNostrRendezvousRoutes([session.drainRoute()]);
    }
  }
}

class WebSocketNostrTransport implements NostrSyncTransport {
  constructor(private readonly relays: readonly string[]) {}
  async publish(event: NostrSyncEvent): Promise<void> {
    await Promise.all(this.relays.map((url) => publishEvent(url, event)));
  }
  async pull(filter: { readonly sessionId: string; readonly kinds: readonly number[]; readonly dTags?: readonly string[] }): Promise<readonly NostrSyncEvent[]> {
    const batches = await Promise.all(this.relays.map((url) => pullEvents(url, filter)));
    return batches.flat();
  }
}

async function publishEvent(url: string, event: NostrSyncEvent): Promise<void> {
  const socket = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      reject(new Error("nostr publish timed out"));
    }, 2_750);
    socket.onopen = () => socket.send(JSON.stringify(["EVENT", event]));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("nostr publish failed"));
    };
    socket.onmessage = () => {
      clearTimeout(timer);
      socket.close();
      resolve();
    };
  });
}

async function pullEvents(url: string, filter: { readonly sessionId: string; readonly kinds: readonly number[]; readonly dTags?: readonly string[] }): Promise<NostrSyncEvent[]> {
  const socket = new WebSocket(url);
  const events: NostrSyncEvent[] = [];
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.close();
      resolve();
    }, 2_750);
    socket.onopen = () => socket.send(JSON.stringify(["REQ", "pomo-sync", { kinds: [...filter.kinds], "#d": [...(filter.dTags ?? [filter.sessionId])] }]));
    socket.onerror = () => {
      clearTimeout(timer);
      reject(new Error("nostr pull failed"));
    };
    socket.onmessage = (message) => {
      if (typeof message.data !== "string") return;
      const frame = JSON.parse(message.data) as unknown;
      if (!Array.isArray(frame)) return;
      if (frame[0] === "EVENT" && typeof frame[2] === "object" && frame[2] !== null) events.push(frame[2] as NostrSyncEvent);
      if (frame[0] === "EOSE") {
        clearTimeout(timer);
        socket.close();
        resolve();
      }
    };
  });
  return events;
}

function mailboxConfigs(value: unknown): MailboxEndpointConfig[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const record = entry as Record<string, unknown>;
    if (typeof record.mailboxId !== "string" || typeof record.baseUrl !== "string" || typeof record.authorization !== "string") return [];
    const peerDeviceIds = Array.isArray(record.peerDeviceIds) ? record.peerDeviceIds.filter((id): id is string => typeof id === "string") : [];
    return [{ mailboxId: record.mailboxId, baseUrl: record.baseUrl, authorization: record.authorization, peerDeviceIds }];
  });
}

export async function receiveLivePeerBytes(routeId: string, bytes: Uint8Array): Promise<void> {
  await current?.receive(routeId, bytes);
}

export function isLivePeerRuntimeMessage(value: unknown): value is { readonly type: string; readonly routeId: string } {
  if (typeof value !== "object" || value === null) return false;
  const record = value as { type?: unknown; routeId?: unknown };
  return typeof record.type === "string" && record.type.startsWith("POMO_WEBRTC_") && typeof record.routeId === "string";
}

export async function handleLivePeerRuntimeMessage(message: { readonly type: string; readonly routeId: string } & Record<string, unknown>): Promise<void> {
  if (message.type === "POMO_WEBRTC_BYTES" && Array.isArray(message.bytes)) {
    await receiveLivePeerBytes(message.routeId, Uint8Array.from(message.bytes as number[]));
  }
}

async function createRemoteOffer(input: {
  readonly localDeviceId: string;
  readonly peerDeviceId: string;
  readonly pipe: LivePeerPipe;
  readonly signaling: WebRtcRendezvousSignaling;
  readonly iceServers: readonly RTCIceServer[];
}): Promise<void> {
  await input.pipe.ensureDocument();
  const opened = await input.pipe.open(input.peerDeviceId, input.iceServers);
  const description = opened.description;
  if (description?.type !== "offer" || description.sdp === undefined || description.sdp.length === 0) {
    throw new Error("missing local WebRTC offer");
  }
  await input.signaling.publish({
    kind: "sdp-offer",
    from: input.localDeviceId,
    to: input.peerDeviceId,
    sdpType: "offer",
    sdp: description.sdp,
  });
  const answer = await input.signaling.waitFor(input.peerDeviceId, input.localDeviceId, "sdp-answer");
  await input.pipe.setRemoteDescription(input.peerDeviceId, { type: answer.sdpType, sdp: answer.sdp });
}

async function acceptRemoteOffer(input: {
  readonly localDeviceId: string;
  readonly peerDeviceId: string;
  readonly pipe: LivePeerPipe;
  readonly signaling: WebRtcRendezvousSignaling;
  readonly iceServers: readonly RTCIceServer[];
  readonly offer: { readonly sdpType: "offer" | "answer"; readonly sdp: string };
}): Promise<void> {
  await input.pipe.ensureDocument();
  const opened = await input.pipe.open(input.peerDeviceId, input.iceServers, { type: input.offer.sdpType, sdp: input.offer.sdp });
  const description = opened.description;
  if (description?.type !== "answer" || description.sdp === undefined || description.sdp.length === 0) {
    throw new Error("missing local WebRTC answer");
  }
  await input.signaling.publish({
    kind: "sdp-answer",
    from: input.localDeviceId,
    to: input.peerDeviceId,
    sdpType: "answer",
    sdp: description.sdp,
  });
}

async function watchIncomingOffers(input: {
  readonly runtime: LivePeerRuntime;
  readonly peerIds: readonly string[];
  readonly directory: readonly LivePeerDirectoryEntry[];
  readonly pipe: LivePeerPipe;
  readonly signaling: WebRtcRendezvousSignaling;
  readonly iceServers: readonly RTCIceServer[];
}): Promise<void> {
  const answered = new Set<string>();
  while (!input.runtime.closed) {
    for (const peerId of input.peerIds) {
      const endpoint = input.directory.find((entry) => entry.deviceId === peerId)?.endpoint;
      if (endpoint !== undefined && endpoint.length > 0) continue;
      if (answered.has(peerId)) continue;
      const offer = (await input.signaling.pull(peerId, input.runtime.identity.deviceId)).filter((signal) => signal.kind === "sdp-offer").at(-1);
      if (offer === undefined) continue;
      try {
        await acceptRemoteOffer({
          localDeviceId: input.runtime.identity.deviceId,
          peerDeviceId: peerId,
          pipe: input.pipe,
          signaling: input.signaling,
          iceServers: input.iceServers,
          offer,
        });
        answered.add(peerId);
      } catch {
        // keep polling; failed or superseded attempts expire
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export function resetChromeLivePeer(): void {
  for (const runtime of runtimes) runtime.reset();
  runtimes.clear();
  current = null;
  installReplicaLan({ session: null, peers: [] });
  installWebRtcInboxRoutes([]);
}

function uniquePeerIds(
  localDeviceId: string,
  directory: readonly LivePeerDirectoryEntry[],
  obligations: readonly DurableRouteObligation[],
  extraPeerIds: readonly string[] = [],
): string[] {
  const ids = new Set<string>();
  for (const entry of directory) ids.add(entry.deviceId);
  for (const peerId of reconstructRoutePeers(obligations)) ids.add(peerId);
  for (const peerId of extraPeerIds) {
    if (/^[0-9a-f]{64}$/.test(peerId)) ids.add(peerId);
  }
  ids.delete(localDeviceId);
  return [...ids].sort();
}

function parseRendezvous(value: unknown): { sessionId: string; contentKey: Uint8Array; relays: string[]; peerDeviceIds: string[] } | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { sessionId?: unknown; contentKeyHex?: unknown; relays?: unknown; peerDeviceIds?: unknown };
  if (typeof record.sessionId !== "string" || typeof record.contentKeyHex !== "string" || !/^[0-9a-f]{64}$/.test(record.contentKeyHex)) return null;
  return {
    sessionId: record.sessionId,
    contentKey: hexToBytes(record.contentKeyHex),
    relays: Array.isArray(record.relays) ? record.relays.filter((url): url is string => typeof url === "string") : [],
    peerDeviceIds: Array.isArray(record.peerDeviceIds) ? record.peerDeviceIds.filter((id): id is string => typeof id === "string") : [],
  };
}

function directoryFrom(stored: Record<string, unknown>): LivePeerDirectoryEntry[] {
  const raw = stored[LIVE_PEERS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const deviceId = (entry as { deviceId?: unknown }).deviceId;
    const endpoint = (entry as { endpoint?: unknown }).endpoint;
    if (typeof deviceId !== "string" || !/^[0-9a-f]{64}$/.test(deviceId)) return [];
    return [{ deviceId, endpoint: typeof endpoint === "string" ? endpoint : undefined }];
  });
}

function iceFrom(stored: Record<string, unknown>): IceProviderConfig {
  const raw = stored[LIVE_PEER_ICE_KEY];
  if (typeof raw !== "object" || raw === null) return { stunUrls: [], turnUrls: [] };
  const record = raw as { stunUrls?: unknown; turnUrls?: unknown; turnUsername?: unknown; turnCredential?: unknown };
  return {
    stunUrls: Array.isArray(record.stunUrls) ? record.stunUrls.filter((url): url is string => typeof url === "string") : [],
    turnUrls: Array.isArray(record.turnUrls) ? record.turnUrls.filter((url): url is string => typeof url === "string") : [],
    turnUsername: typeof record.turnUsername === "string" ? record.turnUsername : undefined,
    turnCredential: typeof record.turnCredential === "string" ? record.turnCredential : undefined,
  };
}

function iceServers(ice: IceProviderConfig): readonly RTCIceServer[] {
  return [
    ...ice.stunUrls.map((urls) => ({ urls })),
    ...ice.turnUrls.map((urls) => ({ urls, username: ice.turnUsername, credential: ice.turnCredential })),
  ];
}

function isStoredIdentity(value: unknown): value is StoredIdentity {
  if (typeof value !== "object" || value === null) return false;
  const record = value as StoredIdentity;
  return typeof record.privateJwk === "object" && record.privateJwk !== null && typeof record.publicJwk === "object" && record.publicJwk !== null;
}

async function importIdentity(record: StoredIdentity): Promise<LivePeerIdentity> {
  const privateKey = await crypto.subtle.importKey("jwk", record.privateJwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const publicCryptoKey = await crypto.subtle.importKey("jwk", record.publicJwk, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", publicCryptoKey));
  const deviceId = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(publicKey))));
  return { deviceId, publicKey, privateKey, publicCryptoKey };
}
