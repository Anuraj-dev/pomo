import { bufferOf } from "../../shared/bytes";

export interface MailboxObject { readonly objectId: string; readonly bytes: Uint8Array; readonly sha256: string; readonly size: number }
export interface MailboxManifest { readonly manifestId: string; readonly checkpointId: string; readonly packIds: readonly string[]; readonly operationIds: readonly string[]; readonly blobIds: readonly string[] }
export type MailboxFailure = "CORS" | "QUOTA" | "CREDENTIAL" | "ROLLBACK" | "MISSING_OBJECT" | "NETWORK";
export interface MailboxProtection { readonly mailboxId: string; readonly protected: boolean; readonly failure: MailboxFailure | null }
export interface ImmutableMailboxClient { createIfAbsent(objectId: string, bytes: Uint8Array): Promise<boolean>; get(objectId: string): Promise<Uint8Array | null> }

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
}

export async function repairMailbox(source: ImmutableMailboxClient, target: ImmutableMailboxClient, objectIds: readonly string[]): Promise<ReadonlySet<string>> {
  const repaired = new Set<string>();
  for (const id of objectIds) { const bytes = await source.get(id); if (bytes !== null && await target.createIfAbsent(id, bytes.slice())) repaired.add(id); }
  return repaired;
}

function classifyFailure(error: unknown): MailboxFailure {
  const message = error instanceof Error ? error.message : "";
  if (/401|403/.test(message)) return "CREDENTIAL";
  if (/507|413/.test(message)) return "QUOTA";
  if (/CORS/i.test(message)) return "CORS";
  return "NETWORK";
}
async function sha256(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }
