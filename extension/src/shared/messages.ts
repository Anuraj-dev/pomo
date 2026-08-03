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
  | PomoCrewBoardMessage
  | PomoCrewJoinMessage
  | PomoCrewCreateMessage
  | PomoCrewLeaveMessage
  | PomoCrewHideMessage
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
  board?: CrewBoardResult;
  joinCode?: string;
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
  "pomo:crew:refresh",
  "pomo:crew:joinCode",
  "pomo:crew:rename",
  "pomo:recovery:export",
  "pomo:recovery:import",
  "pomo:backup:export",
  "pomo:backup:import",
]);

export function isPomoRequest(value: unknown): value is PomoRequest {
  if (typeof value !== "object" || value === null) return false;
  return POMO_REQUEST_TYPES.has((value as { type?: unknown }).type as string);
}
