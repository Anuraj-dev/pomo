import { bufferOf } from "../../shared/bytes";
import { bytesToHex, hexToBytes } from "../../shared/hex";
import { sha256, verifyP256LowS } from "../crypto/PomoCrypto";
import { encodeCanonicalCbor } from "../protocol/cbor";
import { POMO_SUITE_1, POMO_SUITE_GENERATION_1 } from "../protocol/types";
import type {
  ContentEpochAdvance,
  DeviceCertificate,
  GenesisRecord,
  RecoveryCertificate,
  RecoveryRotationMode,
} from "./types";

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function requireP256PublicKey(value: Uint8Array, name: string): void {
  if (value.length !== 65 || value[0] !== 4) throw new Error(`${name} must be an uncompressed P-256 public key`);
}

async function domainId(domain: string, canonicalBody: Uint8Array): Promise<string> {
  return bytesToHex(await sha256(encodeCanonicalCbor([domain, 1, canonicalBody])));
}

export async function createDeviceCertificate(
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
): Promise<DeviceCertificate> {
  requireP256PublicKey(signingPublicKey, "Device signing public key");
  requireP256PublicKey(agreementPublicKey, "Device agreement public key");
  if (equalBytes(signingPublicKey, agreementPublicKey)) throw new Error("Device signing and agreement authorities must be distinct");
  const canonicalBody = encodeCanonicalCbor([1, POMO_SUITE_1, signingPublicKey, agreementPublicKey]);
  return {
    version: 1,
    suite: POMO_SUITE_1,
    signingPublicKey: signingPublicKey.slice(),
    agreementPublicKey: agreementPublicKey.slice(),
    canonicalBody,
    deviceId: await domainId("Pomo Device ID", canonicalBody),
  };
}

export async function createRecoveryCertificate(
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
): Promise<RecoveryCertificate> {
  requireP256PublicKey(signingPublicKey, "Recovery signing public key");
  requireP256PublicKey(agreementPublicKey, "Recovery agreement public key");
  if (equalBytes(signingPublicKey, agreementPublicKey)) throw new Error("Recovery signing and agreement authorities must be distinct");
  const canonicalBody = encodeCanonicalCbor([1, POMO_SUITE_1, signingPublicKey, agreementPublicKey]);
  return {
    version: 1,
    suite: POMO_SUITE_1,
    signingPublicKey: signingPublicKey.slice(),
    agreementPublicKey: agreementPublicKey.slice(),
    canonicalBody,
    recoveryId: await domainId("Pomo Recovery ID", canonicalBody),
  };
}

export function genesisProofMessage(canonicalBody: Uint8Array): Uint8Array {
  return encodeCanonicalCbor(["Pomo Genesis Proof", 1, canonicalBody]);
}

export async function createGenesisRecord(
  recovery: RecoveryCertificate,
  firstDevice: DeviceCertificate,
  recoveryProof: Uint8Array,
  deviceProof: Uint8Array,
): Promise<GenesisRecord> {
  const checkedRecovery = await createRecoveryCertificate(recovery.signingPublicKey, recovery.agreementPublicKey);
  const checkedDevice = await createDeviceCertificate(firstDevice.signingPublicKey, firstDevice.agreementPublicKey);
  if (checkedRecovery.recoveryId !== recovery.recoveryId || checkedDevice.deviceId !== firstDevice.deviceId) {
    throw new Error("Genesis certificate fingerprint mismatch");
  }
  const canonicalBody = encodeCanonicalCbor([
    1,
    POMO_SUITE_1,
    POMO_SUITE_GENERATION_1,
    1,
    recovery.canonicalBody,
    firstDevice.canonicalBody,
  ]);
  const proofMessage = genesisProofMessage(canonicalBody);
  const [recoverySigningKey, deviceSigningKey] = await Promise.all([
    crypto.subtle.importKey("raw", bufferOf(recovery.signingPublicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
    crypto.subtle.importKey("raw", bufferOf(firstDevice.signingPublicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]),
  ]);
  if (!(await verifyP256LowS(recoverySigningKey, proofMessage, recoveryProof)) ||
      !(await verifyP256LowS(deviceSigningKey, proofMessage, deviceProof))) {
    throw new Error("Genesis proof signature mismatch");
  }
  return {
    version: 1,
    suite: POMO_SUITE_1,
    suiteGeneration: POMO_SUITE_GENERATION_1,
    recoveryGeneration: 1,
    recovery,
    firstDevice,
    canonicalBody,
    recoveryProof: recoveryProof.slice(),
    deviceProof: deviceProof.slice(),
    canonicalRecord: encodeCanonicalCbor([canonicalBody, recoveryProof, deviceProof]),
    memberId: await domainId("Pomo Member ID", canonicalBody),
  };
}

export async function admissionTranscriptHash(
  memberId: string,
  admissionId: string,
  certificate: DeviceCertificate,
): Promise<string> {
  const checked = await createDeviceCertificate(certificate.signingPublicKey, certificate.agreementPublicKey);
  if (checked.deviceId !== certificate.deviceId) throw new Error("Admission Device fingerprint mismatch");
  return bytesToHex(await sha256(encodeCanonicalCbor([
    "Pomo Device Admission",
    1,
    hexToBytes(memberId),
    hexToBytes(admissionId),
    certificate.canonicalBody,
  ])));
}

export function encodeDeviceAdmitFact(
  memberId: string,
  admissionId: string,
  transcriptHash: string,
  certificate: DeviceCertificate,
  nextAuthorizationEpoch: number,
  contentEpochAdvance: ContentEpochAdvance,
): Uint8Array {
  return encodeCanonicalCbor([1, hexToBytes(memberId), hexToBytes(admissionId), hexToBytes(transcriptHash), certificate.canonicalBody,
    nextAuthorizationEpoch, contentEpochAdvance.canonicalBody]);
}

export function encodeDeviceReadyFact(
  memberId: string,
  deviceId: string,
  authorizationEpoch: number,
  baselineFrontierDigest: string,
  contentEpoch: number,
): Uint8Array {
  return encodeCanonicalCbor([1, hexToBytes(memberId), hexToBytes(deviceId), authorizationEpoch,
    hexToBytes(baselineFrontierDigest), contentEpoch]);
}

export function encodeDeviceRevokeFact(
  memberId: string,
  targetDeviceId: string,
  nextAuthorizationEpoch: number,
  contentEpochAdvance: ContentEpochAdvance,
): Uint8Array {
  return encodeCanonicalCbor([1, hexToBytes(memberId), hexToBytes(targetDeviceId), nextAuthorizationEpoch,
    contentEpochAdvance.canonicalBody]);
}

export function encodeRecoveryRotateFact(
  memberId: string,
  mode: RecoveryRotationMode,
  nextRecoveryGeneration: number,
  recovery: RecoveryCertificate,
  contentEpochAdvance: ContentEpochAdvance,
): Uint8Array {
  return encodeCanonicalCbor([1, hexToBytes(memberId), mode === "NORMAL" ? 1 : 2, nextRecoveryGeneration,
    recovery.canonicalBody, contentEpochAdvance.canonicalBody]);
}

export function encodeRecoveryResetFact(
  memberId: string,
  nextRecoveryGeneration: number,
  recovery: RecoveryCertificate,
  freshDevice: DeviceCertificate,
  nextAuthorizationEpoch: number,
  contentEpochAdvance: ContentEpochAdvance,
): Uint8Array {
  return encodeCanonicalCbor([1, hexToBytes(memberId), nextRecoveryGeneration, recovery.canonicalBody,
    freshDevice.canonicalBody, nextAuthorizationEpoch, contentEpochAdvance.canonicalBody]);
}
