import type { DayStatRow, SessionRow } from "../db/types";
import { dateStringOf, prevDate } from "../engine/dateLogic";
import { bestDayOf, bestStreak, bestWeekOf, currentStreak, rhythmBuckets, weekdayBuckets } from "../engine/stats";
import type { Phase } from "../engine/timer";
import type { SnapshotPlain } from "./types";

export const SNAPSHOT_VERSION = 2;
const MAX_DAILY_AGGREGATES = 30;
const MAX_HISTORY_DAYS = 120;

export interface OwnSnapshotInput {
  crewId: string;
  identityPublicKey: string;
  displayName: string;
  avatarBase64: string | null;
  dayStats: DayStatRow[];
  sessions: SessionRow[];
  now: number;
  offsetMinutes: number;
}

interface DayEntry {
  date: string;
  completed: number;
  workMinutes: number;
  breakMinutes: number;
}

export function buildOwnSnapshot(input: OwnSnapshotInput): SnapshotPlain {
  const byDate = new Map<string, DayEntry>();
  for (const day of input.dayStats) {
    byDate.set(day.date, {
      date: day.date,
      completed: day.earnedBlocks,
      workMinutes: day.focusMinutes,
      breakMinutes: day.breakMinutes,
    });
  }
  const entries = [...byDate.values()];
  const todayKey = dateStringOf(input.now, input.offsetMinutes);

  const activeDates = new Set(entries.filter((entry) => entry.completed > 0).map((entry) => entry.date));
  const allTimeFocusMinutes = entries.reduce((sum, entry) => sum + entry.workMinutes, 0);
  const dailyAggregates = entries
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .slice(0, MAX_DAILY_AGGREGATES)
    .map((entry) => ({
      localDate: entry.date,
      focusMinutes: entry.workMinutes,
      completedWorkBlocks: entry.completed,
    }));

  const workSessions = input.sessions.filter((session) => session.type === "work");
  const lastFocusedAt = workSessions
    .filter((session) => session.completed)
    .reduce((max, session) => Math.max(max, session.start + session.duration), 0);

  return {
    crewId: input.crewId,
    identityPublicKey: input.identityPublicKey,
    displayName: input.displayName,
    avatarBase64: input.avatarBase64,
    allTimeFocusMinutes,
    publishedAtEpochSeconds: input.now,
    localDate: todayKey,
    utcOffsetMinutes: input.offsetMinutes,
    dailyAggregates,
    currentStreak: currentStreak(activeDates, todayKey, input.offsetMinutes),
    lastFocusedAtEpochSeconds: lastFocusedAt,
    version: SNAPSHOT_VERSION,
    stats: buildStatsExtras({ entries, workSessions, todayKey, offsetMinutes: input.offsetMinutes }),
  };
}

function buildStatsExtras(opts: {
  entries: DayEntry[];
  workSessions: SessionRow[];
  todayKey: string;
  offsetMinutes: number;
}) {
  const { entries, workSessions, todayKey, offsetMinutes } = opts;
  const activeDates = new Set(entries.filter((entry) => entry.completed > 0).map((entry) => entry.date));
  const focusDates = entries.filter((entry) => entry.workMinutes > 0);
  const firstFocusLocalDate = focusDates.map((entry) => entry.date).sort()[0] ?? null;

  const windowFloor = (() => {
    let cursor = todayKey;
    for (let k = 1; k < MAX_HISTORY_DAYS; k++) {
      cursor = prevDate(cursor, offsetMinutes);
    }
    return cursor;
  })();
  const historyStart = firstFocusLocalDate !== null && firstFocusLocalDate > windowFloor ? firstFocusLocalDate : windowFloor;

  const historyKeys: string[] = [];
  let cursor = todayKey;
  while (cursor >= historyStart) {
    historyKeys.push(cursor);
    cursor = prevDate(cursor, offsetMinutes);
  }
  historyKeys.reverse();

  const byDate = new Map(entries.map((entry) => [entry.date, entry]));
  const bestDay = bestDayOf(entries.map(toDayStat));
  const bestWeek = bestWeekOf(entries.map(toDayStat));

  return {
    hourBuckets: rhythmBuckets(workSessions, offsetMinutes),
    weekdayBuckets: weekdayBuckets(workSessions, offsetMinutes),
    allTimeWorkBlocks: entries.reduce((sum, entry) => sum + entry.completed, 0),
    allTimeActiveDays: activeDates.size,
    bestStreak: bestStreak(activeDates),
    firstFocusLocalDate,
    historyStartDate: historyStart,
    historyFocusMinutes: historyKeys.map((date) => byDate.get(date)?.workMinutes ?? 0),
    historyWorkBlocks: historyKeys.map((date) => byDate.get(date)?.completed ?? 0),
    bestDayLocalDate: bestDay?.date ?? null,
    bestDayFocusMinutes: bestDay?.minutes ?? 0,
    bestDayWorkBlocks: bestDay?.completed ?? 0,
    bestWeekStartDate: bestWeek?.weekStart ?? null,
    bestWeekFocusMinutes: bestWeek?.minutes ?? 0,
    bestWeekWorkBlocks: bestWeek?.sessions ?? 0,
  };
}

function toDayStat(entry: DayEntry): { date: string; earnedBlocks: number; focusMinutes: number; breakMinutes: number } {
  return {
    date: entry.date,
    earnedBlocks: entry.completed,
    focusMinutes: entry.workMinutes,
    breakMinutes: entry.breakMinutes,
  };
}
