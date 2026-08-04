import { describe, expect, test } from "bun:test";
import {
  bestDayOf,
  bestStreak,
  bestWeekOf,
  currentStreak,
  lastNDays,
  rhythmBuckets,
  totals,
  weekdayBuckets,
} from "../src/engine/stats";

const OFFSET = 330;
const NOW = 1_800_000_000;
const DAY = 86400;

function dates(epochs: number[]): string[] {
  return epochs.map((e) => {
    const d = new Date(e * 1000 + OFFSET * 60000);
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
  });
}

describe("currentStreak", () => {
  const today = dates([NOW])[0]!;

  test("empty set is zero", () => {
    expect(currentStreak([], today, OFFSET)).toBe(0);
  });

  test("counts consecutive days backward from today when today is active", () => {
    const active = dates([NOW, NOW - DAY, NOW - 2 * DAY]);
    expect(currentStreak(active, today, OFFSET)).toBe(3);
  });

  test("anchors at yesterday when today is not yet active", () => {
    const active = dates([NOW - DAY, NOW - 2 * DAY, NOW - 3 * DAY]);
    expect(currentStreak(active, today, OFFSET)).toBe(3);
  });

  test("stops at a gap", () => {
    const active = dates([NOW, NOW - DAY, NOW - 3 * DAY]);
    expect(currentStreak(active, today, OFFSET)).toBe(2);
  });

  test("a gap before yesterday leaves the streak dead even if today is active", () => {
    const active = dates([NOW, NOW - 2 * DAY]);
    expect(currentStreak(active, today, OFFSET)).toBe(1);
  });
});

describe("bestStreak", () => {
  test("longest run wins over the most recent", () => {
    const active = dates([NOW, NOW - DAY, NOW - 4 * DAY, NOW - 5 * DAY, NOW - 6 * DAY, NOW - 7 * DAY]);
    expect(bestStreak(active)).toBe(4);
  });

  test("single day is a streak of one", () => {
    expect(bestStreak(dates([NOW]))).toBe(1);
  });

  test("empty set is zero", () => {
    expect(bestStreak([])).toBe(0);
  });
});

describe("totals", () => {
  test("sums across day stats", () => {
    const days = [
      { date: "2026-07-30", earnedBlocks: 8, focusMinutes: 200, breakMinutes: 40 },
      { date: "2026-07-31", earnedBlocks: 4, focusMinutes: 100, breakMinutes: 20 },
    ];
    expect(totals(days)).toEqual({ focusMinutes: 300, breakMinutes: 60, earnedBlocks: 12 });
  });

  test("empty input yields zeros", () => {
    expect(totals([])).toEqual({ focusMinutes: 0, breakMinutes: 0, earnedBlocks: 0 });
  });
});

describe("bestDayOf", () => {
  const days = [
    { date: "2026-07-30", earnedBlocks: 8, focusMinutes: 200, breakMinutes: 40 },
    { date: "2026-07-31", earnedBlocks: 4, focusMinutes: 250, breakMinutes: 20 },
    { date: "2026-08-01", earnedBlocks: 0, focusMinutes: 30, breakMinutes: 10 },
  ];

  test("returns the highest focus-minute day with its completed blocks", () => {
    expect(bestDayOf(days)).toEqual({ date: "2026-07-31", completed: 4, minutes: 250 });
  });

  test("a pre-midnight segment day with minutes but no blocks can win", () => {
    const partial = [
      { date: "2026-07-30", earnedBlocks: 0, focusMinutes: 300, breakMinutes: 0 },
      { date: "2026-07-31", earnedBlocks: 5, focusMinutes: 100, breakMinutes: 0 },
    ];
    expect(bestDayOf(partial)).toEqual({ date: "2026-07-30", completed: 0, minutes: 300 });
  });

  test("no focus minutes yields null", () => {
    expect(bestDayOf([{ date: "2026-07-30", earnedBlocks: 0, focusMinutes: 0, breakMinutes: 0 }])).toBeNull();
    expect(bestDayOf([])).toBeNull();
  });
});

describe("bestWeekOf", () => {
  test("groups into Sunday-anchored weeks and picks the highest-minutes week", () => {
    const days = [
      { date: "2026-07-27", earnedBlocks: 2, focusMinutes: 50, breakMinutes: 10 }, // Monday (week 7/26)
      { date: "2026-07-31", earnedBlocks: 3, focusMinutes: 80, breakMinutes: 20 }, // Friday (week 7/26)
      { date: "2026-08-02", earnedBlocks: 4, focusMinutes: 200, breakMinutes: 30 }, // Sunday (week 8/2)
      { date: "2026-08-03", earnedBlocks: 1, focusMinutes: 20, breakMinutes: 5 }, // Monday (week 8/2)
    ];
    expect(bestWeekOf(days)).toEqual({ weekStart: "2026-08-02", sessions: 5, minutes: 220 });
  });

  test("a week with minutes but zero blocks still counts", () => {
    const days = [
      { date: "2026-07-27", earnedBlocks: 0, focusMinutes: 120, breakMinutes: 0 },
      { date: "2026-08-02", earnedBlocks: 2, focusMinutes: 30, breakMinutes: 0 },
    ];
    expect(bestWeekOf(days)).toEqual({ weekStart: "2026-07-26", sessions: 0, minutes: 120 });
  });

  test("empty or zero-minute input yields null", () => {
    expect(bestWeekOf([])).toBeNull();
    expect(bestWeekOf([{ date: "2026-07-27", earnedBlocks: 0, focusMinutes: 0, breakMinutes: 0 }])).toBeNull();
  });
});

describe("rhythmBuckets", () => {
  test("maps focus minutes to member-local hour buckets", () => {
    const epoch = NOW; // 05:00 local with OFFSET 330... derived below
    const local = new Date(epoch * 1000 + OFFSET * 60000);
    const sessions = [{ start: epoch, type: "work" as const, duration: 1500 }];
    const buckets = rhythmBuckets(sessions, OFFSET);
    expect(buckets).toHaveLength(24);
    const sum = buckets.reduce((a, b) => a + b, 0);
    expect(sum).toBe(25);
    expect(buckets[local.getUTCHours()]).toBe(25);
  });

  test("ignores break sessions", () => {
    const sessions = [
      { start: NOW, type: "work" as const, duration: 600 },
      { start: NOW, type: "short" as const, duration: 600 },
    ];
    expect(rhythmBuckets(sessions, OFFSET).reduce((a, b) => a + b, 0)).toBe(10);
  });

  test("supports a custom bucket count", () => {
    const sessions = [{ start: NOW, type: "work" as const, duration: 1500 }];
    const buckets = rhythmBuckets(sessions, OFFSET, { count: 12 });
    expect(buckets).toHaveLength(12);
    const local = new Date(NOW * 1000 + OFFSET * 60000);
    expect(buckets[local.getUTCHours() % 12]).toBe(25);
  });
});

describe("weekdayBuckets", () => {
  test("seven buckets, Monday first", () => {
    const epoch = NOW;
    const local = new Date(epoch * 1000 + OFFSET * 60000);
    const buckets = weekdayBuckets([{ start: epoch, type: "work" as const, duration: 600 }], OFFSET);
    expect(buckets).toHaveLength(7);
    const mondayFirst = (local.getUTCDay() + 6) % 7;
    expect(buckets[mondayFirst]).toBe(10);
  });

  test("supports Sunday-first ordering", () => {
    const epoch = NOW;
    const local = new Date(epoch * 1000 + OFFSET * 60000);
    const buckets = weekdayBuckets([{ start: epoch, type: "work" as const, duration: 600 }], OFFSET, {
      startDay: 0,
    });
    expect(buckets[local.getUTCDay()]).toBe(10);
  });
});

describe("lastNDays", () => {
  test("returns n days in chronological order, filling gaps", () => {
    const today = dates([NOW])[0]!;
    const rows = [
      { date: dates([NOW - 2 * DAY])[0]!, earnedBlocks: 4, focusMinutes: 100, breakMinutes: 0 },
    ];
    const out = lastNDays(rows, today, 5, OFFSET);
    expect(out).toHaveLength(5);
    expect(out[4]!.date).toBe(today);
    expect(out[3]!.date).toBe(dates([NOW - DAY])[0]!);
    expect(out[2]!.earnedBlocks).toBe(4);
    expect(out[0]!.earnedBlocks).toBe(0);
  });
});
