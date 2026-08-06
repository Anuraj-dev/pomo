import type { DayStatRow, SessionRow } from "../db/types";
import { dateStringOf } from "../engine/dateLogic";
import { currentStreak } from "../engine/stats";
import type { SnapshotPlain } from "./types";
import { MAX_DAILY_AGGREGATES } from "./snapshot";

export const SNAPSHOT_VERSION = 2;

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
    .sort((a, b) => b.date.localeCompare(a.date))
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
    stats: null,
  };
}
