import type { CrewRelayStateRow } from "../db/dao";
import type { DayStatRow, SessionRow } from "../db/types";
import type { Board, Standing, WindowKey } from "../crew/leaderboard";
import type { PomoSettings } from "../engine/settings";
import type { TimerSnapshot } from "../engine/timer";
import type { SurfaceStats } from "./statsReader";

export const STATE_KEY = "pomo:state";
export const ENGINE_KEY = "pomo:engine";
export const SETTINGS_KEY = "pomo:settings";
export const CREW_MEMBERSHIPS_KEY = "pomo:crew:memberships";
export const CREW_ACTIVE_KEY = "pomo:crew:active";
export const CREW_SYNC_KEY = "pomo:crew:lastPublish";

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

export interface CrewSummary {
  crewId: string;
  crewName: string;
  displayName: string;
  relays: string[];
  lastAttemptEpochSeconds: number | null;
  lastSuccessEpochSeconds: number | null;
}

export interface CrewBoardResult {
  crew: CrewSummary;
  board: Board;
  relayStates: CrewRelayStateRow[];
  standing: Standing | null;
  selfPublicKey: string;
}

export interface PomoCrewListMessage {
  type: "pomo:crew:list";
}

export interface PomoCrewSelectMessage {
  type: "pomo:crew:select";
  crewId: string;
}

export interface PomoCrewBoardMessage {
  type: "pomo:crew:board";
  crewId: string;
  window: WindowKey;
}

export interface PomoCrewJoinMessage {
  type: "pomo:crew:join";
  payload: string;
  displayName: string;
}

export interface PomoCrewCreateMessage {
  type: "pomo:crew:create";
  crewName: string;
  displayName: string;
}

export interface PomoCrewLeaveMessage {
  type: "pomo:crew:leave";
  crewId: string;
}

export interface PomoCrewHideMessage {
  type: "pomo:crew:hide";
  crewId: string;
  identityPublicKey: string;
  hidden: boolean;
}

export interface PomoCrewHiddenMessage {
  type: "pomo:crew:hidden";
  crewId: string;
}

export interface PomoCrewRenameMessage {
  type: "pomo:crew:rename";
  crewId: string;
  displayName: string;
}

export interface PomoCrewRefreshMessage {
  type: "pomo:crew:refresh";
  crewId: string;
  window?: WindowKey;
}

export interface PomoCrewJoinCodeMessage {
  type: "pomo:crew:joinCode";
  crewId: string;
}

export interface PomoRecoveryExportMessage {
  type: "pomo:recovery:export";
  passphrase: string;
}

export interface PomoRecoveryImportMessage {
  type: "pomo:recovery:import";
  payload: string;
  passphrase: string;
}

export interface PomoBackupExportMessage {
  type: "pomo:backup:export";
}

export interface PomoBackupImportMessage {
  type: "pomo:backup:import";
  payload: string;
  confirmIdentityReplacement?: boolean;
}

export type PomoRequest =
  | PomoCommandMessage
  | PomoQueryMessage
  | PomoStatsMessage
  | PomoHistoryMessage
  | PomoSettingsGetMessage
  | PomoSettingsSetMessage
  | PomoCrewListMessage
  | PomoCrewSelectMessage
  | PomoCrewBoardMessage
  | PomoCrewJoinMessage
  | PomoCrewCreateMessage
  | PomoCrewLeaveMessage
  | PomoCrewHideMessage
  | PomoCrewHiddenMessage
  | PomoCrewRefreshMessage
  | PomoCrewJoinCodeMessage
  | PomoCrewRenameMessage
  | PomoRecoveryExportMessage
  | PomoRecoveryImportMessage
  | PomoBackupExportMessage
  | PomoBackupImportMessage;

export interface PomoResponse {
  ok: boolean;
  error?: string;
  state?: TimerSnapshot;
  settings?: PomoSettings;
  crews?: CrewSummary[];
  activeCrewId?: string | null;
  /** Explicit id of the crew that was just joined/created. */
  crewId?: string;
  board?: CrewBoardResult;
  joinCode?: string;
  hiddenMembers?: string[];
  recovery?: string;
  backup?: string;
  restoreSummary?: { sessionsAdded: number; daysAffected: number; membershipsAdded: number; identityRestored: boolean };
  backupImport?: { sessionsAdded: number; daysAffected: number; conflicts: number };
  needsIdentityConfirmation?: boolean;
  stats?: SurfaceStats;
  history?: HistoryPayload;
}

// Complete registry of request types. `satisfies` fails to compile if a new
// member is added to the PomoRequest union without being registered here.
const REQUEST_TYPE_REGISTRY = {
  "pomo:command": 0,
  "pomo:query": 0,
  "pomo:stats": 0,
  "pomo:history": 0,
  "pomo:settings:get": 0,
  "pomo:settings:set": 0,
  "pomo:crew:list": 0,
  "pomo:crew:select": 0,
  "pomo:crew:board": 0,
  "pomo:crew:join": 0,
  "pomo:crew:create": 0,
  "pomo:crew:leave": 0,
  "pomo:crew:hide": 0,
  "pomo:crew:hidden": 0,
  "pomo:crew:refresh": 0,
  "pomo:crew:joinCode": 0,
  "pomo:crew:rename": 0,
  "pomo:recovery:export": 0,
  "pomo:recovery:import": 0,
  "pomo:backup:export": 0,
  "pomo:backup:import": 0,
} satisfies { [K in PomoRequest["type"]]: 0 };

const POMO_REQUEST_TYPES = new Set<string>(Object.keys(REQUEST_TYPE_REGISTRY));

export function isPomoRequest(value: unknown): value is PomoRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !POMO_REQUEST_TYPES.has(type)) return false;
  const stringField = (name: string): boolean => typeof record[name] === "string";
  // Reject empty/whitespace-only strings for user-supplied fields.
  const nonEmptyStringField = (name: string): boolean => typeof record[name] === "string" && record[name].trim().length > 0;
  const windowField = (name: string): boolean =>
    record[name] === undefined || record[name] === "today" || record[name] === "7d" || record[name] === "30d" || record[name] === "all";
  const hexField = (name: string, length: number): boolean =>
    typeof record[name] === "string" && new RegExp(`^[0-9a-f]{${length}}$`).test(record[name]);
  switch (type) {
    case "pomo:command":
      if (record.command === "extend") {
        // Seconds must be a positive whole number of seconds.
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
    case "pomo:crew:board":
      return hexField("crewId", 32) && windowField("window") && record.window !== undefined;
    case "pomo:crew:join":
      return nonEmptyStringField("payload") && nonEmptyStringField("displayName");
    case "pomo:crew:create":
      return nonEmptyStringField("crewName") && nonEmptyStringField("displayName");
    case "pomo:crew:select":
      return hexField("crewId", 32);
    case "pomo:crew:leave":
    case "pomo:crew:joinCode":
      return hexField("crewId", 32);
    case "pomo:crew:hide":
      return hexField("crewId", 32) && hexField("identityPublicKey", 64) && typeof record.hidden === "boolean";
    case "pomo:crew:hidden":
      return hexField("crewId", 32);
    case "pomo:crew:refresh":
      return hexField("crewId", 32) && windowField("window");
    case "pomo:crew:rename":
      return hexField("crewId", 32) && nonEmptyStringField("displayName");
    case "pomo:recovery:export":
      return nonEmptyStringField("passphrase");
    case "pomo:recovery:import":
      return nonEmptyStringField("payload") && nonEmptyStringField("passphrase");
    case "pomo:backup:import":
      return nonEmptyStringField("payload") && (record.confirmIdentityReplacement === undefined || typeof record.confirmIdentityReplacement === "boolean");
    default:
      return true;
  }
}
