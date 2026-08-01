import "./helpers/db";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CrewDao, HistoryDao } from "../src/db/dao";
import type { CrewDailyRow, CrewRelayStateRow, CrewSnapshotRow } from "../src/db/dao";
import type { SessionRow } from "../src/db/types";
import { DB_NAME, openDb } from "../src/db/schema";
import type { Phase } from "../src/engine/timer";

let db: IDBDatabase;
let history: HistoryDao;
let crew: CrewDao;

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

function snapshot(crewId: string, identityPublicKey: string, publishedAtEpochSeconds: number): CrewSnapshotRow {
  return {
    crewId,
    identityPublicKey,
    displayName: "member",
    avatarBase64: null,
    allTimeFocusMinutes: 0,
    publishedAtEpochSeconds,
    localDate: "2026-08-01",
    utcOffsetMinutes: 330,
    currentStreak: 0,
    lastFocusedAtEpochSeconds: 0,
    protocolVersion: 1,
    statsJson: null,
  };
}

function daily(
  crewId: string,
  identityPublicKey: string,
  localDate: string,
  focusMinutes: number,
  completedWorkBlocks: number,
): CrewDailyRow {
  return { crewId, identityPublicKey, localDate, focusMinutes, completedWorkBlocks };
}

beforeEach(async () => {
  db = await openDb();
  history = new HistoryDao(db);
  crew = new CrewDao(db);
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
});

describe("CrewDao", () => {
  test("upsertLatest stores a strictly newer snapshot and its aggregates", async () => {
    const first = snapshot("crew-a", "key-1", 100);
    expect(await crew.upsertLatest(first, [daily("crew-a", "key-1", "2026-08-01", 25, 1)])).toBe(true);
    const second = snapshot("crew-a", "key-1", 200);
    expect(await crew.upsertLatest(second, [daily("crew-a", "key-1", "2026-08-02", 50, 2)])).toBe(true);
    const rows = await crew.snapshotsForCrew("crew-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(second);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([daily("crew-a", "key-1", "2026-08-02", 50, 2)]);
  });

  test("upsertLatest rejects an equal publishedAt and changes nothing", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [daily("crew-a", "key-1", "2026-08-01", 25, 1)]);
    expect(
      await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [daily("crew-a", "key-1", "2026-08-02", 99, 9)]),
    ).toBe(false);
    const rows = await crew.snapshotsForCrew("crew-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.publishedAtEpochSeconds).toBe(100);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([daily("crew-a", "key-1", "2026-08-01", 25, 1)]);
  });

  test("upsertLatest rejects an older publishedAt", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 200), []);
    expect(
      await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [daily("crew-a", "key-1", "2026-08-01", 25, 1)]),
    ).toBe(false);
    const rows = await crew.snapshotsForCrew("crew-a");
    expect(rows).toHaveLength(1);
    expect(rows[0]!.publishedAtEpochSeconds).toBe(200);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([]);
  });

  test("upsertLatest replaces daily aggregates wholesale", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [
      daily("crew-a", "key-1", "2026-08-01", 25, 1),
      daily("crew-a", "key-1", "2026-08-02", 30, 2),
    ]);
    expect(
      await crew.upsertLatest(snapshot("crew-a", "key-1", 200), [daily("crew-a", "key-1", "2026-08-03", 50, 3)]),
    ).toBe(true);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([daily("crew-a", "key-1", "2026-08-03", 50, 3)]);
    expect(await crew.upsertLatest(snapshot("crew-a", "key-1", 300), [])).toBe(true);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([]);
  });

  test("snapshotsForCrew returns every member of the crew", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 100), []);
    await crew.upsertLatest(snapshot("crew-a", "key-2", 100), []);
    await crew.upsertLatest(snapshot("crew-b", "key-3", 100), []);
    const rows = await crew.snapshotsForCrew("crew-a");
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.identityPublicKey).sort()).toEqual(["key-1", "key-2"]);
  });

  test("dailyFor is scoped to one member", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [daily("crew-a", "key-1", "2026-08-01", 25, 1)]);
    await crew.upsertLatest(snapshot("crew-a", "key-2", 100), [daily("crew-a", "key-2", "2026-08-01", 40, 2)]);
    expect(await crew.dailyFor("crew-a", "key-2")).toEqual([daily("crew-a", "key-2", "2026-08-01", 40, 2)]);
  });

  test("setHidden and unhide toggle a member's hidden state", async () => {
    await crew.setHidden("crew-a", "key-1", 1000);
    await crew.setHidden("crew-a", "key-2", 2000);
    expect((await crew.hiddenKeys("crew-a")).sort()).toEqual(["key-1", "key-2"]);
    await crew.unhide("crew-a", "key-1");
    expect(await crew.hiddenKeys("crew-a")).toEqual(["key-2"]);
    await crew.setHidden("crew-a", "key-1", 3000);
    expect((await crew.hiddenKeys("crew-a")).sort()).toEqual(["key-1", "key-2"]);
  });

  test("updateRelayState keeps last success and error when null", async () => {
    await crew.updateRelayState("crew-a", "wss://relay1", 100, 1000, null);
    await crew.updateRelayState("crew-a", "wss://relay1", 200, null, "timeout");
    let rows = await crew.relayStates("crew-a");
    expect(rows[0]).toEqual({
      crewId: "crew-a",
      relayUrl: "wss://relay1",
      lastAttemptEpochSeconds: 200,
      lastSuccessEpochSeconds: 1000,
      lastError: "timeout",
    });
    await crew.updateRelayState("crew-a", "wss://relay1", 300, null, null);
    rows = await crew.relayStates("crew-a");
    expect(rows[0]).toEqual({
      crewId: "crew-a",
      relayUrl: "wss://relay1",
      lastAttemptEpochSeconds: 300,
      lastSuccessEpochSeconds: 1000,
      lastError: "timeout",
    });
  });

  test("updateRelayState overwrites with new non-null values", async () => {
    await crew.updateRelayState("crew-a", "wss://relay1", 100, 1000, "old");
    await crew.updateRelayState("crew-a", "wss://relay1", 200, 2000, null);
    const rows = await crew.relayStates("crew-a");
    expect(rows[0]).toEqual({
      crewId: "crew-a",
      relayUrl: "wss://relay1",
      lastAttemptEpochSeconds: 200,
      lastSuccessEpochSeconds: 2000,
      lastError: "old",
    });
  });

  test("relayStates returns every relay for the crew", async () => {
    await crew.updateRelayState("crew-a", "wss://z-relay", 1, 1, null);
    await crew.updateRelayState("crew-a", "wss://a-relay", 1, 1, null);
    await crew.updateRelayState("crew-b", "wss://a-relay", 1, 1, null);
    expect((await crew.relayStates("crew-a")).map((r) => r.relayUrl)).toEqual(["wss://a-relay", "wss://z-relay"]);
  });

  test("deleteCrew clears all four crew stores", async () => {
    await crew.upsertLatest(snapshot("crew-a", "key-1", 100), [daily("crew-a", "key-1", "2026-08-01", 25, 1)]);
    await crew.setHidden("crew-a", "key-1", 1000);
    await crew.updateRelayState("crew-a", "wss://a-relay", 100, 1000, null);
    await crew.updateRelayState("crew-a", "wss://b-relay", 100, null, "err");

    await crew.upsertLatest(snapshot("crew-b", "key-2", 100), [daily("crew-b", "key-2", "2026-08-01", 25, 1)]);
    await crew.setHidden("crew-b", "key-2", 1000);
    await crew.updateRelayState("crew-b", "wss://a-relay", 100, 1000, null);

    await crew.deleteCrew("crew-a");

    expect(await crew.snapshotsForCrew("crew-a")).toEqual([]);
    expect(await crew.dailyFor("crew-a", "key-1")).toEqual([]);
    expect(await crew.hiddenKeys("crew-a")).toEqual([]);
    expect(await crew.relayStates("crew-a")).toEqual([]);

    expect(await crew.snapshotsForCrew("crew-b")).toHaveLength(1);
    expect(await crew.dailyFor("crew-b", "key-2")).toHaveLength(1);
    expect(await crew.hiddenKeys("crew-b")).toEqual(["key-2"]);
    expect(await crew.relayStates("crew-b")).toEqual([
      {
        crewId: "crew-b",
        relayUrl: "wss://a-relay",
        lastAttemptEpochSeconds: 100,
        lastSuccessEpochSeconds: 1000,
        lastError: null,
      },
    ]);
  });
});
