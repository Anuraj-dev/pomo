export const DIAGNOSTIC_EXPORT_MAX_BYTES = 10 * 1024 * 1024;
export type EvidenceArea = "STATE_TRANSITION" | "FRONTIER" | "DISPOSITION" | "ROUTE" | "COMMIT_ACK" | "LIFECYCLE_GENERATION" | "RETRY_BACKOFF" | "PROVIDER_PROTECTION" | "CHECKPOINT_REHYDRATION" | "MIGRATION" | "COMPATIBILITY" | "SAFE_MODE" | "PERFORMANCE";
export interface DiagnosticEvent { readonly monotonicMillis: number; readonly area: EvidenceArea; readonly event: string; readonly fields: Readonly<Record<string, string>>; readonly deviceRef?: string; readonly operationRef?: string }
export interface DiagnosticSink { write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }
export interface DiagnosticExportResult { readonly bytesWritten: number; readonly eventsWritten: number; readonly truncated: boolean; readonly cancelled: boolean }

const ALLOWED_FIELDS = new Set(["from", "to", "count", "sequence", "generation", "durationMs", "batchSize", "attempt", "delayMs", "outcome", "reasonCode", "routeKind", "sourceKind", "formatVersion"]);
const EVIDENCE_AREAS = new Set<EvidenceArea>(["STATE_TRANSITION", "FRONTIER", "DISPOSITION", "ROUTE", "COMMIT_ACK", "LIFECYCLE_GENERATION", "RETRY_BACKOFF", "PROVIDER_PROTECTION", "CHECKPOINT_REHYDRATION", "MIGRATION", "COMPATIBILITY", "SAFE_MODE", "PERFORMANCE"]);
const FORBIDDEN = /(key|secret|token|credential|capability|recovery|profile|photo|tag|history|payload|content|member)/i;
export function requireSafeDiagnostic(event: DiagnosticEvent): void {
  if (!Number.isSafeInteger(event.monotonicMillis) || event.monotonicMillis < 0 || !EVIDENCE_AREAS.has(event.area) || typeof event.event !== "string" || event.event.length < 1 || event.event.length > 80 || FORBIDDEN.test(event.event)) throw new Error("unsafe diagnostic event");
  if ((event.deviceRef !== undefined && (typeof event.deviceRef !== "string" || event.deviceRef.length > 200)) || (event.operationRef !== undefined && (typeof event.operationRef !== "string" || event.operationRef.length > 200))) throw new Error("unsafe diagnostic reference");
  const fields = Object.entries(event.fields); if (fields.length > 24) throw new Error("too many diagnostic fields");
  for (const [key, value] of fields) if (!ALLOWED_FIELDS.has(key) || value.length > 120 || FORBIDDEN.test(value)) throw new Error("Diagnostic field is not export-safe");
}

export async function streamDiagnosticExport(events: AsyncIterable<DiagnosticEvent>, sink: DiagnosticSink, signal?: AbortSignal): Promise<DiagnosticExportResult> {
  const encoder = new TextEncoder(); const devices = new Map<string, string>(); const operations = new Map<string, string>();
  let bytesWritten = 0; let eventsWritten = 0;
  for await (const event of events) {
    if (signal?.aborted === true) return { bytesWritten, eventsWritten, truncated: false, cancelled: true };
    requireSafeDiagnostic(event);
    const chunk = encoder.encode(`${JSON.stringify(exportRecord(event, devices, operations))}\n`);
    if (bytesWritten + chunk.length > DIAGNOSTIC_EXPORT_MAX_BYTES) { await sink.close(); return { bytesWritten, eventsWritten, truncated: true, cancelled: false }; }
    await sink.write(chunk); bytesWritten += chunk.length; eventsWritten++;
  }
  await sink.close(); return { bytesWritten, eventsWritten, truncated: false, cancelled: false };
}
function exportRecord(event: DiagnosticEvent, devices: Map<string, string>, operations: Map<string, string>): Record<string, unknown> {
  const output: Record<string, unknown> = { v: 1, monotonicMillis: event.monotonicMillis, area: event.area, event: event.event, fields: Object.fromEntries(Object.entries(event.fields).sort(([left], [right]) => left.localeCompare(right))) };
  if (event.deviceRef !== undefined) output["deviceAlias"] = alias(devices, event.deviceRef, "device");
  if (event.operationRef !== undefined) output["operationAlias"] = alias(operations, event.operationRef, "operation");
  return output;
}
function alias(values: Map<string, string>, raw: string, prefix: string): string { const current = values.get(raw); if (current !== undefined) return current; const value = `${prefix}-${values.size + 1}`; values.set(raw, value); return value; }
