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

export interface PomoNewTabSkipMessage {
  type: "pomo:newtab:skip";
}

export type PomoRequest =
  | PomoCommandMessage
  | PomoQueryMessage
  | PomoStatsMessage
  | PomoHistoryMessage
  | PomoSettingsGetMessage
  | PomoSettingsSetMessage
  | PomoCrewListMessage
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
  | PomoBackupImportMessage
  | PomoNewTabSkipMessage;

export interface PomoResponse {
  ok: boolean;
  error?: string;
  state?: TimerSnapshot;
  settings?: PomoSettings;
  crews?: CrewSummary[];
  board?: CrewBoardResult;
  joinCode?: string;
  hiddenMembers?: string[];
  recovery?: string;
  backup?: string;
  restoreSummary?: { sessionsAdded: number; daysAffected: number; membershipsAdded: number; identityRestored: boolean };
  stats?: SurfaceStats;
  history?: HistoryPayload;
}

const POMO_REQUEST_TYPES = new Set<string>([
  "pomo:command",
  "pomo:query",
  "pomo:stats",
  "pomo:history",
  "pomo:settings:get",
  "pomo:settings:set",
  "pomo:crew:list",
  "pomo:crew:board",
  "pomo:crew:join",
  "pomo:crew:create",
  "pomo:crew:leave",
  "pomo:crew:hide",
  "pomo:crew:hidden",
  "pomo:crew:refresh",
  "pomo:crew:joinCode",
  "pomo:crew:rename",
  "pomo:recovery:export",
  "pomo:recovery:import",
  "pomo:backup:export",
  "pomo:backup:import",
  "pomo:newtab:skip",
]);

export function isPomoRequest(value: unknown): value is PomoRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== "string" || !POMO_REQUEST_TYPES.has(type)) return false;
  const stringField = (name: string): boolean => typeof record[name] === "string";
  const windowField = (name: string): boolean =>
    record[name] === undefined || record[name] === "today" || record[name] === "7d" || record[name] === "30d" || record[name] === "all";
  switch (type) {
    case "pomo:command":
      return (record.command === "toggle" || record.command === "skip" || record.command === "reset" || record.command === "extend") &&
        (record.seconds === undefined || (typeof record.seconds === "number" && Number.isFinite(record.seconds)));
    case "pomo:settings:set":
      return typeof record.settings === "object" && record.settings !== null && !Array.isArray(record.settings);
    case "pomo:crew:board":
      return stringField("crewId") && windowField("window") && record.window !== undefined;
    case "pomo:crew:join":
      return stringField("payload") && stringField("displayName");
    case "pomo:crew:create":
      return stringField("crewName") && stringField("displayName");
    case "pomo:crew:leave":
    case "pomo:crew:joinCode":
      return stringField("crewId");
    case "pomo:crew:hide":
      return stringField("crewId") && stringField("identityPublicKey") && typeof record.hidden === "boolean";
    case "pomo:crew:hidden":
      return stringField("crewId");
    case "pomo:crew:refresh":
      return stringField("crewId") && windowField("window");
    case "pomo:crew:rename":
      return stringField("crewId") && stringField("displayName");
    case "pomo:recovery:export":
      return stringField("passphrase");
    case "pomo:recovery:import":
      return stringField("payload") && stringField("passphrase");
    case "pomo:backup:import":
      return stringField("payload") && (record.confirmIdentityReplacement === undefined || typeof record.confirmIdentityReplacement === "boolean");
    default:
      return true;
  }
}
