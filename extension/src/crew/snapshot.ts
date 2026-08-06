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
  let ciphertextBytes: Uint8Array;
  try {
    ciphertextBytes = base64UrlToBytes(ciphertext);
  } catch {
    throw new Error("invalid snapshot envelope: ciphertext is not valid base64url");
  }
  if (ciphertextBytes.length > MAX_CIPHERTEXT_BYTES) {
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

const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function isRealCalendarDate(value: string): boolean {
  const match = DATE_PATTERN.exec(value);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1]!;
  return day <= daysInMonth;
}

function validateAggregates(aggregates: unknown): void {
  if (!Array.isArray(aggregates)) throw new Error("invalid snapshot: dailyAggregates must be an array");
  if (aggregates.length > MAX_DAILY_AGGREGATES) {
    throw new Error("invalid snapshot: more than 30 daily aggregates");
  }
  let prev: string | null = null;
  const seenDates = new Set<string>();
  for (const aggregate of aggregates) {
    if (typeof aggregate !== "object" || aggregate === null) {
      throw new Error("invalid snapshot: malformed daily aggregate");
    }
    const record = aggregate as Record<string, unknown>;
    if (!isRealDateString(record.localDate)) {
      throw new Error("invalid snapshot: malformed aggregate localDate");
    }
    if (!isNonNegativeNumber(record.focusMinutes)) {
      throw new Error("invalid snapshot: malformed aggregate focusMinutes");
    }
    if (!isNonNegativeInteger(record.completedWorkBlocks)) {
      throw new Error("invalid snapshot: malformed aggregate completedWorkBlocks");
    }
    const localDate = record.localDate as string;
    if (seenDates.has(localDate)) {
      throw new Error("invalid snapshot: daily aggregates must not contain duplicate localDate values");
    }
    if (prev !== null && localDate > prev) {
      throw new Error("invalid snapshot: daily aggregates must be sorted by localDate descending");
    }
    seenDates.add(localDate);
    prev = localDate;
  }
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

/** Real calendar-date check (not just the YYYY-MM-DD shape). */
function isRealDateString(value: unknown): value is string {
  if (typeof value !== "string" || !DATE_PATTERN.test(value)) return false;
  return isRealCalendarDate(value);
}

export function validateStats(stats: unknown): void {
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
  const optionalCount = (name: string): void => {
    const value = record[name];
    if (value !== undefined && value !== null && !isNonNegativeInteger(value)) {
      throw new Error(`invalid snapshot: malformed ${name}`);
    }
  };
  for (const name of ["allTimeWorkBlocks", "allTimeActiveDays", "bestStreak", "bestDayFocusMinutes", "bestDayWorkBlocks", "bestWeekFocusMinutes", "bestWeekWorkBlocks"]) {
    const value = record[name];
    if (value !== undefined && value !== null && !isNonNegativeNumber(value)) {
      throw new Error(`invalid snapshot: malformed ${name}`);
    }
  }
  optionalCount("allTimeWorkBlocks");
  optionalCount("allTimeActiveDays");
  optionalCount("bestStreak");
  for (const name of ["firstFocusLocalDate", "historyStartDate", "bestDayLocalDate", "bestWeekStartDate"]) {
    const value = record[name];
    if (value !== undefined && value !== null && !isRealDateString(value)) {
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
  if (!isNonNegativeInteger(s.publishedAtEpochSeconds)) {
    throw new Error("invalid snapshot: malformed publishedAtEpochSeconds");
  }
  if (!isRealDateString(s.localDate)) {
    throw new Error("invalid snapshot: malformed localDate");
  }
  if (typeof s.utcOffsetMinutes !== "number" || !Number.isInteger(s.utcOffsetMinutes) || s.utcOffsetMinutes < -720 || s.utcOffsetMinutes > 840) {
    throw new Error("invalid snapshot: malformed utcOffsetMinutes");
  }
  if (!isNonNegativeInteger(s.currentStreak)) throw new Error("invalid snapshot: malformed currentStreak");
  if (!isNonNegativeInteger(s.lastFocusedAtEpochSeconds)) {
    throw new Error("invalid snapshot: malformed lastFocusedAtEpochSeconds");
  }
  validateAggregates(s.dailyAggregates);
  validateStats(s.stats);
  return s as unknown as SnapshotPlain;
}

/** Validates a snapshot against its own self-declared identity. Used on the
 * publish path so invalid local data is rejected before it is encrypted. */
export function validateSnapshotPlain(snapshot: unknown): SnapshotPlain {
  if (typeof snapshot !== "object" || snapshot === null) throw new Error("invalid snapshot: not an object");
  const s = snapshot as Record<string, unknown>;
  const envelope = { crewId: s.crewId, identityPublicKey: s.identityPublicKey } as unknown as Envelope;
  return validateSnapshot(snapshot, envelope);
}

export async function buildEnvelope(snapshot: SnapshotPlain, crewKeyHex64: string): Promise<string> {
  // Never encrypt data we would refuse to decrypt from a peer.
  validateSnapshotPlain(snapshot);
  const key = await keyFromCrewKey(crewKeyHex64);
  const iv = new Uint8Array(NONCE_BYTES);
  crypto.getRandomValues(iv);
  const plaintext = bufferOf(utf8ToBytes(JSON.stringify(snapshot)));
  if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
    throw new Error("invalid snapshot: plaintext exceeds maximum size");
  }
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
  const encoded = JSON.stringify({
    version: envelope.version,
    crewId: envelope.crewId,
    identityPublicKey: envelope.identityPublicKey,
    nonce: bytesToBase64Url(iv),
    ciphertext: bytesToBase64Url(ciphertext),
  });
  if (utf8ToBytes(encoded).length > MAX_ENVELOPE_BYTES) {
    throw new Error("invalid snapshot envelope: exceeds maximum size");
  }
  return encoded;
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
