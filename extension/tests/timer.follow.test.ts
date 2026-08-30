import { describe, expect, test } from "bun:test";
import { TimerEngine, TIMER_STATE_VERSION, type CompletedBlock, type EnginePorts } from "../src/engine/timer";

function makePorts(): EnginePorts & { blocks: CompletedBlock[] } {
  const blocks: CompletedBlock[] = [];
  return {
    blocks,
    now: () => 1_800_000_000,
    offsetMinutes: () => 0,
    commit: (block) => blocks.push(block),
    earnedBlocksForDate: () => 0,
    phaseSeconds: () => 1500,
    goal: () => 8,
    tag: () => "Work",
    longBreakAfter: () => 4,
  };
}

describe("TimerEngine.follow", () => {
  test("mirrors phone state without committing", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.follow({
      status: "running",
      phase: "work",
      startTime: 1_800_000_000 - 100,
      duration: 1500,
      remaining: 1400,
      completed: 3,
      date: "2027-01-15",
      tag: "Study",
    });
    engine.tick();
    expect(ports.blocks).toEqual([]);
    expect(engine.peek().status).toBe("running");
    expect(engine.peek().completed).toBe(3);
    expect(engine.peek().tag).toBe("Study");
  });

  test("restore without reconcile does not complete an elapsed follower", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.restore(
      {
        status: "running",
        phase: "work",
        startTime: 1_799_998_000,
        duration: 1500,
        remaining: 0,
        completed: 1,
        goal: 8,
        date: "2027-01-15",
        lastUpdatedTime: 1_799_998_000,
        revision: 1,
        tag: "Work",
        version: TIMER_STATE_VERSION,
      },
      { reconcile: false },
    );
    expect(ports.blocks).toEqual([]);
    expect(engine.peek().status).toBe("running");
  });
});
