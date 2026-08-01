import { describe, expect, test } from "bun:test";
import { epochOfDate } from "../src/engine/dateLogic";
import { buildOwnSnapshot } from "../src/crew/ownSnapshot";
import type { DayStatRow, SessionRow } from "../src/db/types";

const OFFSET = 330;
const NOW = epochOfDate("2026-08-01", OFFSET) + 5 * 3600;

function day(date: string, earnedBlocks: number, focusMinutes: number, breakMinutes: number): DayStatRow {
  return { date, earnedBlocks, focusMinutes, breakMinutes, lastUpdated: NOW * 1000 };
}

function session(start: number, date: string, type: SessionRow["type"], duration: number, completed = true): SessionRow {
  return { start, date, type, duration, completed, tag: null };
}

const CREW = {
  crewId: "aa".repeat(16),
  identityPublicKey: "00".repeat(31) + "01",
  displayName: "Snehit",
  avatarBase64: null,
};

describe("buildOwnSnapshot", () => {
  test("builds a snapshot with aggregates, streak, and last-focused timestamp", () => {
    const dayStats = [
      day("2026-08-01", 2, 50, 10),
      day("2026-07-31", 3, 75, 15),
      day("2026-07-30", 1, 25, 5),
    ];
    const sessions = [
      session(NOW - 3600, "2026-08-01", "work", 1500),
      session(NOW - 7200, "2026-08-01", "short", 300, false),
    ];
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats, sessions, now: NOW, offsetMinutes: OFFSET });

    expect(snapshot.version).toBe(2);
    expect(snapshot.localDate).toBe("2026-08-01");
    expect(snapshot.utcOffsetMinutes).toBe(OFFSET);
    expect(snapshot.allTimeFocusMinutes).toBe(150);
    expect(snapshot.currentStreak).toBe(3);
    expect(snapshot.lastFocusedAtEpochSeconds).toBe(NOW - 3600 + 1500);
    expect(snapshot.dailyAggregates).toEqual([
      { localDate: "2026-08-01", focusMinutes: 50, completedWorkBlocks: 2 },
      { localDate: "2026-07-31", focusMinutes: 75, completedWorkBlocks: 3 },
      { localDate: "2026-07-30", focusMinutes: 25, completedWorkBlocks: 1 },
    ]);
  });

  test("caps aggregates at the most recent 30 days, sorted descending", () => {
    const dayStats: DayStatRow[] = [];
    for (let k = 0; k < 32; k++) {
      const date = new Date(NOW * 1000 + OFFSET * 60000 - k * 86400000);
      const key = date.toISOString().slice(0, 10);
      dayStats.push(day(key, 1, 10, 0));
    }
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats, sessions: [], now: NOW, offsetMinutes: OFFSET });
    expect(snapshot.dailyAggregates).toHaveLength(30);
    expect(snapshot.dailyAggregates[0]!.localDate).toBe("2026-08-01");
  });

  test("builds stats extras from work sessions and day stats", () => {
    const dayStats = [
      day("2026-08-01", 2, 50, 10),
      day("2026-07-31", 3, 75, 15),
      day("2026-07-30", 1, 25, 5),
    ];
    const sessions = [session(NOW - 3600, "2026-08-01", "work", 1500)];
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats, sessions, now: NOW, offsetMinutes: OFFSET });
    const stats = snapshot.stats!;

    expect(stats.hourBuckets).toHaveLength(24);
    expect(stats.hourBuckets.reduce((a, b) => a + b, 0)).toBe(25);
    expect(stats.weekdayBuckets).toHaveLength(7);
    expect(stats.weekdayBuckets.reduce((a, b) => a + b, 0)).toBe(25);
    expect(stats.allTimeWorkBlocks).toBe(6);
    expect(stats.allTimeActiveDays).toBe(3);
    expect(stats.bestStreak).toBe(3);
    expect(stats.firstFocusLocalDate).toBe("2026-07-30");
    expect(stats.historyStartDate).toBe("2026-07-30");
    expect(stats.historyFocusMinutes).toEqual([25, 75, 50]);
    expect(stats.historyWorkBlocks).toEqual([1, 3, 2]);
    expect(stats.bestDayLocalDate).toBe("2026-07-31");
    expect(stats.bestDayFocusMinutes).toBe(75);
    expect(stats.bestDayWorkBlocks).toBe(3);
    expect(stats.bestWeekStartDate).toBe("2026-07-26");
    expect(stats.bestWeekFocusMinutes).toBe(150);
    expect(stats.bestWeekWorkBlocks).toBe(6);
  });

  test("handles an empty history with zeroed stats", () => {
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats: [], sessions: [], now: NOW, offsetMinutes: OFFSET });
    expect(snapshot.allTimeFocusMinutes).toBe(0);
    expect(snapshot.currentStreak).toBe(0);
    expect(snapshot.lastFocusedAtEpochSeconds).toBe(0);
    expect(snapshot.dailyAggregates).toEqual([]);
    const stats = snapshot.stats!;
    expect(stats.firstFocusLocalDate).toBeNull();
    expect(stats.historyStartDate).toBe("2026-04-04");
    expect(stats.historyFocusMinutes).toHaveLength(120);
    expect(stats.historyFocusMinutes.every((v) => v === 0)).toBe(true);
    expect(stats.bestDayLocalDate).toBeNull();
    expect(stats.bestWeekStartDate).toBeNull();
  });
});
