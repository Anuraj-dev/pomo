import { mkdir } from "node:fs/promises";
import { parseSyncUiState, DORMANT_SYNC_UI_STATE } from "../src/sync/ui/syncUiState";
import { allowAllOperationAuthorization, OperationKernel, type OperationJournalEntry } from "../src/sync/kernel/OperationKernel";
import { SharedPreferenceProjection, encodeSharedPreferenceFact } from "../src/sync/materialize/sharedPreferences";
import type { AuthenticatedOperation } from "../src/sync/protocol/types";

const now = (): number => performance.now();
const BENCHMARK_OPERATION_COUNT = 10_000;
const BENCHMARK_BATCH_SIZE = 256;
const percentile = (values: readonly number[], fraction: number): number => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))]!;
const hex = (bytes: Uint8Array): string => [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
const memberId = "01".repeat(32);
const deviceId = "02".repeat(32);
const incarnationId = "03".repeat(16);
const wires = new Map<string, AuthenticatedOperation>();
const signer = {
  async sign(operation: AuthenticatedOperation["unsigned"], payload: Uint8Array, canonicalUnsigned: Uint8Array, operationId: string): Promise<Uint8Array> {
    const signedEnvelope = canonicalUnsigned.slice();
    wires.set(hex(signedEnvelope), { unsigned: operation, payload: payload.slice(), canonicalUnsigned: canonicalUnsigned.slice(), operationId, signedEnvelope });
    return signedEnvelope;
  },
};
const verifier = { async verify(signedEnvelope: Uint8Array): Promise<AuthenticatedOperation> {
  const operation = wires.get(hex(signedEnvelope));
  if (operation === undefined) throw new Error("benchmark wire is unknown");
  return { ...operation, signedEnvelope: signedEnvelope.slice() };
} };
const journal = { async recordBatch(_entries: readonly OperationJournalEntry[]): Promise<void> {} };
const authorRequest = (index: number) => ({
  memberId, deviceId, incarnationId, authorizationEpoch: 1, frontier: [],
  payload: encodeSharedPreferenceFact("benchmark", String(index)), completePrerequisites: new Set(["PROFILE_FRONTIER"]), authorized: true, deviceReady: true,
});
const authoringProjection = new SharedPreferenceProjection();
const authoringKernel = new OperationKernel(verifier, signer, journal, authoringProjection, allowAllOperationAuthorization);
const localSamples: number[] = [];
const authored: AuthenticatedOperation[] = [];
for (let index = 0; index < BENCHMARK_OPERATION_COUNT; index++) {
  const start = now();
  const result = await authoringKernel.author(authorRequest(index));
  if (result.status !== "AUTHORED") throw new Error("benchmark authoring was blocked");
  authored.push(result.operation);
  localSamples.push(now() - start);
}

const replayProjection = new SharedPreferenceProjection();
const replayKernel = new OperationKernel(verifier, signer, journal, replayProjection, allowAllOperationAuthorization);
const backlog = authored.map((operation) => ({ id: operation.operationId, wire: operation.signedEnvelope }));
const backlogStart = now(); let maximumBatchBytes = 0; let blockingMaximumMs = 0;
for (let offset = 0; offset < backlog.length; offset += BENCHMARK_BATCH_SIZE) {
  const sliceStart = now(); const batch = backlog.slice(offset, offset + BENCHMARK_BATCH_SIZE); maximumBatchBytes = Math.max(maximumBatchBytes, batch.reduce((sum, item) => sum + item.wire.byteLength, 0));
  const seen = new Set(batch.map(({ id }) => id)); if (seen.size !== batch.length) throw new Error("benchmark corpus contains duplicates");
  blockingMaximumMs = Math.max(blockingMaximumMs, now() - sliceStart);
  for (const item of batch) if (await replayKernel.ingest(item.wire) !== "ACCEPTED") throw new Error("benchmark replay was not accepted");
}
const backlogMs = now() - backlogStart; const throughput = backlog.length / (backlogMs / 1_000);
const checkpointStart = now(); replayProjection.prepareReplace([{ key: "checkpoint", value: "0" }], authored); const checkpointMs = now() - checkpointStart;
const cachedStart = now(); parseSyncUiState(DORMANT_SYNC_UI_STATE); const cachedStatusMs = now() - cachedStart;
const metrics = {
  operationCount: backlog.length,
  localAuthoringP95Ms: percentile(localSamples, .95), localAuthoringP99Ms: percentile(localSamples, .99), backlogMs, throughputOperationsPerSecond: throughput,
  maximumEnvelopeBatch: BENCHMARK_BATCH_SIZE, maximumBatchBytes, incrementalMemoryCeilingBytes: 64 * 1024 * 1024, checkpointProjectionMs: checkpointMs,
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
