import { describe, expect, test } from "bun:test";
import { AuthorizationLedger, classifyRevokedOperation } from "../../src/sync/identity/AuthorizationLedger";
import { AdmissionSession } from "../../src/sync/identity/AdmissionSession";
import {
  admissionTranscriptHash,
  generateLocalDeviceIdentity,
  generateLocalRecoveryAuthority,
  memberGenesis,
} from "../../src/sync/identity/MemberIdentity";
import type { DeviceCertificate, GenesisRecord, RecoveryCertificate } from "../../src/sync/identity/types";

const frontier = [{
  deviceId: "11".repeat(32),
  incarnationId: "22".repeat(16),
  sequence: 1,
  headHash: "33".repeat(32),
}] as const;

function certificate(deviceId: string): DeviceCertificate {
  return {
    version: 1,
    suite: 1,
    signingPublicKey: new Uint8Array(65).fill(1),
    agreementPublicKey: new Uint8Array(65).fill(2),
    canonicalBody: new Uint8Array([1]),
    deviceId,
  };
}

function recovery(recoveryId: string): RecoveryCertificate {
  return {
    version: 1,
    suite: 1,
    signingPublicKey: new Uint8Array(65).fill(3),
    agreementPublicKey: new Uint8Array(65).fill(4),
    canonicalBody: new Uint8Array([2]),
    recoveryId,
  };
}

function genesis(firstDevice: DeviceCertificate): GenesisRecord {
  return {
    version: 1,
    suite: 1,
    suiteGeneration: 1,
    recoveryGeneration: 1,
    recovery: recovery("44".repeat(32)),
    firstDevice,
    canonicalBody: new Uint8Array([1]),
    recoveryProof: new Uint8Array(64),
    deviceProof: new Uint8Array(64),
    canonicalRecord: new Uint8Array([1]),
    memberId: "00".repeat(32),
  };
}

describe("Member Identity and causal authorization", () => {
  test("generates independent non-transferable Device keys and stable Genesis identity", async () => {
    const device = await generateLocalDeviceIdentity();
    const recoveryAuthority = await generateLocalRecoveryAuthority();
    expect(device.signingPrivateKey.extractable).toBeFalse();
    expect(device.agreementPrivateKey.extractable).toBeFalse();
    await expect(crypto.subtle.exportKey("jwk", device.agreementPrivateKey)).rejects.toThrow();
    expect(device.certificate.signingPublicKey).not.toEqual(device.certificate.agreementPublicKey);

    const first = await memberGenesis(recoveryAuthority.certificate, device.certificate);
    const replay = await memberGenesis(recoveryAuthority.certificate, device.certificate);
    expect(first.memberId).toBe(replay.memberId);
    expect(await admissionTranscriptHash(first.memberId, "55".repeat(32), device.certificate)).toHaveLength(64);
  });

  test("keeps authorization separate from readiness and classifies causal revocation", () => {
    const first = certificate("11".repeat(32));
    const joining = certificate("22".repeat(32));
    const ledger = new AuthorizationLedger(genesis(first));
    expect(ledger.markReady({
      factId: "a1-mismatched-baseline",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      deviceId: first.deviceId,
      authorizationEpoch: 1,
      contentEpoch: 1,
      baselineFrontier: [{ ...frontier[0]!, headHash: "44".repeat(32) }],
      verifiedBaselineFrontier: frontier,
      ledgerFrontier: new Set(),
    })).toBe("REJECTED_INVALID");
    expect(ledger.markReady({
      factId: "a1",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      deviceId: first.deviceId,
      authorizationEpoch: 1,
      contentEpoch: 1,
      baselineFrontier: frontier,
      verifiedBaselineFrontier: frontier,
      ledgerFrontier: new Set(),
    })).toBe("ACCEPTED");
    expect(ledger.admit({
      factId: "a2",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      certificate: joining,
      authorizationEpoch: 2,
      contentEpoch: 2,
      ledgerFrontier: new Set(["a1"]),
    })).toBe("ACCEPTED");
    const rotatedRecovery = recovery("55".repeat(32));
    expect(ledger.recoveryRotate({
      factId: "a2-rotate",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      recoveryVerified: true,
      recoveryGeneration: 2,
      recoveryRotateMode: "NORMAL",
      recovery: rotatedRecovery,
      ledgerFrontier: new Set(["a1", "a2"]),
    })).toBe("ACCEPTED");
    expect(ledger.snapshot().recoveryGeneration).toBe(2);
    expect(ledger.snapshot().devices.get(joining.deviceId)?.deviceReady).toBeFalse();
    expect(ledger.markReady({
      factId: "a2-ready",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      deviceId: joining.deviceId,
      authorizationEpoch: 2,
      contentEpoch: 2,
      baselineFrontier: frontier,
      verifiedBaselineFrontier: frontier,
      ledgerFrontier: new Set(["a1"]),
    })).toBe("REJECTED_INVALID");
    expect(ledger.revoke({
      factId: "a3",
      memberId: "00".repeat(32),
      issuerDeviceId: first.deviceId,
      targetDeviceId: joining.deviceId,
      authorizationEpoch: 3,
      contentEpoch: 3,
      ledgerFrontier: new Set(["a1", "a2"]),
    })).toBe("ACCEPTED");

    const common = {
      operationMemberId: "00".repeat(32),
      operationDeviceId: joining.deviceId,
      memberId: "00".repeat(32),
      targetDeviceId: joining.deviceId,
      revocationFactId: "a3",
      capturedTargetFrontier: new Set(["before"]),
    };
    expect(classifyRevokedOperation({ ...common, operationId: "before", operationAuthorityFrontier: new Set() }))
      .toBe("NORMAL_VALIDATION");
    expect(classifyRevokedOperation({ ...common, operationId: "after", operationAuthorityFrontier: new Set(["a3"]) }))
      .toBe("REJECT_KNOWINGLY_LATER");
    expect(classifyRevokedOperation({ ...common, operationId: "concurrent", operationAuthorityFrontier: new Set() }))
      .toBe("QUARANTINE_CONCURRENT");
  });

  test("never auto-merges a different Member Identity and advances recovery forward", () => {
    const first = certificate("11".repeat(32));
    const fresh = certificate("33".repeat(32));
    const ledger = new AuthorizationLedger(genesis(first));
    expect(ledger.admit({
      factId: "foreign",
      memberId: "ff".repeat(32),
      issuerDeviceId: first.deviceId,
      certificate: fresh,
      authorizationEpoch: 2,
      contentEpoch: 2,
      ledgerFrontier: new Set(),
    })).toBe("QUARANTINED_DIFFERENT_MEMBER");
    expect(ledger.recoveryReset({
      factId: "reset",
      memberId: "00".repeat(32),
      recoveryVerified: true,
      recoveryGeneration: 2,
      recovery: recovery("55".repeat(32)),
      freshDevice: fresh,
      authorizationEpoch: 2,
      contentEpoch: 2,
      ledgerFrontier: new Set(),
    })).toBe("ACCEPTED");
    expect(ledger.snapshot().devices.get(first.deviceId)?.authorized).toBeFalse();
    expect(ledger.snapshot().devices.get(fresh.deviceId)?.deviceReady).toBeFalse();
  });

  test("resumes admission without skipping fingerprint, authorization, baseline, or readiness", () => {
    const initial = {
      memberId: "00".repeat(32),
      admissionId: "11".repeat(32),
      deviceId: "22".repeat(32),
      transcriptHash: "33".repeat(32),
      stage: "OFFER_CREATED" as const,
    };
    const admission = new AdmissionSession(initial);
    expect(() => admission.verifyFingerprints(initial.memberId, "ff".repeat(32), initial.transcriptHash)).toThrow(/Device/);
    admission.verifyFingerprints(initial.memberId, initial.deviceId, initial.transcriptHash);
    const resumed = new AdmissionSession(admission.snapshot());
    expect(() => resumed.advance("BASELINE_VERIFIED")).toThrow(/skipped/);
    resumed.advance("INVENTORY_COMPLETE");
    resumed.advance("LOCAL_EXPORT_SAVED");
    resumed.advance("RECOVERY_ANCHOR_CREATED");
    resumed.advance("PLAN_APPROVED");
    resumed.advance("AUTHORIZATION_COMMITTED");
    resumed.advance("BASELINE_VERIFIED");
    resumed.advance("READY_ACK_COMMITTED");
    expect(resumed.snapshot().stage).toBe("READY_ACK_COMMITTED");
  });

  test("blocks a different Member Identity before authorization", () => {
    const admission = new AdmissionSession({
      memberId: "00".repeat(32),
      admissionId: "11".repeat(32),
      deviceId: "22".repeat(32),
      transcriptHash: "33".repeat(32),
      stage: "OFFER_CREATED",
    });
    admission.verifyFingerprints("00".repeat(32), "22".repeat(32), "33".repeat(32));
    admission.blockDifferentMember();
    expect(admission.snapshot().stage).toBe("IDENTITY_BLOCKED");
    expect(() => admission.advance("INVENTORY_COMPLETE")).toThrow(/Blocked identity/);
  });
});
