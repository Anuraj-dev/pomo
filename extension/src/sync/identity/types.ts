import type { FrontierEntry } from "../protocol/types";

export enum IdentityFactKind {
  DEVICE_ADMIT = 2,
  DEVICE_READY = 3,
  DEVICE_REVOKE = 4,
  RECOVERY_ROTATE = 5,
  RECOVERY_RESET = 6,
}

export interface DeviceCertificate {
  readonly version: 1;
  readonly suite: 1;
  readonly signingPublicKey: Uint8Array;
  readonly agreementPublicKey: Uint8Array;
  readonly canonicalBody: Uint8Array;
  readonly deviceId: string;
}

export interface RecoveryCertificate {
  readonly version: 1;
  readonly suite: 1;
  readonly signingPublicKey: Uint8Array;
  readonly agreementPublicKey: Uint8Array;
  readonly canonicalBody: Uint8Array;
  readonly recoveryId: string;
}

export interface GenesisRecord {
  readonly version: 1;
  readonly suite: 1;
  readonly suiteGeneration: 1;
  readonly recoveryGeneration: 1;
  readonly recovery: RecoveryCertificate;
  readonly firstDevice: DeviceCertificate;
  readonly canonicalBody: Uint8Array;
  readonly recoveryProof: Uint8Array;
  readonly deviceProof: Uint8Array;
  readonly canonicalRecord: Uint8Array;
  readonly memberId: string;
}

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
  readonly recipientKind: "DEVICE" | "RECOVERY";
  readonly recipientId: string;
  readonly agreementPublicKey: Uint8Array;
}

export interface ContentEpochWrap {
  readonly recipientKind: "DEVICE" | "RECOVERY";
  readonly recipientId: string;
  readonly encapsulatedKey: Uint8Array;
  readonly ciphertext: Uint8Array;
}

export interface ContentEpochAdvance {
  readonly contentEpoch: number;
  readonly parentEpochIds: readonly string[];
  readonly authorizationFrontierDigest: string;
  readonly wraps: readonly ContentEpochWrap[];
  readonly epochId: string;
  readonly canonicalBody: Uint8Array;
}

export interface DeviceAuthorityProjection {
  readonly memberId: string;
  readonly deviceId: string;
  readonly certificate: DeviceCertificate;
  readonly authorized: boolean;
  readonly deviceReady: boolean;
  readonly authorizedAtEpoch: number;
  readonly revokedAtEpoch: number | null;
  readonly revocationOperationId: string | null;
  readonly revocationTargetFrontier: readonly FrontierEntry[];
  readonly readyContentEpoch: number | null;
  readonly readyBaselineFrontier: readonly FrontierEntry[];
}

export type AuthorityClassification =
  | "AUTHORIZED"
  | "NOT_READY"
  | "PRESERVE_CAUSALLY_EARLIER"
  | "REJECT_KNOWINGLY_REVOKED"
  | "QUARANTINE_CONCURRENT_REVOCATION"
  | "QUARANTINE_DIFFERENT_MEMBER"
  | "QUARANTINE_UNKNOWN_DEVICE";

export type RecoveryRotationMode = "NORMAL" | "EMERGENCY_DEVICE_ROTATION";
export type RecoveryTransitionClassification = "APPLY" | "REJECT_STALE" | "QUARANTINE_CONCURRENT";

export interface AuthorizationOperationView {
  readonly memberId: string;
  readonly deviceId: string;
  readonly incarnationId: string;
  readonly sequence: number;
  readonly authorizationEpoch: number;
  readonly operationId: string;
  readonly frontier: readonly FrontierEntry[];
}
