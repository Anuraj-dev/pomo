import { DORMANT_SYNC_UI_STATE, parseSyncUiState, scheduleOrdinaryDrain, SYNC_DRAIN_REQUEST_KEY, SYNC_UI_STATE_KEY, type SyncUiState } from "./syncUiState";
import { requireSafeDiagnostic, streamDiagnosticExport, type DiagnosticEvent } from "../diagnostics/diagnosticExport";

export type SyncPanelDensity = "compact" | "panel" | "full";

export function bootSyncPanel(root: HTMLElement, density: SyncPanelDensity): () => void {
  root.className = `sync-panel sync-panel--${density}`;
  root.setAttribute("aria-busy", "true"); root.setAttribute("aria-live", "polite");
  root.textContent = "Loading sync state…";
  let current = DORMANT_SYNC_UI_STATE;
  let diagnosticAbort: AbortController | null = null;
  const apply = (raw: unknown): void => {
    try { current = raw === undefined ? DORMANT_SYNC_UI_STATE : parseSyncUiState(raw); render(root, current, density); }
    catch { renderError(root, density); }
  };
  void chrome.storage.local.get(SYNC_UI_STATE_KEY).then((stored) => apply(stored[SYNC_UI_STATE_KEY])).catch(() => renderError(root, density));
  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string): void => { if (area === "local" && changes[SYNC_UI_STATE_KEY] !== undefined) apply(changes[SYNC_UI_STATE_KEY]!.newValue); };
  chrome.storage.onChanged.addListener(changed);
  root.addEventListener("click", (event) => {
    const action = (event.target as HTMLElement).closest<HTMLElement>("[data-sync-action]")?.dataset["syncAction"];
    if (action === "open") void chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#sync") });
    if (action === "retry" && !current.retryPending) {
      current = scheduleOrdinaryDrain(current); render(root, current, density);
      void chrome.storage.local.set({
        [SYNC_DRAIN_REQUEST_KEY]: { requestedAt: Date.now(), kind: "ORDINARY_DRAIN" },
        [SYNC_UI_STATE_KEY]: current,
      });
    }
    if (action === "recovery-confirm") void confirmForwardRestore(current).then((next) => { current = next; render(root, current, density); });
    if (action === "diagnostics-export" && diagnosticAbort === null) {
      diagnosticAbort = new AbortController();
      void exportDiagnostics(root, diagnosticAbort.signal).finally(() => { diagnosticAbort = null; });
    }
    if (action === "diagnostics-cancel") diagnosticAbort?.abort();
  });
  return () => chrome.storage.onChanged.removeListener(changed);
}

function render(root: HTMLElement, state: SyncUiState, density: SyncPanelDensity): void {
  root.setAttribute("aria-busy", "false"); root.dataset["health"] = state.health;
  root.innerHTML = `<header class="sync-head"><div><h${density === "full" ? "1" : "2"}>Sync</h${density === "full" ? "1" : "2"}><p class="sync-summary"></p></div><span class="sync-health num"></span></header><div class="signal-rail" aria-label="Sync signals"></div><p class="sync-detail"></p><div class="sync-actions"><button type="button" data-sync-action="retry">Retry now</button>${density === "full" ? "" : '<button type="button" data-sync-action="open">Open sync</button>'}</div>${density === "full" ? fullWorkbench() : ""}`;
  setText(root, ".sync-summary", state.summary); setText(root, ".sync-health", state.health.replace("_", " ")); setText(root, ".sync-detail", state.detail);
  const rail = root.querySelector(".signal-rail")!;
  for (const signal of state.signals) { const item = document.createElement("div"); item.className = "signal"; if (signal.attention) item.dataset["attention"] = "true"; const value = document.createElement("strong"); value.className = "num"; value.textContent = signal.value; const label = document.createElement("span"); label.textContent = signal.label; item.append(value, label); rail.append(item); }
  const retry = root.querySelector<HTMLButtonElement>('[data-sync-action="retry"]')!; retry.disabled = state.retryPending; retry.textContent = state.retryPending ? "Retry scheduled" : "Retry now";
  if (density === "full") renderFull(root, state);
}

function fullWorkbench(): string {
  return `<div class="sync-workbench"><section aria-labelledby="admission-title"><h2 id="admission-title">Admission</h2><p id="syncAdmission"></p><code id="syncAdmissionFingerprint"></code></section><section aria-labelledby="migration-title"><h2 id="migration-title">Migration</h2><p id="syncMigration"></p><code id="syncMigrationFingerprint"></code></section><section class="sync-span" aria-labelledby="history-title"><h2 id="history-title">Data History</h2><p>Chronology is causal. Provenance, disposition, and projection effect remain inspectable.</p><div class="sync-history" id="syncHistory"></div></section><section class="sync-span" aria-labelledby="recovery-title"><h2 id="recovery-title">Recovery workbench</h2><p id="syncRecovery"></p><ol id="syncRecoveryOperations"></ol><button type="button" id="syncRecoveryConfirm" disabled>Confirm forward restore</button><small>Creates a Safety checkpoint before compensating Operations. Active phases and authority cannot be rewound.</small></section><section class="sync-span" aria-labelledby="diagnostics-title"><h2 id="diagnostics-title">Diagnostics</h2><p>Sanitized local evidence only. No implicit upload or centralized telemetry.</p><div class="sync-actions"><button type="button" data-sync-action="diagnostics-export">Export diagnostics</button><button type="button" data-sync-action="diagnostics-cancel">Cancel export</button></div><p id="syncDiagnosticStatus" role="status"></p></section></div>`;
}
function renderFull(root: HTMLElement, state: SyncUiState): void {
  setText(root, "#syncAdmission", `${state.admission.stage}${state.admission.resumable ? " · resumable" : ""}`); setText(root, "#syncAdmissionFingerprint", state.admission.fingerprint ?? "Fingerprint pending");
  setText(root, "#syncMigration", `${state.migration.stage}${state.migration.resumable ? " · resumable" : ""}`); setText(root, "#syncMigrationFingerprint", state.migration.fingerprint ?? "Fingerprint pending");
  const history = root.querySelector("#syncHistory")!;
  if (state.history.length === 0) history.textContent = "No synchronized Operations yet. Local history remains available.";
  for (const item of state.history) { const row = document.createElement("article"); row.className = "sync-history-row"; for (const value of [item.chronology, item.provenance, item.disposition, item.projectionEffect]) { const span = document.createElement("span"); span.textContent = value; row.append(span); } history.append(row); }
  setText(root, "#syncRecovery", `${state.recovery.anchor ?? "No anchor"} · ${state.recovery.comparison}`);
  const operations = root.querySelector("#syncRecoveryOperations")!; if (state.recovery.compensatingOperations.length === 0) operations.textContent = "No compensating Operations selected.";
  for (const operation of state.recovery.compensatingOperations) { const item = document.createElement("li"); item.textContent = operation; operations.append(item); }
  const confirm = root.querySelector<HTMLButtonElement>("#syncRecoveryConfirm")!; confirm.dataset["syncAction"] = "recovery-confirm"; confirm.disabled = state.recovery.compensatingOperations.length === 0 || state.recovery.independentConfirmationRequired;
}
function setText(root: HTMLElement, selector: string, value: string): void { const element = root.querySelector(selector); if (element !== null) element.textContent = value; }
function renderError(root: HTMLElement, density: SyncPanelDensity): void { root.setAttribute("aria-busy", "false"); root.dataset["health"] = "STALLED"; root.innerHTML = `<h${density === "full" ? "1" : "2"}>Sync</h${density === "full" ? "1" : "2"}><p role="alert">Sync state could not be read. Timer rendering is unaffected.</p><button type="button" data-sync-action="retry">Retry now</button>`; }

async function exportDiagnostics(root: HTMLElement, signal: AbortSignal): Promise<void> {
  const status = root.querySelector<HTMLElement>("#syncDiagnosticStatus"); if (status !== null) status.textContent = "Preparing sanitized export…";
  try {
    const stored = await chrome.storage.local.get("pomo:sync:diagnostic-events"); const raw = stored["pomo:sync:diagnostic-events"];
    if (!Array.isArray(raw)) throw new Error("No diagnostic evidence is available");
    const events = raw.map(parseDiagnosticEvent); const chunks: Uint8Array[] = [];
    const result = await streamDiagnosticExport((async function* () { for (const event of events) yield event; })(), { async write(chunk) { chunks.push(chunk); }, async close() {} }, signal);
    if (result.cancelled) { if (status !== null) status.textContent = "Export cancelled."; return; }
    const blob = new Blob(chunks.map((chunk) => new Uint8Array(chunk).buffer), { type: "application/x-ndjson" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = "pomo-diagnostics.ndjson"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 0);
    if (status !== null) status.textContent = result.truncated ? "Export reached the 10 MiB safety limit." : `Exported ${result.eventsWritten} evidence records.`;
  } catch (error) { if (status !== null) status.textContent = error instanceof Error ? error.message : "Diagnostic export failed."; }
}
async function confirmForwardRestore(state: SyncUiState): Promise<SyncUiState> {
  if (state.recovery.compensatingOperations.length === 0 || state.recovery.independentConfirmationRequired) return state;
  const next: SyncUiState = {
    ...state,
    recovery: { ...state.recovery, compensatingOperations: [], comparison: "Forward restore confirmed. Safety checkpoint retained." },
  };
  await chrome.storage.local.set({ [SYNC_UI_STATE_KEY]: next });
  return next;
}

function parseDiagnosticEvent(value: unknown): DiagnosticEvent {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid diagnostic evidence");
  const raw = value as Record<string, unknown>; const fields = raw["fields"];
  if (typeof fields !== "object" || fields === null || Array.isArray(fields) || Object.values(fields).some((item) => typeof item !== "string")) throw new Error("Invalid diagnostic evidence");
  const event = { monotonicMillis: raw["monotonicMillis"], area: raw["area"], event: raw["event"], fields, deviceRef: raw["deviceRef"], operationRef: raw["operationRef"] } as DiagnosticEvent;
  requireSafeDiagnostic(event); return event;
}
