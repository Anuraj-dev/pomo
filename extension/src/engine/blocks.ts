import { dateStringOf, nextLocalMidnight } from "./dateLogic";
import type { DayStat } from "./stats";
import type { CompletedBlock, Phase } from "./timer";

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
  offsetMinutes: number;
}): BlockSegment[] {
  const { start, duration, completed, type, tag, offsetMinutes } = opts;
  const endExclusive = start + duration;
  const segments: BlockSegment[] = [];
  let segmentStart = start;
  let index = 0;
  while (segmentStart < endExclusive) {
    const nextMidnight = nextLocalMidnight(segmentStart, offsetMinutes);
    const segmentEnd = Math.min(endExclusive, nextMidnight);
    const segmentDuration = Math.ceil((segmentEnd - segmentStart) / 60) * 60;
    segments.push({
      date: dateStringOf(segmentStart, offsetMinutes),
      start: segmentStart,
      duration: segmentDuration,
      type,
      completed: completed && index === 0,
      tag: index === 0 ? tag : null,
    });
    segmentStart = segmentEnd;
    index++;
  }
  return segments;
}

export function deltasForBlock(block: CompletedBlock, offsetMinutes: number): DayStat[] {
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
    } else if (segment.completed) {
      delta.breakMinutes += segment.duration / 60;
    }
    byDate.set(segment.date, delta);
  }
  return [...byDate.values()];
}
