import { describe, expect, test } from "bun:test";
import { deltasForBlock, splitBlockByCalendarDay } from "../src/engine/blocks";
import { dateStringOf, epochOfDate } from "../src/engine/dateLogic";

const OFFSET = 330;
const DAY = 86400;
const MIDNIGHT = epochOfDate("2026-08-01", OFFSET);

describe("splitBlockByCalendarDay", () => {
  test("single-day block yields one segment with full duration", () => {
    const start = 1_800_000_000;
    const segs = splitBlockByCalendarDay({ start, duration: 1500, completed: true, type: "work", tag: "Work", offsetMinutes: OFFSET });
    expect(segs).toHaveLength(1);
    expect(segs[0]).toEqual({
      date: dateStringOf(start, OFFSET),
      start,
      duration: 1500,
      type: "work",
      completed: true,
      tag: "Work",
    });
  });

  test("block crossing one midnight splits into two, only first segment completed", () => {
    const start = MIDNIGHT - 600; // 10 minutes before local midnight
    const segs = splitBlockByCalendarDay({ start, duration: 1200, completed: true, type: "work", tag: "Work", offsetMinutes: OFFSET });
    expect(segs).toHaveLength(2);
    expect(segs[0]!.completed).toBe(true);
    expect(segs[0]!.duration).toBe(600);
    expect(segs[0]!.date).toBe(dateStringOf(start, OFFSET));
    expect(segs[1]!.completed).toBe(false);
    expect(segs[1]!.duration).toBe(600);
    expect(segs[1]!.date).toBe(dateStringOf(start + 600, OFFSET));
    expect(segs[1]!.tag).toBeNull();
  });

  test("block spanning two midnights yields three segments", () => {
    const start = MIDNIGHT - 600;
    const segs = splitBlockByCalendarDay({ start, duration: DAY + 1200, completed: true, type: "work", tag: "Work", offsetMinutes: OFFSET });
    expect(segs).toHaveLength(3);
    expect(segs[0]!.completed).toBe(true);
    expect(segs[1]!.completed).toBe(false);
    expect(segs[2]!.completed).toBe(false);
  });

  test("durations round up to whole minutes", () => {
    const segs = splitBlockByCalendarDay({ start: 1_800_000_000, duration: 61, completed: true, type: "work", tag: null, offsetMinutes: OFFSET });
    expect(segs[0]!.duration).toBe(120);
  });

  test("zero or negative duration yields nothing", () => {
    expect(splitBlockByCalendarDay({ start: 1_800_000_000, duration: 0, completed: true, type: "work", tag: null, offsetMinutes: OFFSET })).toEqual([]);
  });

  test("partial block (skipped) carries completed=false on its first segment", () => {
    const start = MIDNIGHT - 600;
    const segs = splitBlockByCalendarDay({ start, duration: 1200, completed: false, type: "work", tag: "Deep", offsetMinutes: OFFSET });
    expect(segs[0]!.completed).toBe(false);
  });
});

describe("deltasForBlock", () => {
  test("completed work block counts an earned block and focus minutes", () => {
    const deltas = deltasForBlock({ start: 1_800_000_000, duration: 1500, type: "work", completed: true, tag: "Work" }, OFFSET);
    expect(deltas).toEqual([{ date: dateStringOf(1_800_000_000, OFFSET), earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 }]);
  });

  test("partial work block contributes minutes but never an earned block", () => {
    const deltas = deltasForBlock({ start: 1_800_000_000, duration: 240, type: "work", completed: false, tag: "Work" }, OFFSET);
    expect(deltas).toEqual([{ date: dateStringOf(1_800_000_000, OFFSET), earnedBlocks: 0, focusMinutes: 4, breakMinutes: 0 }]);
  });

  test("completed break contributes break minutes only", () => {
    const deltas = deltasForBlock({ start: 1_800_000_000, duration: 300, type: "short", completed: true, tag: "Work" }, OFFSET);
    expect(deltas).toEqual([{ date: dateStringOf(1_800_000_000, OFFSET), earnedBlocks: 0, focusMinutes: 0, breakMinutes: 5 }]);
  });

  test("midnight-crossing completed work block splits the earned block to the start day", () => {
    const start = MIDNIGHT - 600;
    const deltas = deltasForBlock({ start, duration: 1200, type: "work", completed: true, tag: "Work" }, OFFSET);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ earnedBlocks: 1, focusMinutes: 10 });
    expect(deltas[1]).toMatchObject({ earnedBlocks: 0, focusMinutes: 10 });
  });

  test("skipped work block crossing midnight contributes minutes to both days, earned block to none", () => {
    const start = MIDNIGHT - 600;
    const deltas = deltasForBlock({ start, duration: 1200, type: "work", completed: false, tag: "Work" }, OFFSET);
    expect(deltas).toHaveLength(2);
    expect(deltas[0]).toMatchObject({ earnedBlocks: 0, focusMinutes: 10 });
    expect(deltas[1]).toMatchObject({ earnedBlocks: 0, focusMinutes: 10 });
  });
});
