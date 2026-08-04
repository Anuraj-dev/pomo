import { describe, expect, test } from "bun:test";
import { FOCUS_BADGE_COLOR, MUTED_BADGE_COLOR, badgeColorOf, badgeTextOf } from "../src/shared/badge";

const MINUTE = 60_000;

describe("badgeTextOf", () => {
  test("uses whole minutes when 10 minutes or more remain", () => {
    expect(badgeTextOf(25 * MINUTE)).toBe("25m");
    expect(badgeTextOf(10 * MINUTE)).toBe("10m");
    expect(badgeTextOf(10 * MINUTE + 59_999)).toBe("10m");
  });

  test("uses M:SS when less than 10 minutes remain", () => {
    expect(badgeTextOf(9 * MINUTE + 59_000)).toBe("9:59");
    expect(badgeTextOf(10 * MINUTE - 1)).toBe("9:59");
    expect(badgeTextOf(5 * MINUTE)).toBe("5:00");
    expect(badgeTextOf(5_000)).toBe("0:05");
  });

  test("never shows more time than remains", () => {
    expect(badgeTextOf(14 * MINUTE + 59_000)).toBe("14m");
    expect(badgeTextOf(3 * MINUTE + 40_999)).toBe("3:40");
  });

  test("clamps to 0:00 at or below zero", () => {
    expect(badgeTextOf(0)).toBe("0:00");
    expect(badgeTextOf(-1)).toBe("0:00");
    expect(badgeTextOf(-5 * MINUTE)).toBe("0:00");
  });

  test("never exceeds the four-character badge limit", () => {
    for (const remainingMs of [0, 999, 5_000, 59_999, MINUTE, 9 * MINUTE + 59_000, 10 * MINUTE, 25 * MINUTE, 10_000 * MINUTE]) {
      expect(badgeTextOf(remainingMs).length).toBeLessThanOrEqual(4);
    }
  });
});

describe("badgeColorOf", () => {
  test("uses the signal red during focus", () => {
    expect(badgeColorOf("work")).toBe(FOCUS_BADGE_COLOR);
  });

  test("is muted during breaks", () => {
    expect(badgeColorOf("short")).toBe(MUTED_BADGE_COLOR);
    expect(badgeColorOf("long")).toBe(MUTED_BADGE_COLOR);
  });
});
