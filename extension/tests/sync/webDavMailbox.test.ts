import { describe, expect, test } from "bun:test";
import { repairMailbox, WebDavMailbox, type ImmutableMailboxClient } from "../../src/sync/transport/webDavMailbox";
import { bufferOf } from "../../src/shared/bytes";

class MemoryMailbox implements ImmutableMailboxClient {
  readonly objects = new Map<string, Uint8Array>();
  async createIfAbsent(id: string, bytes: Uint8Array): Promise<boolean> { if (this.objects.has(id)) return false; this.objects.set(id, bytes.slice()); return true; }
  async get(id: string): Promise<Uint8Array | null> { return this.objects.get(id)?.slice() ?? null; }
}

async function hash(bytes: Uint8Array): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(bytes)))].map((byte) => byte.toString(16).padStart(2, "0")).join(""); }

describe("independently verified immutable WebDAV Mailboxes", () => {
  test("requires create, retrieve, hash, and size verification", async () => {
    const client = new MemoryMailbox();
    const bytes = new Uint8Array([1, 2, 3]);
    const expected = { objectId: "object", bytes, sha256: await hash(bytes), size: bytes.length };
    expect(await new WebDavMailbox("primary", client).protect([expected])).toEqual({ mailboxId: "primary", protected: true, failure: null });
    client.objects.set(expected.objectId, new Uint8Array([9]));
    expect(await new WebDavMailbox("primary", client).challenge(expected)).toBeFalse();
  });

  test("repairs a degraded Mailbox from another verified source without inferred deletion", async () => {
    const source = new MemoryMailbox(); source.objects.set("a", new Uint8Array([1])); source.objects.set("b", new Uint8Array([2]));
    const target = new MemoryMailbox();
    expect(await repairMailbox(source, target, ["a", "missing", "b"])).toEqual(new Set(["a", "b"]));
    expect([...target.objects.keys()]).toEqual(["a", "b"]);
  });
});
