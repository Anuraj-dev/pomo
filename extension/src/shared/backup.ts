import type { DayStatRow, SessionRow } from "../db/types";

export const BACKUP_FORMAT = "pomo-backup" as const;
export const BACKUP_VERSION = 1;
export const BACKUP_MAX_BYTES = 64 * 1024 * 1024;

export interface PortableBackup {
  format: typeof BACKUP_FORMAT;
  version: number;
  exportedAtEpochSeconds: number;
  appVersionName: string;
  history: {
    dayStats: Array<{ date: string; completed: number; workMinutes: number; breakMinutes: number }>;
    sessions: Array<{
      start: number;
      date: string;
      type: "work" | "short" | "long";
      duration: number;
      completed: boolean;
      tag: string | null;
    }>;
  };
  crew: Record<string, unknown>;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const PHASES = new Set(["work", "short", "long"]);

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("backup must be a JSON object");
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`backup field ${field} must be a string`);
  return value;
}

function numberValue(value: unknown, field: string, nonNegative = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || !Number.isInteger(value) || (nonNegative && value < 0)) {
    throw new Error(`backup field ${field} must be a ${nonNegative ? "non-negative " : ""}integer`);
  }
  return value;
}

function boolValue(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new Error(`backup field ${field} must be boolean`);
  return value;
}

function arrayValue(value: unknown, field: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`backup field ${field} must be an array`);
  return value;
}

function validDate(value: string): boolean {
  return DATE.test(value);
}

function validateSession(value: unknown): PortableBackup["history"]["sessions"][number] {
  const row = record(value);
  const type = stringValue(row.type, "history.sessions.type");
  const date = stringValue(row.date, "history.sessions.date");
  if (!PHASES.has(type) || !validDate(date)) throw new Error("backup contains an invalid history session");
  const start = numberValue(row.start, "history.sessions.start");
  if (start <= 0) throw new Error("backup contains an invalid history session start");
  return {
    start,
    date,
    type: type as "work" | "short" | "long",
    duration: numberValue(row.duration, "history.sessions.duration", true),
    completed: boolValue(row.completed, "history.sessions.completed"),
    tag: row.tag === null || row.tag === undefined ? null : stringValue(row.tag, "history.sessions.tag"),
  };
}

function validateBackup(value: unknown): PortableBackup {
  const root = record(value);
  if (root.format !== BACKUP_FORMAT) throw new Error("not a Pomo backup");
  const version = numberValue(root.version, "version");
  if (version !== BACKUP_VERSION) throw new Error(`unsupported Pomo backup version: ${version}`);
  const history = record(root.history);
  const crew = root.crew === undefined ? {} : record(root.crew);
  const dayStats = arrayValue(history.dayStats, "history.dayStats").map((raw) => {
    const row = record(raw);
    const date = stringValue(row.date, "history.dayStats.date");
    if (!validDate(date)) throw new Error("backup contains an invalid history date");
    return {
      date,
      completed: numberValue(row.completed, "history.dayStats.completed", true),
      workMinutes: numberValue(row.workMinutes, "history.dayStats.workMinutes", true),
      breakMinutes: numberValue(row.breakMinutes, "history.dayStats.breakMinutes", true),
    };
  });
  const sessions = arrayValue(history.sessions, "history.sessions").map(validateSession);
  return {
    format: BACKUP_FORMAT,
    version,
    exportedAtEpochSeconds: numberValue(root.exportedAtEpochSeconds, "exportedAtEpochSeconds", true),
    appVersionName: stringValue(root.appVersionName, "appVersionName"),
    history: { dayStats, sessions },
    crew,
  };
}

export function decodePortableBackup(json: string): PortableBackup {
  if (new TextEncoder().encode(json).length > BACKUP_MAX_BYTES) throw new Error("backup exceeds maximum size");
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("backup is not valid JSON");
  }
  return validateBackup(parsed);
}

export function encodePortableBackup(input: {
  dayStats: DayStatRow[];
  sessions: SessionRow[];
  appVersionName?: string;
}): string {
  const backup: PortableBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAtEpochSeconds: Math.floor(Date.now() / 1000),
    appVersionName: input.appVersionName ?? "extension",
    history: {
      dayStats: input.dayStats.map((day) => ({
        date: day.date,
        completed: day.earnedBlocks,
        workMinutes: day.focusMinutes,
        breakMinutes: day.breakMinutes,
      })),
      sessions: input.sessions.map((session) => ({ ...session })),
    },
    crew: {
      identityPrivateKey: "",
      profileAvatarBase64: null,
      activeCrewId: null,
      memberships: [],
      snapshots: [],
      dailyAggregates: [],
      hiddenMembers: [],
    },
  };
  return JSON.stringify(backup, null, 2);
}
