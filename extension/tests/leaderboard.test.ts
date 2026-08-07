import { describe, expect, test } from "bun:test";
import { aggregateBoard, standingFor } from "../src/crew/leaderboard";
import type { DailyAggregate, SnapshotPlain } from "../src/crew/types";
import { dateStringOf } from "../src/engine/dateLogic";

const NOW = 1_700_000_000;
const DAY = 86400;

function makeSnapshots(n: number, seed: number, now: number): SnapshotPlain[] {
  const snapshots: SnapshotPlain[] = [];
  let state = seed;
  const nextRand = (): number => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
  for (let i = 0; i < n; i++) {
    const lastFocusedAtEpochSeconds = now - Math.floor(nextRand() * 90 * DAY);
    const dailyAggregates = [];
    let allTimeFocusMinutes = 0;
    for (let d = 0; d < 30; d++) {
      const focusMinutes = Math.floor(nextRand() * 180);
      allTimeFocusMinutes += focusMinutes;
      dailyAggregates.push({
        localDate: dateStringOf(now - d * DAY, 0),
        focusMinutes,
        completedWorkBlocks: Math.floor(nextRand() * 10),
      });
    }
    snapshots.push({
      crewId: "crew",
      identityPublicKey: i.toString(16).padStart(64, "0"),
      displayName: `M${i}`,
      avatarBase64: null,
      allTimeFocusMinutes,
      publishedAtEpochSeconds: now,
      localDate: dateStringOf(now, 0),
      utcOffsetMinutes: 0,
      dailyAggregates,
      currentStreak: Math.floor(nextRand() * 12),
      lastFocusedAtEpochSeconds,
      version: 2,
      stats: null,
    });
  }
  return snapshots;
}

function key(i: number): string {
  return i.toString(16).padStart(64, "0");
}

function agg(localDate: string, focusMinutes: number, completedWorkBlocks = 1): DailyAggregate {
  return { localDate, focusMinutes, completedWorkBlocks };
}

function snapshot(overrides: Partial<SnapshotPlain>): SnapshotPlain {
  return {
    crewId: "crew",
    identityPublicKey: key(99),
    displayName: "M",
    avatarBase64: null,
    allTimeFocusMinutes: 0,
    publishedAtEpochSeconds: NOW,
    localDate: dateStringOf(NOW, 0),
    utcOffsetMinutes: 0,
    dailyAggregates: [],
    currentStreak: 0,
    lastFocusedAtEpochSeconds: NOW,
    version: 2,
    stats: null,
    ...overrides,
  };
}

describe("aggregateBoard", () => {
  test("tie ranks share rank, next group jumps", () => {
    const a = snapshot({ identityPublicKey: key(1), displayName: "A", currentStreak: 3, dailyAggregates: [agg("2023-11-14", 100)] });
    const b = snapshot({ identityPublicKey: key(2), displayName: "B", dailyAggregates: [agg("2023-11-14", 100)] });
    const c = snapshot({ identityPublicKey: key(3), displayName: "C", dailyAggregates: [agg("2023-11-14", 50)] });
    const board = aggregateBoard([a, b, c], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members.map((m) => m.rank)).toEqual([1, 1, 3]);
    expect(board.members.map((m) => m.identityPublicKey)).toEqual([key(1), key(2), key(3)]);
    expect(board.members[0]!.streak).toBe(3);
    expect(board.refreshedAtEpochSeconds).toBe(NOW);
  });

  test("zero-focus members are unranked and listed after ranked", () => {
    const big = snapshot({ identityPublicKey: key(1), displayName: "Big", dailyAggregates: [agg("2023-11-14", 80)] });
    const zero = snapshot({ identityPublicKey: key(2), displayName: "Zero", dailyAggregates: [agg("2023-11-14", 0)] });
    const board = aggregateBoard([zero, big], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members.map((m) => m.identityPublicKey)).toEqual([key(1), key(2)]);
    expect(board.members[0]!.rank).toBe(1);
    expect(board.members[1]!.rank).toBeNull();
  });

  test("7d window excludes aggregates older than six days", () => {
    const s = snapshot({
      identityPublicKey: key(1),
      dailyAggregates: [agg("2023-11-07", 500), agg("2023-11-08", 100), agg("2023-11-14", 0)],
    });
    const board = aggregateBoard([s], { window: "7d", now: NOW, hiddenKeys: new Set() });
    expect(board.members[0]!.focusMinutes).toBe(100);
    expect(board.members[0]!.dailyTrend).toEqual([100, null, null, null, null, null, 0]);
  });

  test("member-local today differs by utcOffsetMinutes", () => {
    const east = snapshot({ identityPublicKey: key(1), displayName: "E", utcOffsetMinutes: 330, dailyAggregates: [agg("2023-11-15", 100), agg("2023-11-14", 200)] });
    const west = snapshot({ identityPublicKey: key(2), displayName: "W", utcOffsetMinutes: -420, dailyAggregates: [agg("2023-11-14", 200), agg("2023-11-13", 300)] });
    const board = aggregateBoard([east, west], { window: "today", now: NOW, hiddenKeys: new Set() });
    const e = board.members.find((m) => m.identityPublicKey === key(1))!;
    const w = board.members.find((m) => m.identityPublicKey === key(2))!;
    expect(e.focusMinutes).toBe(100);
    expect(w.focusMinutes).toBe(200);
    expect(e.focusMinutes).not.toBe(w.focusMinutes);
  });

  test("inactive members are unranked, stale flag set, active members ranked", () => {
    const recent = snapshot({ identityPublicKey: key(1), displayName: "R", dailyAggregates: [agg("2023-11-14", 60)], lastFocusedAtEpochSeconds: NOW - 3 * DAY });
    const staleMember = snapshot({ identityPublicKey: key(2), displayName: "S", dailyAggregates: [agg("2023-11-14", 40)], lastFocusedAtEpochSeconds: NOW - 10 * DAY });
    const gone = snapshot({ identityPublicKey: key(3), displayName: "G", dailyAggregates: [agg("2023-11-14", 20)], lastFocusedAtEpochSeconds: NOW - 40 * DAY });
    const board = aggregateBoard([recent, staleMember, gone], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members.map((m) => m.identityPublicKey)).toEqual([key(1), key(2), key(3)]);
    expect(board.members.map((m) => m.rank)).toEqual([1, 2, null]);
    expect(board.members[0]!.active).toBe(true);
    expect(board.members[0]!.stale).toBe(false);
    expect(board.members[0]!.inactive).toBe(false);
    expect(board.members[1]!.active).toBe(true);
    expect(board.members[1]!.stale).toBe(true);
    expect(board.members[2]!.active).toBe(false);
    expect(board.members[2]!.stale).toBe(false);
    expect(board.members[2]!.inactive).toBe(true);
  });

  test("never-focused members are not classified as inactive", () => {
    const neverFocused = snapshot({ identityPublicKey: key(4), displayName: "N", lastFocusedAtEpochSeconds: 0 });
    const board = aggregateBoard([neverFocused], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members[0]!.active).toBe(true);
    expect(board.members[0]!.inactive).toBe(false);
  });

  test("partial-focus members with no completed block remain rankable", () => {
    const partial = snapshot({
      identityPublicKey: key(4),
      dailyAggregates: [agg("2023-11-14", 20, 0)],
      lastFocusedAtEpochSeconds: 0,
    });
    const board = aggregateBoard([partial], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members[0]!.rank).toBe(1);
    expect(board.members[0]!.inactive).toBe(false);
  });

  test("hidden members are removed entirely", () => {
    const a = snapshot({ identityPublicKey: key(1), dailyAggregates: [agg("2023-11-14", 30)] });
    const b = snapshot({ identityPublicKey: key(2), dailyAggregates: [agg("2023-11-14", 20)] });
    const c = snapshot({ identityPublicKey: key(3), dailyAggregates: [agg("2023-11-14", 10)] });
    const board = aggregateBoard([a, b, c], { window: "today", now: NOW, hiddenKeys: new Set([key(2)]) });
    expect(board.members.map((m) => m.identityPublicKey)).toEqual([key(1), key(3)]);
    expect(board.summary.totalFocusMinutes).toBe(40);
    expect(board.summary.rankedMembers).toBe(2);
  });

  test("colliding display names get fingerprint suffix", () => {
    const x1 = snapshot({ identityPublicKey: key(1), displayName: "X", dailyAggregates: [agg("2023-11-14", 10)] });
    const x2 = snapshot({ identityPublicKey: key(2), displayName: "X", dailyAggregates: [agg("2023-11-14", 20)] });
    const y = snapshot({ identityPublicKey: key(3), displayName: "Y", dailyAggregates: [agg("2023-11-14", 5)] });
    const board = aggregateBoard([x1, x2, y], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(board.members.map((m) => m.displayName)).toEqual(["X · 00000002", "X · 00000001", "Y"]);
    expect(board.members[0]!.fingerprint).toBe("00000002");
  });

  test("all window uses allTimeFocusMinutes", () => {
    const s = snapshot({ identityPublicKey: key(1), allTimeFocusMinutes: 1000, dailyAggregates: [agg("2023-11-14", 42), agg("2023-11-01", 7)] });
    const board = aggregateBoard([s], { window: "all", now: NOW, hiddenKeys: new Set() });
    expect(board.members[0]!.focusMinutes).toBe(1000);
  });

  test("summary totals and median over 500-member fixture", () => {
    const snapshots = makeSnapshots(500, 42, NOW);
    const board = aggregateBoard(snapshots, { window: "30d", now: NOW, hiddenKeys: new Set() });
    const activeFocus = snapshots
      .filter((s) => s.lastFocusedAtEpochSeconds >= NOW - 30 * DAY)
      .map((s) => s.dailyAggregates.reduce((sum, a) => sum + a.focusMinutes, 0));
    const total = activeFocus.reduce((sum, f) => sum + f, 0);
    const positive = activeFocus.filter((f) => f > 0).sort((a, b) => a - b);
    const mid = Math.floor(positive.length / 2);
    const median = positive.length % 2 === 1 ? positive[mid]! : (positive[mid - 1]! + positive[mid]!) / 2;
    expect(board.members.length).toBe(500);
    expect(board.summary.totalFocusMinutes).toBe(total);
    expect(board.summary.rankedMembers).toBe(positive.length);
    expect(board.summary.medianFocusMinutes).toBe(median);
  });

  test("standingFor resolves ranks, ties, and gaps", () => {
    const a = snapshot({ identityPublicKey: key(1), displayName: "A", dailyAggregates: [agg("2023-11-14", 100)] });
    const b = snapshot({ identityPublicKey: key(2), displayName: "B", dailyAggregates: [agg("2023-11-14", 100)] });
    const c = snapshot({ identityPublicKey: key(3), displayName: "C", dailyAggregates: [agg("2023-11-14", 50)] });
    const d = snapshot({ identityPublicKey: key(4), displayName: "D", dailyAggregates: [agg("2023-11-14", 0)] });
    const board = aggregateBoard([a, b, c, d], { window: "today", now: NOW, hiddenKeys: new Set() });
    const leader = standingFor(board, key(1))!;
    expect(leader.rank).toBe(1);
    expect(leader.tieCount).toBe(1);
    expect(leader.gapToNext).toBeNull();
    expect(standingFor(board, key(2))!.tieCount).toBe(1);
    const third = standingFor(board, key(3))!;
    expect(third.rank).toBe(3);
    expect(third.focusMinutes).toBe(50);
    expect(third.tieCount).toBe(0);
    expect(third.gapToNext).toBe(50);
    const unranked = standingFor(board, key(4))!;
    expect(unranked.rank).toBeNull();
    expect(unranked.unranked).toBe(true);
    expect(unranked.gapToNext).toBe(50);
    expect(standingFor(board, key(5))).toBeNull();
  });

  test("unranked members are not reported as tied and a sole leader gets a lead", () => {
    const leader = snapshot({ identityPublicKey: key(1), displayName: "Leader", dailyAggregates: [agg("2023-11-14", 100)] });
    const second = snapshot({ identityPublicKey: key(2), displayName: "Second", dailyAggregates: [agg("2023-11-14", 40)] });
    const zero = snapshot({ identityPublicKey: key(3), displayName: "Zero", dailyAggregates: [agg("2023-11-14", 0)] });
    const board = aggregateBoard([leader, second, zero], { window: "today", now: NOW, hiddenKeys: new Set() });
    expect(standingFor(board, key(1))?.gapToNext).toBe(60);
    expect(standingFor(board, key(3))?.tieCount).toBe(0);
  });
});
