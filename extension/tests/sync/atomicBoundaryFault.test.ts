import "../helpers/db";

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { DB_NAME } from "../../src/db/schema";
import { encodeSharedPreferenceFact } from "../../src/sync/materialize/sharedPreferences";
import { canonicalUnsignedOperation, operationId, payloadHash } from "../../src/sync/protocol/operation";
import { OperationKind } from "../../src/sync/protocol/types";
import { IndexedDbOperationDao } from "../../src/sync/storage/IndexedDbOperationDao";

const fixture = await Bun.file(new URL("../../../sync-protocol/fixtures/fault-boundaries.json", import.meta.url)).json() as { readonly version: number; readonly boundaries: readonly string[] };

async function deleteDatabase(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("test database deletion blocked"));
  });
}

describe("atomic durability and activation fault injection", () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  test("every declared boundary is named and a journal commit crash stays on the old durable state", async () => {
    expect(fixture.version).toBe(1);
    expect(fixture.boundaries).toEqual([
      "operation_commit",
      "outbox_publish",
      "ack_commit",
      "authorization_epoch",
      "checkpoint_install",
      "recovery_anchor",
      "migration_inventory",
      "activation_frontier",
      "legacy_archive_seal",
      "storage_generation_upgrade",
    ]);
    const payload = encodeSharedPreferenceFact("timer.sound", "bell");
    const unsigned = {
      suite: 1,
      suiteGeneration: 1,
      memberId: "00".repeat(32),
      deviceId: "11".repeat(32),
      incarnationId: "22".repeat(16),
      sequence: 1,
      previousHash: null,
      frontier: [],
      authorizationEpoch: 1,
      payloadSchema: 1,
      kind: OperationKind.SharedPreferenceSet,
      payloadHash: await payloadHash(payload),
    } as const;
    const canonicalUnsigned = canonicalUnsignedOperation(unsigned);
    const id = await operationId(canonicalUnsigned);
    const operation = {
      unsigned,
      payload,
      canonicalUnsigned,
      operationId: id,
      signedEnvelope: canonicalUnsigned.slice(),
    };
    const dao = new IndexedDbOperationDao();
    const before = await dao.reconstruct();
    await expect(dao.commit({
      operation,
      disposition: "ACCEPTED",
      localAuthor: true,
    }, (point) => {
      if (point === "BEFORE_COMMIT") throw new Error("injected operation_commit");
    })).rejects.toThrow("injected operation_commit");
    expect(await new IndexedDbOperationDao().reconstruct()).toEqual(before);
  });
});
