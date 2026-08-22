import { describe, expect, test } from "bun:test";
import { bufferOf } from "../../src/shared/bytes";
import { bytesToHex } from "../../src/shared/hex";
import { drainOrdinaryOutbox } from "../../src/sync/transport/ordinaryDrain";
import {
  WebDavMailbox,
  WebDavMailboxSession,
  repairMailbox,
  type ImmutableMailboxClient,
} from "../../src/sync/transport/webDavMailbox";

class MemoryMailbox implements ImmutableMailboxClient {
  readonly objects = new Map<string, Uint8Array>();
  async createIfAbsent(id: string, bytes: Uint8Array): Promise<boolean> {
    if (this.objects.has(id)) return false;
    this.objects.set(id, bytes.slice());
    return true;
  }
  async get(id: string): Promise<Uint8Array | null> {
    return this.objects.get(id)?.slice() ?? null;
  }
  async put(id: string, bytes: Uint8Array): Promise<void> {
    this.objects.set(id, bytes.slice());
  }
}

async function hash(bytes: Uint8Array): Promise<string> {
  return bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(bytes))));
}

async function extractablePair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function identityOf(pair: CryptoKeyPair): Promise<{ id: string; bytes: Uint8Array; privateKey: CryptoKey }> {
  const bytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const id = await hash(bytes);
  return { id, bytes, privateKey: pair.privateKey };
}

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

  test("shared mailbox clears outbox only after a peer-signed ack", async () => {
    const store = new MemoryMailbox();
    const pairA = await extractablePair();
    const pairB = await extractablePair();
    const identityA = await identityOf(pairA);
    const identityB = await identityOf(pairB);
    const sessionA = new WebDavMailboxSession(identityA.id, identityA.bytes, "primary", store, [identityB.id], identityA.privateKey, () => "ACCEPTED");
    const sessionB = new WebDavMailboxSession(identityB.id, identityB.bytes, "primary", store, [identityA.id], identityB.privateKey, () => "ACCEPTED");
    const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([9]) };

    const first = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: [sessionA.drainRoute()],
      ingest() {},
      markDelivered() {},
    });
    expect(first.localOnly).toBeFalse();
    expect(first.delivered.size).toBe(0);

    await drainOrdinaryOutbox({
      obligations: [],
      routes: [sessionB.drainRoute()],
      ingest() {},
      markDelivered() {},
    });

    const delivered: string[] = [];
    const second = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: [sessionA.drainRoute()],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(second.delivered).toEqual(new Set(["op-1"]));
    expect(delivered).toEqual(["op-1"]);
  });
});
