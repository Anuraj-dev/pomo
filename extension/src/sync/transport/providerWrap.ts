import { decryptAes256Gcm, encryptAes256Gcm } from "../crypto/PomoCrypto";
import { encodeCanonicalCbor, decodeCanonicalCbor, type CborValue } from "../protocol/cbor";

const LABEL = "pomo-provider-wrapped";
const SCHEMA = 1;

let activeContentKey: Uint8Array | null = null;

/** Install the current content-epoch key used to wrap provider object bytes. */
export function installProviderContentKey(key: Uint8Array | null): void {
  if (key !== null && key.length !== 32) throw new Error("provider content key must be 32 bytes");
  activeContentKey = key === null ? null : key.slice();
}

export function providerContentKeyInstalled(): boolean {
  return activeContentKey !== null;
}

export async function wrapProviderBytes(plaintext: Uint8Array): Promise<Uint8Array> {
  const key = activeContentKey;
  if (key === null) return plaintext.slice();
  const sealed = await encryptAes256Gcm(key, crypto.getRandomValues(new Uint8Array(12)), new Uint8Array(), plaintext);
  return encodeCanonicalCbor([LABEL, SCHEMA, sealed.nonce, sealed.ciphertextAndTag]);
}

export async function openProviderBytes(bytes: Uint8Array): Promise<Uint8Array> {
  const key = activeContentKey;
  if (key === null) return bytes.slice();
  let fields: readonly CborValue[];
  try {
    const decoded = decodeCanonicalCbor(bytes);
    if (!Array.isArray(decoded) || decoded.length !== 4 || decoded[0] !== LABEL || decoded[1] !== SCHEMA) {
      return bytes.slice();
    }
    fields = decoded;
  } catch {
    return bytes.slice();
  }
  const nonce = fields[2];
  const ciphertext = fields[3];
  if (!(nonce instanceof Uint8Array) || !(ciphertext instanceof Uint8Array)) throw new Error("invalid provider wrap");
  return decryptAes256Gcm(key, { nonce, ciphertextAndTag: ciphertext }, new Uint8Array());
}
