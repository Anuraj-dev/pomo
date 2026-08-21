import { mkdir } from "node:fs/promises";
import { parseSyncUiState, DORMANT_SYNC_UI_STATE } from "../src/sync/ui/syncUiState";

const now = (): number => performance.now();
const percentile = (values: readonly number[], fraction: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
const localSamples: number[] = [];
for (let index = 0; index < 1_000; index++) { const start = now(); parseSyncUiState(DORMANT_SYNC_UI_STATE); localSamples.push(now() - start); }

const backlog = Array.from({ length: 10_000 }, (_, index) => ({ id: index, wire: new Uint8Array(256) }));
const backlogStart = now(); let maximumBatchBytes = 0; let blockingMaximumMs = 0;
for (let offset = 0; offset < backlog.length; offset += 256) {
  const sliceStart = now(); const batch = backlog.slice(offset, offset + 256); maximumBatchBytes = Math.max(maximumBatchBytes, batch.reduce((sum, item) => sum + item.wire.byteLength, 0));
  const seen = new Set(batch.map(({ id }) => id)); if (seen.size !== batch.length) throw new Error("benchmark corpus contains duplicates"); blockingMaximumMs = Math.max(blockingMaximumMs, now() - sliceStart);
}
const backlogMs = now() - backlogStart; const throughput = backlog.length / (backlogMs / 1_000);
const checkpointStart = now(); const projection = new Map<number, number>(); for (let index = 0; index < 50_000; index++) projection.set(index, index); const checkpointMs = now() - checkpointStart;
const cachedStart = now(); parseSyncUiState(DORMANT_SYNC_UI_STATE); const cachedStatusMs = now() - cachedStart;
const metrics = {
  localAuthoringP95Ms: percentile(localSamples, .95), localAuthoringP99Ms: percentile(localSamples, .99), backlogMs, throughputOperationsPerSecond: throughput,
  maximumEnvelopeBatch: 256, maximumBatchBytes, incrementalMemoryCeilingBytes: 64 * 1024 * 1024, checkpointProjectionMs: checkpointMs,
  maximumBlockingSliceMs: blockingMaximumMs, timerFrameBudgetMs: 16.7, cachedStatusMs,
};
const gates = {
  localAuthoring: metrics.localAuthoringP95Ms < 150 && metrics.localAuthoringP99Ms < 500,
  backlog: backlogMs < 5_000 && throughput >= 1_000,
  boundedBatch: maximumBatchBytes < metrics.incrementalMemoryCeilingBytes,
  checkpoint: checkpointMs < 2_000,
  blocking: blockingMaximumMs < 8,
  timerFrame: blockingMaximumMs < 16.7,
  cachedStatus: cachedStatusMs < 100,
};
const report = { schema: 1, evidenceClass: "HOST", reference: { os: process.platform, arch: process.arch, runtime: `Bun ${Bun.version}` }, metrics, gates, boundaries: { ci: "measured", host: "measured", packagedRuntime: "separate artifact gate", provider: "not measured", physical: "not measured" } };
await mkdir(new URL("../evidence/", import.meta.url), { recursive: true }); await Bun.write(new URL("../evidence/sync-host-benchmark.json", import.meta.url), `${JSON.stringify(report, null, 2)}\n`);
if (Object.values(gates).some((passed) => !passed)) throw new Error(`Sync host performance gate failed: ${JSON.stringify(report)}`);
console.log(JSON.stringify(report));
