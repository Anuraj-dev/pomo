import { describe, expect, test } from "bun:test";
import { drainOrdinaryOutbox, type DrainRoute } from "../../src/sync/transport/ordinaryDrain";
import type { SyncEnvelope } from "../../src/sync/transport/directSync";

function envelopes(count: number): SyncEnvelope[] {
  return Array.from({ length: count }, (_, index) => ({
    operationId: `op-${index + 1}`,
    feedKey: "feed",
    sequence: index + 1,
    wire: new Uint8Array([index]),
  }));
}

const loopback: DrainRoute = {
  name: "loopback",
  exchange(batch) {
    if (batch.length === 0) return { connected: true };
    const covered = new Set(batch.map((envelope) => envelope.operationId));
    const head = batch[batch.length - 1]!;
    return {
      connected: true,
      ack: {
        peerDeviceId: "loopback",
        frontier: new Map([[head.feedKey, { sequence: head.sequence, operationId: head.operationId, coveredOperationIds: covered }]]),
        signatureVerified: true,
      },
    };
  },
};

describe("ordinary outbox drain", () => {
  test("empty routes leave obligations and stay local-only", async () => {
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: envelopes(3),
      routes: [],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(result.localOnly).toBeTrue();
    expect(result.delivered.size).toBe(0);
    expect(result.remaining).toEqual(new Set(["op-1", "op-2", "op-3"]));
    expect(delivered).toEqual([]);
  });

  test("signed loopback ack persists delivery and clears covered outbox", async () => {
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: envelopes(3),
      routes: [loopback],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(result.localOnly).toBeFalse();
    expect(result.delivered).toEqual(new Set(["op-1", "op-2", "op-3"]));
    expect(result.remaining.size).toBe(0);
    expect(delivered).toEqual(["op-1", "op-2", "op-3"]);
    expect(result.live).toBeTrue();
  });

  test("unsigned ack does not clear obligations", async () => {
    const delivered: string[] = [];
    const forged: DrainRoute = {
      name: "forged",
      exchange(batch) {
        const head = batch[batch.length - 1]!;
        return {
          connected: true,
          ack: {
            peerDeviceId: "forged",
            frontier: new Map([[head.feedKey, { sequence: head.sequence, operationId: head.operationId }]]),
            signatureVerified: false,
          },
        };
      },
    };
    const result = await drainOrdinaryOutbox({
      obligations: envelopes(2),
      routes: [forged],
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(delivered).toEqual([]);
    expect(result.remaining).toEqual(new Set(["op-1", "op-2"]));
    expect(result.live).toBeFalse();
  });

  test("one drain offers at most the catch-up bound", async () => {
    const offered: number[] = [];
    const probe: DrainRoute = {
      name: "probe",
      exchange(batch) {
        offered.push(batch.length);
        return { connected: true };
      },
    };
    await drainOrdinaryOutbox({
      obligations: envelopes(300),
      routes: [probe],
      ingest() {},
      markDelivered() {},
    });
    expect(offered).toEqual([256]);
  });
});
