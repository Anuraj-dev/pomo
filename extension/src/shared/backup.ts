import type { CrewDailyRow, CrewSnapshotRow } from "../db/dao";
import type { DayStatRow, SessionRow } from "../db/types";
import { isLowerHex } from "./hex";
import type { CrewMembership, StoredMembership } from "../crew/types";
import { decodePayload, encodePrefixedPayload } from "../crew/joinCode";
import { normalizeCrewName, normalizeDisplayName } from "../crew/validation";

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
  crew: {
    identityPrivateKey: string;
    profileAvatarBase64: string | null;
    activeCrewId: string | null;
    memberships: Array<{
      crewId: string;
      crewName: string;
      joinCode: string;
      relays: string[];
      key: string;
      displayName: string;
      protocolVersion: number;
    }>;
    snapshots: Array<{
      crewId: string;
      identityPublicKey: string;
      displayName: string;
      avatarBase64: string | null;
      allTimeFocusMinutes: number;
      publishedAtEpochSeconds: number;
      localDate: string;
      utcOffsetMinutes: number;
      currentStreak: number;
      lastFocusedAtEpochSeconds: number;
      protocolVersion: number;
      statsJson: string | null;
    }>;
    dailyAggregates: Array<{
      crewId: string;
      identityPublicKey: string;
      localDate: string;
      focusMinutes: number;
      completedWorkBlocks: number;
    }>;
    hiddenMembers: Array<{ crewId: string; identityPublicKey: string; hiddenAtEpochSeconds: number }>;
  };
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
  const crew = record(root.crew);
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
  const identityPrivateKey = stringValue(crew.identityPrivateKey ?? "", "crew.identityPrivateKey");
  if (identityPrivateKey !== "" && !isLowerHex(identityPrivateKey, 64)) throw new Error("backup identity is invalid");
  const memberships = arrayValue(crew.memberships, "crew.memberships").map((raw) => {
    const row = record(raw);
    const relays = arrayValue(row.relays, "crew.memberships.relays").map((relay) => stringValue(relay, "crew.memberships.relay"));
    const crewId = stringValue(row.crewId, "crew.memberships.crewId");
    const key = stringValue(row.key, "crew.memberships.key");
    const crewName = stringValue(row.crewName, "crew.memberships.crewName");
    const joinCode = stringValue(row.joinCode, "crew.memberships.joinCode");
    const displayName = stringValue(row.displayName, "crew.memberships.displayName");
    if (!isLowerHex(crewId, 32) || !isLowerHex(key, 64)) throw new Error("backup contains an invalid Crew membership key");
    if (normalizeCrewName(crewName) !== crewName || normalizeDisplayName(displayName) !== displayName) {
      throw new Error("backup contains an invalid Crew name");
    }
    let decoded: ReturnType<typeof decodePayload>;
    try {
      decoded = decodePayload(joinCode);
    } catch {
      throw new Error("backup contains an invalid Crew join code");
    }
    const relaysMatch = decoded.relays.length === relays.length && decoded.relays.every((relay, index) => relay === relays[index]);
    if (decoded.crewId !== crewId || decoded.crewName !== crewName || decoded.key !== key || !relaysMatch) {
      throw new Error("backup Crew join code does not match its membership");
    }
    return {
      crewId,
      crewName,
      joinCode,
      relays,
      key,
      displayName,
      protocolVersion: numberValue(row.protocolVersion, "crew.memberships.protocolVersion"),
    };
  });
  const snapshots = arrayValue(crew.snapshots, "crew.snapshots").map((raw) => {
    const row = record(raw);
    const crewId = stringValue(row.crewId, "crew.snapshots.crewId");
    const identityPublicKey = stringValue(row.identityPublicKey, "crew.snapshots.identityPublicKey");
    if (!isLowerHex(crewId, 32) || !isLowerHex(identityPublicKey, 64)) throw new Error("backup contains an invalid Crew snapshot key");
    return {
      crewId,
      identityPublicKey,
      displayName: stringValue(row.displayName, "crew.snapshots.displayName"),
      avatarBase64: row.avatarBase64 === null || row.avatarBase64 === undefined ? null : stringValue(row.avatarBase64, "crew.snapshots.avatarBase64"),
      allTimeFocusMinutes: numberValue(row.allTimeFocusMinutes, "crew.snapshots.allTimeFocusMinutes", true),
      publishedAtEpochSeconds: numberValue(row.publishedAtEpochSeconds, "crew.snapshots.publishedAtEpochSeconds", true),
      localDate: stringValue(row.localDate, "crew.snapshots.localDate"),
      utcOffsetMinutes: numberValue(row.utcOffsetMinutes, "crew.snapshots.utcOffsetMinutes"),
      currentStreak: numberValue(row.currentStreak, "crew.snapshots.currentStreak", true),
      lastFocusedAtEpochSeconds: numberValue(row.lastFocusedAtEpochSeconds, "crew.snapshots.lastFocusedAtEpochSeconds", true),
      protocolVersion: numberValue(row.protocolVersion, "crew.snapshots.protocolVersion"),
      statsJson: row.statsJson === null || row.statsJson === undefined ? null : stringValue(row.statsJson, "crew.snapshots.statsJson"),
    };
  });
  const dailyAggregates = arrayValue(crew.dailyAggregates, "crew.dailyAggregates").map((raw) => {
    const row = record(raw);
    const localDate = stringValue(row.localDate, "crew.dailyAggregates.localDate");
    if (!validDate(localDate)) throw new Error("backup contains an invalid Crew date");
    const crewId = stringValue(row.crewId, "crew.dailyAggregates.crewId");
    const identityPublicKey = stringValue(row.identityPublicKey, "crew.dailyAggregates.identityPublicKey");
    if (!isLowerHex(crewId, 32) || !isLowerHex(identityPublicKey, 64)) throw new Error("backup contains an invalid Crew aggregate key");
    return {
      crewId,
      identityPublicKey,
      localDate,
      focusMinutes: numberValue(row.focusMinutes, "crew.dailyAggregates.focusMinutes", true),
      completedWorkBlocks: numberValue(row.completedWorkBlocks, "crew.dailyAggregates.completedWorkBlocks", true),
    };
  });
  const hiddenMembers = arrayValue(crew.hiddenMembers, "crew.hiddenMembers").map((raw) => {
    const row = record(raw);
    const crewId = stringValue(row.crewId, "crew.hiddenMembers.crewId");
    const identityPublicKey = stringValue(row.identityPublicKey, "crew.hiddenMembers.identityPublicKey");
    if (!isLowerHex(crewId, 32) || !isLowerHex(identityPublicKey, 64)) throw new Error("backup contains an invalid hidden Crew key");
    return {
      crewId,
      identityPublicKey,
      hiddenAtEpochSeconds: numberValue(row.hiddenAtEpochSeconds, "crew.hiddenMembers.hiddenAtEpochSeconds", true),
    };
  });
  return {
    format: BACKUP_FORMAT,
    version,
    exportedAtEpochSeconds: numberValue(root.exportedAtEpochSeconds, "exportedAtEpochSeconds", true),
    appVersionName: stringValue(root.appVersionName, "appVersionName"),
    history: { dayStats, sessions },
    crew: {
      identityPrivateKey,
      profileAvatarBase64: crew.profileAvatarBase64 === null || crew.profileAvatarBase64 === undefined ? null : stringValue(crew.profileAvatarBase64, "crew.profileAvatarBase64"),
      activeCrewId: crew.activeCrewId === null || crew.activeCrewId === undefined ? null : stringValue(crew.activeCrewId, "crew.activeCrewId"),
      memberships,
      snapshots,
      dailyAggregates,
      hiddenMembers,
    },
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
  memberships: StoredMembership[];
  identityPrivateKey: string;
  activeCrewId: string | null;
  snapshots: CrewSnapshotRow[];
  dailyAggregates: CrewDailyRow[];
  hiddenMembers: Array<{ crewId: string; identityPublicKey: string; hiddenAtEpochSeconds: number }>;
  appVersionName?: string;
}): string {
  const backup: PortableBackup = {
    format: BACKUP_FORMAT,
    version: BACKUP_VERSION,
    exportedAtEpochSeconds: Math.floor(Date.now() / 1000),
    appVersionName: input.appVersionName ?? "extension",
    history: {
      dayStats: input.dayStats.map((day) => ({ date: day.date, completed: day.earnedBlocks, workMinutes: day.focusMinutes, breakMinutes: day.breakMinutes })),
      sessions: input.sessions.map((session) => ({ ...session })),
    },
    crew: {
      identityPrivateKey: input.identityPrivateKey,
      profileAvatarBase64: null,
      activeCrewId: input.activeCrewId,
      memberships: input.memberships.map((membership) => ({
        crewId: membership.crewId,
        crewName: membership.crewName,
        joinCode: encodePrefixedPayload({
          version: 2,
          crewId: membership.crewId,
          crewName: membership.crewName,
          relays: membership.relays,
          key: membership.key,
        }),
        relays: [...membership.relays],
        key: membership.key,
        displayName: membership.displayName,
        protocolVersion: 2,
      })),
      snapshots: input.snapshots.map((snapshot) => ({ ...snapshot })),
      dailyAggregates: input.dailyAggregates.map((aggregate) => ({ ...aggregate })),
      hiddenMembers: input.hiddenMembers.map((hidden) => ({ ...hidden })),
    },
  };
  return JSON.stringify(backup, null, 2);
}

export function membershipFromBackup(value: PortableBackup["crew"]["memberships"][number]): StoredMembership {
  return {
    crewId: value.crewId,
    crewName: value.crewName,
    relays: [...value.relays],
    key: value.key,
    displayName: value.displayName,
    joinedAtEpochSeconds: Math.floor(Date.now() / 1000),
  };
}

export function asCrewMembership(value: StoredMembership): CrewMembership {
  return { crewId: value.crewId, crewName: value.crewName, relays: [...value.relays], key: value.key };
}
