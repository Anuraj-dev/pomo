import { bufferOf } from "../../shared/bytes";
import { bytesToHex } from "../../shared/hex";
import { encodeCanonicalCbor, decodeCanonicalCbor, type CborValue } from "../protocol/cbor";
import { signP256LowS } from "../crypto/PomoCrypto";
import type { DurablePeerAck, SyncEnvelope } from "./directSync";
import type { DrainExchange, DrainRoute } from "./ordinaryDrain";
import { encodeAckBody, verifyLanAck, type ReplicaLanAck } from "./replicaLan";

export interface MailboxObject { readonly objectId: string; readonly bytes: Uint8Array; readonly sha256: string; readonly size: number }
export interface MailboxManifest { readonly manifestId: string; readonly checkpointId: string; readonly packIds: readonly string[]; readonly operationIds: readonly string[]; readonly blobIds: readonly string[] }
export type MailboxFailure = "CORS" | "QUOTA" | "CREDENTIAL" | "ROLLBACK" | "MISSING_OBJECT" | "NETWORK";
export interface MailboxProtection { readonly mailboxId: string; readonly protected: boolean; readonly failure: MailboxFailure | null }
export interface ImmutableMailboxClient {
  createIfAbsent(objectId: string, bytes: Uint8Array): Promise<boolean>;
  get(objectId: string): Promise<Uint8Array | null>;
  put(objectId: string, bytes: Uint8Array): Promise<void>;
}

const OFFER_LABEL = "pomo-mailbox-offer";
const ACK_OBJECT_LABEL = "pomo-mailbox-ack";
const ACK_LABEL = "pomo-durable-peer-ack";
const SCHEMA = 1;
const DURABLE = new Set(["ACCEPTED", "DUPLICATE", "PENDING_GAP", "PENDING_CAUSAL", "QUARANTINED_FORK"]);

export class WebDavMailbox {
  constructor(readonly mailboxId: string, private readonly client: ImmutableMailboxClient) {}
  async protect(objects: readonly MailboxObject[]): Promise<MailboxProtection> {
    try {
      for (const expected of objects) {
        await this.client.createIfAbsent(expected.objectId, expected.bytes.slice());
        const retrieved = await this.client.get(expected.objectId);
        if (retrieved === null) return { mailboxId: this.mailboxId, protected: false, failure: "MISSING_OBJECT" };
        if (retrieved.length !== expected.size || await sha256(retrieved) !== expected.sha256) return { mailboxId: this.mailboxId, protected: false, failure: "ROLLBACK" };
      }
      return { mailboxId: this.mailboxId, protected: true, failure: null };
    } catch (error) {
      return { mailboxId: this.mailboxId, protected: false, failure: classifyFailure(error) };
    }
  }
  async challenge(expected: MailboxObject): Promise<boolean> {
    const retrieved = await this.client.get(expected.objectId);
    return retrieved !== null && retrieved.length === expected.size && await sha256(retrieved) === expected.sha256;
  }
}

export class FetchWebDavClient implements ImmutableMailboxClient {
  constructor(private readonly baseUrl: string, private readonly authorization: string) {}
  async createIfAbsent(objectId: string, bytes: Uint8Array): Promise<boolean> {
    const response = await fetch(new URL(encodeURIComponent(objectId), this.baseUrl), { method: "PUT", headers: { Authorization: this.authorization, "If-None-Match": "*", "Content-Type": "application/octet-stream" }, body: bufferOf(bytes) });
    if (response.status === 412) return false;
    if (!response.ok) throw new Error(`WEBDAV_${response.status}`);
    return true;
  }
  async get(objectId: string): Promise<Uint8Array | null> {
    const response = await fetch(new URL(encodeURIComponent(objectId), this.baseUrl), { headers: { Authorization: this.authorization, "Cache-Control": "no-cache" } });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`WEBDAV_${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }
  async put(objectId: string, bytes: Uint8Array): Promise<void> {
    const response = await fetch(new URL(encodeURIComponent(objectId), this.baseUrl), { method: "PUT", headers: { Authorization: this.authorization, "Content-Type": "application/octet-stream" }, body: bufferOf(bytes) });
    if (!response.ok) throw new Error(`WEBDAV_${response.status}`);
  }
}

export async function repairMailbox(source: ImmutableMailboxClient, target: ImmutableMailboxClient, objectIds: readonly string[]): Promise<ReadonlySet<string>> {
  const repaired = new Set<string>();
  for (const id of objectIds) { const bytes = await source.get(id); if (bytes !== null && await target.createIfAbsent(id, bytes.slice())) repaired.add(id); }
  return repaired;
}

export async function objectIdForWire(wire: Uint8Array): Promise<string> {
  return sha256(wire);
}

export function offerLocator(deviceId: string): string {
  return `locator-offer-${deviceId}`;
}

export function ackLocator(targetDeviceId: string): string {
  return `locator-ack-${targetDeviceId}`;
}

export async function mailboxObjects(batch: readonly SyncEnvelope[]): Promise<MailboxObject[]> {
  return Promise.all(batch.map(async (envelope) => {
    const bytes = envelope.wire.slice();
    const digest = await sha256(bytes);
    return { objectId: digest, bytes, sha256: digest, size: bytes.length };
  }));
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

export async function encodeOffer(deviceId: string, envelopes: readonly SyncEnvelope[]): Promise<Uint8Array> {
  const entries = await Promise.all(envelopes.map(async (envelope) => [
    envelope.operationId,
    envelope.feedKey,
    envelope.sequence,
    await objectIdForWire(envelope.wire),
  ]));
  return encodeCanonicalCbor([OFFER_LABEL, SCHEMA, deviceId, entries]);
}

export function decodeOffer(bytes: Uint8Array): { deviceId: string; entries: Array<{ envelope: SyncEnvelope; objectId: string }> } {
  const fields = asArray(decodeCanonicalCbor(bytes), 4, "mailbox offer");
  if (fields[0] !== OFFER_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected mailbox offer");
  if (!Array.isArray(fields[3])) throw new Error("offer entries must be an array");
  return {
    deviceId: asText(fields[2]!, "deviceId"),
    entries: fields[3].map((item) => {
      const entry = asArray(item, 4, "offer entry");
      return {
        envelope: {
          operationId: asText(entry[0]!, "operationId"),
          feedKey: asText(entry[1]!, "feedKey"),
          sequence: asInt(entry[2]!, "sequence"),
          wire: new Uint8Array(),
        },
        objectId: asText(entry[3]!, "objectId"),
      };
    }),
  };
}

export function encodeAckObject(ack: ReplicaLanAck): Uint8Array {
  return encodeCanonicalCbor([ACK_OBJECT_LABEL, SCHEMA, encodeAckBody(ack.peerDeviceId, ack.publicKey, ack.frontier), ack.signature.slice()]);
}

export function decodeAckObject(bytes: Uint8Array): ReplicaLanAck {
  const fields = asArray(decodeCanonicalCbor(bytes), 4, "mailbox ack");
  if (fields[0] !== ACK_OBJECT_LABEL || fields[1] !== SCHEMA) throw new Error("unexpected mailbox ack");
  const body = asBytes(fields[2]!, "ack body");
  const signature = asBytes(fields[3]!, "signature").slice();
  const ackFields = asArray(decodeCanonicalCbor(body), 5, "ack body");
  if (ackFields[0] !== ACK_LABEL || ackFields[1] !== SCHEMA) throw new Error("unexpected durable ack");
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

export class WebDavMailboxSession {
  constructor(
    readonly deviceId: string,
    readonly publicKey: Uint8Array,
    private readonly mailboxId: string,
    private readonly client: ImmutableMailboxClient,
    private readonly peerDeviceIds: readonly string[],
    private readonly privateKey: CryptoKey,
    private readonly ingest: (wire: Uint8Array) => Promise<string> | string,
  ) {}

  drainRoute(): DrainRoute {
    const mailbox = new WebDavMailbox(this.mailboxId, this.client);
    return {
      name: `mailbox:${this.mailboxId}`,
      exchange: async (batch): Promise<DrainExchange> => {
        const objects = await mailboxObjects(batch);
        const protection = await mailbox.protect(objects);
        if (!protection.protected) return { connected: false };
        if (batch.length > 0) {
          await this.client.put(offerLocator(this.deviceId), await encodeOffer(this.deviceId, batch));
        }
        const inbound = new Map<string, SyncEnvelope>();
        for (const peerId of this.peerDeviceIds) {
          if (peerId === this.deviceId) continue;
          const offerBytes = await this.client.get(offerLocator(peerId));
          if (offerBytes === null) continue;
          const { entries } = decodeOffer(offerBytes);
          const accepted: SyncEnvelope[] = [];
          const covered = new Set<string>();
          for (const entry of entries) {
            const wire = await this.client.get(entry.objectId);
            if (wire === null) continue;
            const envelope = { ...entry.envelope, wire: wire.slice() };
            const disposition = await this.ingest(wire.slice());
            if (DURABLE.has(disposition)) {
              covered.add(entry.envelope.operationId);
              accepted.push(envelope);
            }
            inbound.set(entry.envelope.operationId, envelope);
          }
          if (covered.size > 0) {
            await this.client.put(ackLocator(peerId), encodeAckObject(await this.signAck(accepted, covered)));
          }
        }
        const ackBytes = await this.client.get(ackLocator(this.deviceId));
        let ack: DurablePeerAck | undefined;
        if (ackBytes !== null) {
          try {
            ack = await verifyLanAck(decodeAckObject(ackBytes));
          } catch {
            ack = undefined;
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

export interface MailboxEndpointConfig {
  readonly mailboxId: string;
  readonly baseUrl: string;
  readonly authorization: string;
  readonly peerDeviceIds: readonly string[];
}

let installedRoutes: DrainRoute[] = [];

export function installWebDavMailboxRoutes(routes: readonly DrainRoute[]): void {
  installedRoutes = [...routes];
}

export function webDavMailboxDrainRoutes(): DrainRoute[] {
  return [...installedRoutes];
}

export async function installWebDavMailboxFromConfig(input: {
  readonly deviceId: string;
  readonly publicKey: Uint8Array;
  readonly privateKey: CryptoKey;
  readonly endpoints: readonly MailboxEndpointConfig[];
  readonly ingest: (wire: Uint8Array) => Promise<string> | string;
}): Promise<void> {
  installedRoutes = input.endpoints.map((endpoint) => new WebDavMailboxSession(
    input.deviceId,
    input.publicKey,
    endpoint.mailboxId,
    new FetchWebDavClient(endpoint.baseUrl, endpoint.authorization),
    endpoint.peerDeviceIds,
    input.privateKey,
    input.ingest,
  ).drainRoute());
}

function classifyFailure(error: unknown): MailboxFailure {
  const message = error instanceof Error ? error.message : "";
  if (/401|403/.test(message)) return "CREDENTIAL";
  if (/507|413/.test(message)) return "QUOTA";
  if (/CORS/i.test(message)) return "CORS";
  return "NETWORK";
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(bytes))));
}
