import type { FrontierEntry } from "../protocol/types";
import type { DeviceCertificate, GenesisRecord, RecoveryCertificate } from "./types";

export interface AuthorizedDevice {
  readonly certificate: DeviceCertificate;
  readonly authorized: boolean;
  readonly deviceReady: boolean;
  readonly admittedAtEpoch: number;
  readonly revokedAtEpoch: number | null;
}

export interface AuthorizationSnapshot {
  readonly memberId: string;
  readonly authorizationEpoch: number;
  readonly contentEpoch: number;
  readonly recoveryGeneration: number;
  readonly recovery: RecoveryCertificate;
  readonly devices: ReadonlyMap<string, AuthorizedDevice>;
}

export type AuthorityDisposition =
  | "ACCEPTED"
  | "DUPLICATE"
  | "PENDING_CAUSAL"
  | "QUARANTINED_CONCURRENT_AUTHORITY"
  | "QUARANTINED_DIFFERENT_MEMBER"
  | "REJECTED_INVALID"
  | "REJECTED_STALE_RECOVERY";

export class AuthorizationLedger {
  readonly #accepted = new Set<string>();
  readonly #devices = new Map<string, AuthorizedDevice>();
  #authorizationEpoch = 1;
  #contentEpoch = 1;
  #recoveryGeneration = 1;
  #recovery: RecoveryCertificate;

  constructor(private readonly genesis: GenesisRecord) {
    this.#recovery = genesis.recovery;
    this.#devices.set(genesis.firstDevice.deviceId, {
      certificate: genesis.firstDevice,
      authorized: true,
      deviceReady: false,
      admittedAtEpoch: 1,
      revokedAtEpoch: null,
    });
  }

  snapshot(): AuthorizationSnapshot {
    return {
      memberId: this.genesis.memberId,
      authorizationEpoch: this.#authorizationEpoch,
      contentEpoch: this.#contentEpoch,
      recoveryGeneration: this.#recoveryGeneration,
      recovery: this.#recovery,
      devices: new Map(this.#devices),
    };
  }

  admit(input: {
    readonly factId: string;
    readonly memberId: string;
    readonly issuerDeviceId: string;
    readonly certificate: DeviceCertificate;
    readonly authorizationEpoch: number;
    readonly contentEpoch: number;
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    if (!this.#authorizedAndReady(input.issuerDeviceId) ||
        input.authorizationEpoch !== this.#authorizationEpoch + 1 ||
        input.contentEpoch !== this.#contentEpoch + 1 ||
        this.#devices.get(input.certificate.deviceId)?.authorized === true) return "REJECTED_INVALID";
    this.#authorizationEpoch = input.authorizationEpoch;
    this.#contentEpoch = input.contentEpoch;
    this.#devices.set(input.certificate.deviceId, {
      certificate: input.certificate,
      authorized: true,
      deviceReady: false,
      admittedAtEpoch: input.authorizationEpoch,
      revokedAtEpoch: null,
    });
    this.#accepted.add(input.factId);
    return "ACCEPTED";
  }

  markReady(input: {
    readonly factId: string;
    readonly memberId: string;
    readonly deviceId: string;
    readonly authorizationEpoch: number;
    readonly contentEpoch: number;
    readonly baselineFrontier: readonly FrontierEntry[];
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    const device = this.#devices.get(input.deviceId);
    if (device === undefined || !device.authorized || input.baselineFrontier.length === 0 ||
        input.authorizationEpoch !== this.#authorizationEpoch || input.contentEpoch !== this.#contentEpoch) {
      return "REJECTED_INVALID";
    }
    this.#devices.set(input.deviceId, { ...device, deviceReady: true });
    this.#accepted.add(input.factId);
    return "ACCEPTED";
  }

  revoke(input: {
    readonly factId: string;
    readonly memberId: string;
    readonly issuerDeviceId: string;
    readonly targetDeviceId: string;
    readonly authorizationEpoch: number;
    readonly contentEpoch: number;
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    const target = this.#devices.get(input.targetDeviceId);
    if (!this.#authorizedAndReady(input.issuerDeviceId) || target === undefined || !target.authorized ||
        input.authorizationEpoch !== this.#authorizationEpoch + 1 || input.contentEpoch !== this.#contentEpoch + 1) {
      return "REJECTED_INVALID";
    }
    this.#authorizationEpoch = input.authorizationEpoch;
    this.#contentEpoch = input.contentEpoch;
    this.#devices.set(input.targetDeviceId, {
      ...target,
      authorized: false,
      deviceReady: false,
      revokedAtEpoch: input.authorizationEpoch,
    });
    this.#accepted.add(input.factId);
    return "ACCEPTED";
  }

  recoveryReset(input: {
    readonly factId: string;
    readonly memberId: string;
    readonly recoveryVerified: boolean;
    readonly recoveryGeneration: number;
    readonly recovery: RecoveryCertificate;
    readonly freshDevice: DeviceCertificate;
    readonly authorizationEpoch: number;
    readonly contentEpoch: number;
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    if (!input.recoveryVerified || input.recoveryGeneration !== this.#recoveryGeneration + 1 ||
        input.authorizationEpoch !== this.#authorizationEpoch + 1 || input.contentEpoch !== this.#contentEpoch + 1) {
      return "REJECTED_STALE_RECOVERY";
    }
    for (const [deviceId, device] of this.#devices) {
      this.#devices.set(deviceId, { ...device, authorized: false, deviceReady: false, revokedAtEpoch: input.authorizationEpoch });
    }
    this.#devices.set(input.freshDevice.deviceId, {
      certificate: input.freshDevice,
      authorized: true,
      deviceReady: false,
      admittedAtEpoch: input.authorizationEpoch,
      revokedAtEpoch: null,
    });
    this.#authorizationEpoch = input.authorizationEpoch;
    this.#contentEpoch = input.contentEpoch;
    this.#recoveryGeneration = input.recoveryGeneration;
    this.#recovery = input.recovery;
    this.#accepted.add(input.factId);
    return "ACCEPTED";
  }

  #preflight(factId: string, memberId: string, frontier: ReadonlySet<string>): AuthorityDisposition | null {
    if (memberId !== this.genesis.memberId) return "QUARANTINED_DIFFERENT_MEMBER";
    if (this.#accepted.has(factId)) return "DUPLICATE";
    for (const dependency of frontier) if (!this.#accepted.has(dependency)) return "PENDING_CAUSAL";
    return null;
  }

  #authorizedAndReady(deviceId: string): boolean {
    const device = this.#devices.get(deviceId);
    return device?.authorized === true && device.deviceReady;
  }
}

export function classifyRevokedOperation(input: {
  readonly operationMemberId: string;
  readonly operationDeviceId: string;
  readonly operationId: string;
  readonly operationAuthorityFrontier: ReadonlySet<string>;
  readonly memberId: string;
  readonly targetDeviceId: string;
  readonly revocationFactId: string;
  readonly capturedTargetFrontier: ReadonlySet<string>;
}): "NORMAL_VALIDATION" | "REJECT_KNOWINGLY_LATER" | "QUARANTINE_CONCURRENT" | "QUARANTINE_DIFFERENT_MEMBER" {
  if (input.operationMemberId !== input.memberId) return "QUARANTINE_DIFFERENT_MEMBER";
  if (input.operationDeviceId !== input.targetDeviceId || input.capturedTargetFrontier.has(input.operationId)) {
    return "NORMAL_VALIDATION";
  }
  return input.operationAuthorityFrontier.has(input.revocationFactId) ?
    "REJECT_KNOWINGLY_LATER" : "QUARANTINE_CONCURRENT";
}
