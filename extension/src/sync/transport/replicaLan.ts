import { encodeCanonicalCbor, decodeCanonicalCbor, type CborValue } from "../protocol/cbor";
import { signP256LowS, verifyP256LowS } from "../crypto/PomoCrypto";
import { DirectSyncCoordinator, type DurablePeerAck, type SyncEnvelope } from "./directSync";
import type { DrainExchange, DrainRoute } from "./ordinaryDrain";

const REQUEST_LABEL = "pomo-replica-lan-request";
const RESPONSE_LABEL = "pomo-replica-lan-response";
const ACK_LABEL = "pomo-durable-peer-ack";
const SCHEMA = 1;
const DURABLE = new Set(["ACCEPTED", "DUPLICATE", "PENDING_GAP", "PENDING_CAUSAL", "QUARANTINED_FORK"]);

export interface ReplicaLanRequest {
  readonly deviceId: string;
  readonly envelopes: readonly SyncEnvelope[];
}

export interface ReplicaLanAck {
  readonly peerDeviceId: string;
  readonly publicKey: Uint8Array;
  readonly frontier: ReadonlyMap<string, { readonly sequence: number; readonly operationId: string; readonly coveredOperationIds: ReadonlySet<string> }>;
  readonly signature: Uint8Array;
}

export interface ReplicaLanResponse {
  readonly deviceId: string;
  readonly inbound: readonly SyncEnvelope[];
  readonly ack: ReplicaLanAck;
}

export interface ReplicaLanPeer {
  readonly deviceId: string;
  exchange(request: ReplicaLanRequest): Promise<ReplicaLanResponse> | ReplicaLanResponse;
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

function encodeEnvelopes(envelopes: readonly SyncEnvelope[]): CborValue {
  return envelopes.map((envelope) => [envelope.operationId, envelope.feedKey, envelope.sequence, envelope.wire.slice()]);
}

function decodeEnvelopes(value: CborValue): SyncEnvelope[] {
  if (!Array.isArray(value)) throw new Error("envelopes must be an array");
  return value.map((item) => {
    const fields = asArray(item, 4, "envelope");
    return {
      operationId: asText(fields[0]!, "operationId"),
      feedKey: asText(fields[1]!, "feedKey"),
      sequence: asInt(fields[2]!, "sequence"),
      wire: asBytes(fields[3]!, "wire").slice(),
    };
  });
}

function encodeFrontier(frontier: ReplicaLanAck["frontier"]): CborValue {
  return [...frontier.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([feedKey, head]) => [
    feedKey,
    head.sequence,
    head.operationId,
    [...head.coveredOperationIds].sort(),
  ]);
}

function decodeFrontier(value: CborValue): ReplicaLanAck["frontier"] {
  if (!Array.isArray(value)) throw new Error("frontier must be an array");
  const frontier = new Map<string, { sequence: number; operationId: string; coveredOperationIds: Set<string> }>();
  for (const item of value) {
    const fields = asArray(item, 4, "frontier entry");
    if (!Array.isArray(fields[3])) throw new Error("covered ids must be an array");
    frontier.set(asText(fields[0]!, "feedKey"), {
      sequence: asInt(fields[1]!, "sequence"),
      operationId: asText(fields[2]!, "operationId"),
      coveredOperationIds: new Set(fields[3].map((id) => asText(id, "coveredOperationId"))),
    });
  }
  return frontier;
}

export function encodeAckBody(peerDeviceId: string, publicKey: Uint8Array, frontier: ReplicaLanAck["frontier"]): Uint8Array {
  return encodeCanonicalCbor([ACK_LABEL, SCHEMA, peerDeviceId, publicKey.slice(), encodeFrontier(frontier)]);
}

export function encodeLanRequest(request: ReplicaLanRequest): Uint8Array {
  return encodeCanonicalCbor([REQUEST_LABEL, SCHEMA, request.deviceId, encodeEnvelopes(request.envelopes)]);
}

export function decodeLanRequest(bytes: Uint8Array): ReplicaLanRequest {
  const fields = asArray(decodeCanonicalCbor(bytes), 4, "replica request");
  if (fields[0] !== REQUEST_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected replica request frame");
  return { deviceId: asText(fields[2]!, "deviceId"), envelopes: decodeEnvelopes(fields[3]!) };
}

export function encodeLanResponse(response: ReplicaLanResponse): Uint8Array {
  return encodeCanonicalCbor([
    RESPONSE_LABEL,
    SCHEMA,
    response.deviceId,
    encodeEnvelopes(response.inbound),
    encodeAckBody(response.ack.peerDeviceId, response.ack.publicKey, response.ack.frontier),
    response.ack.signature.slice(),
  ]);
}

export function decodeLanResponse(bytes: Uint8Array): ReplicaLanResponse {
  const fields = asArray(decodeCanonicalCbor(bytes), 6, "replica response");
  if (fields[0] !== RESPONSE_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected replica response frame");
  const ackFields = asArray(decodeCanonicalCbor(asBytes(fields[4]!, "ack body")), 5, "ack body");
  if (ackFields[0] !== ACK_LABEL || ackFields[1] !== SCHEMA) throw new Error("unexpected replica ack");
  return {
    deviceId: asText(fields[2]!, "deviceId"),
    inbound: decodeEnvelopes(fields[3]!),
    ack: {
      peerDeviceId: asText(ackFields[2]!, "peerDeviceId"),
      publicKey: asBytes(ackFields[3]!, "publicKey").slice(),
      frontier: decodeFrontier(ackFields[4]!),
      signature: asBytes(fields[5]!, "signature").slice(),
    },
  };
}

export async function verifyLanAck(ack: ReplicaLanAck): Promise<DurablePeerAck> {
  const publicKey = await crypto.subtle.importKey("raw", ack.publicKey, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const verified = await verifyP256LowS(publicKey, encodeAckBody(ack.peerDeviceId, ack.publicKey, ack.frontier), ack.signature);
  return { peerDeviceId: ack.peerDeviceId, frontier: ack.frontier, signatureVerified: verified };
}

export class ReplicaLanSession {
  constructor(
    readonly deviceId: string,
    readonly publicKey: Uint8Array,
    private readonly privateKey: CryptoKey,
    private readonly ingest: (wire: Uint8Array) => Promise<string> | string,
    private readonly outbox: () => readonly SyncEnvelope[] | Promise<readonly SyncEnvelope[]>,
  ) {
    if (publicKey.length !== 65 || publicKey[0] !== 4) throw new Error("replica LAN public key must be uncompressed P-256");
  }

  async handle(request: ReplicaLanRequest): Promise<ReplicaLanResponse> {
    const covered = new Set<string>();
    for (const envelope of request.envelopes.slice(0, DirectSyncCoordinator.MAX_BATCH)) {
      const disposition = await this.ingest(envelope.wire.slice());
      if (DURABLE.has(disposition)) covered.add(envelope.operationId);
    }
    return {
      deviceId: this.deviceId,
      inbound: (await this.outbox()).slice(0, DirectSyncCoordinator.MAX_BATCH),
      ack: await this.signAck(request.envelopes, covered),
    };
  }

  drainRoute(peer: ReplicaLanPeer): DrainRoute {
    return {
      name: `lan:${peer.deviceId}`,
      exchange: async (batch) => {
        const response = await peer.exchange({ deviceId: this.deviceId, envelopes: batch });
        return {
          inbound: response.inbound,
          ack: await verifyLanAck(response.ack),
          connected: true,
        } satisfies DrainExchange;
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
      const head = envelopes.reduce((current, envelope) => envelope.sequence >= current.sequence ? envelope : current);
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

const peers: ReplicaLanPeer[] = [];
let session: ReplicaLanSession | null = null;
let ingestWire: ((wire: Uint8Array) => Promise<unknown> | unknown) | null = null;

export function installReplicaLan(next: { session: ReplicaLanSession | null; peers: readonly ReplicaLanPeer[]; ingest?: (wire: Uint8Array) => Promise<unknown> | unknown }): void {
  session = next.session;
  peers.splice(0, peers.length, ...next.peers);
  ingestWire = next.ingest ?? null;
}

export function replicaLanDrainRoutes(): DrainRoute[] {
  const current = session;
  if (current === null) return [];
  return peers.filter((peer) => peer.deviceId !== current.deviceId).map((peer) => current.drainRoute(peer));
}

export async function ingestReplicaLan(wire: Uint8Array): Promise<void> {
  await ingestWire?.(wire.slice());
}
