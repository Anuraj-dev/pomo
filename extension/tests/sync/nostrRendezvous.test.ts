import { describe, expect, test } from "bun:test";
import { bufferOf } from "../../src/shared/bytes";
import { bytesToHex } from "../../src/shared/hex";
import { drainOrdinaryOutbox } from "../../src/sync/transport/ordinaryDrain";
import {
  NostrRendezvousSession,
  type NostrSyncEvent,
  type NostrSyncTransport,
} from "../../src/sync/transport/nostrRendezvous";

class MemoryRelay implements NostrSyncTransport {
  readonly events: NostrSyncEvent[] = [];
  publish(event: NostrSyncEvent): void {
    this.events.push(event);
  }
  pull(): NostrSyncEvent[] {
    return [...this.events];
  }
}

async function identityOf(pair: CryptoKeyPair): Promise<{ id: string; bytes: Uint8Array; privateKey: CryptoKey }> {
  const bytes = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const id = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(bytes))));
  return { id, bytes, privateKey: pair.privateKey };
}

describe("nostr rendezvous drain", () => {
  test("shared relay clears outbox after peer-signed ack", async () => {
    const relay = new MemoryRelay();
    const contentKey = crypto.getRandomValues(new Uint8Array(32));
    const pairA = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const pairB = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const identityA = await identityOf(pairA);
    const identityB = await identityOf(pairB);
    const sessionA = new NostrRendezvousSession(
      identityA.id,
      identityA.bytes,
      identityA.privateKey,
      "session-1",
      contentKey,
      relay,
      [identityB.id],
      () => "ACCEPTED",
      "aa".repeat(32),
    );
    const sessionB = new NostrRendezvousSession(
      identityB.id,
      identityB.bytes,
      identityB.privateKey,
      "session-1",
      contentKey,
      relay,
      [identityA.id],
      () => "ACCEPTED",
      "bb".repeat(32),
    );
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
    expect(delivered).toEqual(["op-1"]);
    expect(second.delivered).toEqual(new Set(["op-1"]));
  });
});
