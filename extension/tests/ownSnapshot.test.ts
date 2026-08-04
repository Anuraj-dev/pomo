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

  test("emits no stats extras", () => {
    const dayStats = [
      day("2026-08-01", 2, 50, 10),
      day("2026-07-31", 3, 75, 15),
      day("2026-07-30", 1, 25, 5),
    ];
    const sessions = [session(NOW - 3600, "2026-08-01", "work", 1500)];
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats, sessions, now: NOW, offsetMinutes: OFFSET });
    expect(snapshot.stats).toBeNull();
  });

  test("handles an empty history with zeroed counters", () => {
    const snapshot = buildOwnSnapshot({ ...CREW, dayStats: [], sessions: [], now: NOW, offsetMinutes: OFFSET });
    expect(snapshot.allTimeFocusMinutes).toBe(0);
    expect(snapshot.currentStreak).toBe(0);
    expect(snapshot.lastFocusedAtEpochSeconds).toBe(0);
    expect(snapshot.dailyAggregates).toEqual([]);
    expect(snapshot.stats).toBeNull();
  });
});
