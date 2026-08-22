import { compareBytes } from "../protocol/operation";
import { encodeCanonicalCbor } from "../protocol/cbor";
import { bytesToHex, hexToBytes } from "../../shared/hex";
import {
  generateHpkeRecipientKeyPair,
  serializeHpkePublicKey,
  sha256,
} from "../crypto/PomoCrypto";
import { POMO_SUITE_1, POMO_SUITE_GENERATION_1, type FrontierEntry } from "../protocol/types";
import type { DeviceCertificate, RecoveryCertificate } from "./types";
export type { DeviceCertificate, RecoveryCertificate } from "./types";

export interface LocalDeviceIdentity {
  readonly certificate: DeviceCertificate;
  readonly signingPrivateKey: CryptoKey;
  readonly agreementPrivateKey: CryptoKey;
}

export interface LocalRecoveryAuthority {
  readonly certificate: RecoveryCertificate;
  readonly signingPrivateKey: CryptoKey;
  readonly agreementPrivateKey: CryptoKey;
}

export interface MemberGenesis {
  readonly version: 1;
  readonly suite: typeof POMO_SUITE_1;
  readonly suiteGeneration: typeof POMO_SUITE_GENERATION_1;
  readonly recoveryGeneration: 1;
  readonly recovery: RecoveryCertificate;
  readonly firstDevice: DeviceCertificate;
  readonly canonicalBody: Uint8Array;
  readonly memberId: string;
}

export type AdmissionStage =
  | "OFFER_CREATED"
  | "MUTUAL_FINGERPRINT_VERIFIED"
  | "INVENTORY_COMPLETE"
  | "LOCAL_EXPORT_SAVED"
  | "RECOVERY_ANCHOR_CREATED"
  | "PLAN_APPROVED"
  | "AUTHORIZATION_COMMITTED"
  | "BASELINE_VERIFIED"
  | "READY_ACK_COMMITTED"
  | "IDENTITY_BLOCKED";

export interface ContentRecipient {
  readonly recipientType: "DEVICE" | "RECOVERY";
  readonly recipientId: string;
  readonly agreementPublicKey: Uint8Array;
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.length === right.length && left.every((byte, index) => byte === right[index]);
}

function requirePublicKey(value: Uint8Array, name: string): void {
  if (value.length !== 65 || value[0] !== 4) throw new Error(`${name} must be an uncompressed P-256 public key`);
}

async function exportP256PublicKey(publicKey: CryptoKey): Promise<Uint8Array> {
  const encoded = new Uint8Array(await crypto.subtle.exportKey("raw", publicKey));
  requirePublicKey(encoded, "signing public key");
  return encoded;
}

async function generateInstallationSigningKeyPair(): Promise<CryptoKeyPair> {
  const generated = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  const privateJwk = await crypto.subtle.exportKey("jwk", generated.privateKey);
  const privateKey = await crypto.subtle.importKey(
    "jwk",
    privateJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  );
  return { publicKey: generated.publicKey, privateKey };
}

export async function deviceCertificate(
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
): Promise<DeviceCertificate> {
  requirePublicKey(signingPublicKey, "signing public key");
  requirePublicKey(agreementPublicKey, "agreement public key");
  if (equalBytes(signingPublicKey, agreementPublicKey)) throw new Error("Device signing and agreement authorities must be distinct");
  const canonicalBody = encodeCanonicalCbor([1, POMO_SUITE_1, signingPublicKey, agreementPublicKey]);
  const deviceId = bytesToHex(await sha256(encodeCanonicalCbor(["Pomo Device ID", 1, canonicalBody])));
  return {
    version: 1,
    suite: POMO_SUITE_1,
    signingPublicKey: signingPublicKey.slice(),
    agreementPublicKey: agreementPublicKey.slice(),
    canonicalBody,
    deviceId,
  };
}

export async function recoveryCertificate(
  signingPublicKey: Uint8Array,
  agreementPublicKey: Uint8Array,
): Promise<RecoveryCertificate> {
  requirePublicKey(signingPublicKey, "Recovery signing public key");
  requirePublicKey(agreementPublicKey, "Recovery agreement public key");
  if (equalBytes(signingPublicKey, agreementPublicKey)) throw new Error("Recovery signing and agreement authorities must be distinct");
  const canonicalBody = encodeCanonicalCbor([1, POMO_SUITE_1, signingPublicKey, agreementPublicKey]);
  const recoveryId = bytesToHex(await sha256(encodeCanonicalCbor(["Pomo Recovery ID", 1, canonicalBody])));
  return {
    version: 1,
    suite: POMO_SUITE_1,
    signingPublicKey: signingPublicKey.slice(),
    agreementPublicKey: agreementPublicKey.slice(),
    canonicalBody,
    recoveryId,
  };
}

export async function generateLocalDeviceIdentity(): Promise<LocalDeviceIdentity> {
  const signing = await generateInstallationSigningKeyPair();
  const agreement = await generateHpkeRecipientKeyPair();
  if (signing.privateKey.extractable || agreement.privateKey.extractable) throw new Error("Device private keys must be non-transferable");
  const certificate = await deviceCertificate(
    await exportP256PublicKey(signing.publicKey),
    await serializeHpkePublicKey(agreement.publicKey),
  );
  return { certificate, signingPrivateKey: signing.privateKey, agreementPrivateKey: agreement.privateKey };
}

export async function generateLocalRecoveryAuthority(): Promise<LocalRecoveryAuthority> {
  const signing = await generateInstallationSigningKeyPair();
  const agreement = await generateHpkeRecipientKeyPair();
  if (signing.privateKey.extractable || agreement.privateKey.extractable) throw new Error("Recovery private keys must be non-extractable at rest");
  const certificate = await recoveryCertificate(
    await exportP256PublicKey(signing.publicKey),
    await serializeHpkePublicKey(agreement.publicKey),
  );
  return { certificate, signingPrivateKey: signing.privateKey, agreementPrivateKey: agreement.privateKey };
}

export async function memberGenesis(
  recovery: RecoveryCertificate,
  firstDevice: DeviceCertificate,
): Promise<MemberGenesis> {
  const checkedRecovery = await recoveryCertificate(recovery.signingPublicKey, recovery.agreementPublicKey);
  const checkedDevice = await deviceCertificate(firstDevice.signingPublicKey, firstDevice.agreementPublicKey);
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
  const memberId = bytesToHex(await sha256(encodeCanonicalCbor(["Pomo Member ID", 1, canonicalBody])));
  return {
    version: 1,
    suite: POMO_SUITE_1,
    suiteGeneration: POMO_SUITE_GENERATION_1,
    recoveryGeneration: 1,
    recovery,
    firstDevice,
    canonicalBody,
    memberId,
  };
}

export async function admissionTranscriptHash(
  memberId: string,
  admissionId: string,
  certificate: DeviceCertificate,
): Promise<string> {
  const checked = await deviceCertificate(certificate.signingPublicKey, certificate.agreementPublicKey);
  if (checked.deviceId !== certificate.deviceId) throw new Error("Admission Device fingerprint mismatch");
  return bytesToHex(await sha256(encodeCanonicalCbor([
    "Pomo Device Admission",
    1,
    hexToBytes(memberId),
    hexToBytes(admissionId),
    certificate.canonicalBody,
  ])));
}

export function canonicalFrontier(frontier: readonly FrontierEntry[]): readonly FrontierEntry[] {
  const sorted = [...frontier].sort((left, right) =>
    compareBytes(hexToBytes(left.deviceId), hexToBytes(right.deviceId)) ||
    compareBytes(hexToBytes(left.incarnationId), hexToBytes(right.incarnationId)));
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index - 1]!.deviceId === sorted[index]!.deviceId && sorted[index - 1]!.incarnationId === sorted[index]!.incarnationId) {
      throw new Error("Authorization frontier must be unique");
    }
  }
  return sorted;
}

export async function authorizationFrontierDigest(frontier: readonly FrontierEntry[]): Promise<string> {
  return bytesToHex(await sha256(encodeCanonicalCbor(canonicalFrontier(frontier).map((entry) => [
    hexToBytes(entry.deviceId),
    hexToBytes(entry.incarnationId),
    entry.sequence,
    hexToBytes(entry.headHash),
  ]))));
}

export function contentEpochAad(
  memberId: string,
  contentEpoch: number,
  authorizationFrontierHash: string,
  recipient: Pick<ContentRecipient, "recipientType" | "recipientId">,
): Uint8Array {
  return encodeCanonicalCbor([
    "Pomo Content Epoch Wrap",
    1,
    hexToBytes(memberId),
    contentEpoch,
    hexToBytes(authorizationFrontierHash),
    recipient.recipientType === "DEVICE" ? 1 : 2,
    hexToBytes(recipient.recipientId),
  ]);
}

export function sortContentRecipients(recipients: readonly ContentRecipient[]): readonly ContentRecipient[] {
  const sorted = [...recipients].sort((left, right) => compareBytes(hexToBytes(left.recipientId), hexToBytes(right.recipientId)));
  for (let index = 1; index < sorted.length; index++) {
    if (sorted[index - 1]!.recipientId === sorted[index]!.recipientId) throw new Error("Content epoch recipients must be unique");
  }
  return sorted;
}
