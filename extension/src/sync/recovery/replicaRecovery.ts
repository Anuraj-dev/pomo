export interface FrontierHead { readonly feedKey: string; readonly sequence: number; readonly operationId: string }
export interface CheckpointManifest {
  readonly checkpointId: string; readonly kind: "ROUTINE" | "RECOVERY" | "SAFETY"; readonly frontier: readonly FrontierHead[];
  readonly materializerVersion: number; readonly projectionRoot: string; readonly packIds: readonly string[]; readonly blobIds: readonly string[];
}
export interface PackedOperation { readonly operationId: string; readonly feedKey: string; readonly sequence: number; readonly wire: Uint8Array }
export interface JournalPack { readonly packId: string; readonly prefix: FrontierHead; readonly operations: readonly PackedOperation[] }

export function validateCheckpoint(manifest: CheckpointManifest): void {
  const sorted = [...manifest.frontier].sort((left, right) => left.feedKey.localeCompare(right.feedKey));
  if (sorted.some((entry, index) => entry.feedKey !== manifest.frontier[index]?.feedKey) || new Set(sorted.map((entry) => entry.feedKey)).size !== sorted.length) throw new Error("checkpoint frontier must be unique and sorted");
  if (!Number.isSafeInteger(manifest.materializerVersion) || manifest.materializerVersion < 1 || manifest.projectionRoot.length === 0) throw new Error("invalid checkpoint roots");
  if (new Set(manifest.packIds).size !== manifest.packIds.length || new Set(manifest.blobIds).size !== manifest.blobIds.length) throw new Error("duplicate checkpoint objects");
}

export function validateJournalPack(pack: JournalPack, forkedFeeds: ReadonlySet<string>): void {
  if (forkedFeeds.has(pack.prefix.feedKey) || pack.operations.length === 0) throw new Error("pack prefix is not replaceable");
  for (let index = 0; index < pack.operations.length; index++) {
    const operation = pack.operations[index]!;
    if (operation.feedKey !== pack.prefix.feedKey || operation.sequence !== index + 1) throw new Error("pack must be a complete feed prefix");
  }
  if (pack.operations.at(-1)?.operationId !== pack.prefix.operationId || new Set(pack.operations.map((operation) => operation.operationId)).size !== pack.operations.length) throw new Error("invalid pack head");
}

export interface RecoverySource { readonly sourceId: string; readonly checkpoint: CheckpointManifest | null; readonly operations: readonly PackedOperation[] }
export interface RehydrationPlan {
  readonly checkpoint: CheckpointManifest | null; readonly operations: readonly PackedOperation[];
  readonly sourceByOperation: ReadonlyMap<string, ReadonlySet<string>>; readonly gaps: ReadonlySet<string>;
}

export function planRehydration(sources: readonly RecoverySource[]): RehydrationPlan {
  const checkpoints = [...new Map(sources.flatMap((source) => source.checkpoint === null ? [] : [[source.checkpoint.checkpointId, source.checkpoint] as const])).values()];
  checkpoints.forEach(validateCheckpoint);
  const dominates = (left: CheckpointManifest, right: CheckpointManifest): boolean => {
    const rightHeads = new Map(right.frontier.map((head) => [head.feedKey, head]));
    return [...rightHeads.values()].every((rightHead) => {
      const leftHead = left.frontier.find((head) => head.feedKey === rightHead.feedKey);
      return leftHead !== undefined && (leftHead.sequence > rightHead.sequence ||
        (leftHead.sequence === rightHead.sequence && leftHead.operationId === rightHead.operationId));
    });
  };
  const maximal = checkpoints.filter((candidate) => checkpoints.every((other) => other === candidate || !dominates(other, candidate)));
  if (maximal.length > 1) throw new Error("recovery checkpoints are incomparable");
  checkpoints.splice(0, checkpoints.length, ...maximal);
  const copies = new Map<string, Array<{ sourceId: string; operation: PackedOperation }>>();
  for (const source of sources) for (const operation of source.operations) copies.set(operation.operationId, [...(copies.get(operation.operationId) ?? []), { sourceId: source.sourceId, operation }]);
  const operations: PackedOperation[] = [];
  const sourceByOperation = new Map<string, ReadonlySet<string>>();
  for (const [operationId, candidates] of copies) {
    const first = candidates[0]!.operation;
    if (candidates.some(({ operation }) => !equalBytes(first.wire, operation.wire))) throw new Error("Operation ID collision");
    operations.push(first);
    sourceByOperation.set(operationId, new Set(candidates.map(({ sourceId }) => sourceId)));
  }
  operations.sort((left, right) => left.feedKey.localeCompare(right.feedKey) || left.sequence - right.sequence);
  const gaps = new Set<string>();
  const feeds = new Map<string, PackedOperation[]>();
  for (const operation of operations) feeds.set(operation.feedKey, [...(feeds.get(operation.feedKey) ?? []), operation]);
  for (const [feed, values] of feeds) {
    const sequences = new Set(values.map((operation) => operation.sequence));
    for (let sequence = 1; sequence <= Math.max(...sequences); sequence++) if (!sequences.has(sequence)) gaps.add(`${feed}@${sequence}`);
  }
  return { checkpoint: checkpoints.at(-1) ?? null, operations, sourceByOperation, gaps };
}

export type IntegrityFailure = "PROJECTION_CORRUPT" | "JOURNAL_CORRUPT" | "DEVICE_KEY_MISSING";
export function integrityDisposition(failure: IntegrityFailure): { readonly active: boolean; readonly incarnationSealed: boolean; readonly inspectionAllowed: true; readonly exportAllowed: true } {
  return { active: failure !== "PROJECTION_CORRUPT", incarnationSealed: failure !== "PROJECTION_CORRUPT", inspectionAllowed: true, exportAllowed: true };
}
export function quarantineThresholdExceeded(quarantined: number, suspendedFeeds: number): boolean { return quarantined > 1_000 || suspendedFeeds > 16; }
function equalBytes(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && left.every((value, index) => value === right[index]); }
