import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../shared/bytes";
import { bytesToHex, isLowerHex } from "../shared/hex";

export interface CrewJoinPayload {
  version: number;
  crewId: string;
  crewName: string;
  relays: string[];
  key: string;
}

export const DEFAULT_RELAYS = ["wss://relay.damus.io", "wss://nos.lol", "wss://relay.primal.net"];

const URI_PREFIX = "pomo://crew/join/v2/";
const RAW_PREFIX = "pomo-crew.v2.";
const LEGACY_PREFIX = "pomo-crew.";
const MAX_ENCODED_LENGTH = 16 * 1024;
const MAX_CREW_NAME_GRAPHEMES = 40;
const MAX_RELAYS = 8;
const BIDI_OVERRIDES = "\u202a\u202b\u202c\u202d\u202e\u2066\u2067\u2068\u2069";

function randomHex(byteCount: number): string {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function normalizeCrewName(value: string): string | null {
  const normalized = value.normalize("NFC").trim().replace(/\s+/g, " ");
  if (normalized.length === 0) return null;
  for (const ch of normalized) {
    const code = ch.codePointAt(0) ?? 0;
    if (code <= 0x1f || code === 0x7f || BIDI_OVERRIDES.includes(ch)) return null;
  }
  const graphemes = new Intl.Segmenter().segment(normalized);
  let count = 0;
  for (const _ of graphemes) {
    count++;
    if (count > MAX_CREW_NAME_GRAPHEMES) return null;
  }
  return normalized;
}

function isValidRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "wss:" &&
      url.hostname.length > 0 &&
      url.username.length === 0 &&
      url.password.length === 0
    );
  } catch {
    return false;
  }
}

export function encodePayload(p: CrewJoinPayload): string {
  const json = JSON.stringify({
    version: p.version,
    crewId: p.crewId,
    crewName: p.crewName,
    relays: p.relays,
    key: p.key,
  });
  return bytesToBase64Url(utf8ToBytes(json));
}

export function decodePayload(input: string): CrewJoinPayload {
  let encoded: string;
  if (input.startsWith(URI_PREFIX)) {
    encoded = input.slice(URI_PREFIX.length);
  } else if (input.startsWith(RAW_PREFIX)) {
    encoded = input.slice(RAW_PREFIX.length);
  } else if (input.startsWith(LEGACY_PREFIX)) {
    throw new Error("v1 join codes are not supported");
  } else {
    encoded = input;
  }
  if (encoded.length === 0) throw new Error("join code payload is empty");
  if (encoded.length > MAX_ENCODED_LENGTH) throw new Error("join code payload exceeds maximum length");
  let json: string;
  try {
    json = bytesToUtf8(base64UrlToBytes(encoded));
  } catch {
    throw new Error("join code payload is not valid base64url");
  }
  let data: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) throw new Error("not an object");
    data = parsed as Record<string, unknown>;
  } catch {
    throw new Error("join code payload is not valid JSON");
  }

  const version = data.version;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new Error("join code payload has an invalid version field");
  }
  if (version !== 2) throw new Error(`unsupported join code version: ${version}`);

  const crewId = data.crewId;
  if (typeof crewId !== "string" || !isLowerHex(crewId, 32)) {
    throw new Error("join code payload has an invalid crewId: expected 32 lowercase hex characters");
  }

  const key = data.key;
  if (typeof key !== "string" || !isLowerHex(key, 64)) {
    throw new Error("join code payload has an invalid key: expected 64 lowercase hex characters");
  }

  const crewNameRaw = data.crewName;
  if (typeof crewNameRaw !== "string") throw new Error("join code payload has an invalid crew name");
  const crewName = normalizeCrewName(crewNameRaw);
  if (crewName === null) throw new Error("join code payload has an invalid crew name");

  const relays: string[] = [];
  if (data.relays !== undefined) {
    if (!Array.isArray(data.relays)) throw new Error("join code payload has an invalid relays field");
    for (const relay of data.relays) {
      if (typeof relay !== "string" || !isValidRelayUrl(relay)) {
        throw new Error(`join code payload has an invalid relay url: ${String(relay)}`);
      }
      relays.push(relay);
    }
  }
  if (relays.length > MAX_RELAYS) throw new Error("join code payload has too many relays: at most 8 allowed");
  if (new Set(relays).size !== relays.length) throw new Error("join code payload has duplicate relay urls");
  const finalRelays = relays.length === 0 ? [...DEFAULT_RELAYS] : relays;

  return {
    version,
    crewId,
    crewName,
    relays: finalRelays,
    key,
  };
}

export function newPayload(crewName: string): CrewJoinPayload {
  const normalized = normalizeCrewName(crewName);
  if (normalized === null) throw new Error("invalid crew name");
  return {
    version: 2,
    crewId: randomHex(16),
    crewName: normalized,
    relays: [...DEFAULT_RELAYS],
    key: randomHex(32),
  };
}
