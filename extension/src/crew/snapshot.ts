import { base64UrlToBytes, bufferOf, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../shared/bytes";
import { hexToBytes, isLowerHex } from "../shared/hex";
import { NONCE_BYTES } from "./keyring";
import { normalizeDisplayName } from "./validation";
import type { CrewStatsExtras, SnapshotPlain } from "./types";

const GCM_TAG_BITS = 128;
export const MAX_DAILY_AGGREGATES = 30;
const MAX_HISTORY_DAYS = 120;
const MAX_ENVELOPE_BYTES = 64 * 1024;
const MAX_CIPHERTEXT_BYTES = 32 * 1024;
const MAX_PLAINTEXT_BYTES = 32 * 1024;

interface Envelope {
  version: number;
  crewId: string;
  identityPublicKey: string;
  nonce: string;
  ciphertext: string;
}

async function keyFromCrewKey(crewKeyHex64: string): Promise<CryptoKey> {
  if (!isLowerHex(crewKeyHex64, 64)) throw new Error("invalid crew key: expected 64 lowercase hex characters");
  return crypto.subtle.importKey("raw", bufferOf(hexToBytes(crewKeyHex64)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

function associatedData(envelope: Envelope): ArrayBuffer {
  return bufferOf(utf8ToBytes(`${envelope.version}\n${envelope.crewId}\n${envelope.identityPublicKey}`));
}

function parseEnvelope(envelopeJson: string): Envelope {
  if (utf8ToBytes(envelopeJson).length > MAX_ENVELOPE_BYTES) {
    throw new Error("invalid snapshot envelope: exceeds maximum size");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(envelopeJson);
  } catch {
    throw new Error("invalid snapshot envelope: not valid JSON");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("invalid snapshot envelope");
  const data = parsed as Record<string, unknown>;
  if (typeof data.version !== "number" || !Number.isInteger(data.version)) {
    throw new Error("invalid snapshot envelope: missing version");
  }
  if (data.version !== 2) throw new Error(`unsupported snapshot envelope version: ${data.version}`);
  const crewId = data.crewId;
  if (typeof crewId !== "string" || !isLowerHex(crewId, 32)) {
    throw new Error("invalid snapshot envelope: crewId must be 32 lowercase hex characters");
  }
  const identityPublicKey = data.identityPublicKey;
  if (typeof identityPublicKey !== "string" || !isLowerHex(identityPublicKey, 64)) {
    throw new Error("invalid snapshot envelope: identityPublicKey must be 64 lowercase hex characters");
  }
  const nonce = data.nonce;
  const ciphertext = data.ciphertext;
  if (typeof nonce !== "string" || nonce.length === 0) {
    throw new Error("invalid snapshot envelope: missing nonce");
  }
  if (typeof ciphertext !== "string" || ciphertext.length === 0) {
    throw new Error("invalid snapshot envelope: missing ciphertext");
  }
  if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
    throw new Error("invalid snapshot envelope: ciphertext exceeds maximum size");
  }
  let nonceBytes: Uint8Array;
  try {
    nonceBytes = base64UrlToBytes(nonce);
  } catch {
    throw new Error("invalid snapshot envelope: nonce is not valid base64url");
  }
  if (nonceBytes.length !== NONCE_BYTES) throw new Error("invalid snapshot envelope: nonce must be 12 bytes");
  return { version: data.version, crewId, identityPublicKey, nonce, ciphertext };
}

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function validateAggregates(aggregates: unknown): void {
  if (!Array.isArray(aggregates)) throw new Error("invalid snapshot: dailyAggregates must be an array");
  if (aggregates.length > MAX_DAILY_AGGREGATES) {
    throw new Error("invalid snapshot: more than 30 daily aggregates");
  }
  let prev: string | null = null;
  for (const aggregate of aggregates) {
    if (typeof aggregate !== "object" || aggregate === null) {
      throw new Error("invalid snapshot: malformed daily aggregate");
    }
    const record = aggregate as Record<string, unknown>;
    if (typeof record.localDate !== "string" || !DATE_PATTERN.test(record.localDate)) {
      throw new Error("invalid snapshot: malformed aggregate localDate");
    }
    if (!isNonNegativeNumber(record.focusMinutes)) {
      throw new Error("invalid snapshot: malformed aggregate focusMinutes");
    }
    if (!isNonNegativeNumber(record.completedWorkBlocks)) {
      throw new Error("invalid snapshot: malformed aggregate completedWorkBlocks");
    }
    if (prev !== null && (record.localDate as string) > prev) {
      throw new Error("invalid snapshot: daily aggregates must be sorted by localDate descending");
    }
    prev = record.localDate as string;
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validateStats(stats: unknown): void {
  if (stats === null) return;
  if (typeof stats !== "object" || Array.isArray(stats)) throw new Error("invalid snapshot: malformed stats");
  const record = stats as Record<string, unknown>;
  const optionalBuckets = (name: string, expected: number): void => {
    const value = record[name];
    if (value === undefined || value === null) return;
    if (!Array.isArray(value) || value.length !== expected || !value.every(isNonNegativeNumber)) {
      throw new Error(`invalid snapshot: ${name} is malformed`);
    }
  };
  optionalBuckets("hourBuckets", 24);
  optionalBuckets("weekdayBuckets", 7);
  for (const name of ["allTimeWorkBlocks", "allTimeActiveDays", "bestStreak", "bestDayFocusMinutes", "bestDayWorkBlocks", "bestWeekFocusMinutes", "bestWeekWorkBlocks"]) {
    const value = record[name];
    if (value !== undefined && value !== null && !isNonNegativeNumber(value)) {
      throw new Error(`invalid snapshot: malformed ${name}`);
    }
  }
  const hasMinutes = record.historyFocusMinutes !== undefined && record.historyFocusMinutes !== null;
  const hasBlocks = record.historyWorkBlocks !== undefined && record.historyWorkBlocks !== null;
  const hasStart = record.historyStartDate !== undefined && record.historyStartDate !== null;
  if (hasMinutes !== hasBlocks || hasMinutes !== hasStart) throw new Error("invalid snapshot: partial history arrays are not allowed");
  if (hasMinutes) {
    if (!Array.isArray(record.historyFocusMinutes) || !Array.isArray(record.historyWorkBlocks)) {
      throw new Error("invalid snapshot: history arrays must be arrays");
    }
    if (record.historyFocusMinutes.length !== record.historyWorkBlocks.length) {
      throw new Error("invalid snapshot: history arrays must have equal length");
    }
    if (record.historyFocusMinutes.length > MAX_HISTORY_DAYS) {
      throw new Error("invalid snapshot: history arrays exceed 120 entries");
    }
    if (
      !record.historyFocusMinutes.every(isNonNegativeNumber) ||
      !record.historyWorkBlocks.every(isNonNegativeNumber)
    ) {
      throw new Error("invalid snapshot: history arrays must be non-negative numbers");
    }
  }
}

function validateSnapshot(snapshot: unknown, envelope: Envelope): SnapshotPlain {
  if (typeof snapshot !== "object" || snapshot === null) {
    throw new Error("invalid snapshot: not an object");
  }
  const s = snapshot as Record<string, unknown>;
  if (s.version !== 2) throw new Error(`unsupported snapshot version: ${String(s.version)}`);
  if (s.crewId !== envelope.crewId) throw new Error("snapshot crewId does not match envelope");
  if (s.identityPublicKey !== envelope.identityPublicKey) {
    throw new Error("snapshot identityPublicKey does not match envelope");
  }
  if (typeof s.displayName !== "string" || normalizeDisplayName(s.displayName) !== s.displayName) {
    throw new Error("invalid snapshot: malformed displayName");
  }
  if (s.avatarBase64 !== null && typeof s.avatarBase64 !== "string") {
    throw new Error("invalid snapshot: malformed avatarBase64");
  }
  if (!isNonNegativeNumber(s.allTimeFocusMinutes)) {
    throw new Error("invalid snapshot: malformed allTimeFocusMinutes");
  }
  if (!isNonNegativeNumber(s.publishedAtEpochSeconds)) {
    throw new Error("invalid snapshot: malformed publishedAtEpochSeconds");
  }
  if (typeof s.localDate !== "string" || !DATE_PATTERN.test(s.localDate)) {
    throw new Error("invalid snapshot: malformed localDate");
  }
  if (typeof s.utcOffsetMinutes !== "number" || s.utcOffsetMinutes < -720 || s.utcOffsetMinutes > 840) {
    throw new Error("invalid snapshot: malformed utcOffsetMinutes");
  }
  if (!isNonNegativeNumber(s.currentStreak)) throw new Error("invalid snapshot: malformed currentStreak");
  if (!isNonNegativeNumber(s.lastFocusedAtEpochSeconds)) {
    throw new Error("invalid snapshot: malformed lastFocusedAtEpochSeconds");
  }
  validateAggregates(s.dailyAggregates);
  validateStats(s.stats);
  return s as unknown as SnapshotPlain;
}

export async function buildEnvelope(snapshot: SnapshotPlain, crewKeyHex64: string): Promise<string> {
  const key = await keyFromCrewKey(crewKeyHex64);
  const iv = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(iv);
  const plaintext = bufferOf(utf8ToBytes(JSON.stringify(snapshot)));
  const envelope: Envelope = {
    version: snapshot.version,
    crewId: snapshot.crewId,
    identityPublicKey: snapshot.identityPublicKey,
    nonce: "",
    ciphertext: "",
  };
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(envelope), tagLength: GCM_TAG_BITS },
      key,
      plaintext,
    ),
  );
  return JSON.stringify({
    version: envelope.version,
    crewId: envelope.crewId,
    identityPublicKey: envelope.identityPublicKey,
    nonce: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
  });
}

export async function decryptEnvelope(envelopeJson: string, crewKeyHex64: string): Promise<SnapshotPlain> {
  const envelope = parseEnvelope(envelopeJson);
  let plaintextBytes: Uint8Array;
  try {
    const key = await keyFromCrewKey(crewKeyHex64);
    const iv = bufferOf(base64UrlToBytes(envelope.nonce));
    const out = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: associatedData(envelope), tagLength: GCM_TAG_BITS },
      key,
      bufferOf(base64UrlToBytes(envelope.ciphertext)),
    );
    plaintextBytes = new Uint8Array(out);
  } catch {
    throw new Error("failed to decrypt snapshot: wrong crew key or tampered envelope");
  }
  if (plaintextBytes.length > MAX_PLAINTEXT_BYTES) {
    throw new Error("invalid snapshot: plaintext exceeds maximum size");
  }
  let snapshot: SnapshotPlain;
  try {
    const parsed: unknown = JSON.parse(bytesToUtf8(plaintextBytes));
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    snapshot = parsed as SnapshotPlain;
  } catch {
    throw new Error("invalid snapshot: plaintext is not valid JSON");
  }
  validateSnapshot(snapshot, envelope);
  return snapshot;
}
