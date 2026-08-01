export interface PomoSettings {
  workMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longBreakAfter: number;
  dailyGoal: number;
  theme: "system" | "light" | "dark";
  newtabInstrument: boolean;
}

export const DEFAULT_SETTINGS: PomoSettings = {
  workMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longBreakAfter: 4,
  dailyGoal: 8,
  theme: "system",
  newtabInstrument: true,
};

const THEMES: readonly PomoSettings["theme"][] = ["system", "light", "dark"];

function positiveMinutes(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function nonNegativeCount(value: number | undefined, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function validTheme(value: unknown): PomoSettings["theme"] {
  return THEMES.includes(value as PomoSettings["theme"]) ? (value as PomoSettings["theme"]) : "system";
}

function validBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeSettings(input: unknown): PomoSettings {
  if (input == null || typeof input !== "object") return { ...DEFAULT_SETTINGS };
  const source = input as Record<string, unknown>;
  return {
    workMinutes: positiveMinutes(source.workMinutes as number | undefined, DEFAULT_SETTINGS.workMinutes),
    shortMinutes: positiveMinutes(source.shortMinutes as number | undefined, DEFAULT_SETTINGS.shortMinutes),
    longMinutes: positiveMinutes(source.longMinutes as number | undefined, DEFAULT_SETTINGS.longMinutes),
    longBreakAfter: positiveMinutes(source.longBreakAfter as number | undefined, DEFAULT_SETTINGS.longBreakAfter),
    dailyGoal: nonNegativeCount(source.dailyGoal as number | undefined, DEFAULT_SETTINGS.dailyGoal),
    theme: validTheme(source.theme),
    newtabInstrument: validBoolean(source.newtabInstrument, DEFAULT_SETTINGS.newtabInstrument),
  };
}
