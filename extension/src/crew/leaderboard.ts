import type { SnapshotPlain } from "./types";
import { dateStringOf, prevDate } from "../engine/dateLogic";
import { fingerprint as fingerprintOf } from "./identity";

export type WindowKey = "today" | "7d" | "30d" | "all";

export interface BoardMember {
  identityPublicKey: string;
  displayName: string;
  fingerprint: string;
  focusMinutes: number;
  streak: number;
  dailyTrend: (number | null)[];
  rank: number | null;
  active: boolean;
  stale: boolean;
  inactive: boolean;
  neverFocused: boolean;
  lastFocusedAtEpochSeconds: number;
}

export interface BoardSummary {
  totalFocusMinutes: number;
  rankedMembers: number;
  medianFocusMinutes: number;
}

export interface Board {
  members: BoardMember[];
  summary: BoardSummary;
  refreshedAtEpochSeconds: number;
}

export interface Standing {
  rank: number | null;
  focusMinutes: number;
  tieCount: number;
  gapToNext: number | null;
  unranked: boolean;
}

const DAY = 86400;

interface Row {
  snapshot: SnapshotPlain;
  focusMinutes: number;
  dailyTrend: (number | null)[];
  active: boolean;
  inactive: boolean;
  neverFocused: boolean;
  stale: boolean;
  rank: number | null;
}

export function aggregateBoard(
  snapshots: SnapshotPlain[],
  opts: { window: WindowKey; now: number; hiddenKeys: Set<string> },
): Board {
  const visible = snapshots.filter((s) => !opts.hiddenKeys.has(s.identityPublicKey));
  const nameCounts = new Map<string, number>();
  for (const s of visible) {
    nameCounts.set(s.displayName, (nameCounts.get(s.displayName) ?? 0) + 1);
  }

  const rows: Row[] = visible.map((s) => {
    const memberToday = dateStringOf(opts.now, s.utcOffsetMinutes);
    let focusMinutes: number;
    if (opts.window === "all") {
      focusMinutes = s.allTimeFocusMinutes;
    } else {
      const span = opts.window === "today" ? 1 : opts.window === "7d" ? 7 : 30;
      let windowStart = memberToday;
      for (let k = 1; k < span; k++) {
        windowStart = prevDate(windowStart, s.utcOffsetMinutes);
      }
      focusMinutes = 0;
      for (const a of s.dailyAggregates) {
        if (a.localDate >= windowStart && a.localDate <= memberToday) {
          focusMinutes += a.focusMinutes;
        }
      }
    }
    const byDate = new Map(s.dailyAggregates.map((a) => [a.localDate, a.focusMinutes]));
    const dailyTrend: (number | null)[] = [];
    for (let k = 6; k >= 0; k--) {
      let date = memberToday;
      for (let j = 0; j < k; j++) {
        date = prevDate(date, s.utcOffsetMinutes);
      }
      dailyTrend.push(byDate.get(date) ?? null);
    }
    // A lastFocusedAt newer than the snapshot's own publication time is a lie
    // (or clock skew); clamp so it cannot mark a member perpetually active.
    const publishedAt = s.publishedAtEpochSeconds;
    const rawLastFocused = s.lastFocusedAtEpochSeconds;
    const lastFocused = rawLastFocused > 0 && rawLastFocused <= publishedAt ? rawLastFocused : 0;
    const neverFocused = lastFocused === 0;
    const inactive = !neverFocused && lastFocused < opts.now - 30 * DAY;
    const active = !inactive;
    return {
      snapshot: { ...s, lastFocusedAtEpochSeconds: lastFocused },
      focusMinutes,
      dailyTrend,
      active,
      inactive,
      neverFocused,
      stale: !neverFocused && !inactive && lastFocused < opts.now - 7 * DAY,
      rank: null,
    };
  });

  const ranked = rows
    .filter((r) => !r.inactive && r.focusMinutes > 0)
    .sort((a, b) => b.focusMinutes - a.focusMinutes);
  let groupStart = 0;
  while (groupStart < ranked.length) {
    const focus = ranked[groupStart]!.focusMinutes;
    let groupEnd = groupStart;
    while (groupEnd < ranked.length && ranked[groupEnd]!.focusMinutes === focus) {
      groupEnd++;
    }
    const rank = groupStart + 1;
    for (let k = groupStart; k < groupEnd; k++) {
      ranked[k]!.rank = rank;
    }
    groupStart = groupEnd;
  }

  const zeroFocusMembers = rows
    .filter((r) => !r.inactive && r.focusMinutes === 0)
    .sort((a, b) => b.snapshot.lastFocusedAtEpochSeconds - a.snapshot.lastFocusedAtEpochSeconds);
  const inactive = rows
    .filter((r) => r.inactive)
    .sort((a, b) => b.snapshot.lastFocusedAtEpochSeconds - a.snapshot.lastFocusedAtEpochSeconds);

  const ordered = [...ranked, ...zeroFocusMembers, ...inactive];
  const members: BoardMember[] = ordered.map((r) => {
    const s = r.snapshot;
    const fingerprint = fingerprintOf(s.identityPublicKey);
    const collides = (nameCounts.get(s.displayName) ?? 0) > 1;
    return {
      identityPublicKey: s.identityPublicKey,
      displayName: collides ? `${s.displayName} · ${fingerprint}` : s.displayName,
      fingerprint,
      focusMinutes: r.focusMinutes,
      streak: s.currentStreak,
      dailyTrend: r.dailyTrend,
      rank: r.rank,
      active: r.active,
      stale: r.stale,
      inactive: r.inactive,
      neverFocused: r.neverFocused,
      lastFocusedAtEpochSeconds: s.lastFocusedAtEpochSeconds,
    };
  });

  // Keep total consistent with ranked/median: only current (non-inactive)
  // members count toward the crew total.
  const totalFocusMinutes = rows
    .filter((r) => !r.inactive)
    .reduce((sum, r) => sum + r.focusMinutes, 0);
  const positive = ranked
    .map((r) => r.focusMinutes)
    .sort((a, b) => a - b);
  let medianFocusMinutes = 0;
  if (positive.length > 0) {
    const mid = Math.floor(positive.length / 2);
    medianFocusMinutes =
      positive.length % 2 === 1 ? positive[mid]! : (positive[mid - 1]! + positive[mid]!) / 2;
  }

  return {
    members,
    summary: { totalFocusMinutes, rankedMembers: positive.length, medianFocusMinutes },
    refreshedAtEpochSeconds: opts.now,
  };
}

export function standingFor(board: Board, selfKey: string): Standing | null {
  const self = board.members.find((m) => m.identityPublicKey === selfKey);
  if (!self) {
    return null;
  }
  const tieCount = self.rank === null ? 0 : board.members.filter((m) => m.rank === self.rank).length - 1;
  let gapToNext: number | null = null;
  if (self.rank === null) {
    const rankedFocus = board.members.filter((m) => m.rank !== null).map((m) => m.focusMinutes);
    if (rankedFocus.length > 0) {
      gapToNext = Math.min(...rankedFocus);
    }
  } else {
    const above = board.members
      .filter((m) => m.rank !== null && m.focusMinutes > self.focusMinutes)
      .map((m) => m.focusMinutes);
    if (above.length > 0) {
      gapToNext = Math.min(...above) - self.focusMinutes;
    } else {
      const tied = board.members.filter((m) => m.rank === self.rank).length > 1;
      const below = board.members
        .filter((m) => m.rank !== null && m.focusMinutes < self.focusMinutes)
        .map((m) => m.focusMinutes);
      if (!tied && below.length > 0) gapToNext = self.focusMinutes - Math.max(...below);
    }
  }
  return {
    rank: self.rank,
    focusMinutes: self.focusMinutes,
    tieCount,
    gapToNext,
    unranked: self.rank === null,
  };
}
