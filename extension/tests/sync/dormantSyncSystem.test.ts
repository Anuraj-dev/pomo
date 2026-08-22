import { expect, test } from "bun:test";
import { DormantSyncSystem } from "../../src/sync/dormantSyncSystem";

test("test artifact uses authenticated ingress while production stays dormant", async () => {
  const received: { value: Uint8Array | null } = { value: null };
  const system = new DormantSyncSystem({ async ingest(wire) { received.value = wire; return "ACCEPTED"; } }, { productionActivated: false, testArtifact: true });
  system.startTestArtifact(); const source = new Uint8Array([1, 2, 3]); expect(await system.ingestFromReplica(source)).toBe("ACCEPTED"); source.fill(0);
  expect(received.value).toEqual(new Uint8Array([1, 2, 3])); expect(system.productionMigrationCutoverAllowed()).toBeFalse();
  const production = new DormantSyncSystem({ async ingest() { return "ACCEPTED"; } }, { productionActivated: false, testArtifact: false });
  expect(() => production.startTestArtifact()).toThrow(/production/); expect(production.productionMigrationCutoverAllowed()).toBeFalse();
});
