import { describe, expect, test } from "bun:test";
import { bytesToHex } from "../../src/shared/hex";
import { OperationKernel, type AuthorRequest, type OperationJournal, type OperationJournalEntry, type OperationMaterializer, type OperationSigner, type OperationVerifier } from "../../src/sync/kernel/OperationKernel";
import { SharedPreferenceProjection, encodeSharedPreferenceFact } from "../../src/sync/materialize/sharedPreferences";
import { canonicalUnsignedOperation, operationId, payloadHash } from "../../src/sync/protocol/operation";
import { OperationKind, type AuthenticatedOperation, type OperationDisposition, POMO_SUITE_1, POMO_SUITE_GENERATION_1, type UnsignedOperation } from "../../src/sync/protocol/types";

const MEMBER = "00".repeat(32);
const DEVICE = "11".repeat(32);
const INCARNATION = "22".repeat(16);
const fixtureRoot = new URL("../../../sync-protocol/", import.meta.url);
const operationFixture = ((await Bun.file(new URL("fixtures/operation.json", fixtureRoot)).json()) as {
  readonly cases: readonly {
    readonly expected: {
      readonly summary: { readonly accepted: number; readonly pending: number; readonly quarantined: number; readonly rejected: number };
    };
  }[];
}).cases[0]!;

class FixtureCrypto implements OperationSigner, OperationVerifier {
  readonly operations = new Map<string, AuthenticatedOperation>();

  async sign(operation: AuthenticatedOperation["unsigned"], payload: Uint8Array, canonicalUnsigned: Uint8Array, operationId: string): Promise<Uint8Array> {
    const envelope = new TextEncoder().encode(operationId);
    this.operations.set(bytesToHex(envelope), { operationId, unsigned: operation, payload, canonicalUnsigned, signedEnvelope: envelope });
    return envelope;
  }

  async verify(envelope: Uint8Array): Promise<AuthenticatedOperation> {
    const operation = this.operations.get(bytesToHex(envelope));
    if (operation === undefined) throw new Error("invalid fixture signature");
    return operation;
  }
}

class TamperingVerifier implements OperationVerifier {
  constructor(private readonly delegate: OperationVerifier) {}

  async verify(envelope: Uint8Array): Promise<AuthenticatedOperation> {
    const verified = await this.delegate.verify(envelope);
    return { ...verified, unsigned: { ...verified.unsigned, frontier: [...verified.unsigned.frontier].reverse() } };
  }
}

class MemoryJournal implements OperationJournal {
  readonly records: Array<{ readonly id: string; readonly disposition: OperationDisposition }> = [];
  failNextBatch = false;
  #deferred: {
    readonly entered: Promise<void>;
    readonly markEntered: () => void;
    readonly wait: Promise<void>;
    readonly release: () => void;
    readonly fail: (error: Error) => void;
  } | null = null;

  deferNextBatch(): { readonly entered: Promise<void>; readonly release: () => void; readonly fail: (error: Error) => void } {
    let markEntered!: () => void;
    let release!: () => void;
    let fail!: (error: Error) => void;
    const entered = new Promise<void>((resolve) => { markEntered = resolve; });
    const wait = new Promise<void>((resolve, reject) => { release = resolve; fail = reject; });
    this.#deferred = { entered, markEntered, wait, release, fail };
    return { entered, release, fail };
  }

  async recordBatch(entries: readonly OperationJournalEntry[]): Promise<void> {
    if (this.failNextBatch) {
      this.failNextBatch = false;
      throw new Error("durable journal unavailable");
    }
    const deferred = this.#deferred;
    if (deferred !== null) {
      this.#deferred = null;
      deferred.markEntered();
      await deferred.wait;
    }
    this.records.push(...entries.map(({ operation, disposition }) => ({ id: operation.operationId, disposition })));
  }
}

class FailingJournal implements OperationJournal {
  async recordBatch(): Promise<void> {
    throw new Error("durable journal unavailable");
  }
}

class ControllableMaterializer implements OperationMaterializer {
  readonly projection = new SharedPreferenceProjection();
  failNextPreparation = false;

  validate(operation: AuthenticatedOperation): void {
    this.projection.validate(operation);
  }

  prepareAccepted(operations: readonly AuthenticatedOperation[]): () => void {
    if (this.failNextPreparation) {
      this.failNextPreparation = false;
      throw new Error("staged projection rejected");
    }
    return this.projection.prepareAccepted(operations);
  }

  prepareReplace(
    checkpointPreferences: readonly { readonly key: string; readonly value: string }[],
    operations: readonly AuthenticatedOperation[],
  ): () => void {
    if (this.failNextPreparation) {
      this.failNextPreparation = false;
      throw new Error("staged projection rejected");
    }
    return this.projection.prepareReplace(checkpointPreferences, operations);
  }

  replace(
    checkpointPreferences: readonly { readonly key: string; readonly value: string }[],
    operations: readonly AuthenticatedOperation[],
  ): void {
    this.projection.replace(checkpointPreferences, operations);
  }
}

function harness(): { kernel: OperationKernel; crypto: FixtureCrypto; journal: MemoryJournal; projection: SharedPreferenceProjection } {
  const crypto = new FixtureCrypto();
  const journal = new MemoryJournal();
  const projection = new SharedPreferenceProjection();
  return { kernel: new OperationKernel(crypto, crypto, journal, projection), crypto, journal, projection };
}

function request(value = "25"): AuthorRequest {
  return {
    memberId: MEMBER,
    deviceId: DEVICE,
    incarnationId: INCARNATION,
    authorizationEpoch: 1,
    frontier: [],
    payload: encodeSharedPreferenceFact("focusDurationMinutes", value),
    completePrerequisites: new Set(["AUTHORIZATION", "PROFILE_FRONTIER"]),
    authorized: true,
    deviceReady: true,
  };
}

async function signedOperation(
  crypto: FixtureCrypto,
  sequence: number,
  previousHash: string | null,
  value: string,
): Promise<Uint8Array> {
  const payload = encodeSharedPreferenceFact("focusDurationMinutes", value);
  const unsigned: UnsignedOperation = {
    suite: POMO_SUITE_1,
    suiteGeneration: POMO_SUITE_GENERATION_1,
    memberId: MEMBER,
    deviceId: DEVICE,
    incarnationId: INCARNATION,
    sequence,
    previousHash,
    frontier: [],
    authorizationEpoch: 1,
    payloadSchema: 1,
    kind: OperationKind.SharedPreferenceSet,
    payloadHash: await payloadHash(payload),
  };
  const canonical = canonicalUnsignedOperation(unsigned);
  return crypto.sign(unsigned, payload, canonical, await operationId(canonical));
}

async function signedCrossFeedOperation(
  crypto: FixtureCrypto,
  deviceId: string,
  incarnationId: string,
  value: string,
  frontier: readonly { readonly deviceId: string; readonly incarnationId: string; readonly sequence: number; readonly headHash: string }[],
): Promise<AuthenticatedOperation> {
  const payload = encodeSharedPreferenceFact("focusDurationMinutes", value);
  const unsigned: UnsignedOperation = {
    suite: POMO_SUITE_1,
    suiteGeneration: POMO_SUITE_GENERATION_1,
    memberId: MEMBER,
    deviceId,
    incarnationId,
    sequence: 1,
    previousHash: null,
    frontier,
    authorizationEpoch: 1,
    payloadSchema: 1,
    kind: OperationKind.SharedPreferenceSet,
    payloadHash: await payloadHash(payload),
  };
  const canonical = canonicalUnsignedOperation(unsigned);
  const id = await operationId(canonical);
  const signedEnvelope = await crypto.sign(unsigned, payload, canonical, id);
  return { operationId: id, unsigned, payload, canonicalUnsigned: canonical, signedEnvelope };
}

describe("OperationKernel four-call seam", () => {
  test("author signs, journals, ingests, summarizes, and materializes one dormant fact", async () => {
    const { kernel, journal, projection } = harness();
    const result = await kernel.author(request());
    expect(result.status).toBe("AUTHORED");
    expect(result.status === "AUTHORED" && result.disposition).toBe("ACCEPTED");
    expect(journal.records).toHaveLength(1);
    expect(kernel.summarize()).toMatchObject({
      accepted: operationFixture.expected.summary.accepted,
      pending: operationFixture.expected.summary.pending,
      quarantined: operationFixture.expected.summary.quarantined,
    });
    expect(journal.records.filter(({ disposition }) => disposition === "REJECTED_INVALID")).toHaveLength(
      operationFixture.expected.summary.rejected,
    );
    expect(projection.value("focusDurationMinutes")).toBe("25");
  });

  test("returns a detached authored operation snapshot", async () => {
    const { kernel, projection } = harness();
    const result = await kernel.author(request("25"));
    if (result.status !== "AUTHORED") throw new Error("fixture authoring was blocked");

    result.operation.payload.fill(0);
    expect(projection.value("focusDurationMinutes")).toBe("25");
    expect((await kernel.author(request("30"))).status).toBe("AUTHORED");
    expect(projection.value("focusDurationMinutes")).toBe("30");
  });

  test("serializes overlapping author calls per feed before assigning positions", async () => {
    const { kernel } = harness();
    const [first, second] = await Promise.all([
      kernel.author(request("25")),
      kernel.author(request("30")),
    ]);
    if (first.status !== "AUTHORED" || second.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    expect(first.operation.unsigned.sequence).toBe(1);
    expect(second.operation.unsigned.sequence).toBe(2);
    expect(first.operation.unsigned.previousHash).toBeNull();
    expect(second.operation.unsigned.previousHash).toBe(first.operation.operationId);
    expect(kernel.summarize()).toMatchObject({ accepted: 2, pending: 0, quarantined: 0 });
  });

  test("keeps optimistic acceptance invisible and does not erase a queued ingest after journal failure", async () => {
    const { kernel, crypto, journal, projection } = harness();
    const remote = await signedOperation(crypto, 1, null, "30");
    const deferred = journal.deferNextBatch();
    const failedAuthor = kernel.author(request("25"));
    await deferred.entered;
    const queuedIngest = kernel.ingest(remote);

    expect(kernel.summarize()).toMatchObject({ accepted: 0, pending: 0, quarantined: 0 });
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
    deferred.fail(new Error("deferred journal failure"));
    expect(await failedAuthor).toEqual({ status: "BLOCKED_PREREQUISITE", missing: new Set(["AUTHORING_COMMIT"]) });
    expect(await queuedIngest).toBe("ACCEPTED");
    expect(kernel.summarize()).toMatchObject({ accepted: 1, pending: 0, quarantined: 0 });
    expect(projection.value("focusDurationMinutes")).toBe("30");
  });

  test("materializes causal dependencies before a lower-ID dependent Operation", async () => {
    const { kernel, crypto, projection } = harness();
    const prerequisiteDevice = "33".repeat(32);
    const dependentDevice = "44".repeat(32);
    const prerequisiteIncarnation = "55".repeat(16);
    const dependentIncarnation = "66".repeat(16);
    let prerequisite!: AuthenticatedOperation;
    let dependent!: AuthenticatedOperation;
    for (let attempt = 0; attempt < 256; attempt++) {
      prerequisite = await signedCrossFeedOperation(
        crypto,
        prerequisiteDevice,
        prerequisiteIncarnation,
        `stale-${attempt}`,
        [],
      );
      dependent = await signedCrossFeedOperation(
        crypto,
        dependentDevice,
        dependentIncarnation,
        "causally-new",
        [{
          deviceId: prerequisiteDevice,
          incarnationId: prerequisiteIncarnation,
          sequence: 1,
          headHash: prerequisite.operationId,
        }],
      );
      if (dependent.operationId < prerequisite.operationId) break;
    }
    expect(dependent.operationId < prerequisite.operationId).toBe(true);
    expect(await kernel.ingest(dependent.signedEnvelope)).toBe("PENDING_CAUSAL");
    expect(await kernel.ingest(prerequisite.signedEnvelope)).toBe("ACCEPTED");
    expect(projection.value("focusDurationMinutes")).toBe("causally-new");
  });

  test("cascades quarantine when a fork invalidates an accepted causal dependency", async () => {
    const { kernel, crypto, projection } = harness();
    const prerequisiteDevice = "33".repeat(32);
    const dependentDevice = "44".repeat(32);
    const prerequisiteIncarnation = "55".repeat(16);
    const dependentIncarnation = "66".repeat(16);
    const prerequisite = await signedCrossFeedOperation(crypto, prerequisiteDevice, prerequisiteIncarnation, "old", []);
    const dependent = await signedCrossFeedOperation(crypto, dependentDevice, dependentIncarnation, "new", [{
      deviceId: prerequisiteDevice,
      incarnationId: prerequisiteIncarnation,
      sequence: 1,
      headHash: prerequisite.operationId,
    }]);
    const conflicting = await signedCrossFeedOperation(crypto, prerequisiteDevice, prerequisiteIncarnation, "fork", []);
    expect(await kernel.ingest(prerequisite.signedEnvelope)).toBe("ACCEPTED");
    expect(await kernel.ingest(dependent.signedEnvelope)).toBe("ACCEPTED");
    expect(projection.value("focusDurationMinutes")).toBe("new");

    expect(await kernel.ingest(conflicting.signedEnvelope)).toBe("QUARANTINED_FORK");
    expect(kernel.summarize()).toMatchObject({ accepted: 0, pending: 0, quarantined: 3 });
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
    expect(await kernel.ingest(dependent.signedEnvelope)).toBe("DUPLICATE");
    expect(await kernel.author({
      ...request("blocked"),
      deviceId: dependentDevice,
      incarnationId: dependentIncarnation,
    })).toEqual({ status: "BLOCKED_PREREQUISITE", missing: new Set(["UNFORKED_FEED"]) });
  });

  test("cascades quarantine through a pending dependent with another missing dependency", async () => {
    const { kernel, crypto } = harness();
    const prerequisiteDevice = "33".repeat(32);
    const dependentDevice = "44".repeat(32);
    const prerequisiteIncarnation = "55".repeat(16);
    const dependentIncarnation = "66".repeat(16);
    const missingDevice = "77".repeat(32);
    const prerequisite = await signedCrossFeedOperation(crypto, prerequisiteDevice, prerequisiteIncarnation, "old", []);
    const pending = await signedCrossFeedOperation(crypto, dependentDevice, dependentIncarnation, "pending", [
      { deviceId: prerequisiteDevice, incarnationId: prerequisiteIncarnation, sequence: 1, headHash: prerequisite.operationId },
      { deviceId: missingDevice, incarnationId: "88".repeat(16), sequence: 1, headHash: "99".repeat(32) },
    ]);
    const conflicting = await signedCrossFeedOperation(crypto, prerequisiteDevice, prerequisiteIncarnation, "fork", []);

    expect(await kernel.ingest(pending.signedEnvelope)).toBe("PENDING_CAUSAL");
    expect(await kernel.ingest(prerequisite.signedEnvelope)).toBe("ACCEPTED");
    expect(kernel.summarize()).toMatchObject({ accepted: 1, pending: 1, quarantined: 0 });
    expect(await kernel.ingest(conflicting.signedEnvelope)).toBe("QUARANTINED_FORK");
    expect(kernel.summarize()).toMatchObject({ accepted: 0, pending: 0, quarantined: 3 });
  });

  test("keeps a fork invisible until its atomic quarantine batch commits", async () => {
    const { kernel, crypto, journal, projection } = harness();
    const first = await kernel.author(request("25"));
    if (first.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    const conflicting = await signedOperation(crypto, 1, null, "30");
    const deferred = journal.deferNextBatch();
    const quarantining = kernel.ingest(conflicting);
    await deferred.entered;
    expect(kernel.summarize()).toMatchObject({ accepted: 1, pending: 0, quarantined: 0 });
    expect(projection.value("focusDurationMinutes")).toBe("25");
    deferred.release();
    expect(await quarantining).toBe("QUARANTINED_FORK");
    const quarantinedIds = journal.records
      .filter(({ disposition }) => disposition === "QUARANTINED_FORK")
      .map(({ id }) => id);
    expect(quarantinedIds).toContain(first.operation.operationId);
    expect(quarantinedIds).toContain(new TextDecoder().decode(conflicting));
    expect(kernel.summarize()).toMatchObject({ accepted: 0, pending: 0, quarantined: 2 });
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
  });

  test("blocks incomplete authoring and rejects an unauthenticated envelope", async () => {
    const { kernel } = harness();
    expect(await kernel.author({ ...request(), completePrerequisites: new Set(["AUTHORIZATION"]) })).toEqual({
      status: "BLOCKED_PREREQUISITE",
      missing: new Set(["PROFILE_FRONTIER"]),
    });
    expect(await kernel.ingest(new Uint8Array([1, 2, 3]))).toBe("REJECTED_INVALID");
  });

  test("accumulates every blocked author prerequisite using the shared tokens", async () => {
    const { kernel, crypto } = harness();
    expect(await kernel.ingest(await signedOperation(crypto, 2, "aa".repeat(32), "30"))).toBe("PENDING_GAP");
    expect(await kernel.author({
      ...request(),
      authorized: false,
      deviceReady: false,
      completePrerequisites: new Set<string>(),
    })).toEqual({
      status: "BLOCKED_PREREQUISITE",
      missing: new Set(["AUTHORIZATION", "DEVICE_READY", "PROFILE_FRONTIER", "COMPLETE_LOCAL_FEED"]),
    });
  });

  test("returns only the authenticated verifier result from authoring", async () => {
    const crypto = new FixtureCrypto();
    const projection = new SharedPreferenceProjection();
    const kernel = new OperationKernel(new TamperingVerifier(crypto), crypto, new MemoryJournal(), projection);
    expect(await kernel.author({
      ...request(),
      frontier: [
        { deviceId: "33".repeat(32), incarnationId: "44".repeat(16), sequence: 1, headHash: "55".repeat(32) },
        { deviceId: "66".repeat(32), incarnationId: "77".repeat(16), sequence: 1, headHash: "88".repeat(32) },
      ],
    })).toEqual({
      status: "BLOCKED_PREREQUISITE",
      missing: new Set(["AUTHORING_COMMIT"]),
    });
    expect(kernel.summarize().accepted).toBe(0);
  });

  test("deduplicates replay and restores a verified covered feed", async () => {
    const { kernel, crypto, projection } = harness();
    const authored = await kernel.author(request());
    if (authored.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    expect(await kernel.ingest(authored.operation.signedEnvelope)).toBe("DUPLICATE");
    expect(await kernel.restore({
      suite: POMO_SUITE_1,
      suiteGeneration: POMO_SUITE_GENERATION_1,
      feeds: [{ deviceId: DEVICE, incarnationId: INCARNATION, coveredOperationIds: [authored.operation.operationId] }],
      materializedPreferences: [{ key: "focusDurationMinutes", value: "25" }],
    }, [])).toBe("RESTORED");
    expect(kernel.summarize()).toMatchObject({ accepted: 1, pending: 0, quarantined: 0 });
    expect(projection.value("focusDurationMinutes")).toBe("25");

    expect(await kernel.ingest(await signedOperation(crypto, 3, authored.operation.operationId, "30"))).toBe("PENDING_GAP");
    expect(await kernel.ingest(await signedOperation(crypto, 3, authored.operation.operationId, "35"))).toBe("QUARANTINED_FORK");
    expect(projection.value("focusDurationMinutes")).toBe("25");

    const restoredAgain = await kernel.restore({
      suite: POMO_SUITE_1,
      suiteGeneration: POMO_SUITE_GENERATION_1,
      feeds: [{ deviceId: DEVICE, incarnationId: INCARNATION, coveredOperationIds: [authored.operation.operationId] }],
      materializedPreferences: [{ key: "focusDurationMinutes", value: "25" }],
    }, []);
    expect(restoredAgain).toBe("RESTORED");
    expect(await kernel.ingest(await signedOperation(crypto, 1, null, "30"))).toBe("QUARANTINED_FORK");
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
  });

  test("rejects unsupported checkpoint generation without changing state", async () => {
    const { kernel } = harness();
    await kernel.author(request());
    expect(await kernel.restore({ suite: 1, suiteGeneration: 2, feeds: [] } as never, [])).toBe("REJECTED_CHECKPOINT");
    expect(kernel.summarize().accepted).toBe(1);
  });

  test("rejects a concurrent trailing Operation that does not causally descend from the checkpoint frontier", async () => {
    const { kernel, crypto, journal, projection } = harness();
    const coveredOperationId = "77".repeat(32);
    const concurrent = await signedCrossFeedOperation(
      crypto,
      "33".repeat(32),
      "44".repeat(16),
      "30",
      [],
    );

    expect(await kernel.restore({
      suite: POMO_SUITE_1,
      suiteGeneration: POMO_SUITE_GENERATION_1,
      feeds: [{ deviceId: DEVICE, incarnationId: INCARNATION, coveredOperationIds: [coveredOperationId] }],
      materializedPreferences: [{ key: "focusDurationMinutes", value: "25" }],
    }, [concurrent.signedEnvelope])).toBe("REJECTED_CHECKPOINT");

    expect(journal.records).toEqual([]);
    expect(kernel.summarize().heads.size).toBe(0);
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
  });

  test("does not expose accepted state when durable journal recording fails", async () => {
    const crypto = new FixtureCrypto();
    const projection = new SharedPreferenceProjection();
    const kernel = new OperationKernel(crypto, crypto, new FailingJournal(), projection);
    expect(await kernel.author(request())).toEqual({
      status: "BLOCKED_PREREQUISITE",
      missing: new Set(["AUTHORING_COMMIT"]),
    });
    expect(kernel.summarize().accepted).toBe(0);
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
  });

  test("maps an ingest journal failure to rejected without exposing optimistic state", async () => {
    const crypto = new FixtureCrypto();
    const projection = new SharedPreferenceProjection();
    const kernel = new OperationKernel(crypto, crypto, new FailingJournal(), projection);
    const envelope = await signedOperation(crypto, 1, null, "25");
    expect(await kernel.ingest(envelope)).toBe("REJECTED_INVALID");
    expect(kernel.summarize().accepted).toBe(0);
    expect(projection.value("focusDurationMinutes")).toBeUndefined();
  });

  test("does not fabricate missing feed positions when future pending candidates fork", async () => {
    const { kernel, crypto } = harness();
    const first = await kernel.author(request());
    if (first.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    const firstOperation = first.operation;

    async function signedFuture(value: string): Promise<Uint8Array> {
      const payload = encodeSharedPreferenceFact("focusDurationMinutes", value);
      const unsigned: UnsignedOperation = {
        suite: POMO_SUITE_1,
        suiteGeneration: POMO_SUITE_GENERATION_1,
        memberId: MEMBER,
        deviceId: DEVICE,
        incarnationId: INCARNATION,
        sequence: 5,
        previousHash: firstOperation.operationId,
        frontier: [],
        authorizationEpoch: 1,
        payloadSchema: 1,
        kind: OperationKind.SharedPreferenceSet,
        payloadHash: await payloadHash(payload),
      };
      const canonical = canonicalUnsignedOperation(unsigned);
      const id = await operationId(canonical);
      return crypto.sign(unsigned, payload, canonical, id);
    }

    expect(await kernel.ingest(await signedFuture("30"))).toBe("PENDING_GAP");
    expect(await kernel.ingest(await signedFuture("35"))).toBe("QUARANTINED_FORK");
    expect([...kernel.summarize().heads.values()]).toEqual([{ sequence: 1, headHash: firstOperation.operationId }]);
  });

  test("stages the complete restore and leaves active state unchanged on a trailing duplicate", async () => {
    const { kernel, projection } = harness();
    const authored = await kernel.author(request());
    if (authored.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    expect(await kernel.restore({ suite: 1, suiteGeneration: 1, feeds: [], materializedPreferences: [] }, [
      authored.operation.signedEnvelope,
      authored.operation.signedEnvelope,
    ])).toBe("REJECTED_CHECKPOINT");
    expect(kernel.summarize().accepted).toBe(1);
    expect(projection.value("focusDurationMinutes")).toBe("25");
  });

  test("atomically journals every accepted trailing restore Operation before activation", async () => {
    const { kernel, crypto, journal, projection } = harness();
    const active = await kernel.author(request("25"));
    if (active.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    const beforeSummary = kernel.summarize();
    const beforeRecords = [...journal.records];
    const trailing = await signedOperation(crypto, 1, null, "30");
    journal.failNextBatch = true;

    expect(await kernel.restore({ suite: 1, suiteGeneration: 1, feeds: [], materializedPreferences: [] }, [trailing]))
      .toBe("REJECTED_CHECKPOINT");
    expect(journal.records).toEqual(beforeRecords);
    expect(kernel.summarize()).toEqual(beforeSummary);
    expect(projection.value("focusDurationMinutes")).toBe("25");

    expect(await kernel.restore({ suite: 1, suiteGeneration: 1, feeds: [], materializedPreferences: [] }, [trailing]))
      .toBe("RESTORED");
    expect(journal.records.slice(beforeRecords.length)).toEqual([{
      id: crypto.operations.get(bytesToHex(trailing))!.operationId,
      disposition: "ACCEPTED",
    }]);
    expect(projection.value("focusDurationMinutes")).toBe("30");
  });

  test("rejects a complete trailing projection before writing its journal batch", async () => {
    const crypto = new FixtureCrypto();
    const journal = new MemoryJournal();
    const materializer = new ControllableMaterializer();
    const kernel = new OperationKernel(crypto, crypto, journal, materializer);
    const active = await kernel.author(request("25"));
    if (active.status !== "AUTHORED") throw new Error("fixture authoring was blocked");
    const beforeRecords = [...journal.records];
    const trailing = await signedOperation(crypto, 1, null, "30");
    materializer.failNextPreparation = true;

    expect(await kernel.restore({ suite: 1, suiteGeneration: 1, feeds: [], materializedPreferences: [] }, [trailing]))
      .toBe("REJECTED_CHECKPOINT");
    expect(journal.records).toEqual(beforeRecords);
    expect(kernel.summarize().accepted).toBe(1);
    expect(materializer.projection.value("focusDurationMinutes")).toBe("25");
  });

  test("drops a now-immediate pending candidate with the wrong predecessor and allows identical replay", async () => {
    const { kernel, crypto } = harness();
    const wrongPrevious = "aa".repeat(32);
    const invalidSecond = await signedOperation(crypto, 2, wrongPrevious, "30");
    const first = await signedOperation(crypto, 1, null, "25");

    expect(await kernel.ingest(invalidSecond)).toBe("PENDING_GAP");
    expect(await kernel.ingest(first)).toBe("ACCEPTED");
    const afterDrain = kernel.summarize();
    expect(afterDrain).toMatchObject({ accepted: 1, pending: 0, quarantined: 0 });

    expect(await kernel.ingest(invalidSecond)).toBe("REJECTED_INVALID");
    expect(kernel.summarize()).toMatchObject({
      accepted: afterDrain.accepted,
      pending: afterDrain.pending,
      quarantined: afterDrain.quarantined,
    });
    expect(kernel.summarize().dispositionCounts.get("REJECTED_INVALID")).toBe(2);
  });

  test("rejects non-canonical checkpoint preference projections without changing active state", async () => {
    const { kernel, projection } = harness();
    await kernel.author(request());
    const invalidPreferences = [
      [{ key: "z", value: "1" }, { key: "a", value: "2" }],
      [{ key: "a", value: "1" }, { key: "a", value: "2" }],
      [{ key: "é".repeat(65), value: "1" }],
      [{ key: "\ud800", value: "1" }],
    ] as const;
    for (const materializedPreferences of invalidPreferences) {
      expect(await kernel.restore({ suite: 1, suiteGeneration: 1, feeds: [], materializedPreferences }, [])).toBe("REJECTED_CHECKPOINT");
      expect(projection.value("focusDurationMinutes")).toBe("25");
    }
  });
});
