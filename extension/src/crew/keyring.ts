import { base64UrlToBytes, bufferOf, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../shared/bytes";
import { isLowerHex } from "../shared/hex";
import type { CrewMembership } from "./types";

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

export interface RecoveryPayload {
  identityPrivateKey: string;
  memberships: CrewMembership[];
  version: number;
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
  if (!isLowerHex(privateKeyHex64, 64)) throw new Error("unwrapped keyring is not a valid private key");
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
  memberships: CrewMembership[],
  passphrase: string,
): Promise<string> {
  if (!isLowerHex(identityPrivateKey, 64)) throw new Error("encodeRecovery requires a valid identity private key");
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new Error(`passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`);
  }
  const payload: RecoveryPayload = { identityPrivateKey, memberships, version: RECOVERY_VERSION };
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
    if (
      record.version !== RECOVERY_VERSION ||
      typeof record.identityPrivateKey !== "string" ||
      !isLowerHex(record.identityPrivateKey, 64) ||
      !Array.isArray(record.memberships)
    ) {
      return null;
    }
    return {
      identityPrivateKey: record.identityPrivateKey,
      memberships: record.memberships as CrewMembership[],
      version: RECOVERY_VERSION,
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
