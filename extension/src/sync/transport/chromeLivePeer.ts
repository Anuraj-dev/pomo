import { bufferOf } from "../../shared/bytes";
import { bytesToHex } from "../../shared/hex";
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
  ensureWebRtcOffscreenDocument,
  reconstructRoutePeers,
  type DurableRouteObligation,
  type IceProviderConfig,
} from "./WebRtcRouteManager";

export const LIVE_PEER_IDENTITY_KEY = "pomo:sync:live-peer-identity";
export const LIVE_PEERS_KEY = "pomo:sync:live-peers";
export const LIVE_PEER_ICE_KEY = "pomo:sync:webrtc-ice";

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
  addCandidate(routeId: string, candidate: RTCIceCandidateInit): Promise<void>;
  send(routeId: string, bytes: Uint8Array): Promise<void>;
  close(routeId: string): Promise<void>;
}

export interface LivePeerDirectoryEntry {
  readonly deviceId: string;
}

interface StoredIdentity {
  readonly privateJwk: JsonWebKey;
  readonly publicJwk: JsonWebKey;
}

let current: LivePeerRuntime | null = null;

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
  async open(): Promise<{ readonly description?: RTCSessionDescriptionInit | null }> {
    return {};
  }
  async addCandidate(): Promise<void> {}
  async close(): Promise<void> {}
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
}): Promise<LivePeerIdentity> {
  const identity = input.identity ?? await loadOrCreateLivePeerIdentity(input.storage);
  const ice = iceFrom(await input.storage.get([LIVE_PEER_ICE_KEY]));
  configureWebRtcIce(ice);
  const session = new ReplicaLanSession(identity.deviceId, identity.publicKey, identity.privateKey, input.ingest, input.outbox);
  const pipe = input.pipe ?? (typeof chrome !== "undefined" && chrome.offscreen !== undefined ? new ChromeOffscreenPipe() : null);
  const inbox = input.inbox ?? (typeof indexedDB !== "undefined" ? packagedWebRtcInbox() : null);
  const runtime = new LivePeerRuntime(identity, session, pipe, inbox, input.ingest);
  const directory = directoryFrom(await input.storage.get([LIVE_PEERS_KEY]));
  const peerIds = uniquePeerIds(identity.deviceId, directory, input.obligations ?? []);
  const peers: ReplicaLanPeer[] = pipe === null ? [] : peerIds.map((deviceId) => ({
    deviceId,
    exchange: async (request) => {
      await pipe.ensureDocument();
      await pipe.open(deviceId, iceServers(ice));
      const response = runtime.waitForResponse(deviceId);
      await pipe.send(deviceId, encodeLanRequest(request));
      return response;
    },
  }));
  installReplicaLan({ session, peers, ingest: input.ingest });
  installWebRtcInboxRoutes(inbox === null ? [] : [webRtcInboxDrainRoute({ inbox, ingest: input.ingest })]);
  if (pipe instanceof MemoryLivePipe) pipe.onBytes = (routeId, bytes) => runtime.receive(routeId, bytes);
  current = runtime;
  await runtime.pumpInbox();
  return identity;
}

export async function ensurePackagedChromeLivePeer(): Promise<LivePeerIdentity | null> {
  if (typeof chrome === "undefined" || chrome.storage?.local === undefined) return current?.identity ?? null;
  if (current !== null) {
    await current.pumpInbox();
    return current.identity;
  }
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
  return identity;
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

export function resetChromeLivePeer(): void {
  current?.reset();
  current = null;
  installReplicaLan({ session: null, peers: [] });
  installWebRtcInboxRoutes([]);
}

function uniquePeerIds(localDeviceId: string, directory: readonly LivePeerDirectoryEntry[], obligations: readonly DurableRouteObligation[]): string[] {
  const ids = new Set<string>();
  for (const entry of directory) ids.add(entry.deviceId);
  for (const peerId of reconstructRoutePeers(obligations)) ids.add(peerId);
  ids.delete(localDeviceId);
  return [...ids].sort();
}

function directoryFrom(stored: Record<string, unknown>): LivePeerDirectoryEntry[] {
  const raw = stored[LIVE_PEERS_KEY];
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const deviceId = (entry as { deviceId?: unknown }).deviceId;
    return typeof deviceId === "string" && /^[0-9a-f]{64}$/.test(deviceId) ? [{ deviceId }] : [];
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
