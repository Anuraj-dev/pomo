import { describe, expect, test } from "bun:test";
import { DEFAULT_SETTINGS, sanitizeSettings } from "../src/engine/settings";

describe("Settings — defaults", () => {
  test("defaults match the phone", () => {
    expect(DEFAULT_SETTINGS).toEqual({
      workMinutes: 25,
      shortMinutes: 5,
      longMinutes: 15,
      longBreakAfter: 4,
      dailyGoal: 8,
      theme: "system",
      newtabInstrument: true,
    });
  });
});

describe("Settings — sanitization", () => {
  test("null input yields defaults", () => {
    expect(sanitizeSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
  });

  test("zero, negative, and NaN values fall back to defaults", () => {
    const s = sanitizeSettings({
      workMinutes: 0,
      shortMinutes: -3,
      longMinutes: Number.NaN,
      longBreakAfter: 0,
      dailyGoal: -1,
    });
    expect(s.workMinutes).toBe(25);
    expect(s.shortMinutes).toBe(5);
    expect(s.longMinutes).toBe(15);
    expect(s.longBreakAfter).toBe(4);
    expect(s.dailyGoal).toBe(8);
  });

  test("valid values pass through", () => {
    const s = sanitizeSettings({ workMinutes: 50, dailyGoal: 12, longBreakAfter: 3, theme: "dark" });
    expect(s.workMinutes).toBe(50);
    expect(s.dailyGoal).toBe(12);
    expect(s.longBreakAfter).toBe(3);
    expect(s.theme).toBe("dark");
  });

  test("unknown theme falls back to system", () => {
    expect(sanitizeSettings({ theme: "neon" as never }).theme).toBe("system");
  });

  test("partial input keeps other defaults", () => {
    const s = sanitizeSettings({ workMinutes: 1 });
    expect(s.workMinutes).toBe(1);
    expect(s.shortMinutes).toBe(5);
    expect(s.theme).toBe("system");
    expect(s.newtabInstrument).toBe(true);
  });

  test("fractional minutes are floored", () => {
    expect(sanitizeSettings({ workMinutes: 24.7 }).workMinutes).toBe(24);
  });
});
