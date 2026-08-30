import { describe, expect, test } from "bun:test";
import { historyDelta, parsePhoneHistory } from "../src/link/phoneState";

describe("parsePhoneHistory", () => {
  test("reads date-keyed sessions and keeps phone dates", () => {
    const sessions = parsePhoneHistory({
      "2026-05-07": {
        completed: 1,
        work_minutes: 25,
        break_minutes: 5,
        sessions: [
          { type: "work", start: 1_710_000_000, duration: 1500, completed: true },
          { type: "short", start: 1_710_001_500, duration: 300, completed: true },
        ],
      },
    });
    expect(sessions).toEqual([
      {
        date: "2026-05-07",
        type: "work",
        start: 1_710_000_000,
        duration: 1500,
        completed: true,
        tag: null,
      },
      {
        date: "2026-05-07",
        type: "short",
        start: 1_710_001_500,
        duration: 300,
        completed: true,
        tag: null,
      },
    ]);
  });

  test("empty object is valid empty history", () => {
    expect(parsePhoneHistory({})).toEqual([]);
  });

  test("rejects a non-object payload", () => {
    expect(parsePhoneHistory([])).toBeNull();
    expect(parsePhoneHistory("nope")).toBeNull();
  });

  test("skips invalid session rows and bad dates", () => {
    const sessions = parsePhoneHistory({
      "not-a-date": { sessions: [{ type: "work", start: 1, duration: 60, completed: true }] },
      "2026-05-07": {
        sessions: [
          { type: "work", start: 0, duration: 1500, completed: true },
          { type: "nap", start: 10, duration: 1500, completed: true },
          { type: "work", start: 20, duration: 1500, completed: true, tag: "Study" },
        ],
      },
    });
    expect(sessions).toEqual([
      {
        date: "2026-05-07",
        type: "work",
        start: 20,
        duration: 1500,
        completed: true,
        tag: "Study",
      },
    ]);
  });
});

describe("historyDelta", () => {
  test("completed work earns a block and focus minutes", () => {
    expect(
      historyDelta({
        date: "2026-05-07",
        type: "work",
        start: 1,
        duration: 1500,
        completed: true,
        tag: null,
      }),
    ).toEqual({ earnedBlocks: 1, focusMinutes: 25, breakMinutes: 0 });
  });

  test("partial work never earns a block", () => {
    expect(
      historyDelta({
        date: "2026-05-07",
        type: "work",
        start: 1,
        duration: 600,
        completed: false,
        tag: null,
      }),
    ).toEqual({ earnedBlocks: 0, focusMinutes: 10, breakMinutes: 0 });
  });

  test("break minutes come from break rows", () => {
    expect(
      historyDelta({
        date: "2026-05-07",
        type: "short",
        start: 1,
        duration: 300,
        completed: true,
        tag: null,
      }),
    ).toEqual({ earnedBlocks: 0, focusMinutes: 0, breakMinutes: 5 });
  });
});
