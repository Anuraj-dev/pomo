import type { AuthenticatedOperation, FrontierEntry } from "../protocol/types";
import type { OperationAuthorizationPolicy } from "../kernel/OperationKernel";
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

export function operationAuthorizationPolicy(
  snapshot: AuthorizationSnapshot,
  classifyRevocation: (operation: AuthenticatedOperation) => "NORMAL_VALIDATION" | "REJECT_KNOWINGLY_LATER" | "QUARANTINE_CONCURRENT" = () => "NORMAL_VALIDATION",
): OperationAuthorizationPolicy {
  return {
    authorize: (operation) => {
      const device = snapshot.devices.get(operation.unsigned.deviceId);
      if (operation.unsigned.memberId !== snapshot.memberId || operation.unsigned.authorizationEpoch !== snapshot.authorizationEpoch ||
          device?.authorized !== true || device.deviceReady !== true) return "REJECTED_INVALID";
      const revocation = classifyRevocation(operation);
      return revocation === "REJECT_KNOWINGLY_LATER" ? "REJECTED_INVALID" : revocation === "QUARANTINE_CONCURRENT" ? "QUARANTINED_FORK" : "AUTHORIZED";
    },
  };
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
  readonly #firstDeviceId: string;

  constructor(private readonly genesis: GenesisRecord) {
    this.#recovery = genesis.recovery;
    this.#firstDeviceId = genesis.firstDevice.deviceId;
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
    readonly issuerDeviceId: string;
    readonly deviceId: string;
    readonly authorizationEpoch: number;
    readonly contentEpoch: number;
    readonly baselineFrontier: readonly FrontierEntry[];
    /** Frontier authenticated by the completed baseline transaction. */
    readonly verifiedBaselineFrontier: readonly FrontierEntry[];
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    const device = this.#devices.get(input.deviceId);
    const expectedBaselineDevices = [...this.#devices]
      .filter(([deviceId, value]) => value.authorized && (deviceId !== input.deviceId || deviceId === this.#firstDeviceId))
      .map(([deviceId]) => deviceId);
    const baselineDevices = input.baselineFrontier.map((entry) => entry.deviceId);
    const baselineMatchesVerified = sameFrontier(input.baselineFrontier, input.verifiedBaselineFrontier);
    if (input.issuerDeviceId !== input.deviceId || device === undefined || !device.authorized ||
        (input.baselineFrontier.length === 0 && expectedBaselineDevices.length > 0) ||
        baselineDevices.length !== new Set(baselineDevices).size ||
        baselineDevices.length !== expectedBaselineDevices.length ||
        expectedBaselineDevices.some((deviceId) => !baselineDevices.includes(deviceId)) ||
        !baselineMatchesVerified ||
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

  recoveryRotate(input: {
    readonly factId: string;
    readonly memberId: string;
    readonly issuerDeviceId: string;
    readonly recoveryVerified: boolean;
    readonly recoveryGeneration: number;
    readonly recoveryRotateMode: "NORMAL" | "EMERGENCY_DEVICE_ROTATION";
    readonly recovery: RecoveryCertificate;
    readonly ledgerFrontier: ReadonlySet<string>;
  }): AuthorityDisposition {
    const preflight = this.#preflight(input.factId, input.memberId, input.ledgerFrontier);
    if (preflight !== null) return preflight;
    if (input.recoveryGeneration !== this.#recoveryGeneration + 1) {
      return input.recoveryGeneration === this.#recoveryGeneration ?
        "QUARANTINED_CONCURRENT_AUTHORITY" : "REJECTED_STALE_RECOVERY";
    }
    const issuerReady = this.#authorizedAndReady(input.issuerDeviceId);
    const authorityValid = input.recoveryRotateMode === "NORMAL" ?
      input.recoveryVerified && issuerReady : !input.recoveryVerified && issuerReady;
    if (!authorityValid) return "REJECTED_INVALID";
    this.#recoveryGeneration = input.recoveryGeneration;
    this.#recovery = input.recovery;
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

function sameFrontier(left: readonly FrontierEntry[], right: readonly FrontierEntry[]): boolean {
  if (left.length !== right.length) return false;
  const key = (entry: FrontierEntry): string => `${entry.deviceId}:${entry.incarnationId}:${entry.sequence}:${entry.headHash}`;
  const expected = new Set(right.map(key));
  return expected.size === right.length && left.every((entry) => expected.has(key(entry)));
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
