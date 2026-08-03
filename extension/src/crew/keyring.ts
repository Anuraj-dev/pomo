import { base64UrlToBytes, bufferOf, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../shared/bytes";
import { isLowerHex } from "../shared/hex";
import { DEFAULT_RELAYS, decodePayload, encodePrefixedPayload, isValidRelayUrl } from "./joinCode";
import { publicKeyOf } from "./identity";
import { normalizeCrewName, normalizeDisplayName } from "./validation";
import type { CrewMembership, StoredMembership } from "./types";

export const KEYRING_STORAGE_KEY = "pomo:keyring";

export const RECOVERY_PREFIX = "pomo-recovery.v1.";
export const RECOVERY_VERSION = 1;
export const PBKDF2_NAME = "PBKDF2WithHmacSHA256";
export const CIPHER_NAME = "AES/GCM/NoPadding";
export const PBKDF2_ITERATIONS = 600_000;
export const MIN_PBKDF2_ITERATIONS = 100_000;
export const MAX_PBKDF2_ITERATIONS = 2_000_000;
export const MIN_PASSPHRASE_LENGTH = 12;
export const MAX_ENCODED_LENGTH = 128 * 1024;
export const SALT_BYTES = 16;
export const NONCE_BYTES = 12;
export const GCM_TAG_BITS = 128;

const AES_GCM = { name: "AES-GCM", tagLength: GCM_TAG_BITS } as const;

function isValidPrivateKey(value: unknown): value is string {
  if (typeof value !== "string" || !isLowerHex(value, 64)) return false;
  try {
    publicKeyOf(value);
    return true;
  } catch {
    return false;
  }
}

export interface RecoveryPayload {
  identityPrivateKey: string;
  memberships: RecoveryMembership[];
}

export interface RecoveryMembership {
  crewId: string;
  crewName: string;
  joinCode: string;
  relays: string[];
  key: string;
  displayName: string;
  protocolVersion: number;
  isArchived: boolean;
}

interface RecoveryEnvelope {
  version: number;
  kdf: string;
  iterations: number;
  cipher: string;
  salt: string;
  nonce: string;
  ciphertext: string;
}

export async function generateWrappingKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt", "decrypt"]);
}

export async function exportWrappingKey(key: CryptoKey): Promise<string> {
  return bytesToBase64Url(new Uint8Array(await crypto.subtle.exportKey("raw", key)));
}

export async function importWrappingKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", bufferOf(base64UrlToBytes(encoded)), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function wrapIdentityKey(privateKeyHex64: string, wrappingKey: CryptoKey): Promise<string> {
  if (!isLowerHex(privateKeyHex64, 64)) throw new Error("wrapIdentityKey requires a 64-char lowercase hex private key");
  if (!isValidPrivateKey(privateKeyHex64)) throw new Error("wrapIdentityKey requires a valid secp256k1 private key");
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ ...AES_GCM, iv: nonce }, wrappingKey, bufferOf(utf8ToBytes(privateKeyHex64))),
  );
  return JSON.stringify({
    version: RECOVERY_VERSION,
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext),
  });
}

export async function unwrapIdentityKey(envelopeJson: string, wrappingKey: CryptoKey): Promise<string> {
  let envelope: unknown;
  try {
    envelope = JSON.parse(envelopeJson);
  } catch {
    throw new Error("invalid keyring envelope");
  }
  if (typeof envelope !== "object" || envelope === null) throw new Error("invalid keyring envelope");
  const record = envelope as Record<string, unknown>;
  if (record.version !== RECOVERY_VERSION) throw new Error("unsupported keyring version");
  if (typeof record.nonce !== "string" || typeof record.ciphertext !== "string") {
    throw new Error("invalid keyring envelope");
  }
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt(
      { ...AES_GCM, iv: bufferOf(base64UrlToBytes(record.nonce)) },
      wrappingKey,
      bufferOf(base64UrlToBytes(record.ciphertext)),
    );
  } catch {
    throw new Error("failed to unwrap keyring: wrong wrapping key or tampered envelope");
  }
  const privateKeyHex64 = bytesToUtf8(new Uint8Array(plaintext));
  if (!isValidPrivateKey(privateKeyHex64)) throw new Error("unwrapped keyring is not a valid private key");
  return privateKeyHex64;
}

async function keyFromPassphrase(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", bufferOf(utf8ToBytes(passphrase)), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: bufferOf(salt), iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function encodeEnvelope(envelope: RecoveryEnvelope): string {
  return RECOVERY_PREFIX + bytesToBase64Url(utf8ToBytes(JSON.stringify(envelope)));
}

export async function encodeRecovery(
  identityPrivateKey: string,
  memberships: Array<CrewMembership | StoredMembership>,
  passphrase: string,
): Promise<string> {
  if (!isLowerHex(identityPrivateKey, 64)) throw new Error("encodeRecovery requires a valid identity private key");
  if (!isValidPrivateKey(identityPrivateKey)) throw new Error("encodeRecovery requires a valid secp256k1 private key");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const normalizedMemberships = memberships.map((membership) => {
    const crewName = normalizeCrewName(membership.crewName);
    const displayName = normalizeDisplayName("displayName" in membership ? membership.displayName : membership.crewName);
    const relays = membership.relays.length === 0 ? [...DEFAULT_RELAYS] : [...membership.relays];
    if (
      crewName === null ||
      displayName === null ||
      !isLowerHex(membership.crewId, 32) ||
      !isLowerHex(membership.key, 64) ||
      !relays.every(isValidRelayUrl)
    ) {
      throw new Error("encodeRecovery received an invalid Crew membership");
    }
    return { membership, crewName, displayName, relays };
  });
  const payload: RecoveryPayload = {
    identityPrivateKey,
    memberships: normalizedMemberships.map(({ membership, crewName, displayName, relays }) => ({
      crewId: membership.crewId,
      crewName,
      joinCode: encodePrefixedPayload({
        version: 2,
        crewId: membership.crewId,
        crewName,
        relays,
        key: membership.key,
      }),
      relays,
      key: membership.key,
      displayName,
      protocolVersion: 2,
      isArchived: false,
    })),
  };
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const key = await keyFromPassphrase(passphrase, salt, PBKDF2_ITERATIONS);
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ ...AES_GCM, iv: nonce }, key, bufferOf(utf8ToBytes(JSON.stringify(payload)))),
  );
  return encodeEnvelope({
    version: RECOVERY_VERSION,
    kdf: PBKDF2_NAME,
    iterations: PBKDF2_ITERATIONS,
    cipher: CIPHER_NAME,
    salt: bytesToBase64Url(salt),
    nonce: bytesToBase64Url(nonce),
    ciphertext: bytesToBase64Url(ciphertext),
  });
}

export async function decodeRecovery(value: string, passphrase: string): Promise<RecoveryPayload | null> {
  if (!value.startsWith(RECOVERY_PREFIX) || value.length > MAX_ENCODED_LENGTH) return null;
  try {
    const envelopeJson = bytesToUtf8(base64UrlToBytes(value.slice(RECOVERY_PREFIX.length)));
    const parsed: unknown = JSON.parse(envelopeJson);
    if (typeof parsed !== "object" || parsed === null) return null;
    const envelope = parsed as RecoveryEnvelope;
    if (!isSupported(envelope)) return null;
    const key = await keyFromPassphrase(passphrase, base64UrlToBytes(envelope.salt), envelope.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { ...AES_GCM, iv: bufferOf(base64UrlToBytes(envelope.nonce)) },
      key,
      bufferOf(base64UrlToBytes(envelope.ciphertext)),
    );
    const payload: unknown = JSON.parse(bytesToUtf8(new Uint8Array(plaintext)));
    if (typeof payload !== "object" || payload === null) return null;
    const record = payload as Record<string, unknown>;
    if (!isValidPrivateKey(record.identityPrivateKey) || !Array.isArray(record.memberships)) {
      return null;
    }
    const memberships: RecoveryMembership[] = [];
    for (const raw of record.memberships) {
      if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
      const membership = raw as Record<string, unknown>;
      if (
        typeof membership.crewId !== "string" ||
        typeof membership.crewName !== "string" ||
        typeof membership.joinCode !== "string" ||
        !Array.isArray(membership.relays) ||
        !membership.relays.every((relay) => typeof relay === "string" && isValidRelayUrl(relay)) ||
        typeof membership.key !== "string" ||
        typeof membership.displayName !== "string" ||
        membership.protocolVersion !== 2 ||
        membership.isArchived !== false ||
        normalizeCrewName(membership.crewName) !== membership.crewName ||
        normalizeDisplayName(membership.displayName) !== membership.displayName ||
        !isLowerHex(membership.crewId, 32) ||
        !isLowerHex(membership.key, 64)
      ) {
        return null;
      }
      let decoded: ReturnType<typeof decodePayload>;
      try {
        decoded = decodePayload(membership.joinCode);
      } catch {
        return null;
      }
      if (
        decoded.crewId !== membership.crewId ||
        decoded.crewName !== membership.crewName ||
        decoded.key !== membership.key ||
        decoded.relays.join("\n") !== (membership.relays as string[]).join("\n")
      ) {
        return null;
      }
      memberships.push({
        crewId: membership.crewId,
        crewName: membership.crewName,
        joinCode: membership.joinCode,
        relays: [...(membership.relays as string[])],
        key: membership.key,
        displayName: membership.displayName,
        protocolVersion: 2,
        isArchived: false,
      });
    }
    return {
      identityPrivateKey: record.identityPrivateKey,
      memberships,
    };
  } catch {
    return null;
  }
}

function isSupported(envelope: RecoveryEnvelope): boolean {
  let saltBytes: Uint8Array;
  let nonceBytes: Uint8Array;
  try {
    saltBytes = base64UrlToBytes(envelope.salt);
    nonceBytes = base64UrlToBytes(envelope.nonce);
  } catch {
    return false;
  }
  return (
    envelope.version === RECOVERY_VERSION &&
    envelope.kdf === PBKDF2_NAME &&
    envelope.iterations >= MIN_PBKDF2_ITERATIONS &&
    envelope.iterations <= MAX_PBKDF2_ITERATIONS &&
    envelope.cipher === CIPHER_NAME &&
    saltBytes.length === SALT_BYTES &&
    nonceBytes.length === NONCE_BYTES &&
    typeof envelope.ciphertext === "string" &&
    envelope.ciphertext.length > 0
  );
}
