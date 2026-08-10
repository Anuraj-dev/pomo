import { dateStringOf, nextLocalMidnight, nextLocalMidnightAtOffset, type OffsetMinutes } from "./dateLogic";
import type { DayStat } from "./stats";
import type { CompletedBlock, Phase } from "./timer";

function dateAt(epochSeconds: number, offsetMinutes: OffsetMinutes): string {
  return typeof offsetMinutes === "function"
    ? dateStringOf(epochSeconds, offsetMinutes(epochSeconds))
    : dateStringOf(epochSeconds, offsetMinutes);
}

function nextMidnightAt(epochSeconds: number, offsetMinutes: OffsetMinutes): number {
  return typeof offsetMinutes === "function"
    ? nextLocalMidnightAtOffset(epochSeconds, offsetMinutes)
    : nextLocalMidnight(epochSeconds, offsetMinutes);
}

export interface BlockSegment {
  date: string;
  start: number;
  duration: number;
  type: Phase;
  completed: boolean;
  tag: string | null;
}

/**
 * Splits a session across local calendar days.
 *
 * Attribution policy: rounding happens once for the whole block (to whole
 * minutes); the earned block and tag are attributed to the session's start
 * date (first segment), regardless of how minutes are distributed. A
 * zero-length first segment is retained when it carries that metadata so the
 * start-day earned block/tag survives rounding.
 */
export function splitBlockByCalendarDay(opts: {
  start: number;
  duration: number;
  completed: boolean;
  type: Phase;
  tag: string | null;
  offsetMinutes: OffsetMinutes;
}): BlockSegment[] {
  const { start, duration, completed, type, tag, offsetMinutes } = opts;
  if (!Number.isFinite(start) || !Number.isFinite(duration) || duration <= 0) return [];
  const endExclusive = start + duration;
  const rawSegments: Array<{ date: string; start: number; exactSeconds: number }> = [];
  let segmentStart = start;
  while (segmentStart < endExclusive) {
    const nextMidnight = nextMidnightAt(segmentStart, offsetMinutes);
    const segmentEnd = Math.min(endExclusive, nextMidnight);
    rawSegments.push({
      date: dateAt(segmentStart, offsetMinutes),
      start: segmentStart,
      exactSeconds: segmentEnd - segmentStart,
    });
    segmentStart = segmentEnd;
  }
  const totalMinutes = Math.round(duration / 60);
  const shares = rawSegments.map((segment) => (segment.exactSeconds * totalMinutes) / duration);
  const minutes = shares.map(Math.floor);
  let leftover = totalMinutes - minutes.reduce((sum, value) => sum + value, 0);
  const byRemainder = shares
    .map((share, index) => [index, share - minutes[index]!] as const)
    .sort((a, b) => b[1] - a[1]);
  for (const [index] of byRemainder) {
    if (leftover === 0) break;
    minutes[index]! += 1;
    leftover -= 1;
  }
  return rawSegments
    .map((segment, index) => ({
      date: segment.date,
      start: segment.start,
      duration: minutes[index]! * 60,
      type,
      completed: completed && index === 0,
      tag: index === 0 ? tag : null,
    }))
    .filter((segment, index) => {
      if (segment.duration > 0) return true;
      // Keep the metadata-carrying first segment even at zero duration so a
      // start-day earned block/tag is not lost to rounding.
      return index === 0 && (segment.completed || segment.tag !== null);
    });
}

export interface BlockDelta {
  earnedBlocks: number;
  focusMinutes: number;
  breakMinutes: number;
}

/** Delta contributed by one calendar-day segment of a session. Work earns a
 * block only when the segment is completed; break minutes count only when the
 * whole session completed. */
export function deltaForSegment(segment: BlockSegment, blockCompleted: boolean): BlockDelta {
  return segment.type === "work"
    ? { earnedBlocks: segment.completed ? 1 : 0, focusMinutes: segment.duration / 60, breakMinutes: 0 }
    : { earnedBlocks: 0, focusMinutes: 0, breakMinutes: blockCompleted ? segment.duration / 60 : 0 };
}

export function deltasForBlock(block: CompletedBlock, offsetMinutes: OffsetMinutes): DayStat[] {
  const segments = splitBlockByCalendarDay({
    start: block.start,
    duration: block.duration,
    completed: block.completed,
    type: block.type,
    tag: block.tag,
    offsetMinutes,
  });
  const byDate = new Map<string, DayStat>();
  for (const segment of segments) {
    const delta = deltaForSegment(segment, block.completed);
    const dayStat = byDate.get(segment.date) ?? {
      date: segment.date,
      earnedBlocks: 0,
      focusMinutes: 0,
      breakMinutes: 0,
    };
    dayStat.earnedBlocks += delta.earnedBlocks;
    dayStat.focusMinutes += delta.focusMinutes;
    dayStat.breakMinutes += delta.breakMinutes;
    byDate.set(segment.date, dayStat);
  }
  return [...byDate.values()];
}
