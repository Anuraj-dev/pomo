import { bufferOf, bytesToUtf8, utf8ToBytes } from "../../shared/bytes";
import { bytesToHex, hexToBytes } from "../../shared/hex";
import { encodeCanonicalCbor, decodeCanonicalCbor, type CborValue } from "../protocol/cbor";
import { decryptAes256Gcm, encryptAes256Gcm, signP256LowS } from "../crypto/PomoCrypto";
import type { DurablePeerAck, SyncEnvelope } from "./directSync";
import type { DrainExchange, DrainRoute } from "./ordinaryDrain";
import { encodeAckBody, verifyLanAck, type ReplicaLanAck } from "./replicaLan";

const MAX_SIGNAL_BYTES = 16_384;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const OFFER_LABEL = "pomo-nostr-offer";
const ACK_LABEL = "pomo-nostr-ack";
const SCHEMA = 1;
const DURABLE = new Set(["ACCEPTED", "DUPLICATE", "PENDING_GAP", "PENDING_CAUSAL", "QUARANTINED_FORK"]);

/** Application-specific Nostr kind for sync rendezvous. Distinct from Crew 39050. */
export const SYNC_RENDEZVOUS_KIND = 39_051;

export interface RendezvousSignal { readonly signalId: string; readonly sequence: number; readonly expiresAt: number; readonly payload: Uint8Array }
export interface EncryptedSignal { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array }

export interface NostrSyncEvent {
  readonly id: string;
  readonly pubkey: string;
  readonly created_at: number;
  readonly kind: number;
  readonly tags: readonly (readonly string[])[];
  readonly content: string;
  readonly sig: string;
}

export interface NostrSyncTransport {
  publish(event: NostrSyncEvent): Promise<void> | void;
  pull(filter: { readonly sessionId: string; readonly kinds: readonly number[]; readonly dTags?: readonly string[] }): Promise<readonly NostrSyncEvent[]> | readonly NostrSyncEvent[];
}

export type WebRtcSdpKind = "sdp-offer" | "sdp-answer";

export interface WebRtcSdpSignal {
  readonly kind: WebRtcSdpKind;
  readonly from: string;
  readonly to: string;
  readonly sdpType: "offer" | "answer";
  readonly sdp: string;
}

export async function encryptSignal(key: CryptoKey, signal: RendezvousSignal): Promise<EncryptedSignal> {
  if (signal.payload.length > MAX_SIGNAL_BYTES || signal.sequence < 0 || signal.expiresAt <= Date.now()) throw new Error("invalid rendezvous signal");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ signalId: signal.signalId, sequence: signal.sequence, expiresAt: signal.expiresAt, payload: [...signal.payload] }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, body));
  return { nonce, ciphertext };
}

export class RendezvousReplayWindow {
  readonly #seen = new Set<string>();
  async decrypt(key: CryptoKey, encrypted: EncryptedSignal, now = Date.now()): Promise<RendezvousSignal> {
    if (encrypted.nonce.length !== 12 || encrypted.ciphertext.length > MAX_SIGNAL_BYTES + 1_024) throw new Error("invalid encrypted signal");
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferOf(encrypted.nonce) }, key, bufferOf(encrypted.ciphertext)));
    const value = JSON.parse(new TextDecoder().decode(raw)) as { signalId: string; sequence: number; expiresAt: number; payload: number[] };
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.expiresAt < now || value.expiresAt > now + MAX_CLOCK_SKEW_MS || this.#seen.has(value.signalId)) throw new Error("expired or replayed rendezvous signal");
    this.#seen.add(value.signalId);
    return { signalId: value.signalId, sequence: value.sequence, expiresAt: value.expiresAt, payload: new Uint8Array(value.payload) };
  }
}

export async function importRendezvousSignalKey(bytes: Uint8Array): Promise<CryptoKey> {
  if (bytes.length !== 32) throw new Error("rendezvous signal key must be 32 bytes");
  return crypto.subtle.importKey("raw", bufferOf(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

export function signalLocator(sessionId: string, from: string, to: string): string {
  return `${sessionId}:signal:${from}:${to}`;
}

export function encodeSdpSignal(signal: WebRtcSdpSignal): Uint8Array {
  if (!/^[0-9a-f]{64}$/.test(signal.from) || !/^[0-9a-f]{64}$/.test(signal.to)) throw new Error("sdp signal device ids must be 32-byte hex");
  if (signal.sdp.length === 0 || utf8ToBytes(signal.sdp).length > MAX_SIGNAL_BYTES - 256) throw new Error("sdp signal payload is empty or too large");
  if ((signal.kind === "sdp-offer") !== (signal.sdpType === "offer")) throw new Error("sdp signal kind must match sdpType");
  return utf8ToBytes(JSON.stringify({
    v: 1,
    kind: signal.kind,
    from: signal.from,
    to: signal.to,
    sdpType: signal.sdpType,
    sdp: signal.sdp,
  }));
}

export function decodeSdpSignal(bytes: Uint8Array): WebRtcSdpSignal {
  const value = JSON.parse(bytesToUtf8(bytes)) as Record<string, unknown>;
  if (value.v !== 1 || (value.kind !== "sdp-offer" && value.kind !== "sdp-answer")) throw new Error("unexpected sdp signal");
  if (typeof value.from !== "string" || typeof value.to !== "string" || !/^[0-9a-f]{64}$/.test(value.from) || !/^[0-9a-f]{64}$/.test(value.to)) {
    throw new Error("sdp signal device ids must be 32-byte hex");
  }
  if (value.sdpType !== "offer" && value.sdpType !== "answer") throw new Error("sdp signal type must be offer or answer");
  if (typeof value.sdp !== "string" || value.sdp.length === 0) throw new Error("sdp signal is empty");
  if ((value.kind === "sdp-offer") !== (value.sdpType === "offer")) throw new Error("sdp signal kind must match sdpType");
  return { kind: value.kind, from: value.from, to: value.to, sdpType: value.sdpType, sdp: value.sdp };
}

function encodeEncryptedSignalContent(encrypted: EncryptedSignal): string {
  return bytesToHex(encodeCanonicalCbor([encrypted.nonce, encrypted.ciphertext]));
}

function decodeEncryptedSignalContent(content: string): EncryptedSignal {
  const fields = asArray(decodeCanonicalCbor(hexToBytes(content)), 2, "encrypted signal");
  return { nonce: asBytes(fields[0]!, "nonce").slice(), ciphertext: asBytes(fields[1]!, "ciphertext").slice() };
}

export class WebRtcRendezvousSignaling {
  private sequence = 0;
  private readonly window = new RendezvousReplayWindow();
  private readonly decoded = new Map<string, WebRtcSdpSignal>();

  constructor(
    readonly deviceId: string,
    private readonly sessionId: string,
    private readonly key: CryptoKey,
    private readonly transport: NostrSyncTransport,
    private readonly authorPubkey: string,
  ) {}

  async publish(signal: WebRtcSdpSignal): Promise<void> {
    if (signal.from !== this.deviceId) throw new Error("sdp signal from must be the local device");
    this.sequence += 1;
    const encrypted = await encryptSignal(this.key, {
      signalId: bytesToHex(crypto.getRandomValues(new Uint8Array(16))),
      sequence: this.sequence,
      expiresAt: Date.now() + 60_000,
      payload: encodeSdpSignal(signal),
    });
    await this.transport.publish({
      id: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
      pubkey: this.authorPubkey,
      created_at: Math.floor(Date.now() / 1000),
      kind: SYNC_RENDEZVOUS_KIND,
      tags: [["d", signalLocator(this.sessionId, signal.from, signal.to)], ["pomo", "signal"], ["device", signal.from], ["peer", signal.to]],
      content: encodeEncryptedSignalContent(encrypted),
      sig: "00".repeat(64),
    });
  }

  async pull(from: string, to: string): Promise<WebRtcSdpSignal[]> {
    const events = await this.transport.pull({
      sessionId: this.sessionId,
      kinds: [SYNC_RENDEZVOUS_KIND],
      dTags: [signalLocator(this.sessionId, from, to)],
    });
    const signals: WebRtcSdpSignal[] = [];
    for (const event of events) {
      if (event.tags.find((tag) => tag[0] === "pomo")?.[1] !== "signal") continue;
      const cached = this.decoded.get(event.id);
      if (cached !== undefined) {
        if (cached.from === from && cached.to === to) signals.push(cached);
        continue;
      }
      try {
        const decrypted = await this.window.decrypt(this.key, decodeEncryptedSignalContent(event.content));
        const signal = decodeSdpSignal(decrypted.payload);
        this.decoded.set(event.id, signal);
        if (signal.from === from && signal.to === to) signals.push(signal);
      } catch {
        // expired, replayed, or not an SDP signal
      }
    }
    return signals;
  }

  async waitFor(from: string, to: string, kind: WebRtcSdpKind, timeoutMs = 4_000): Promise<WebRtcSdpSignal> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const matches = (await this.pull(from, to)).filter((signal) => signal.kind === kind);
      if (matches.length > 0) return matches[matches.length - 1]!;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("webrtc signaling timed out");
  }
}

function asArray(value: CborValue, length: number, name: string): readonly CborValue[] {
  if (!Array.isArray(value) || value.length !== length) throw new Error(`${name} must be a ${length}-item array`);
  return value;
}

function asText(value: CborValue, name: string): string {
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  return value;
}

function asInt(value: CborValue, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) throw new Error(`${name} must be an integer`);
  return value;
}

function asBytes(value: CborValue, name: string): Uint8Array {
  if (!(value instanceof Uint8Array)) throw new Error(`${name} must be a byte string`);
  return value;
}

export function encodeNostrOffer(deviceId: string, envelopes: readonly SyncEnvelope[]): Uint8Array {
  return encodeCanonicalCbor([
    OFFER_LABEL,
    SCHEMA,
    deviceId,
    envelopes.map((envelope) => [envelope.operationId, envelope.feedKey, envelope.sequence, envelope.wire.slice()]),
  ]);
}

export function decodeNostrOffer(bytes: Uint8Array): { deviceId: string; envelopes: SyncEnvelope[] } {
  const fields = asArray(decodeCanonicalCbor(bytes), 4, "nostr offer");
  if (fields[0] !== OFFER_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected nostr offer");
  if (!Array.isArray(fields[3])) throw new Error("offer envelopes must be an array");
  return {
    deviceId: asText(fields[2]!, "deviceId"),
    envelopes: fields[3].map((item) => {
      const entry = asArray(item, 4, "offer envelope");
      return {
        operationId: asText(entry[0]!, "operationId"),
        feedKey: asText(entry[1]!, "feedKey"),
        sequence: asInt(entry[2]!, "sequence"),
        wire: asBytes(entry[3]!, "wire").slice(),
      };
    }),
  };
}

export function encodeNostrAckObject(ack: ReplicaLanAck): Uint8Array {
  return encodeCanonicalCbor([ACK_LABEL, SCHEMA, encodeAckBody(ack.peerDeviceId, ack.publicKey, ack.frontier), ack.signature.slice()]);
}

export function decodeNostrAckObject(bytes: Uint8Array): ReplicaLanAck {
  const fields = asArray(decodeCanonicalCbor(bytes), 4, "nostr ack");
  if (fields[0] !== ACK_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected nostr ack");
  const body = asBytes(fields[2]!, "ack body");
  const signature = asBytes(fields[3]!, "signature").slice();
  const ackFields = asArray(decodeCanonicalCbor(body), 5, "ack body");
  if (ackFields[0] !== "pomo-durable-peer-ack" || ackFields[1] !== 1) throw new Error("unexpected durable ack");
  const frontierValue = ackFields[4]!;
  if (!Array.isArray(frontierValue)) throw new Error("frontier must be an array");
  const frontier = new Map<string, { sequence: number; operationId: string; coveredOperationIds: Set<string> }>();
  for (const item of frontierValue) {
    const entry = asArray(item, 4, "frontier entry");
    if (!Array.isArray(entry[3])) throw new Error("covered ids must be an array");
    frontier.set(asText(entry[0]!, "feedKey"), {
      sequence: asInt(entry[1]!, "sequence"),
      operationId: asText(entry[2]!, "operationId"),
      coveredOperationIds: new Set(entry[3].map((id) => asText(id, "coveredOperationId"))),
    });
  }
  return {
    peerDeviceId: asText(ackFields[2]!, "peerDeviceId"),
    publicKey: asBytes(ackFields[3]!, "publicKey").slice(),
    frontier,
    signature,
  };
}

async function sealPayload(contentKey: Uint8Array, payload: Uint8Array): Promise<string> {
  const sealed = await encryptAes256Gcm(contentKey, crypto.getRandomValues(new Uint8Array(12)), new Uint8Array(), payload);
  return bytesToHex(encodeCanonicalCbor([sealed.nonce, sealed.ciphertextAndTag]));
}

async function openPayload(contentKey: Uint8Array, content: string): Promise<Uint8Array> {
  const hex = content.match(/.{1,2}/g);
  if (hex === null) throw new Error("invalid sealed content");
  const bytes = Uint8Array.from(hex.map((pair) => Number.parseInt(pair, 16)));
  const fields = asArray(decodeCanonicalCbor(bytes), 2, "sealed content");
  return decryptAes256Gcm(contentKey, { nonce: asBytes(fields[0]!, "nonce"), ciphertextAndTag: asBytes(fields[1]!, "ciphertext") }, new Uint8Array());
}

export class NostrRendezvousSession {
  constructor(
    readonly deviceId: string,
    readonly publicKey: Uint8Array,
    private readonly privateKey: CryptoKey,
    private readonly sessionId: string,
    private readonly contentKey: Uint8Array,
    private readonly transport: NostrSyncTransport,
    private readonly peerDeviceIds: readonly string[],
    private readonly ingest: (wire: Uint8Array) => Promise<string> | string,
    private readonly authorPubkey: string,
  ) {
    if (contentKey.length !== 32) throw new Error("nostr rendezvous content key must be 32 bytes");
  }

  drainRoute(): DrainRoute {
    return {
      name: `nostr:${this.sessionId}`,
      exchange: async (batch): Promise<DrainExchange> => {
        if (batch.length > 0) {
          const content = await sealPayload(this.contentKey, encodeNostrOffer(this.deviceId, batch));
          await this.transport.publish({
            id: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
            pubkey: this.authorPubkey,
            created_at: Math.floor(Date.now() / 1000),
            kind: SYNC_RENDEZVOUS_KIND,
            tags: [["d", this.sessionId], ["pomo", "offer"], ["device", this.deviceId]],
            content,
            sig: "00".repeat(64),
          });
        }
        const events = await this.transport.pull({ sessionId: this.sessionId, kinds: [SYNC_RENDEZVOUS_KIND] });
        const inbound = new Map<string, SyncEnvelope>();
        let ack: DurablePeerAck | undefined;
        for (const event of events) {
          const kindTag = event.tags.find((tag) => tag[0] === "pomo")?.[1];
          const deviceTag = event.tags.find((tag) => tag[0] === "device")?.[1];
          if (kindTag === "signal") continue;
          if (kindTag === "offer" && deviceTag !== undefined && deviceTag !== this.deviceId && this.peerDeviceIds.includes(deviceTag)) {
            const offer = decodeNostrOffer(await openPayload(this.contentKey, event.content));
            const accepted: SyncEnvelope[] = [];
            const covered = new Set<string>();
            for (const envelope of offer.envelopes) {
              const disposition = await this.ingest(envelope.wire.slice());
              if (DURABLE.has(disposition)) {
                covered.add(envelope.operationId);
                accepted.push(envelope);
              }
              inbound.set(envelope.operationId, envelope);
            }
            if (covered.size > 0) {
              const signed = await this.signAck(accepted, covered);
              await this.transport.publish({
                id: bytesToHex(crypto.getRandomValues(new Uint8Array(32))),
                pubkey: this.authorPubkey,
                created_at: Math.floor(Date.now() / 1000),
                kind: SYNC_RENDEZVOUS_KIND,
                tags: [["d", this.sessionId], ["pomo", "ack"], ["device", deviceTag]],
                content: await sealPayload(this.contentKey, encodeNostrAckObject(signed)),
                sig: "00".repeat(64),
              });
            }
          }
          if (kindTag === "ack" && deviceTag === this.deviceId) {
            try {
              ack = await verifyLanAck(decodeNostrAckObject(await openPayload(this.contentKey, event.content)));
            } catch {
              // ignore malformed ack
            }
          }
        }
        return { inbound: [...inbound.values()], ack, connected: true };
      },
    };
  }

  private async signAck(batch: readonly SyncEnvelope[], covered: ReadonlySet<string>): Promise<ReplicaLanAck> {
    const grouped = new Map<string, SyncEnvelope[]>();
    for (const envelope of batch) {
      if (!covered.has(envelope.operationId)) continue;
      const list = grouped.get(envelope.feedKey) ?? [];
      list.push(envelope);
      grouped.set(envelope.feedKey, list);
    }
    const frontier = new Map<string, { sequence: number; operationId: string; coveredOperationIds: Set<string> }>();
    for (const [feedKey, envelopes] of grouped) {
      const head = envelopes.reduce((current, envelope) => envelope.sequence > current.sequence ? envelope : current);
      frontier.set(feedKey, {
        sequence: head.sequence,
        operationId: head.operationId,
        coveredOperationIds: new Set(envelopes.map((envelope) => envelope.operationId)),
      });
    }
    const signature = await signP256LowS(this.privateKey, encodeAckBody(this.deviceId, this.publicKey, frontier));
    return { peerDeviceId: this.deviceId, publicKey: this.publicKey.slice(), frontier, signature };
  }
}

let installedNostrRoutes: DrainRoute[] = [];

export function installNostrRendezvousRoutes(routes: readonly DrainRoute[]): void {
  installedNostrRoutes = [...routes];
}

export function nostrRendezvousDrainRoutes(): DrainRoute[] {
  return [...installedNostrRoutes];
}
