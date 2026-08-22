export interface ReplicaOffer {
  readonly memberId: string;
  readonly admissionId: string;
  readonly identityDeviceId: string;
  readonly lanDeviceId: string;
  readonly transcriptHash: string;
  readonly endpoint: string | null;
}

const KIND = "pomo-replica-offer";

export function encodeReplicaOffer(offer: ReplicaOffer): string {
  return JSON.stringify({
    schema: 1,
    kind: KIND,
    memberId: offer.memberId,
    admissionId: offer.admissionId,
    identityDeviceId: offer.identityDeviceId,
    lanDeviceId: offer.lanDeviceId,
    transcriptHash: offer.transcriptHash,
    endpoint: offer.endpoint,
  });
}

export function decodeReplicaOffer(raw: string): ReplicaOffer {
  const value = JSON.parse(raw) as Record<string, unknown>;
  if (value.schema !== 1 || value.kind !== KIND) throw new Error("unexpected replica offer");
  return {
    memberId: hex(value.memberId, "memberId"),
    admissionId: hex(value.admissionId, "admissionId"),
    identityDeviceId: hex(value.identityDeviceId, "identityDeviceId"),
    lanDeviceId: hex(value.lanDeviceId, "lanDeviceId"),
    transcriptHash: hex(value.transcriptHash, "transcriptHash"),
    endpoint: typeof value.endpoint === "string" && value.endpoint.length > 0 ? value.endpoint : null,
  };
}

function hex(value: unknown, name: string): string {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) throw new Error(`${name} must be 32-byte hex`);
  return value;
}
