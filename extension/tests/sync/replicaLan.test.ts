import { describe, expect, test } from "bun:test";
import { drainOrdinaryOutbox } from "../../src/sync/transport/ordinaryDrain";
import {
  ReplicaLanSession,
  decodeLanRequest,
  encodeLanRequest,
  installReplicaLan,
  replicaLanDrainRoutes,
  verifyLanAck,
  type ReplicaLanPeer,
} from "../../src/sync/transport/replicaLan";

async function extractablePair(): Promise<CryptoKeyPair> {
  return await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
}

async function publicBytes(publicKey: CryptoKey): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
}

describe("replica LAN session", () => {
  test("signed exchange ingests through the peer and clears covered outbox", async () => {
    const pairA = await extractablePair();
    const pairB = await extractablePair();
    const ingested: Uint8Array[] = [];
    const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([9]) };
    const sessionA = new ReplicaLanSession("aa".repeat(32), await publicBytes(pairA.publicKey), pairA.privateKey, () => "ACCEPTED", () => [envelope]);
    const sessionB = new ReplicaLanSession("bb".repeat(32), await publicBytes(pairB.publicKey), pairB.privateKey, (wire) => {
      ingested.push(wire.slice());
      return "ACCEPTED";
    }, () => []);
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: [sessionA.drainRoute({ deviceId: sessionB.deviceId, exchange: (request) => sessionB.handle(request) })],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(result.localOnly).toBeFalse();
    expect(result.delivered).toEqual(new Set(["op-1"]));
    expect(delivered).toEqual(["op-1"]);
    expect(ingested).toHaveLength(1);
    expect([...ingested[0]!]).toEqual([9]);
    expect(result.live).toBeTrue();
  });

  test("forged ack does not clear obligations", async () => {
    const pair = await extractablePair();
    const honest = new ReplicaLanSession("aa".repeat(32), await publicBytes(pair.publicKey), pair.privateKey, () => "ACCEPTED", () => []);
    const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([1]) };
    const peer: ReplicaLanPeer = {
      deviceId: honest.deviceId,
      async exchange(request) {
        const response = await honest.handle(request);
        const signature = response.ack.signature.slice();
        signature[0] = (signature[0]! + 1) & 0xff;
        return { ...response, ack: { ...response.ack, signature } };
      },
    };
    const session = new ReplicaLanSession("bb".repeat(32), await publicBytes((await extractablePair()).publicKey), (await extractablePair()).privateKey, () => "ACCEPTED", () => []);
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: [session.drainRoute(peer)],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(delivered).toEqual([]);
    expect(result.remaining).toEqual(new Set(["op-1"]));
    expect(result.live).toBeFalse();
  });

  test("rejected envelopes are omitted from the signed frontier", async () => {
    const pair = await extractablePair();
    const session = new ReplicaLanSession("bb".repeat(32), await publicBytes(pair.publicKey), pair.privateKey, () => "REJECTED_INVALID", () => []);
    const response = await session.handle({
      deviceId: "aa".repeat(32),
      envelopes: [{ operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([1]) }],
    });
    expect(response.ack.frontier.size).toBe(0);
    expect((await verifyLanAck(response.ack)).signatureVerified).toBeTrue();
  });

  test("request codec round-trips envelopes", () => {
    const request = {
      deviceId: "aa".repeat(32),
      envelopes: [{ operationId: "op-1", feedKey: "device:inc", sequence: 7, wire: new Uint8Array([1, 2, 3]) }],
    };
    const decoded = decodeLanRequest(encodeLanRequest(request));
    expect(decoded.deviceId).toBe(request.deviceId);
    expect(decoded.envelopes[0]?.operationId).toBe("op-1");
    expect(decoded.envelopes[0]?.sequence).toBe(7);
    expect([...decoded.envelopes[0]!.wire]).toEqual([1, 2, 3]);
  });

  test("directory routes skip the local device", async () => {
    const pair = await extractablePair();
    const session = new ReplicaLanSession("aa".repeat(32), await publicBytes(pair.publicKey), pair.privateKey, () => "ACCEPTED", () => []);
    installReplicaLan({
      session,
      peers: [
        { deviceId: "aa".repeat(32), exchange: async () => { throw new Error("self"); } },
        { deviceId: "bb".repeat(32), exchange: async (request) => session.handle(request) },
      ],
    });
    expect(replicaLanDrainRoutes().map((route) => route.name)).toEqual(["lan:" + "bb".repeat(32)]);
    installReplicaLan({ session: null, peers: [] });
  });
});
