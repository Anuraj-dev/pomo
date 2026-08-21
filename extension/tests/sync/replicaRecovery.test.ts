import { describe, expect, test } from "bun:test";
import { integrityDisposition, planRehydration, validateCheckpoint, validateJournalPack } from "../../src/sync/recovery/replicaRecovery";

describe("Checkpoints, packs, rehydration, and Safe mode", () => {
  const checkpoint = { checkpointId: "cp", kind: "RECOVERY" as const, frontier: [{ feedKey: "a", sequence: 1, operationId: "a1" }], materializerVersion: 1, projectionRoot: "root", packIds: ["pack"], blobIds: [] };
  const a1 = { operationId: "a1", feedKey: "a", sequence: 1, wire: new Uint8Array([1]) };
  const a3 = { operationId: "a3", feedKey: "a", sequence: 3, wire: new Uint8Array([3]) };

  test("unions sources without inventing missing Operations and keeps provenance", () => {
    const plan = planRehydration([
      { sourceId: "device", checkpoint, operations: [a1] },
      { sourceId: "mailbox", checkpoint, operations: [a1, a3] },
    ]);
    expect(plan.sourceByOperation.get("a1")).toEqual(new Set(["device", "mailbox"]));
    expect(plan.gaps).toEqual(new Set(["a@2"]));
  });

  test("accepts named anchors and only packs complete fork-free prefixes", () => {
    validateCheckpoint({ ...checkpoint, kind: "SAFETY" });
    const pack = { packId: "pack", prefix: { feedKey: "a", sequence: 2, operationId: "a2" }, operations: [a1, { operationId: "a2", feedKey: "a", sequence: 2, wire: new Uint8Array([2]) }] };
    validateJournalPack(pack, new Set());
    expect(() => validateJournalPack(pack, new Set(["a"]))).toThrow(/replaceable/);
  });

  test("rejects incomparable checkpoint frontiers instead of selecting one", () => {
    const other = { ...checkpoint, checkpointId: "other", frontier: [{ feedKey: "b", sequence: 2, operationId: "b2" }] };
    expect(() => planRehydration([
      { sourceId: "first", checkpoint, operations: [] },
      { sourceId: "second", checkpoint: other, operations: [] },
    ])).toThrow(/incomparable/);
  });

  test("rebuilds projections but seals the incarnation for journal or key corruption", () => {
    expect(integrityDisposition("PROJECTION_CORRUPT")).toEqual({ active: false, incarnationSealed: false, inspectionAllowed: true, exportAllowed: true });
    expect(integrityDisposition("JOURNAL_CORRUPT").incarnationSealed).toBeTrue();
    expect(integrityDisposition("DEVICE_KEY_MISSING").inspectionAllowed).toBeTrue();
  });
});
