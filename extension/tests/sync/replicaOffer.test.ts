import { describe, expect, test } from "bun:test";
import { decodeReplicaOffer, encodeReplicaOffer } from "../../src/sync/identity/replicaOffer";
import { LIVE_PEERS_KEY, installChromeLivePeer, resetChromeLivePeer, type LivePeerStorage } from "../../src/sync/transport/chromeLivePeer";
import { drainOrdinaryOutbox } from "../../src/sync/transport/ordinaryDrain";
import { ReplicaLanSession, encodeLanResponse, replicaLanDrainRoutes } from "../../src/sync/transport/replicaLan";
import { loadOrCreateLivePeerIdentity } from "../../src/sync/transport/chromeLivePeer";
import { afterEach } from "bun:test";
import { bufferOf } from "../../src/shared/bytes";
import { bytesToHex } from "../../src/shared/hex";

class MemoryStorage implements LivePeerStorage {
  constructor(private readonly data: Record<string, unknown> = {}) {}
  async get(keys: readonly string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.flatMap((key) => this.data[key] === undefined ? [] : [[key, this.data[key]]]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }
}

afterEach(() => {
  resetChromeLivePeer();
});

describe("replica offer and HTTP peer", () => {
  test("offer round-trips the Chrome-reachable endpoint", () => {
    const encoded = encodeReplicaOffer({
      memberId: "aa".repeat(32),
      admissionId: "bb".repeat(32),
      identityDeviceId: "cc".repeat(32),
      lanDeviceId: "dd".repeat(32),
      transcriptHash: "ee".repeat(32),
      endpoint: "http://192.168.1.8:12345/replica",
    });
    const decoded = decodeReplicaOffer(encoded);
    expect(decoded.endpoint).toBe("http://192.168.1.8:12345/replica");
    expect(decoded.lanDeviceId).toBe("dd".repeat(32));
  });

  test("installed HTTP peer drains through the replica LAN codec", async () => {
    const storage = new MemoryStorage();
    const identity = await loadOrCreateLivePeerIdentity(storage);
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const publicKey = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
    const peerId = bytesToHex(new Uint8Array(await crypto.subtle.digest("SHA-256", bufferOf(publicKey))));
    const peerSession = new ReplicaLanSession(peerId, publicKey, pair.privateKey, () => "ACCEPTED", () => []);
    await storage.set({ [LIVE_PEERS_KEY]: [{ deviceId: peerId, endpoint: "http://127.0.0.1:9/replica" }] });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      const body = init?.body;
      const bytes = body instanceof Uint8Array ? body : new Uint8Array(body as ArrayBuffer);
      const { decodeLanRequest } = await import("../../src/sync/transport/replicaLan");
      const response = await peerSession.handle(decodeLanRequest(bytes));
      return new Response(encodeLanResponse(response), { status: 200 });
    }) as typeof fetch;
    try {
      await installChromeLivePeer({
        storage,
        identity,
        ingest: () => "ACCEPTED",
        outbox: () => [],
        inbox: { takeAll: () => [] },
        pipe: { ensureDocument: async () => {}, open: async () => ({}), addCandidate: async () => {}, send: async () => {}, close: async () => {} },
      });
      const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([9]) };
      const delivered: string[] = [];
      const result = await drainOrdinaryOutbox({
        obligations: [envelope],
        routes: replicaLanDrainRoutes(),
        ingest() {},
        markDelivered(id) { delivered.push(id); },
      });
      expect(result.localOnly).toBeFalse();
      expect(delivered).toEqual(["op-1"]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
