import { describe, expect, test } from "bun:test";
import { authorizeForwardRestore, compareHistoricalValues, openRecoveryArtifact, prepareForwardRestore, sealRecoveryArchive, sealRecoveryFile, validateRecoveryArchiveManifest } from "../../src/sync/recovery/recoveryArtifacts";
import { encodeCanonicalCbor } from "../../src/sync/protocol/cbor";

describe("Recovery artifacts and forward restore", () => {
  test("encrypts bounded files and archives and rejects corruption", async () => {
    const file = await sealRecoveryFile({ protectedAuthority: new Uint8Array([1, 2]), recoveryGeneration: 4, frontierEvidence: ["a@3"], capabilityLocators: ["cap"], mailboxLocators: ["mail"] }, "correct horse");
    expect((await openRecoveryArtifact(file, "correct horse")).length).toBeGreaterThan(0);
    const corrupt = { ...file, ciphertextAndTag: file.ciphertextAndTag.slice() }; corrupt.ciphertextAndTag[0]! ^= 1;
    await expect(openRecoveryArtifact(corrupt, "correct horse")).rejects.toThrow();
    const archive = encodeCanonicalCbor([1, "manifest"]); expect(await openRecoveryArtifact(await sealRecoveryArchive(archive, "correct horse"), "correct horse")).toEqual(archive);
  });

  test("archive authority and restore confirmations fail closed", () => {
    const manifest = { archiveId: "archive", recoveryGeneration: 2, checkpointIds: ["checkpoint"], packIds: ["pack"], blobIds: ["blob"], manifestDigest: new Uint8Array(32), credentialProof: null };
    validateRecoveryArchiveManifest(manifest, false);
    expect(() => validateRecoveryArchiveManifest(manifest, true)).toThrow(/credentials/);
    const plan = prepareForwardRestore("safety", [{ domain: "HISTORY", targetId: "session", compensatingPayload: new Uint8Array([1]) }]);
    expect(() => authorizeForwardRestore(plan, "AGENT", false, { humanConfirmed: true, independentConfirmed: false })).toThrow(/independent/);
    expect(() => prepareForwardRestore("safety", [{ domain: "ACTIVE_PHASE", targetId: "phase", compensatingPayload: new Uint8Array([1]) }])).toThrow(/rewind/);
  });

  test("compares domain causality, never row timestamps", () => {
    const older = { domain: "PROFILE" as const, targetId: "me", causalVersion: 1, operationId: "op-z", value: null };
    expect(compareHistoricalValues(older, { ...older, causalVersion: 2, operationId: "op-a" })).toBeLessThan(0);
  });
});
