import { describe, expect, test } from "bun:test";
import { normalizeCrewName, normalizeDisplayName } from "../src/crew/validation";

describe("Crew name validation", () => {
  test("normalizes Unicode whitespace and NFC while preserving ordinary emoji", () => {
    expect(normalizeDisplayName("  Snehit\u00a0  Pomo  ")).toBe("Snehit Pomo");
    expect(normalizeDisplayName("Cafe\u0301")).toBe("Café");
  });

  test("rejects blank, control, bidi, and overlong names", () => {
    expect(normalizeDisplayName(" \n ")).toBeNull();
    expect(normalizeDisplayName("safe\u202e-name")).toBeNull();
    expect(normalizeDisplayName("x".repeat(25))).toBeNull();
    expect(normalizeCrewName("x".repeat(41))).toBeNull();
  });
});
