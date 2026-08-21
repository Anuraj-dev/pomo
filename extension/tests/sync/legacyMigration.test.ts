import { describe, expect, test } from "bun:test";
import { activateMigrationAtomically, POMO_BACKUP_V1_WARNING, requireIdentitySelection, validateMigrationInventory, verifyMigrationReady } from "../../src/sync/migration/legacyMigration";

describe("side-by-side legacy migration", () => {
  const verification = { expectedItems: 2, explainedItems: 2, projectionRootsMatch: true, domainInvariantsHold: true };
  const ready = { recoveryAnchorId: "anchor", baselineCaughtUp: true, timerState: "PARKED" as const, identitiesSelected: true, verification };
  test("inventories every durable disposition", () => {
    const dispositions = ["VALID", "DUPLICATE", "CONFLICTING", "MALFORMED_QUARANTINED", "MEMBER_EXCLUDED"] as const;
    validateMigrationInventory({ sourceId: "chrome", durableItemCount: dispositions.length, items: dispositions.map((disposition, index) => ({ sourceId: "chrome", durableId: `id-${index}`, domain: "history", disposition, detail: "classified" })) });
    expect(() => validateMigrationInventory({ sourceId: "chrome", durableItemCount: 2, items: [] })).toThrow(/Every durable/);
  });
  test("blocks identity blending, live timer, stale baseline, and omissions", () => {
    expect(() => requireIdentitySelection([{ memberId: "a", crewIds: new Set(["a"]) }, { memberId: "b", crewIds: new Set(["b"]) }], null)).toThrow(/selection/);
    expect(() => verifyMigrationReady({ ...ready, timerState: "PAUSED" })).toThrow(/Parked/);
    expect(() => verifyMigrationReady({ ...ready, baselineCaughtUp: false })).toThrow(/baseline/);
    expect(() => verifyMigrationReady({ ...ready, verification: { ...verification, explainedItems: 1 } })).toThrow(/omissions/);
  });
  test("atomic activation seals legacy archive and retires dual-write", () => {
    expect(activateMigrationAtomically(ready, "journal", "encrypted-legacy").dualWriteRetired).toBeTrue();
    expect(POMO_BACKUP_V1_WARNING).toContain("sensitive");
  });
});
