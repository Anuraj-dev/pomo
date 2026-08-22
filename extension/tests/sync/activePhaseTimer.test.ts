import { describe, expect, test } from "bun:test";
import { ActivePhaseTimer } from "../../src/sync/timer/activePhaseTimer";

describe("active phase timer", () => {
  test("start pause resume derive remaining from projection", () => {
    let now = 1_000;
    const timer = new ActivePhaseTimer("device-a", () => now);
    timer.start({ kind: "WORK", durationMillis: 60_000, tagId: null }, "phase-1");
    expect(timer.remainingMillis()).toBe(60_000);
    now = 11_000;
    expect(timer.remainingMillis()).toBe(50_000);
    timer.pause();
    now = 31_000;
    expect(timer.remainingMillis()).toBe(50_000);
    timer.resume();
    now = 36_000;
    expect(timer.remainingMillis()).toBe(45_000);
    const completed = timer.complete();
    expect(completed.completedOperationIds.size).toBeGreaterThan(0);
    expect(timer.remainingMillis()).toBe(0);
  });
});
