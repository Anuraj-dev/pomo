import { describe, expect, test } from "bun:test";
import {
  applyTag,
  authorizeDestructiveHistory,
  dailyTotals,
  materializeHistory,
  type HistoryBlock,
} from "../../src/sync/domain/history";

function block(blockId: string, elapsedMillis: number): HistoryBlock {
  return {
    blockId,
    phaseId: `phase-${blockId}`,
    startedAtEpochMillis: 1_755_734_400_000,
    elapsedMillis,
    outcome: "COMPLETED",
    tagId: "tag-work",
    authoredTagName: "Work",
    localDate: "2026-08-21",
  };
}

describe("identified History and stable Session tags", () => {
  test("retains correction and tombstone alternatives until settlement", () => {
    const original = block("stable-a", 60_000);
    const corrected = { ...original, elapsedMillis: 90_000 };
    const facts = [
      { kind: "CREATE" as const, factId: "create", blockId: original.blockId, block: original },
      { kind: "CORRECT" as const, factId: "correct", blockId: original.blockId, replacement: corrected },
      { kind: "TOMBSTONE" as const, factId: "delete", blockId: original.blockId },
    ];
    expect(materializeHistory(facts).conflicts).toContain(original.blockId);
    const settled = materializeHistory([...facts, {
      kind: "SETTLE" as const,
      factId: "settle",
      blockId: original.blockId,
      selectedFactIds: new Set(["create", "correct"]),
    }]);
    expect(settled.visible.get(original.blockId)?.elapsedMillis).toBe(90_000);
    expect(settled.alternatives.get(original.blockId)).toHaveLength(4);
  });

  test("rebuilds totals and never infers deletion from an absent local row", () => {
    const first = block("stable-a", 60_000);
    const second = { ...block("stable-b", 30_000), outcome: "PARTIAL" as const };
    const projection = materializeHistory([
      { kind: "CREATE" as const, factId: "a", blockId: first.blockId, block: first },
      { kind: "CREATE" as const, factId: "b", blockId: second.blockId, block: second },
    ]);
    expect([...projection.visible.keys()]).toEqual(["stable-a", "stable-b"]);
    expect(dailyTotals(projection).get("2026-08-21")).toEqual({ elapsedMillis: 90_000, completed: 1 });
  });

  test("preserves Tag IDs and independently confirms broad destructive scope", () => {
    const work = { tagId: "tag-work", name: "Work", paletteSlot: 0, archived: false, mergedInto: null };
    const study = { tagId: "tag-study", name: "Study", paletteSlot: 1, archived: false, mergedInto: null };
    const renamed = applyTag(new Map([[work.tagId, work], [study.tagId, study]]), { ...study, name: "Deep work" }, work.tagId, study.tagId);
    const archived = applyTag(renamed.tags, { ...study, name: "Deep work", archived: true }, work.tagId, study.tagId);
    expect(archived.tags.get(study.tagId)?.name).toBe("Deep work");
    expect(archived.defaultTagId).toBe(work.tagId);
    const broad = new Set(Array.from({ length: 10 }, (_, index) => `${index}`));
    expect(authorizeDestructiveHistory(broad, new Set())).toBeFalse();
    expect(authorizeDestructiveHistory(broad, broad)).toBeTrue();
  });
});
