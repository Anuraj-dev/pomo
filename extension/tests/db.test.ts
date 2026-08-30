import "./helpers/db";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { HistoryDao } from "../src/db/dao";
import type { SessionRow } from "../src/db/types";
import { DB_NAME, openDb } from "../src/db/schema";
import type { Phase } from "../src/engine/timer";

let db: IDBDatabase;
let history: HistoryDao;

function session(
  start: number,
  date: string,
  type: Phase,
  duration: number,
  completed = true,
  tag: string | null = null,
): SessionRow {
  return { start, date, type, duration, completed, tag };
}

beforeEach(async () => {
  db = await openDb();
  history = new HistoryDao(db);
});
afterEach(async () => {
  db.close();
  await new Promise<void>((resolve, reject) => {
    const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
});

describe("HistoryDao", () => {
  test("insertSessionWithDayStats creates a fresh dayStats row", async () => {
    await history.insertSessionWithDayStats(session(100, "2026-08-01", "work", 1500), {
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
    });
    const stats = await history.dayStatsForDate("2026-08-01");
    expect(stats).toEqual({
      date: "2026-08-01",
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
      lastUpdated: expect.any(Number),
    });
  });

  test("insertSessionWithDayStats accumulates deltas on a second insert", async () => {
    await history.insertSessionWithDayStats(session(100, "2026-08-01", "work", 1500), {
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
    });
    await history.insertSessionWithDayStats(session(200, "2026-08-01", "short", 300), {
      earnedBlocks: 0,
      focusMinutes: 0,
      breakMinutes: 5,
    });
    await history.insertSessionWithDayStats(session(300, "2026-08-01", "work", 1200, false), {
      earnedBlocks: 0,
      focusMinutes: 20,
      breakMinutes: 0,
    });
    const stats = await history.dayStatsForDate("2026-08-01");
    expect(stats!.earnedBlocks).toBe(1);
    expect(stats!.focusMinutes).toBe(45);
    expect(stats!.breakMinutes).toBe(5);
    expect(stats!.lastUpdated).toBeGreaterThan(0);
  });

  test("sessionsForDate returns that date's sessions ordered by start", async () => {
    await history.insertSession(session(300, "2026-08-02", "work", 1500));
    await history.insertSession(session(100, "2026-08-02", "short", 300));
    await history.insertSession(session(200, "2026-08-02", "work", 1500));
    await history.insertSession(session(400, "2026-08-03", "work", 1500));
    const rows = await history.sessionsForDate("2026-08-02");
    expect(rows.map((r) => r.start)).toEqual([100, 200, 300]);
  });

  test("allSessions orders every session by start ascending", async () => {
    await history.insertSession(session(500, "2026-08-04", "work", 1500));
    await history.insertSession(session(100, "2026-08-02", "work", 1500));
    await history.insertSession(session(300, "2026-08-03", "short", 300));
    const rows = await history.allSessions();
    expect(rows.map((r) => r.start)).toEqual([100, 300, 500]);
  });

  test("insertSession replaces an existing row with the same start", async () => {
    await history.insertSession(session(100, "2026-08-05", "work", 1500, true, "a"));
    await history.insertSession({ ...session(100, "2026-08-05", "work", 1500), completed: false, tag: "b" });
    const rows = await history.sessionsForDate("2026-08-05");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tag).toBe("b");
    expect(rows[0]!.completed).toBe(false);
  });

  test("lastSession returns the session with the newest start", async () => {
    await history.insertSession(session(100, "2026-08-05", "work", 1500));
    await history.insertSession(session(200, "2026-08-05", "short", 300));
    await history.insertSession(session(300, "2026-08-06", "work", 1500));
    expect((await history.lastSession())!.start).toBe(300);
  });

  test("dayStats returns rows ordered by date", async () => {
    await history.insertSessionWithDayStats(session(100, "2026-08-03", "work", 1500), {
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
    });
    await history.insertSessionWithDayStats(session(200, "2026-08-01", "work", 1500), {
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
    });
    await history.insertSessionWithDayStats(session(300, "2026-08-02", "work", 1500), {
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
    });
    expect((await history.dayStats()).map((r) => r.date)).toEqual(["2026-08-01", "2026-08-02", "2026-08-03"]);
  });

  test("earnedBlocksForDate falls back to zero without dayStats", async () => {
    await history.insertSessionWithDayStats(session(100, "2026-08-07", "work", 1500), {
      earnedBlocks: 3,
      focusMinutes: 75,
      breakMinutes: 0,
    });
    expect(await history.earnedBlocksForDate("2026-08-07")).toBe(3);
    expect(await history.earnedBlocksForDate("2026-08-08")).toBe(0);
  });

  test("insertBlock is idempotent: replaying a segment start never double-counts dayStats", async () => {
    const block = {
      row: session(100, "2026-08-01", "work", 1500),
      delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
    };
    expect(await history.insertBlock([block])).toEqual([100]);
    expect(await history.insertBlock([block])).toEqual([]);
    expect(await history.sessionsForDate("2026-08-01")).toHaveLength(1);
    expect(await history.dayStatsForDate("2026-08-01")).toEqual({
      date: "2026-08-01",
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
      lastUpdated: expect.any(Number),
    });
  });

  test("mergeBackup imports disjoint sessions and dayStats into an existing database", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const result = await history.mergeBackup(
      [
        { date: "2026-08-02", earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0, lastUpdated: 1_000 },
        { date: "2026-08-03", earnedBlocks: 2, focusMinutes: 50, breakMinutes: 0, lastUpdated: 2_000 },
      ],
      [session(200, "2026-08-02", "work", 1500), session(300, "2026-08-03", "short", 300)],
    );
    expect(result).toEqual({ sessionsAdded: 2, daysAffected: 2, conflicts: 0 });
    expect((await history.sessionsForDate("2026-08-02")).map((r) => r.start)).toEqual([200]);
    expect(await history.dayStatsForDate("2026-08-02")).toEqual({
      date: "2026-08-02",
      earnedBlocks: 1,
      focusMinutes: 25,
      breakMinutes: 0,
      lastUpdated: expect.any(Number),
    });
    expect(await history.dayStatsForDate("2026-08-03")).toEqual({
      date: "2026-08-03",
      earnedBlocks: 2,
      focusMinutes: 50,
      breakMinutes: 5,
      lastUpdated: expect.any(Number),
    });
  });

  test("mergeBackup counts a conflict on a duplicate start with different content and keeps the local row", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500, true, "local"),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const result = await history.mergeBackup(
      [{ date: "2026-08-01", earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0, lastUpdated: 1 }],
      [session(100, "2026-08-01", "work", 900, false, "backup")],
    );
    expect(result).toEqual({ sessionsAdded: 0, daysAffected: 0, conflicts: 1 });
    const rows = await history.sessionsForDate("2026-08-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tag).toBe("local");
    expect(rows[0]!.completed).toBe(true);
  });

  test("mergeBackup counts a conflict when only the date differs on a colliding start", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const result = await history.mergeBackup([], [session(100, "2026-08-02", "work", 1500)]);
    expect(result).toEqual({ sessionsAdded: 0, daysAffected: 0, conflicts: 1 });
    const rows = await history.sessionsForDate("2026-08-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.date).toBe("2026-08-01");
  });

  test("mergeBackup counts a conflict when only the tag differs on a colliding start", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500, true, "local"),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const result = await history.mergeBackup([], [session(100, "2026-08-01", "work", 1500, true, "backup")]);
    expect(result).toEqual({ sessionsAdded: 0, daysAffected: 0, conflicts: 1 });
    const rows = await history.sessionsForDate("2026-08-01");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.tag).toBe("local");
  });

  test("mergeBackup rejects a duplicate start within the backup payload and counts a conflict", async () => {
    const result = await history.mergeBackup(
      [],
      [session(100, "2026-08-01", "work", 1500), session(100, "2026-08-01", "work", 900, false)],
    );
    expect(result).toEqual({ sessionsAdded: 1, daysAffected: 1, conflicts: 1 });
    const rows = await history.allSessions();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.duration).toBe(1500);
    expect(rows[0]!.completed).toBe(true);
  });

  test("mergeBackup counts identical duplicate starts in the payload as conflicts too", async () => {
    const result = await history.mergeBackup(
      [],
      [session(100, "2026-08-01", "work", 1500), session(100, "2026-08-01", "work", 1500)],
    );
    expect(result).toEqual({ sessionsAdded: 1, daysAffected: 1, conflicts: 1 });
    const rows = await history.allSessions();
    expect(rows).toHaveLength(1);
  });

  test("mergeBackup max-merges dayStats per field across derived, local, and backup totals", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const result = await history.mergeBackup(
      [{ date: "2026-08-01", earnedBlocks: 5, focusMinutes: 10, breakMinutes: 3, lastUpdated: 1 }],
      [session(200, "2026-08-01", "short", 300)],
    );
    expect(result).toEqual({ sessionsAdded: 1, daysAffected: 1, conflicts: 0 });
    expect(await history.dayStatsForDate("2026-08-01")).toEqual({
      date: "2026-08-01",
      earnedBlocks: 5,
      focusMinutes: 25,
      breakMinutes: 5,
      lastUpdated: expect.any(Number),
    });
  });

  test("mergeBackup only writes day rows that actually changed", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500),
        delta: { earnedBlocks: 2, focusMinutes: 50, breakMinutes: 0 },
      },
    ]);
    const before = await history.dayStatsForDate("2026-08-01");
    const result = await history.mergeBackup(
      [{ date: "2026-08-01", earnedBlocks: 2, focusMinutes: 50, breakMinutes: 0, lastUpdated: 1 }],
      [session(200, "2026-08-02", "work", 1500)],
    );
    expect(result.daysAffected).toBe(1);
    expect(await history.dayStatsForDate("2026-08-02")).toBeDefined();
    expect(await history.dayStatsForDate("2026-08-01")).toEqual(before);
  });

  test("mergeBackup preserves the existing lastUpdated of unchanged day rows", async () => {
    await history.insertBlock([
      {
        row: session(100, "2026-08-01", "work", 1500),
        delta: { earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 },
      },
    ]);
    const before = await history.dayStatsForDate("2026-08-01");
    await history.mergeBackup([], []);
    const after = await history.dayStatsForDate("2026-08-01");
    expect(after!.lastUpdated).toBe(before!.lastUpdated);
  });
});
