import { canonicalUnsignedOperation, assertOperationIdentity, compareBytes, operationId, payloadHash } from "../protocol/operation";
import { hexToBytes } from "../../shared/hex";
import {
  OperationKind,
  OPERATION_DISPOSITIONS,
  POMO_SUITE_1,
  POMO_SUITE_GENERATION_1,
  type AuthenticatedOperation,
  type FeedKey,
  type FrontierEntry,
  type KernelSummary,
  type OperationDisposition,
  type RejectedDisposition,
  type UnsignedOperation,
  type VerifiedCheckpoint,
} from "../protocol/types";

export interface OperationVerifier {
  verify(signedEnvelope: Uint8Array): Promise<AuthenticatedOperation>;
}
export interface OperationSigner {
  sign(operation: UnsignedOperation, payload: Uint8Array, canonicalUnsigned: Uint8Array, operationId: string): Promise<Uint8Array>;
}

export interface OperationJournal {
  /** Implementations must commit every entry or none of them. */
  recordBatch(entries: readonly OperationJournalEntry[]): Promise<void>;
  recordRejected?(rawWire: Uint8Array, disposition: RejectedDisposition): Promise<void>;
}

export interface OperationJournalEntry {
  readonly operation: AuthenticatedOperation;
  readonly disposition: OperationDisposition;
  readonly localAuthor: boolean;
}

export interface OperationMaterializer {
  validate(operation: AuthenticatedOperation): void;
  /** Validate and stage without changing visible state; the returned activation must be synchronous and infallible. */
  prepareReplace(
    checkpointPreferences: readonly { readonly key: string; readonly value: string }[],
    operations: readonly AuthenticatedOperation[],
  ): () => void;
  /** Implementations must validate the complete replacement before changing visible state. */
  replace(
    checkpointPreferences: readonly { readonly key: string; readonly value: string }[],
    operations: readonly AuthenticatedOperation[],
  ): void;
}

export interface AuthorRequest {
  readonly memberId: string;
  readonly deviceId: string;
  readonly incarnationId: string;
  readonly authorizationEpoch: number;
  readonly frontier: readonly FrontierEntry[];
  readonly payload: Uint8Array;
  readonly completePrerequisites: ReadonlySet<string>;
  readonly authorized: boolean;
  readonly deviceReady: boolean;
}

export type AuthorResult =
  | { readonly status: "BLOCKED_PREREQUISITE"; readonly missing: ReadonlySet<string> }
  | { readonly status: "AUTHORED"; readonly operation: AuthenticatedOperation; readonly disposition: OperationDisposition };

interface FeedState {
  head: number;
  headHash: string | null;
  forkedAt: number | null;
  accepted: Map<number, AuthenticatedOperation>;
  candidates: Map<number, AuthenticatedOperation>;
  pending: Map<number, AuthenticatedOperation>;
  checkpointIds: Map<number, string>;
}

interface KernelStateSnapshot {
  readonly feeds: Map<FeedKey, FeedState>;
  readonly knownIds: Set<string>;
  readonly quarantined: Set<string>;
  readonly checkpointPreferences: Map<string, string>;
}

export class OperationKernel {
  readonly #feeds = new Map<FeedKey, FeedState>();
  readonly #knownIds = new Set<string>();
  readonly #quarantined = new Set<string>();
  readonly #checkpointPreferences = new Map<string, string>();
  readonly #dispositionCounts = new Map<OperationDisposition, number>(
    OPERATION_DISPOSITIONS.map((disposition) => [disposition, 0] as const),
  );
  #mutationTail: Promise<void> = Promise.resolve();
  #uncommittedSnapshot: KernelStateSnapshot | null = null;

  constructor(
    private readonly verifier: OperationVerifier,
    private readonly signer: OperationSigner,
    private readonly journal: OperationJournal,
    private readonly materializer: OperationMaterializer,
  ) {}

  author(request: AuthorRequest): Promise<AuthorResult> {
    return this.#serializeMutation(() => this.#authorSerialized(request));
  }

  async #authorSerialized(request: AuthorRequest): Promise<AuthorResult> {
    const missing = new Set<string>();
    if (!request.authorized) missing.add("AUTHORIZATION");
    if (!request.deviceReady) missing.add("DEVICE_READY");
    if (!request.completePrerequisites.has("PROFILE_FRONTIER")) missing.add("PROFILE_FRONTIER");
    const feed = this.#feeds.get(this.#feedKey(request));
    if (feed?.forkedAt !== null && feed?.forkedAt !== undefined) missing.add("UNFORKED_FEED");
    if (feed !== undefined && feed.pending.size > 0) missing.add("COMPLETE_LOCAL_FEED");
    if (missing.size > 0) return { status: "BLOCKED_PREREQUISITE", missing };
    try {
      const operation: UnsignedOperation = {
        suite: POMO_SUITE_1,
        suiteGeneration: POMO_SUITE_GENERATION_1,
        memberId: request.memberId,
        deviceId: request.deviceId,
        incarnationId: request.incarnationId,
        sequence: (feed?.head ?? 0) + 1,
        previousHash: feed?.headHash ?? null,
        frontier: [...request.frontier].sort((left, right) =>
          compareBytes(hexToBytes(left.deviceId), hexToBytes(right.deviceId)) ||
          compareBytes(hexToBytes(left.incarnationId), hexToBytes(right.incarnationId))),
        authorizationEpoch: request.authorizationEpoch,
        payloadSchema: 1,
        kind: OperationKind.SharedPreferenceSet,
        payloadHash: await payloadHash(request.payload),
      };
      const canonical = canonicalUnsignedOperation(operation);
      const id = await operationId(canonical);
      const envelope = await this.signer.sign(operation, request.payload, canonical, id);
      const authenticated = await this.#authenticate(envelope);
      if (!equalBytes(authenticated.payload, request.payload) ||
          !equalBytes(authenticated.canonicalUnsigned, canonical) ||
          authenticated.operationId !== id ||
          !sameUnsignedOperation(authenticated.unsigned, operation)) {
        throw new Error("signer/verifier round trip changed the authored Operation");
      }
      const disposition = await this.#ingestAuthenticated(authenticated, true);
      if (disposition === "REJECTED_INVALID") throw new Error("locally authored Operation failed ingestion");
      return { status: "AUTHORED", operation: cloneAuthenticatedOperation(authenticated), disposition };
    } catch {
      return { status: "BLOCKED_PREREQUISITE", missing: new Set(["AUTHORING_COMMIT"]) };
    }
  }

  ingest(signedEnvelope: Uint8Array): Promise<OperationDisposition> {
    return this.#serializeMutation(async () => {
      try {
        return await this.#ingest(signedEnvelope, false);
      } catch {
        return "REJECTED_INVALID";
      }
    });
  }

  async #ingest(signedEnvelope: Uint8Array, localAuthor: boolean): Promise<OperationDisposition> {
    let operation: AuthenticatedOperation;
    try {
      operation = await this.verifier.verify(signedEnvelope);
      if (!equalBytes(operation.signedEnvelope, signedEnvelope)) throw new Error("verifier changed signed envelope");
    } catch {
      await this.#recordRejected(signedEnvelope, "REJECTED_INVALID");
      return "REJECTED_INVALID";
    }
    if (operation.unsigned.suite !== POMO_SUITE_1 ||
        operation.unsigned.suiteGeneration !== POMO_SUITE_GENERATION_1) {
      await this.#recordRejected(signedEnvelope, "REJECTED_UNSUPPORTED_SUITE");
      return "REJECTED_UNSUPPORTED_SUITE";
    }
    try {
      await assertOperationIdentity(operation.unsigned, operation.payload, operation.canonicalUnsigned, operation.operationId);
      this.materializer.validate(operation);
    } catch {
      await this.#recordRejected(signedEnvelope, "REJECTED_INVALID");
      return "REJECTED_INVALID";
    }
    return this.#ingestAuthenticated(operation, localAuthor);
  }

  async #authenticate(signedEnvelope: Uint8Array): Promise<AuthenticatedOperation> {
    const operation = await this.verifier.verify(signedEnvelope);
    if (!equalBytes(operation.signedEnvelope, signedEnvelope)) throw new Error("verifier changed signed envelope");
    await assertOperationIdentity(operation.unsigned, operation.payload, operation.canonicalUnsigned, operation.operationId);
    this.materializer.validate(operation);
    return operation;
  }

  async #ingestAuthenticated(operation: AuthenticatedOperation, localAuthor: boolean): Promise<OperationDisposition> {
    if (this.#knownIds.has(operation.operationId)) {
      await this.#recordBatch([{ operation, disposition: "DUPLICATE", localAuthor }]);
      return "DUPLICATE";
    }
    const key = this.#feedKey(operation.unsigned);
    const existingFeed = this.#feeds.get(key);
    const feed = existingFeed ?? this.#newFeed();

    const checkpointId = feed.checkpointIds.get(operation.unsigned.sequence);
    if (checkpointId !== undefined && checkpointId !== operation.operationId) {
      return this.#commitFork(key, feed, existingFeed !== undefined, checkpointId, operation, localAuthor);
    }
    const existing = feed.candidates.get(operation.unsigned.sequence);
    if (existing !== undefined && existing.operationId !== operation.operationId) {
      return this.#commitFork(key, feed, existingFeed !== undefined, existing.operationId, operation, localAuthor);
    }
    let disposition: OperationDisposition;
    if (feed.forkedAt !== null && operation.unsigned.sequence >= feed.forkedAt) {
      disposition = "QUARANTINED_FORK";
      await this.#recordBatch([{ operation, disposition, localAuthor }]);
      if (existingFeed === undefined) this.#feeds.set(key, feed);
      this.#knownIds.add(operation.operationId);
      feed.candidates.set(operation.unsigned.sequence, operation);
      this.#quarantined.add(operation.operationId);
    } else if (operation.unsigned.sequence <= feed.head) {
      disposition = "REJECTED_INVALID";
      await this.#recordBatch([{ operation, disposition, localAuthor }]);
    } else if (operation.unsigned.sequence !== feed.head + 1) {
      disposition = "PENDING_GAP";
      await this.#recordBatch([{ operation, disposition, localAuthor }]);
      if (existingFeed === undefined) this.#feeds.set(key, feed);
      this.#knownIds.add(operation.operationId);
      feed.candidates.set(operation.unsigned.sequence, operation);
      feed.pending.set(operation.unsigned.sequence, operation);
    } else if (operation.unsigned.previousHash !== feed.headHash) {
      disposition = "REJECTED_INVALID";
      await this.#recordBatch([{ operation, disposition, localAuthor }]);
    } else if (!this.#causalReady(operation)) {
      disposition = "PENDING_CAUSAL";
      await this.#recordBatch([{ operation, disposition, localAuthor }]);
      if (existingFeed === undefined) this.#feeds.set(key, feed);
      this.#knownIds.add(operation.operationId);
      feed.candidates.set(operation.unsigned.sequence, operation);
      feed.pending.set(operation.unsigned.sequence, operation);
    } else {
      disposition = "ACCEPTED";
      const snapshot = this.#captureState();
      this.#uncommittedSnapshot = snapshot;
      if (existingFeed === undefined) this.#feeds.set(key, feed);
      this.#knownIds.add(operation.operationId);
      feed.candidates.set(operation.unsigned.sequence, operation);
      this.#accept(feed, operation);
      const transitions = this.#drainAll();
      let activateMaterialization: () => void;
      try {
        activateMaterialization = this.materializer.prepareReplace(
          this.#checkpointPreferenceEntries(),
          this.#acceptedInMaterializationOrder(),
        );
        await this.#recordBatch([{ operation, disposition, localAuthor }, ...transitions]);
      } catch (error) {
        this.#restoreState(snapshot);
        this.#uncommittedSnapshot = null;
        throw error;
      }
      activateMaterialization();
      this.#uncommittedSnapshot = null;
    }
    return disposition;
  }

  summarize(): KernelSummary {
    const visibleFeeds = this.#uncommittedSnapshot?.feeds ?? this.#feeds;
    const visibleQuarantined = this.#uncommittedSnapshot?.quarantined ?? this.#quarantined;
    const heads = new Map<FeedKey, { sequence: number; headHash: string | null }>();
    const gaps = new Set<string>();
    const causalWaits = new Set<string>();
    const forks = new Set<string>();
    let accepted = 0;
    let pending = 0;
    for (const [key, feed] of [...visibleFeeds].sort(([left], [right]) => this.#compareFeedKeys(left, right))) {
      heads.set(key, { sequence: feed.head, headHash: feed.headHash });
      accepted += feed.checkpointIds.size + feed.accepted.size;
      pending += feed.pending.size;
      if (feed.pending.size > 0) {
        if (feed.pending.has(feed.head + 1)) causalWaits.add(`${key}@${feed.head + 1}`);
        else gaps.add(`${key}@${feed.head + 1}`);
      }
      if (feed.forkedAt !== null) forks.add(`${key}@${feed.forkedAt}`);
    }
    return {
      heads,
      gaps,
      causalWaits,
      forks,
      accepted,
      pending,
      quarantined: visibleQuarantined.size,
      dispositionCounts: new Map(this.#dispositionCounts),
    };
  }

  restore(checkpoint: VerifiedCheckpoint, trailing: readonly Uint8Array[]): Promise<"RESTORED" | "REJECTED_CHECKPOINT"> {
    return this.#serializeMutation(() => this.#restoreSerialized(checkpoint, trailing));
  }

  async #restoreSerialized(checkpoint: VerifiedCheckpoint, trailing: readonly Uint8Array[]): Promise<"RESTORED" | "REJECTED_CHECKPOINT"> {
    if (checkpoint.suite !== POMO_SUITE_1 || checkpoint.suiteGeneration !== POMO_SUITE_GENERATION_1) return "REJECTED_CHECKPOINT";
    let checkpointPreferences: Map<string, string>;
    try {
      checkpointPreferences = this.#validateCheckpointPreferences(checkpoint.materializedPreferences);
    } catch {
      return "REJECTED_CHECKPOINT";
    }
    const restored = new Map<FeedKey, FeedState>();
    for (const checkpointFeed of checkpoint.feeds) {
      try {
        this.#requireCheckpointFeed(checkpointFeed.deviceId, checkpointFeed.incarnationId, checkpointFeed.coveredOperationIds);
      } catch {
        return "REJECTED_CHECKPOINT";
      }
      const feedKey = this.#feedKey(checkpointFeed);
      if (restored.has(feedKey)) return "REJECTED_CHECKPOINT";
      const covered = new Map(checkpointFeed.coveredOperationIds.map((id, index) => [index + 1, id]));
      const count = checkpointFeed.coveredOperationIds.length;
      restored.set(feedKey, { ...this.#newFeed(), head: count, headHash: covered.get(count) ?? null, checkpointIds: covered });
    }
    const staged = new OperationKernel(this.verifier, this.signer, { recordBatch: async () => {} }, {
      validate: (operation) => this.materializer.validate(operation),
      prepareReplace: () => () => {},
      replace: () => {},
    });
    for (const [key, feed] of restored) {
      staged.#feeds.set(key, feed);
      for (const id of feed.checkpointIds.values()) staged.#knownIds.add(id);
    }
    for (const [key, value] of checkpointPreferences) staged.#checkpointPreferences.set(key, value);
    for (const envelope of trailing) {
      if (await staged.ingest(envelope) !== "ACCEPTED") return "REJECTED_CHECKPOINT";
    }
    const materialized = staged.#acceptedInMaterializationOrder();
    const trailingOperations = materialized.filter((operation) => !staged.#isCheckpointCovered(operation.operationId));
    const acceptedById = new Map(materialized.map((operation) => [operation.operationId, operation]));
    const checkpointFrontier = [...restored.entries()].flatMap(([feedKey, feed]) =>
      feed.headHash === null ? [] : [{ feedKey, sequence: feed.head, operationId: feed.headHash }],
    );
    if (trailingOperations.some((operation) =>
      !staged.#dominatesCheckpointFrontier(operation, checkpointFrontier, acceptedById))) {
      return "REJECTED_CHECKPOINT";
    }
    let activateMaterialization: () => void;
    try {
      activateMaterialization = this.materializer.prepareReplace(staged.#checkpointPreferenceEntries(), materialized);
    } catch {
      return "REJECTED_CHECKPOINT";
    }
    try {
      if (trailingOperations.length > 0) {
        await this.#recordBatch(trailingOperations.map((operation) => ({
          operation,
          disposition: "ACCEPTED" as const,
          localAuthor: false,
        })));
      }
    } catch {
      return "REJECTED_CHECKPOINT";
    }
    activateMaterialization();
    this.#feeds.clear();
    for (const [key, feed] of staged.#feeds) this.#feeds.set(key, this.#cloneFeed(feed));
    this.#knownIds.clear();
    for (const id of staged.#knownIds) this.#knownIds.add(id);
    this.#quarantined.clear();
    for (const id of staged.#quarantined) this.#quarantined.add(id);
    this.#checkpointPreferences.clear();
    for (const [key, value] of staged.#checkpointPreferences) this.#checkpointPreferences.set(key, value);
    return "RESTORED";
  }

  async #recordBatch(entries: readonly OperationJournalEntry[]): Promise<void> {
    await this.journal.recordBatch(entries);
    for (const entry of entries) this.#recordDisposition(entry.disposition);
  }

  async #recordRejected(rawWire: Uint8Array, disposition: RejectedDisposition): Promise<void> {
    await this.journal.recordRejected?.(rawWire.slice(), disposition);
    this.#recordDisposition(disposition);
  }

  #recordDisposition(disposition: OperationDisposition): void {
    this.#dispositionCounts.set(disposition, this.#dispositionCounts.get(disposition)! + 1);
  }

  #cloneFeed(feed: FeedState): FeedState {
    return {
      head: feed.head,
      headHash: feed.headHash,
      forkedAt: feed.forkedAt,
      accepted: new Map(feed.accepted),
      candidates: new Map(feed.candidates),
      pending: new Map(feed.pending),
      checkpointIds: new Map(feed.checkpointIds),
    };
  }

  #serializeMutation<T>(mutation: () => Promise<T>): Promise<T> {
    const result = this.#mutationTail.then(mutation, mutation);
    this.#mutationTail = result.then(() => {}, () => {});
    return result;
  }

  async #commitFork(
    key: FeedKey,
    feed: FeedState,
    feedExisted: boolean,
    conflictingId: string,
    incoming: AuthenticatedOperation,
    localAuthor: boolean,
  ): Promise<"QUARANTINED_FORK"> {
    const snapshot = this.#captureState();
    this.#uncommittedSnapshot = snapshot;
    if (!feedExisted) this.#feeds.set(key, feed);
    this.#knownIds.add(incoming.operationId);
    const transitioned = new Set<string>();
    const sameFeedReclassifications = this.#quarantineFork(
      feed,
      incoming.unsigned.sequence,
      conflictingId,
      incoming,
      transitioned,
    );
    const reclassifications = [
      ...sameFeedReclassifications,
      ...this.#quarantineUnavailableDependents(transitioned),
    ];
    let activateMaterialization: () => void;
    try {
      activateMaterialization = this.materializer.prepareReplace(
        this.#checkpointPreferenceEntries(),
        this.#acceptedInMaterializationOrder(),
      );
      await this.#recordBatch([
        { operation: incoming, disposition: "QUARANTINED_FORK", localAuthor },
        ...reclassifications,
      ]);
    } catch (error) {
      this.#restoreState(snapshot);
      this.#uncommittedSnapshot = null;
      throw error;
    }
    activateMaterialization();
    this.#uncommittedSnapshot = null;
    return "QUARANTINED_FORK";
  }

  #captureState(): KernelStateSnapshot {
    return {
      feeds: new Map([...this.#feeds].map(([key, feed]) => [key, this.#cloneFeed(feed)])),
      knownIds: new Set(this.#knownIds),
      quarantined: new Set(this.#quarantined),
      checkpointPreferences: new Map(this.#checkpointPreferences),
    };
  }

  #restoreState(snapshot: KernelStateSnapshot): void {
    this.#feeds.clear();
    for (const [key, feed] of snapshot.feeds) this.#feeds.set(key, feed);
    this.#knownIds.clear();
    for (const id of snapshot.knownIds) this.#knownIds.add(id);
    this.#quarantined.clear();
    for (const id of snapshot.quarantined) this.#quarantined.add(id);
    this.#checkpointPreferences.clear();
    for (const [key, value] of snapshot.checkpointPreferences) this.#checkpointPreferences.set(key, value);
  }

  #isCheckpointCovered(operationId: string): boolean {
    return [...this.#feeds.values()].some((feed) => [...feed.checkpointIds.values()].includes(operationId));
  }

  #newFeed(): FeedState {
    return { head: 0, headHash: null, forkedAt: null, accepted: new Map(), candidates: new Map(), pending: new Map(), checkpointIds: new Map() };
  }

  #feedKey(value: { readonly deviceId: string; readonly incarnationId: string }): FeedKey {
    return `${value.deviceId}:${value.incarnationId}`;
  }

  #compareFeedKeys(left: FeedKey, right: FeedKey): number {
    const [leftDevice, leftIncarnation] = left.split(":") as [string, string];
    const [rightDevice, rightIncarnation] = right.split(":") as [string, string];
    return compareBytes(hexToBytes(leftDevice), hexToBytes(rightDevice)) || compareBytes(hexToBytes(leftIncarnation), hexToBytes(rightIncarnation));
  }

  #requireCheckpointFeed(deviceId: string, incarnationId: string, ids: readonly string[]): void {
    if (!/^[0-9a-f]{64}$/.test(deviceId) || !/^[0-9a-f]{32}$/.test(incarnationId)) throw new Error("invalid checkpoint feed");
    const unique = new Set(ids);
    if (unique.size !== ids.length || ids.some((id) => !/^[0-9a-f]{64}$/.test(id))) throw new Error("invalid checkpoint coverage");
  }

  #validateCheckpointPreferences(
    preferences: readonly { readonly key: string; readonly value: string }[],
  ): Map<string, string> {
    const validated = new Map<string, string>();
    let previousKey: string | undefined;
    for (const preference of preferences) {
      this.#requireCanonicalText(preference.key, 1, 128, "checkpoint preference key");
      this.#requireCanonicalText(preference.value, 0, 4096, "checkpoint preference value");
      if (previousKey !== undefined && this.#compareUtf8(previousKey, preference.key) >= 0) {
        throw new Error("checkpoint preferences must have unique canonical key order");
      }
      validated.set(preference.key, preference.value);
      previousKey = preference.key;
    }
    return validated;
  }

  #requireCanonicalText(value: string, minimumBytes: number, maximumBytes: number, name: string): void {
    const byteLength = new TextEncoder().encode(value).length;
    if (hasLoneSurrogate(value) || value.normalize("NFC") !== value || byteLength < minimumBytes || byteLength > maximumBytes) {
      throw new Error(`${name} is outside the canonical text profile`);
    }
  }

  #compareUtf8(left: string, right: string): number {
    return compareBytes(new TextEncoder().encode(left), new TextEncoder().encode(right));
  }

  #accept(feed: FeedState, operation: AuthenticatedOperation): void {
    feed.pending.delete(operation.unsigned.sequence);
    feed.accepted.set(operation.unsigned.sequence, operation);
    feed.head = operation.unsigned.sequence;
    feed.headHash = operation.operationId;
  }

  #causalReady(operation: AuthenticatedOperation): boolean {
    return operation.unsigned.frontier.every((entry) => {
      const dependency = this.#feeds.get(this.#feedKey(entry));
      if (dependency === undefined || dependency.head < entry.sequence) return false;
      return (dependency.accepted.get(entry.sequence)?.operationId ?? dependency.checkpointIds.get(entry.sequence)) === entry.headHash;
    });
  }

  #drainAll(): OperationJournalEntry[] {
    const transitions: OperationJournalEntry[] = [];
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (const feed of this.#feeds.values()) {
        const next = feed.pending.get(feed.head + 1);
        if (next !== undefined && next.unsigned.previousHash !== feed.headHash) {
          feed.pending.delete(next.unsigned.sequence);
          feed.candidates.delete(next.unsigned.sequence);
          this.#knownIds.delete(next.operationId);
          transitions.push({ operation: next, disposition: "REJECTED_INVALID", localAuthor: false });
          advanced = true;
        } else if (next !== undefined && this.#causalReady(next)) {
          this.#accept(feed, next);
          transitions.push({ operation: next, disposition: "ACCEPTED", localAuthor: false });
          advanced = true;
        }
      }
    }
    return transitions;
  }

  #dependenciesSatisfied(
    operation: AuthenticatedOperation,
    acceptedById: ReadonlyMap<string, AuthenticatedOperation>,
  ): boolean {
    const previousHash = operation.unsigned.previousHash;
    if (operation.unsigned.sequence === 1) {
      if (previousHash !== null) return false;
    } else {
      if (previousHash === null) return false;
      const previous = acceptedById.get(previousHash);
      if (previous !== undefined) {
        if (previous.unsigned.deviceId !== operation.unsigned.deviceId ||
            previous.unsigned.incarnationId !== operation.unsigned.incarnationId ||
            previous.unsigned.sequence !== operation.unsigned.sequence - 1) return false;
      } else {
        const feed = this.#feeds.get(this.#feedKey(operation.unsigned));
        if (feed?.checkpointIds.get(operation.unsigned.sequence - 1) !== previousHash) return false;
      }
    }
    for (const frontier of operation.unsigned.frontier) {
      const dependency = acceptedById.get(frontier.headHash);
      if (dependency !== undefined) {
        if (dependency.unsigned.deviceId !== frontier.deviceId ||
            dependency.unsigned.incarnationId !== frontier.incarnationId ||
            dependency.unsigned.sequence !== frontier.sequence) return false;
      } else {
        const feed = this.#feeds.get(this.#feedKey(frontier));
        if (feed?.checkpointIds.get(frontier.sequence) !== frontier.headHash) return false;
      }
    }
    return true;
  }

  #dominatesCheckpointFrontier(
    operation: AuthenticatedOperation,
    checkpointFrontier: readonly { readonly feedKey: FeedKey; readonly sequence: number; readonly operationId: string }[],
    acceptedById: ReadonlyMap<string, AuthenticatedOperation>,
  ): boolean {
    return checkpointFrontier.every((target) =>
      this.#reachesCheckpointHead(operation, target, acceptedById, new Set()));
  }

  #reachesCheckpointHead(
    operation: AuthenticatedOperation,
    target: { readonly feedKey: FeedKey; readonly sequence: number; readonly operationId: string },
    acceptedById: ReadonlyMap<string, AuthenticatedOperation>,
    visited: Set<string>,
  ): boolean {
    if (visited.has(operation.operationId)) return false;
    visited.add(operation.operationId);
    const unsigned = operation.unsigned;
    if (this.#feedKey(unsigned) === target.feedKey && unsigned.sequence > target.sequence) return true;
    if (unsigned.frontier.some((entry) =>
      this.#feedKey(entry) === target.feedKey &&
      entry.sequence === target.sequence &&
      entry.headHash === target.operationId)) return true;
    if (unsigned.previousHash !== null) {
      const previous = acceptedById.get(unsigned.previousHash);
      if (previous !== undefined && this.#reachesCheckpointHead(previous, target, acceptedById, visited)) return true;
    }
    return unsigned.frontier.some((entry) => {
      const dependency = acceptedById.get(entry.headHash);
      return dependency !== undefined && this.#reachesCheckpointHead(dependency, target, acceptedById, visited);
    });
  }

  #quarantineUnavailableDependents(transitioned = new Set<string>()): OperationJournalEntry[] {
    const transitions: OperationJournalEntry[] = [];
    while (true) {
      const accepted = [...this.#feeds.values()].flatMap((feed) => [...feed.accepted.values()]);
      const acceptedById = new Map(accepted.map((operation) => [operation.operationId, operation]));
      const invalidByFeed = new Map<FeedKey, number>();
      const candidates = [...this.#feeds.values()].flatMap((feed) => [...feed.pending.values()]);
      for (const operation of [...accepted, ...candidates]) {
        if (this.#dependenciesSatisfied(operation, acceptedById) || !this.#referencesQuarantinedDependency(operation)) continue;
        const key = this.#feedKey(operation.unsigned);
        invalidByFeed.set(key, Math.min(invalidByFeed.get(key) ?? operation.unsigned.sequence, operation.unsigned.sequence));
      }
      if (invalidByFeed.size === 0) return transitions;
      for (const [key, sequence] of [...invalidByFeed].sort(([left], [right]) => this.#compareFeedKeys(left, right))) {
        const feed = this.#feeds.get(key)!;
        for (const [position, candidate] of feed.candidates) {
          if (position < sequence || transitioned.has(candidate.operationId)) continue;
          transitioned.add(candidate.operationId);
          transitions.push({ operation: candidate, disposition: "QUARANTINED_FORK", localAuthor: false });
        }
        this.#quarantineDependentFeedFrom(feed, sequence);
      }
    }
  }

  #referencesQuarantinedDependency(operation: AuthenticatedOperation): boolean {
    const dependencies = [
      ...(operation.unsigned.previousHash === null ? [] : [operation.unsigned.previousHash]),
      ...operation.unsigned.frontier.map(({ headHash }) => headHash),
    ];
    return dependencies.some((dependency) => this.#quarantined.has(dependency));
  }

  #quarantineDependentFeedFrom(feed: FeedState, sequence: number): void {
    feed.forkedAt = feed.forkedAt === null ? sequence : Math.min(feed.forkedAt, sequence);
    let invalidatedCheckpoint = false;
    for (const [position, id] of feed.checkpointIds) if (position >= feed.forkedAt) {
      feed.checkpointIds.delete(position);
      this.#quarantined.add(id);
      invalidatedCheckpoint = true;
    }
    if (invalidatedCheckpoint) this.#checkpointPreferences.clear();
    for (const [position, candidate] of feed.candidates) if (position >= feed.forkedAt) {
      this.#quarantined.add(candidate.operationId);
    }
    for (const position of [...feed.accepted.keys()]) if (position >= feed.forkedAt) feed.accepted.delete(position);
    for (const position of [...feed.pending.keys()]) if (position >= feed.forkedAt) feed.pending.delete(position);
    feed.head = Math.min(feed.head, feed.forkedAt - 1);
    feed.headHash = feed.accepted.get(feed.head)?.operationId ?? feed.checkpointIds.get(feed.head) ?? null;
  }

  #quarantineFork(
    feed: FeedState,
    sequence: number,
    existingId: string,
    incoming: AuthenticatedOperation,
    transitioned: Set<string>,
  ): OperationJournalEntry[] {
    feed.forkedAt = feed.forkedAt === null ? sequence : Math.min(feed.forkedAt, sequence);
    this.#quarantined.add(existingId);
    this.#quarantined.add(incoming.operationId);
    let invalidatedCheckpoint = false;
    for (const [position, id] of feed.checkpointIds) if (position >= feed.forkedAt) {
      feed.checkpointIds.delete(position);
      this.#quarantined.add(id);
      invalidatedCheckpoint = true;
    }
    if (invalidatedCheckpoint) this.#checkpointPreferences.clear();
    const transitions: OperationJournalEntry[] = [];
    for (const [position, operation] of feed.candidates) if (position >= feed.forkedAt) {
      this.#quarantined.add(operation.operationId);
      transitioned.add(operation.operationId);
      transitions.push({ operation, disposition: "QUARANTINED_FORK", localAuthor: false });
    }
    for (const [position, operation] of feed.accepted) if (position >= feed.forkedAt) {
      feed.accepted.delete(position);
      this.#quarantined.add(operation.operationId);
    }
    for (const [position, operation] of feed.pending) if (position >= feed.forkedAt) {
      feed.pending.delete(position);
      this.#quarantined.add(operation.operationId);
    }
    feed.head = Math.min(feed.head, feed.forkedAt - 1);
    feed.headHash = feed.accepted.get(feed.head)?.operationId ?? feed.checkpointIds.get(feed.head) ?? null;
    return transitions;
  }

  #checkpointPreferenceEntries(): readonly { readonly key: string; readonly value: string }[] {
    return [...this.#checkpointPreferences].map(([key, value]) => ({ key, value }));
  }

  #acceptedInMaterializationOrder(): AuthenticatedOperation[] {
    const accepted = [...this.#feeds.values()].flatMap((feed) => [...feed.accepted.values()]);
    const byId = new Map(accepted.map((operation) => [operation.operationId, operation]));
    const dependents = new Map<string, string[]>();
    const indegree = new Map(accepted.map((operation) => [operation.operationId, 0]));
    for (const operation of accepted) {
      if (!this.#dependenciesSatisfied(operation, byId)) throw new Error("accepted Operation dependency is unavailable");
      const dependencies = new Set<string>();
      if (operation.unsigned.previousHash !== null && byId.has(operation.unsigned.previousHash)) dependencies.add(operation.unsigned.previousHash);
      for (const frontier of operation.unsigned.frontier) if (byId.has(frontier.headHash)) dependencies.add(frontier.headHash);
      indegree.set(operation.operationId, dependencies.size);
      for (const dependency of dependencies) dependents.set(dependency, [...(dependents.get(dependency) ?? []), operation.operationId]);
    }
    const ready = accepted.filter((operation) => indegree.get(operation.operationId) === 0);
    const ordered: AuthenticatedOperation[] = [];
    while (ready.length > 0) {
      ready.sort((left, right) => compareBytes(hexToBytes(left.operationId), hexToBytes(right.operationId)));
      const operation = ready.shift()!;
      ordered.push(operation);
      for (const dependentId of dependents.get(operation.operationId) ?? []) {
        const remaining = indegree.get(dependentId)! - 1;
        indegree.set(dependentId, remaining);
        if (remaining === 0) ready.push(byId.get(dependentId)!);
      }
    }
    if (ordered.length !== accepted.length) throw new Error("accepted Operation dependency cycle");
    return ordered;
  }
}

function cloneAuthenticatedOperation(operation: AuthenticatedOperation): AuthenticatedOperation {
  return {
    unsigned: {
      ...operation.unsigned,
      frontier: operation.unsigned.frontier.map((entry) => ({ ...entry })),
    },
    payload: operation.payload.slice(),
    canonicalUnsigned: operation.canonicalUnsigned.slice(),
    operationId: operation.operationId,
    signedEnvelope: operation.signedEnvelope.slice(),
  };
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function sameUnsignedOperation(left: UnsignedOperation, right: UnsignedOperation): boolean {
  return left.suite === right.suite &&
    left.suiteGeneration === right.suiteGeneration &&
    left.memberId === right.memberId &&
    left.deviceId === right.deviceId &&
    left.incarnationId === right.incarnationId &&
    left.sequence === right.sequence &&
    left.previousHash === right.previousHash &&
    left.authorizationEpoch === right.authorizationEpoch &&
    left.payloadSchema === right.payloadSchema &&
    left.kind === right.kind &&
    left.payloadHash === right.payloadHash &&
    left.frontier.length === right.frontier.length &&
    left.frontier.every((entry, index) => {
      const expected = right.frontier[index];
      return expected !== undefined &&
        entry.deviceId === expected.deviceId &&
        entry.incarnationId === expected.incarnationId &&
        entry.sequence === expected.sequence &&
        entry.headHash === expected.headHash;
    });
}

function hasLoneSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      if (index + 1 >= value.length) return true;
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return true;
      index++;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
