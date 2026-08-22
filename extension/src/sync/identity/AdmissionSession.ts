import type { AdmissionStage } from "./types";

export interface AdmissionSnapshot {
  readonly memberId: string;
  readonly admissionId: string;
  readonly deviceId: string;
  readonly transcriptHash: string;
  readonly stage: AdmissionStage;
}

const STAGES: readonly AdmissionStage[] = [
  "OFFER_CREATED",
  "MUTUAL_FINGERPRINT_VERIFIED",
  "AUTHORIZATION_COMMITTED",
  "BASELINE_VERIFIED",
  "READY_ACK_COMMITTED",
];

/** Persist the returned snapshot in syncAdmissions after every transition. */
export class AdmissionSession {
  #current: AdmissionSnapshot;

  constructor(snapshot: AdmissionSnapshot) {
    this.#current = { ...snapshot };
  }

  snapshot(): AdmissionSnapshot {
    return { ...this.#current };
  }

  verifyFingerprints(memberId: string, deviceId: string, transcriptHash: string): void {
    if (this.#current.stage !== "OFFER_CREATED") throw new Error("Admission fingerprint step already completed");
    if (memberId !== this.#current.memberId) throw new Error("Member fingerprint mismatch");
    if (deviceId !== this.#current.deviceId) throw new Error("Device fingerprint mismatch");
    if (transcriptHash !== this.#current.transcriptHash) throw new Error("Admission transcript mismatch");
    this.#current = { ...this.#current, stage: "MUTUAL_FINGERPRINT_VERIFIED" };
  }

  advance(next: AdmissionStage): void {
    const index = STAGES.indexOf(this.#current.stage);
    if (STAGES[index + 1] !== next) throw new Error("Admission stages cannot be skipped or rewound");
    this.#current = { ...this.#current, stage: next };
  }
}
