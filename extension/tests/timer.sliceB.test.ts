import { describe, expect, test } from "bun:test";
import { TimerEngine, type CompletedBlock, type EnginePorts } from "../src/engine/timer";
import { dateStringOf, epochOfDate } from "../src/engine/dateLogic";

const OFFSET = 330;
const NOW = 1_800_000_000;

interface FakePorts extends EnginePorts {
  blocks: CompletedBlock[];
  setEarnedBlocksForDate(n: number): void;
  setNow(n: number): void;
}

function makePorts(offset = OFFSET): FakePorts {
  const blocks: CompletedBlock[] = [];
  let count = 0;
  let now = NOW;
  return {
    blocks,
    now: () => now,
    setNow: (n) => (now = n),
    offsetMinutes: () => offset,
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

describe("TimerEngine — skip", () => {
  test("skip a work block ≥60s records a partial block and parks at short", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 240);
    engine.skip();
    expect(ports.blocks).toHaveLength(1);
    expect(ports.blocks[0]).toEqual({ start: NOW, duration: 240, type: "work", completed: false, tag: "Work" });
    const s = engine.snapshot();
    expect(s.status).toBe("stopped");
    expect(s.phase).toBe("short");
    expect(s.remaining).toBe(300);
  });

  test("skip a work block under 60s records nothing", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 30);
    engine.skip();
    expect(ports.blocks).toHaveLength(0);
    expect(engine.snapshot().phase).toBe("short");
  });

  test("skip a break returns to work with no commit", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 1500);
    engine.tick();
    expect(ports.blocks).toHaveLength(1);
    expect(engine.snapshot().phase).toBe("short");
    engine.skip();
    expect(ports.blocks).toHaveLength(1);
    expect(engine.snapshot().phase).toBe("work");
    expect(engine.snapshot().remaining).toBe(1500);
  });
});

describe("TimerEngine — reset & extend", () => {
  test("reset keeps the phase, stops, re-arms full duration, records nothing", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 600);
    engine.reset();
    expect(ports.blocks).toHaveLength(0);
    const s = engine.snapshot();
    expect(s.status).toBe("stopped");
    expect(s.phase).toBe("work");
    expect(s.remaining).toBe(1500);
  });

  test("extend only works while running and grows remaining", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 100);
    engine.extend(60);
    ports.setNow(NOW + 400);
    expect(engine.snapshot().remaining).toBe(1160);
    engine.toggle();
    engine.extend(60);
    expect(engine.snapshot().remaining).toBe(1160);
  });
});

describe("TimerEngine — date reconciliation", () => {
  test("a stopped state from a stale date resets to work on the new date and re-reads completed", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    ports.setNow(NOW + 300);
    engine.skip();
    ports.setEarnedBlocksForDate(5);
    ports.setNow(NOW + 86400 * 2);
    engine.toggle();
    const s = engine.snapshot();
    expect(s.phase).toBe("work");
    expect(s.completed).toBe(5);
    expect(s.date).toBe(dateStringOf(NOW + 86400 * 2, OFFSET));
    expect(s.remaining).toBe(1500);
  });

  test("a running block crossing midnight keeps ticking and completes on the new date", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.toggle();
    engine.extend(86400);
    const crossed = NOW + 86400 + 200;
    ports.setNow(crossed);
    engine.tick();
    expect(engine.snapshot().status).toBe("running");
    ports.setNow(NOW + 87900);
    engine.tick();
    expect(ports.blocks).toHaveLength(1);
    expect(engine.snapshot().phase).toBe("short");
    expect(engine.snapshot().date).toBe(dateStringOf(NOW + 87900, OFFSET));
  });

  test("a work block crossing midnight uses the start-day cadence for its break", (): void => {
    const start = epochOfDate("2026-08-01", OFFSET) + 23 * 60 * 60 + 50 * 60;
    const startDate = dateStringOf(start, OFFSET);
    const nextDate = dateStringOf(start + 1500, OFFSET);
    let now = start;
    const blocks: CompletedBlock[] = [];
    const ports: EnginePorts = {
      now: (): number => now,
      offsetMinutes: (): number => OFFSET,
      commit: (block): void => {
        blocks.push(block);
      },
      earnedBlocksForDate: (date): number => (date === startDate ? 3 : date === nextDate ? 0 : 0),
      phaseSeconds: (phase): number => (phase === "work" ? 1500 : phase === "short" ? 300 : 900),
      goal: (): number => 8,
      tag: (): string => "Work",
      longBreakAfter: (): number => 4,
    };
    const engine = new TimerEngine(ports);
    engine.toggle();
    now = start + 1500;
    engine.tick();
    expect(blocks).toHaveLength(1);
    expect(engine.snapshot().phase).toBe("long");
    expect(engine.snapshot().completed).toBe(0);
  });
});

describe("TimerEngine — restore from saved state", () => {
  test("restoring a running session that elapsed completes it and commits", () => {
    const ports = makePorts();
    const saved = {
      status: "running" as const,
      phase: "work" as const,
      startTime: NOW - 1500,
      duration: 1500,
      remaining: 0,
      completed: 3,
      goal: 8,
      date: dateStringOf(NOW, OFFSET),
      lastUpdatedTime: NOW - 1500,
      tag: "Work",
      version: 2,
    };
    const engine = new TimerEngine(ports);
    engine.restore(saved);
    expect(ports.blocks).toHaveLength(1);
    expect(ports.blocks[0]).toEqual({ start: NOW - 1500, duration: 1500, type: "work", completed: true, tag: "Work" });
    expect(engine.snapshot().phase).toBe("long");
  });

  test("restoring a running session still in progress keeps it running with derived remaining", () => {
    const first = makePorts();
    const engine = new TimerEngine(first);
    engine.toggle();
    first.setNow(NOW + 120);
    engine.toggle();
    const saved = engine.snapshot();
    const revivedPorts = makePorts();
    const revived = new TimerEngine(revivedPorts);
    revived.restore(saved);
    expect(revived.snapshot().status).toBe("paused");
    expect(revived.snapshot().remaining).toBe(1380);
    revived.toggle();
    revivedPorts.setNow(NOW + 200);
    expect(revived.snapshot().remaining).toBe(1180);
  });

  test("restoring a stopped state from a stale date resets like a fresh day", () => {
    const ports = makePorts();
    const engine = new TimerEngine(ports);
    engine.skip();
    const saved = engine.snapshot();
    saved.date = dateStringOf(NOW - 86400, OFFSET);
    saved.phase = "short";
    saved.remaining = 300;
    const revived = new TimerEngine(makePorts());
    revived.restore(saved);
    const s = revived.snapshot();
    expect(s.status).toBe("stopped");
    expect(s.phase).toBe("work");
    expect(s.remaining).toBe(1500);
    expect(s.date).toBe(dateStringOf(NOW, OFFSET));
  });

  test("restore throws for non-finite numeric fields", () => {
    const base = {
      status: "stopped" as const,
      phase: "work" as const,
      startTime: NOW,
      duration: 1500,
      remaining: 0,
      completed: 0,
      goal: 8,
      date: dateStringOf(NOW, OFFSET),
      lastUpdatedTime: NOW,
      tag: "Work",
      version: 2,
    };
    for (const duration of [Infinity, NaN]) {
      expect(() => new TimerEngine(makePorts()).restore({ ...base, duration })).toThrow(/invalid saved duration/);
    }
  });

  test("restore throws for an invalid calendar date", () => {
    const saved = {
      status: "stopped" as const,
      phase: "work" as const,
      startTime: NOW,
      duration: 1500,
      remaining: 0,
      completed: 0,
      goal: 8,
      date: "2026-99-99",
      lastUpdatedTime: NOW,
      tag: "Work",
      version: 2,
    };
    const engine = new TimerEngine(makePorts());
    expect(() => engine.restore(saved)).toThrow(/invalid saved date/);
  });
});
