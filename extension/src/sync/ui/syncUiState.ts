export const SYNC_UI_STATE_KEY = "pomo:sync:ui-state";
export const SYNC_DRAIN_REQUEST_KEY = "pomo:sync:ordinary-drain-request";

export type SyncHealth = "HEALTHY" | "OFFLINE" | "STALLED" | "QUARANTINE" | "CONFLICT" | "LIMITED" | "INCOMPLETE" | "SAFE_MODE";
export interface SyncSignal { readonly label: "Saved locally" | "Peer-redundant" | "Protected sync" | "Attention"; readonly value: string; readonly attention: boolean }
export interface SyncHistoryItem { readonly id: string; readonly chronology: string; readonly provenance: string; readonly disposition: string; readonly projectionEffect: string }
export interface SyncUiState {
  readonly version: 1;
  readonly health: SyncHealth;
  readonly summary: string;
  readonly detail: string;
  readonly signals: readonly [SyncSignal, SyncSignal, SyncSignal, SyncSignal];
  readonly admission: { readonly stage: string; readonly fingerprint: string | null; readonly resumable: boolean };
  readonly migration: { readonly stage: string; readonly fingerprint: string | null; readonly resumable: boolean };
  readonly history: readonly SyncHistoryItem[];
  readonly recovery: { readonly anchor: string | null; readonly comparison: string; readonly compensatingOperations: readonly string[]; readonly independentConfirmationRequired: boolean };
  readonly timerControlsFrozen: boolean;
  readonly retryPending: boolean;
}

export const DORMANT_SYNC_UI_STATE: SyncUiState = {
  version: 1, health: "INCOMPLETE", summary: "Sync not activated", detail: "Saved locally. Complete admission before protected sync can author shared history.",
  signals: [
    { label: "Saved locally", value: "Current", attention: false },
    { label: "Peer-redundant", value: "Not yet", attention: false },
    { label: "Protected sync", value: "Incomplete", attention: true },
    { label: "Attention", value: "Admission", attention: true },
  ],
  admission: { stage: "Not started", fingerprint: null, resumable: true }, migration: { stage: "Not started", fingerprint: null, resumable: true }, history: [],
  recovery: { anchor: null, comparison: "No Recovery anchor selected", compensatingOperations: [], independentConfirmationRequired: false },
  timerControlsFrozen: false, retryPending: false,
};

const HEALTH = new Set<SyncHealth>(["HEALTHY", "OFFLINE", "STALLED", "QUARANTINE", "CONFLICT", "LIMITED", "INCOMPLETE", "SAFE_MODE"]);
const SIGNAL_LABELS = ["Saved locally", "Peer-redundant", "Protected sync", "Attention"] as const;
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function text(value: unknown, limit = 240): value is string { return typeof value === "string" && value.length <= limit; }

export function parseSyncUiState(value: unknown): SyncUiState {
  if (!object(value) || value["version"] !== 1 || !HEALTH.has(value["health"] as SyncHealth) || !text(value["summary"]) || !text(value["detail"])) throw new Error("Invalid sync UI state");
  const signals = value["signals"];
  if (!Array.isArray(signals) || signals.length !== 4) throw new Error("Invalid Signal rail");
  const parsedSignals = signals.map((signal, index) => {
    if (!object(signal) || signal["label"] !== SIGNAL_LABELS[index] || !text(signal["value"], 80) || typeof signal["attention"] !== "boolean") throw new Error("Invalid Signal rail");
    return { label: SIGNAL_LABELS[index]!, value: signal["value"], attention: signal["attention"] };
  }) as unknown as SyncUiState["signals"];
  const admission = parseProgress(value["admission"]); const migration = parseProgress(value["migration"]);
  if (!Array.isArray(value["history"]) || value["history"].length > 200) throw new Error("Invalid Data History");
  const history = value["history"].map((item) => {
    if (!object(item) || !text(item["id"], 100) || !text(item["chronology"]) || !text(item["provenance"]) || !text(item["disposition"]) || !text(item["projectionEffect"])) throw new Error("Invalid Data History item");
    return { id: item["id"], chronology: item["chronology"], provenance: item["provenance"], disposition: item["disposition"], projectionEffect: item["projectionEffect"] };
  });
  const recovery = value["recovery"];
  if (!object(recovery) || !(recovery["anchor"] === null || text(recovery["anchor"], 100)) || !text(recovery["comparison"]) || !Array.isArray(recovery["compensatingOperations"]) || recovery["compensatingOperations"].length > 100 || !recovery["compensatingOperations"].every((item) => text(item)) || typeof recovery["independentConfirmationRequired"] !== "boolean") throw new Error("Invalid Recovery preview");
  if (typeof value["timerControlsFrozen"] !== "boolean" || typeof value["retryPending"] !== "boolean") throw new Error("Invalid sync control state");
  return { version: 1, health: value["health"] as SyncHealth, summary: value["summary"], detail: value["detail"], signals: parsedSignals, admission, migration, history, recovery: { anchor: recovery["anchor"], comparison: recovery["comparison"], compensatingOperations: recovery["compensatingOperations"], independentConfirmationRequired: recovery["independentConfirmationRequired"] }, timerControlsFrozen: value["timerControlsFrozen"], retryPending: value["retryPending"] };
}

function parseProgress(value: unknown): SyncUiState["admission"] {
  if (!object(value) || !text(value["stage"], 100) || !(value["fingerprint"] === null || text(value["fingerprint"], 100)) || typeof value["resumable"] !== "boolean") throw new Error("Invalid resumable workflow");
  return { stage: value["stage"], fingerprint: value["fingerprint"], resumable: value["resumable"] };
}

export function scheduleOrdinaryDrain(state: SyncUiState): SyncUiState { return { ...state, retryPending: true }; }

export function timerControlsFrozenFromStorage(raw: unknown): boolean {
  if (raw === undefined) return false;
  try {
    return parseSyncUiState(raw).timerControlsFrozen;
  } catch {
    return false;
  }
}
