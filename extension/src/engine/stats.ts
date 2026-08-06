import { isValidDateString, prevDate } from "./dateLogic";
import type { Phase } from "./timer";

export function currentStreak(dates: Iterable<string>, todayKey: string, offsetMinutes: number): number {
  const set = new Set(dates);
  if (set.size === 0) return 0;
  let cursor = set.has(todayKey) ? todayKey : prevDate(todayKey, offsetMinutes);
  let streak = 0;
  while (set.has(cursor)) {
    streak++;
    cursor = prevDate(cursor, offsetMinutes);
  }
  return streak;
}

export function bestStreak(dates: Iterable<string>): number {
  const sorted = [...new Set(dates)]
    .filter(isValidDateString)
    .map((d) => {
      const [y, m, day] = d.split("-").map(Number);
      return Date.UTC(y!, m! - 1, day!);
    })
    .sort((a, b) => b - a);
  let best = 0;
  let run = 0;
  let prev = Number.NaN;
  for (const t of sorted) {
    run = prev - t === 86400000 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = t;
  }
  return best;
}

export interface DayStat {
  date: string;
  earnedBlocks: number;
  focusMinutes: number;
  breakMinutes: number;
}

export function totals(days: DayStat[]): { earnedBlocks: number; focusMinutes: number; breakMinutes: number } {
  let focusMinutes = 0;
  let breakMinutes = 0;
  let earnedBlocks = 0;
  for (const day of days) {
    focusMinutes += day.focusMinutes;
    breakMinutes += day.breakMinutes;
    earnedBlocks += day.earnedBlocks;
  }
  return { earnedBlocks, focusMinutes, breakMinutes };
}

export interface BestDay {
  date: string;
  completed: number;
  minutes: number;
}

export interface BestWeek {
  weekStart: string;
  sessions: number;
  minutes: number;
}

/**
 * Rank by focus minutes, filtering on work minutes (not completed blocks) so the
 * pre-midnight segment of a split block can still win as the best focus day.
 * Ties resolve to the later date.
 */
export function bestDayOf(days: DayStat[]): BestDay | null {
  const candidates = days.filter((day) => day.focusMinutes > 0);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) =>
    b.focusMinutes > a.focusMinutes || (b.focusMinutes === a.focusMinutes && b.date > a.date) ? b : a
  );
  return { date: best.date, completed: best.earnedBlocks, minutes: best.focusMinutes };
}

/** Best week over the whole of `days`, grouped into Sunday-anchored weeks. */
export function bestWeekOf(days: DayStat[]): BestWeek | null {
  if (days.length === 0) return null;
  const minutesByWeek = new Map<string, number>();
  const blocksByWeek = new Map<string, number>();
  for (const day of days) {
    const weekStart = sundayWeekStart(day.date);
    minutesByWeek.set(weekStart, (minutesByWeek.get(weekStart) ?? 0) + day.focusMinutes);
    blocksByWeek.set(weekStart, (blocksByWeek.get(weekStart) ?? 0) + day.earnedBlocks);
  }
  let bestKey: string | null = null;
  let bestMinutes = 0;
  for (const [key, minutes] of minutesByWeek) {
    if (bestKey === null || minutes > bestMinutes || (minutes === bestMinutes && key > bestKey)) {
      bestMinutes = minutes;
      bestKey = key;
    }
  }
  if (bestKey === null || bestMinutes === 0) return null;
  return { weekStart: bestKey, sessions: blocksByWeek.get(bestKey) ?? 0, minutes: bestMinutes };
}

function sundayWeekStart(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dayOfWeek = new Date(Date.UTC(y!, m! - 1, d!)).getUTCDay();
  return new Date(Date.UTC(y!, m! - 1, d! - dayOfWeek)).toISOString().slice(0, 10);
}

export type OffsetMinutes = number | ((epochSeconds: number) => number);

function resolveOffset(offsetMinutes: OffsetMinutes, epochSeconds: number): number {
  return typeof offsetMinutes === "function" ? offsetMinutes(epochSeconds) : offsetMinutes;
}

export interface RhythmBucketsOptions {
  count?: number;
}

export function rhythmBuckets(
  sessions: Array<{ start: number; type: Phase; duration: number }>,
  offsetMinutes: OffsetMinutes,
  options: RhythmBucketsOptions = {},
): number[] {
  const count = Number.isInteger(options.count) && options.count! >= 1 && options.count! <= 24 ? options.count! : 24;
  const buckets = new Array<number>(count).fill(0);
  for (const session of sessions) {
    if (session.type !== "work") continue;
    const local = new Date(session.start * 1000 + resolveOffset(offsetMinutes, session.start) * 60000);
    buckets[local.getUTCHours() % count]! += session.duration;
  }
  return buckets.map((seconds) => Math.ceil(seconds / 60));
}

export interface WeekdayBucketsOptions {
  startDay?: number;
}

export function weekdayBuckets(
  sessions: Array<{ start: number; type: Phase; duration: number }>,
  offsetMinutes: OffsetMinutes,
  options: WeekdayBucketsOptions = {},
): number[] {
  const startDay = Number.isInteger(options.startDay) && options.startDay! >= 0 && options.startDay! <= 6 ? options.startDay! : 1;
  const buckets = new Array<number>(7).fill(0);
  for (const session of sessions) {
    if (session.type !== "work") continue;
    const local = new Date(session.start * 1000 + resolveOffset(offsetMinutes, session.start) * 60000);
    buckets[(local.getUTCDay() + 7 - startDay) % 7]! += session.duration;
  }
  return buckets.map((seconds) => Math.ceil(seconds / 60));
}

export function lastNDays(days: DayStat[], todayKey: string, n: number, offsetMinutes: number): DayStat[] {
  const count = Number.isFinite(n) ? Math.min(3660, Math.max(0, Math.floor(n))) : 0;
  const byDate = new Map(days.map((day) => [day.date, day]));
  const keys: string[] = [];
  let cursor = todayKey;
  for (let i = 0; i < count; i++) {
    keys.push(cursor);
    cursor = prevDate(cursor, offsetMinutes);
  }
  keys.reverse();
  return keys.map((date) => byDate.get(date) ?? { date, earnedBlocks: 0, focusMinutes: 0, breakMinutes: 0 });
}
