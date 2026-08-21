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
});
