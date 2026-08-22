import { describe, expect, test } from "bun:test";
import { materializeActivePhase, type TimerAction, type TimerFact } from "../../src/sync/timer/activePhase";

const plan = { kind: "WORK" as const, durationMillis: 1_500_000, tagId: "tag-work" };
function fact(operationId: string, action: TimerAction, parentHeads: readonly string[], ownerDeviceId: string, ownershipClaimId: string): TimerFact {
  return { operationId, phaseId: "phase-1", action, parentHeads: new Set(parentHeads), ownerDeviceId, ownershipClaimId, plan, elapsedMillis: 0, timeUncertain: false, composedElapsedMillis: null };
}

describe("causal Active phase materialization", () => {
  test("concurrent owner action and explicit provisional takeover retain both heads", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const pause = fact("pause", "PAUSE", ["start"], "android", "claim-a");
    const takeover = fact("takeover", "PROVISIONAL_TAKEOVER", ["start"], "chrome", "claim-b");
    const projection = materializeActivePhase([takeover, start, pause, start]);
    expect(projection.heads).toEqual(new Set(["pause", "takeover"]));
    expect(projection.settlementRequired).toBeTrue();
  });

  test("handoff preserves the Phase plan and duplicate Completion has one effect", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const handoff = fact("handoff", "HANDOFF", ["start"], "chrome", "claim-b");
    const complete = fact("complete", "COMPLETE", ["handoff"], "chrome", "claim-b");
    const projection = materializeActivePhase([start, handoff, complete, complete]);
    expect(projection.completedOperationIds).toEqual(new Set(["complete"]));
    expect(projection.ownerDeviceId).toBe("chrome");
  });

  test("time uncertainty never manufactures a winner", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const pause = { ...fact("pause", "PAUSE", ["start"], "android", "claim-a"), timeUncertain: true };
    expect(materializeActivePhase([start, pause]).timeUncertain).toBeTrue();
  });

  test("keeps a knowingly stale owner command in audit without throwing the projection", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const handoff = fact("handoff", "HANDOFF", ["start"], "chrome", "claim-b");
    const stale = fact("stale-extend", "EXTEND", ["handoff"], "android", "claim-a");
    const projection = materializeActivePhase([start, handoff, stale]);
    expect(projection.staleCommandIds).toEqual(new Set(["stale-extend"]));
    expect(projection.heads).toEqual(new Set(["handoff"]));
    expect(projection.ownerDeviceId).toBe("chrome");
  });

  test("prunes descendants of stale owner commands before they become heads", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const handoff = fact("handoff", "HANDOFF", ["start"], "chrome", "claim-b");
    const stale = fact("stale-extend", "EXTEND", ["handoff"], "android", "claim-a");
    const descendant = fact("stale-complete", "COMPLETE", ["stale-extend"], "android", "claim-a");
    const projection = materializeActivePhase([start, handoff, stale, descendant]);
    expect(projection.staleCommandIds).toEqual(new Set(["stale-extend", "stale-complete"]));
    expect(projection.heads).toEqual(new Set(["handoff"]));
    expect(projection.completedOperationIds.size).toBe(0);
    expect(projection.ownerDeviceId).toBe("chrome");
  });

  test("settlement is canonical only when it cites every conflict head", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const pause = fact("pause", "PAUSE", ["start"], "android", "claim-a");
    const takeover = fact("takeover", "PROVISIONAL_TAKEOVER", ["start"], "chrome", "claim-b");
    const partial = materializeActivePhase([start, pause, takeover, fact("partial", "SETTLE", ["pause"], "chrome", "claim-b")]);
    expect(partial.heads).toEqual(new Set(["pause", "takeover"]));
    expect(partial.settlementRequired).toBeTrue();
    const settled = materializeActivePhase([start, pause, takeover, fact("settle", "SETTLE", ["pause", "takeover"], "chrome", "claim-b")]);
    expect(settled.heads).toEqual(new Set(["settle"]));
    expect(settled.settlementRequired).toBeFalse();
  });

  test("keeps descendants pending when an ancestor is still causally incomplete", () => {
    const start = fact("start", "START", [], "android", "claim-a");
    const pendingAncestor = fact("z-ancestor", "PAUSE", ["missing"], "android", "claim-a");
    const descendant = fact("a-descendant", "RESUME", ["z-ancestor"], "android", "claim-a");
    const projection = materializeActivePhase([descendant, pendingAncestor, start]);
    expect(projection.pending).toEqual(new Set(["z-ancestor", "a-descendant"]));
    expect(projection.heads).toEqual(new Set(["start"]));
  });
});
