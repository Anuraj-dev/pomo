import type { DayStatRow, SessionRow } from "../db/types";
import type { PomoSettings } from "../engine/settings";
import type { TimerSnapshot } from "../engine/timer";
import type { SurfaceStats } from "./statsReader";

export const STATE_KEY = "pomo:state";
export const ENGINE_KEY = "pomo:engine";
export const SETTINGS_KEY = "pomo:settings";

export type PomoCommand = "toggle" | "skip" | "reset" | "extend";

export interface PomoCommandMessage {
  type: "pomo:command";
  command: PomoCommand;
  seconds?: number;
}

export interface PomoQueryMessage {
  type: "pomo:query";
}

export interface PomoStatsMessage {
  type: "pomo:stats";
}

export interface PomoHistoryMessage {
  type: "pomo:history";
}

export interface HistoryPayload {
  sessions: SessionRow[];
  dayStats: DayStatRow[];
}

export interface PomoSettingsGetMessage {
  type: "pomo:settings:get";
}

export interface PomoSettingsSetMessage {
  type: "pomo:settings:set";
  settings: Partial<PomoSettings>;
}

export interface PomoBackupExportMessage {
  type: "pomo:backup:export";
}

export interface PomoBackupImportMessage {
  type: "pomo:backup:import";
  payload: string;
}

export type PomoRequest =
  | PomoCommandMessage
  | PomoQueryMessage
  | PomoStatsMessage
  | PomoHistoryMessage
  | PomoSettingsGetMessage
  | PomoSettingsSetMessage
  | PomoBackupExportMessage
  | PomoBackupImportMessage;

export interface PomoResponse {
  ok: boolean;
  error?: string;
  state?: TimerSnapshot;
  settings?: PomoSettings;
  backup?: string;
  backupImport?: { sessionsAdded: number; daysAffected: number; conflicts: number };
  stats?: SurfaceStats;
  history?: HistoryPayload;
}

const REQUEST_TYPE_REGISTRY = {
  "pomo:command": 0,
  "pomo:query": 0,
  "pomo:stats": 0,
  "pomo:history": 0,
  "pomo:settings:get": 0,
  "pomo:settings:set": 0,
  "pomo:backup:export": 0,
  "pomo:backup:import": 0,
} satisfies { [K in PomoRequest["type"]]: 0 };

const POMO_REQUEST_TYPES = new Set<string>(Object.keys(REQUEST_TYPE_REGISTRY));

export function isPomoRequest(value: unknown): value is PomoRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !POMO_REQUEST_TYPES.has(type)) return false;
  const nonEmptyStringField = (name: string): boolean => typeof record[name] === "string" && record[name].trim().length > 0;
  switch (type) {
    case "pomo:command":
      if (record.command === "extend") {
        return typeof record.seconds === "number" && Number.isInteger(record.seconds) && record.seconds > 0;
      }
      return (
        (record.command === "toggle" || record.command === "skip" || record.command === "reset") &&
        record.seconds === undefined
      );
    case "pomo:settings:set": {
      if (typeof record.settings !== "object" || record.settings === null || Array.isArray(record.settings)) return false;
      const settingsRecord = record.settings as Record<string, unknown>;
      for (const [name, rule] of Object.entries({
        workMinutes: (v: unknown) => typeof v === "number" && Number.isFinite(v),
        shortMinutes: (v: unknown) => typeof v === "number" && Number.isFinite(v),
        longMinutes: (v: unknown) => typeof v === "number" && Number.isFinite(v),
        longBreakAfter: (v: unknown) => typeof v === "number" && Number.isFinite(v),
        dailyGoal: (v: unknown) => typeof v === "number" && Number.isFinite(v),
        theme: (v: unknown) => v === "system" || v === "light" || v === "dark",
        newtabInstrument: (v: unknown) => typeof v === "boolean",
        soundEnabled: (v: unknown) => typeof v === "boolean",
        tag: (v: unknown) => typeof v === "string",
      })) {
        if (settingsRecord[name] !== undefined && !rule(settingsRecord[name])) return false;
      }
      return true;
    }
    case "pomo:backup:import":
      return nonEmptyStringField("payload");
    default:
      return true;
  }
}
