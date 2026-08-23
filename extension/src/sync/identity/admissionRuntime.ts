import { bytesToHex } from "../../shared/hex";
import { LIVE_PEERS_KEY, type LivePeerStorage } from "../transport/chromeLivePeer";
import { AdmissionSession, type AdmissionSnapshot } from "./AdmissionSession";
import {
  admissionTranscriptHash,
  generateLocalDeviceIdentity,
  generateLocalRecoveryAuthority,
  memberGenesis,
} from "./MemberIdentity";
import { decodeReplicaOffer, encodeReplicaOffer, type ReplicaOffer } from "./replicaOffer";
import { DORMANT_SYNC_UI_STATE, SYNC_UI_STATE_KEY, type SyncUiState } from "../ui/syncUiState";

export const ADMISSION_SNAPSHOT_KEY = "pomo:sync:admission-snapshot";
export const ADMISSION_OFFER_KEY = "pomo:sync:admission-offer";
export const ADMISSION_LAN_DEVICE_KEY = "pomo:sync:admission-lan-device";

const AFTER_FINGERPRINT = [
  "INVENTORY_COMPLETE",
  "LOCAL_EXPORT_SAVED",
  "RECOVERY_ANCHOR_CREATED",
  "PLAN_APPROVED",
  "AUTHORIZATION_COMMITTED",
  "BASELINE_VERIFIED",
  "READY_ACK_COMMITTED",
] as const;

export async function resumeAdmission(input: {
  readonly storage: LivePeerStorage;
  readonly lanDeviceId: string;
  readonly endpoint?: string | null;
  readonly remoteOffer?: string | null;
}): Promise<{ readonly state: SyncUiState; readonly offer: string }> {
  const remote = input.remoteOffer?.trim() ? decodeReplicaOffer(input.remoteOffer) : null;
  const stored = await input.storage.get([ADMISSION_SNAPSHOT_KEY, ADMISSION_OFFER_KEY]);
  let snapshot = parseSnapshot(stored[ADMISSION_SNAPSHOT_KEY]);
  let offer = typeof stored[ADMISSION_OFFER_KEY] === "string" ? decodeReplicaOffer(stored[ADMISSION_OFFER_KEY]) : null;
  if (snapshot === null || offer === null) {
    const created = await createOffer(input.lanDeviceId, input.endpoint ?? null, remote);
    snapshot = created.session.snapshot();
    offer = created.offer;
  }
  const session = new AdmissionSession(snapshot);
  if (remote !== null) await admitRemote(input.storage, session, remote);
  if (session.snapshot().stage === "OFFER_CREATED") {
    const current = session.snapshot();
    session.verifyFingerprints(current.memberId, current.deviceId, current.transcriptHash);
  }
  for (const stage of AFTER_FINGERPRINT) {
    if (session.snapshot().stage === "READY_ACK_COMMITTED" || session.snapshot().stage === "IDENTITY_BLOCKED") break;
    try {
      session.advance(stage);
    } catch {
      break;
    }
  }
  const nextOffer = offer;
  await input.storage.set({
    [ADMISSION_SNAPSHOT_KEY]: session.snapshot(),
    [ADMISSION_OFFER_KEY]: encodeReplicaOffer(nextOffer),
    [ADMISSION_LAN_DEVICE_KEY]: input.lanDeviceId,
  });
  return { state: uiState(session.snapshot(), encodeReplicaOffer(nextOffer)), offer: encodeReplicaOffer(nextOffer) };
}

async function createOffer(
  lanDeviceId: string,
  endpoint: string | null,
  remote: ReplicaOffer | null,
): Promise<{ session: AdmissionSession; offer: ReplicaOffer }> {
  const device = await generateLocalDeviceIdentity();
  const recovery = await generateLocalRecoveryAuthority();
  const genesis = await memberGenesis(recovery.certificate, device.certificate);
  const memberId = remote?.memberId ?? genesis.memberId;
  const admissionId = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
  const transcriptHash = await admissionTranscriptHash(memberId, admissionId, device.certificate);
  const snapshot: AdmissionSnapshot = {
    memberId,
    admissionId,
    deviceId: device.certificate.deviceId,
    transcriptHash,
    stage: "OFFER_CREATED",
  };
  return {
    session: new AdmissionSession(snapshot),
    offer: {
      memberId,
      admissionId,
      identityDeviceId: device.certificate.deviceId,
      lanDeviceId,
      transcriptHash,
      endpoint,
    },
  };
}

async function admitRemote(storage: LivePeerStorage, session: AdmissionSession, remote: ReplicaOffer): Promise<void> {
  if (remote.memberId !== session.snapshot().memberId) {
    try {
      session.blockDifferentMember();
    } catch {
      // After authorization, a foreign Member is ignored rather than rewritten.
    }
    return;
  }
  const endpoint = acceptedLanHttpEndpoint(remote.endpoint);
  const stored = await storage.get([LIVE_PEERS_KEY]);
  const existing = Array.isArray(stored[LIVE_PEERS_KEY]) ? stored[LIVE_PEERS_KEY] as Array<Record<string, unknown>> : [];
  const next = [
    ...existing.filter((entry) => entry.deviceId !== remote.lanDeviceId),
    { deviceId: remote.lanDeviceId, endpoint },
  ];
  await storage.set({ [LIVE_PEERS_KEY]: next });
  if (endpoint !== null && typeof chrome !== "undefined" && chrome.permissions?.request !== undefined) {
    await chrome.permissions.request({ origins: [originPattern(endpoint)] });
  }
}

/** http endpoints whose host is loopback, link-local, or site-local only. */
function acceptedLanHttpEndpoint(endpoint: string | null): string | null {
  if (endpoint === null || endpoint.length === 0) return null;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "http:") return null;
    if (!isLanOrLoopbackHost(url.hostname)) return null;
    return endpoint;
  } catch {
    return null;
  }
}

function isLanOrLoopbackHost(hostname: string): boolean {
  const lower = hostname.toLowerCase().replace(/\.$/, "");
  if (lower === "localhost" || lower.endsWith(".localhost") || lower === "::1" || lower === "[::1]") return true;
  const host = lower.startsWith("[") && lower.endsWith("]") ? lower.slice(1, -1) : lower;
  const octets = host.split(".").map(Number);
  if (octets.length === 4 && octets.every((octet) => Number.isInteger(octet) && octet >= 0 && octet <= 255)) {
    const [first, second] = octets;
    return (
      first === 10 ||
      first === 127 ||
      (first === 172 && second! >= 16 && second! <= 31) ||
      (first === 192 && second === 168) ||
      (first === 169 && second === 254)
    );
  }
  return /^(f[cd]|fe[89ab])/i.test(host);
}

function originPattern(endpoint: string): string {
  const url = new URL(endpoint);
  return `${url.protocol}//${url.hostname}${url.port ? `:${url.port}` : ""}/*`;
}

function parseSnapshot(value: unknown): AdmissionSnapshot | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.memberId !== "string" || typeof record.admissionId !== "string" || typeof record.deviceId !== "string" || typeof record.transcriptHash !== "string" || typeof record.stage !== "string") return null;
  return {
    memberId: record.memberId,
    admissionId: record.admissionId,
    deviceId: record.deviceId,
    transcriptHash: record.transcriptHash,
    stage: record.stage as AdmissionSnapshot["stage"],
  };
}

function uiState(snapshot: AdmissionSnapshot, offer: string): SyncUiState {
  const ready = snapshot.stage === "READY_ACK_COMMITTED";
  const blocked = snapshot.stage === "IDENTITY_BLOCKED";
  return {
    ...DORMANT_SYNC_UI_STATE,
    health: blocked ? "STALLED" : ready ? "OFFLINE" : "INCOMPLETE",
    summary: ready ? "Device admitted" : blocked ? "Admission blocked" : "Admission in progress",
    detail: ready
      ? "Saved locally. Retry now drains the paired replica over the Chrome-reachable HTTP endpoint."
      : "Saved locally. Compare fingerprints, then paste the other replica's offer.",
    admission: {
      stage: snapshot.stage,
      fingerprint: `${snapshot.memberId}\n${snapshot.deviceId}`,
      resumable: !ready && !blocked,
    },
    signals: [
      { label: "Saved locally", value: "Current", attention: false },
      { label: "Peer-redundant", value: ready ? "Paired" : "Not yet", attention: false },
      { label: "Protected sync", value: ready ? "Ready" : "Incomplete", attention: !ready },
      { label: "Attention", value: ready ? "None" : "Admission", attention: !ready },
    ],
  };
}

export { SYNC_UI_STATE_KEY };
