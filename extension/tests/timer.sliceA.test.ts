import { describe, expect, test } from "bun:test";
import { TimerEngine, type CompletedBlock, type EnginePorts } from "../src/engine/timer";
import { dateStringOf } from "../src/engine/dateLogic";

const OFFSET = 330;
const NOW = 1_800_000_000;

interface FakePorts extends EnginePorts {
  blocks: CompletedBlock[];
  setEarnedBlocksForDate(n: number): void;
}

function makePorts(): FakePorts {
  const blocks: CompletedBlock[] = [];
  let count = 0;
  return {
    blocks,
    now: () => NOW,
    offsetMinutes: () => OFFSET,
    commit: (b) => {
      blocks.push(b);
      if (b.type === "work" && b.completed) count++;
    },
    earnedBlocksForDate: () => count,
    setEarnedBlocksForDate: (n) => (count = n),
    phaseSeconds: (phase) => (phase === "work" ? 25 * 60 : phase === "short" ? 5 * 60 : 15 * 60),
    goal: () => 8,
    tag: () => "Work",
    longBreakAfter: () => 4,
  };
}

function at(engine: TimerEngine, now: number) {
  (engine as unknown as { ports: EnginePorts }).ports.now = () => now;
}

describe("TimerEngine — initial state", () => {
  test("starts stopped, work phase, full duration armed, next is short", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    const s = engine.snapshot();
    expect(s.status).toBe("stopped");
    expect(s.phase).toBe("work");
    expect(s.nextPhase).toBe("short");
    expect(s.duration).toBe(1500);
    expect(s.remaining).toBe(1500);
    expect(s.completed).toBe(0);
    expect(s.goal).toBe(8);
    expect(s.tag).toBe("Work");
    expect(s.version).toBe(2);
    expect(s.date).toBe(dateStringOf(NOW, OFFSET));
  });
});

describe("TimerEngine — toggle / pause / resume", () => {
  test("start decrements derived remaining from the endpoint", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    expect(engine.snapshot().status).toBe("running");
    at(engine, NOW + 120);
    expect(engine.snapshot().remaining).toBe(1380);
  });

  test("pause freezes remaining; resume preserves elapsed", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    at(engine, NOW + 100);
    engine.toggle();
    let s = engine.snapshot();
    expect(s.status).toBe("paused");
    expect(s.remaining).toBe(1400);
    at(engine, NOW + 500);
    engine.toggle();
    s = engine.snapshot();
    expect(s.status).toBe("running");
    at(engine, NOW + 620);
    expect(engine.snapshot().remaining).toBe(1280);
  });

  test("tick never overruns below zero", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    at(engine, NOW + 1600);
    engine.tick();
    expect(engine.snapshot().remaining).toBeGreaterThanOrEqual(0);
  });
});

describe("TimerEngine — completion & cadence", () => {
  test("work completion commits a full completed block and parks at short", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    at(engine, NOW + 1500);
    engine.tick();
    expect(ports.blocks).toHaveLength(1);
    expect(ports.blocks[0]).toEqual({ start: NOW, duration: 1500, type: "work", completed: true, tag: "Work" });
    const s = engine.snapshot();
    expect(s.status).toBe("stopped");
    expect(s.phase).toBe("short");
    expect(s.duration).toBe(300);
  });

  test("break completion commits and returns to work", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    at(engine, NOW + 1500);
    engine.tick();
    engine.toggle();
    at(engine, NOW + 1800);
    engine.tick();
    expect(ports.blocks).toHaveLength(2);
    expect(ports.blocks[1]).toEqual({ start: NOW + 1500, duration: 300, type: "short", completed: true, tag: "Work" });
    expect(engine.snapshot().phase).toBe("work");
  });

  test("long break triggers when earned count is a multiple of longBreakAfter", () => {
    const ports = makePorts();
    ports.setEarnedBlocksForDate(3);
    const engine = new TimerEngine(ports);
    expect(engine.snapshot().nextPhase).toBe("long");
    engine.toggle();
    at(engine, NOW + 1500);
    engine.tick();
    expect(ports.blocks).toHaveLength(1);
    expect(engine.snapshot().phase).toBe("long");
  });

  test("nextPhase preview flips to long for the Nth upcoming block", () => {
    const ports = makePorts();
    ports.setEarnedBlocksForDate(3);
    const engine = new TimerEngine(ports);
    expect(engine.snapshot().nextPhase).toBe("long");
    engine.toggle();
    at(engine, NOW + 1500);
    engine.tick();
    expect(engine.snapshot().phase).toBe("long");
    expect(engine.snapshot().nextPhase).toBe("work");
  });
});
