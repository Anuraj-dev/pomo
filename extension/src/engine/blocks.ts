import { dateStringOf, localDateStringOf, nextLocalMidnight, nextLocalMidnightAt } from "./dateLogic";
import type { DayStat } from "./stats";
import type { CompletedBlock, Phase } from "./timer";

export type OffsetMinutes = number | ((epochSeconds: number) => number);

function dateAt(epochSeconds: number, offsetMinutes: OffsetMinutes): string {
  return typeof offsetMinutes === "function" ? localDateStringOf(epochSeconds) : dateStringOf(epochSeconds, offsetMinutes);
}

function nextMidnightAt(epochSeconds: number, offsetMinutes: OffsetMinutes): number {
  return typeof offsetMinutes === "function" ? nextLocalMidnightAt(epochSeconds) : nextLocalMidnight(epochSeconds, offsetMinutes);
}

export interface BlockSegment {
  date: string;
  start: number;
  duration: number;
  type: Phase;
  completed: boolean;
  tag: string | null;
}

export function splitBlockByCalendarDay(opts: {
  start: number;
  duration: number;
  completed: boolean;
  type: Phase;
  tag: string | null;
  offsetMinutes: OffsetMinutes;
}): BlockSegment[] {
  const { start, duration, completed, type, tag, offsetMinutes } = opts;
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
  return rawSegments.map((segment, index) => ({
    date: segment.date,
    start: segment.start,
    duration: minutes[index]! * 60,
    type,
    completed: completed && index === 0,
    tag: index === 0 ? tag : null,
  }));
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
    const delta = byDate.get(segment.date) ?? {
      date: segment.date,
      earnedBlocks: 0,
      focusMinutes: 0,
      breakMinutes: 0,
    };
    if (segment.type === "work") {
      if (segment.completed) delta.earnedBlocks += 1;
      delta.focusMinutes += segment.duration / 60;
    } else if (block.completed) {
      delta.breakMinutes += segment.duration / 60;
    }
    byDate.set(segment.date, delta);
  }
  return [...byDate.values()];
}
