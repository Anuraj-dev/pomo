import { describe, expect, test } from "bun:test";
import { requireSafeDiagnostic, streamDiagnosticExport, type DiagnosticEvent } from "../../src/sync/diagnostics/diagnosticExport";

async function* events(values: readonly DiagnosticEvent[]): AsyncIterable<DiagnosticEvent> { for (const value of values) yield value; }
describe("privacy-safe diagnostic export", () => {
  test("streams per-export aliases without stable references", async () => {
    const chunks: Uint8Array[] = []; const sink = { async write(chunk: Uint8Array) { chunks.push(chunk); }, async close() {} };
    await streamDiagnosticExport(events([{ monotonicMillis: 1, area: "FRONTIER", event: "advanced", fields: { sequence: "3" }, deviceRef: "stable-device", operationRef: "stable-operation" }]), sink);
    const text = new TextDecoder().decode(chunks[0]); expect(text).toContain("device-1"); expect(text).toContain("operation-1"); expect(text).not.toContain("stable-device");
  });
  test("rejects domain plaintext and cancels without draining the source", async () => {
    expect(() => requireSafeDiagnostic({ monotonicMillis: 1, area: "MIGRATION", event: "event", fields: { outcome: "profile content" } })).toThrow(/export-safe/);
    const controller = new AbortController(); controller.abort(); let writes = 0;
    const result = await streamDiagnosticExport(events([{ monotonicMillis: 1, area: "PERFORMANCE", event: "sample", fields: { durationMs: "1" } }]), { async write() { writes++; }, async close() {} }, controller.signal);
    expect(result.cancelled).toBeTrue(); expect(writes).toBe(0);
  });
});
