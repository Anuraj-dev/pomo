export interface PomoSettings {
  workMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longBreakAfter: number;
  dailyGoal: number;
  theme: "system" | "light" | "dark";
  newtabInstrument: boolean;
  soundEnabled: boolean;
  tag: string;
}

export const DEFAULT_SETTINGS: PomoSettings = {
  workMinutes: 25,
  shortMinutes: 5,
  longMinutes: 15,
  longBreakAfter: 4,
  dailyGoal: 8,
  theme: "system",
  newtabInstrument: true,
  soundEnabled: true,
  tag: "Work",
};

const THEMES: readonly PomoSettings["theme"][] = ["system", "light", "dark"];

const MAX_WORK_MINUTES = 360;
const MAX_SHORT_MINUTES = 120;
const MAX_LONG_MINUTES = 240;
const MAX_LONG_BREAK_AFTER = 12;
const MAX_DAILY_GOAL = 100;
const MAX_TAG_LENGTH = 40;

/** Floor a number and clamp into [min, max]; fall back when not finite or <= 0. */
function clampPositive(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.min(max, Math.max(min, Math.floor(value)));
}

/** Floor a count into [0, max]; fall back when not finite or negative. */
function clampCount(value: unknown, max: number, fallback: number): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return fallback;
  return Math.min(max, Math.max(0, Math.floor(value)));
}

export function isValidTheme(value: unknown): value is PomoSettings["theme"] {
  return THEMES.includes(value as PomoSettings["theme"]);
}

function validTheme(value: unknown): PomoSettings["theme"] {
  return isValidTheme(value) ? value : "system";
}

function validBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function validTag(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SETTINGS.tag;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const trimmed = cleaned.slice(0, MAX_TAG_LENGTH);
  return trimmed.length > 0 ? trimmed : DEFAULT_SETTINGS.tag;
}

export function sanitizeSettings(input: unknown): PomoSettings {
  if (input == null || typeof input !== "object") return { ...DEFAULT_SETTINGS };
  const source = input as Record<string, unknown>;
  return {
    workMinutes: clampPositive(source.workMinutes, 1, MAX_WORK_MINUTES, DEFAULT_SETTINGS.workMinutes),
    shortMinutes: clampPositive(source.shortMinutes, 1, MAX_SHORT_MINUTES, DEFAULT_SETTINGS.shortMinutes),
    longMinutes: clampPositive(source.longMinutes, 1, MAX_LONG_MINUTES, DEFAULT_SETTINGS.longMinutes),
    longBreakAfter: clampPositive(source.longBreakAfter, 1, MAX_LONG_BREAK_AFTER, DEFAULT_SETTINGS.longBreakAfter),
    dailyGoal: clampCount(source.dailyGoal, MAX_DAILY_GOAL, DEFAULT_SETTINGS.dailyGoal),
    theme: validTheme(source.theme),
    newtabInstrument: validBoolean(source.newtabInstrument, DEFAULT_SETTINGS.newtabInstrument),
    soundEnabled: validBoolean(source.soundEnabled, DEFAULT_SETTINGS.soundEnabled),
    tag: validTag(source.tag),
  };
}
