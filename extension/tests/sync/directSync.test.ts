import { describe, expect, test } from "bun:test";
import { DirectSyncCoordinator } from "../../src/sync/transport/directSync";

describe("authenticated direct Replica synchronization", () => {
  test("bounds catch-up, resumes after route loss, and trusts only covered signed acknowledgment", () => {
    const obligations = Array.from({ length: 300 }, (_, index) => ({ operationId: `op-${index + 1}`, feedKey: "feed", sequence: index + 1, wire: new Uint8Array([index]) }));
    const coordinator = new DirectSyncCoordinator(obligations);
    coordinator.connected();
    expect(coordinator.nextBatch()).toHaveLength(256);
    expect(coordinator.liveObservationTrusted()).toBeFalse();
    expect(() => coordinator.acknowledge({ peerDeviceId: "peer", frontier: new Map([["feed", 256]]), signatureVerified: false })).toThrow(/signed/);
    coordinator.acknowledge({ peerDeviceId: "peer", frontier: new Map([["feed", 256]]), signatureVerified: true });
    coordinator.disconnected(); coordinator.connected();
    expect(coordinator.nextBatch()).toHaveLength(44);
    coordinator.acknowledge({ peerDeviceId: "peer", frontier: new Map([["feed", 300]]), signatureVerified: true });
    expect(coordinator.liveObservationTrusted()).toBeTrue();
  });

  test("deduplicates transfer before kernel ingestion", async () => {
    const envelope = { operationId: "op", feedKey: "feed", sequence: 1, wire: new Uint8Array([1]) };
    let ingested = 0;
    await new DirectSyncCoordinator([]).ingest([envelope, envelope], async () => { ingested++; });
    expect(ingested).toBe(1);
  });
});
