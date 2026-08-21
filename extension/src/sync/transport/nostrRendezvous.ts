import { bufferOf } from "../../shared/bytes";

const MAX_SIGNAL_BYTES = 16_384;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;

export interface RendezvousSignal { readonly signalId: string; readonly sequence: number; readonly expiresAt: number; readonly payload: Uint8Array }
export interface EncryptedSignal { readonly nonce: Uint8Array; readonly ciphertext: Uint8Array }

export async function encryptSignal(key: CryptoKey, signal: RendezvousSignal): Promise<EncryptedSignal> {
  if (signal.payload.length > MAX_SIGNAL_BYTES || signal.sequence < 0 || signal.expiresAt <= Date.now()) throw new Error("invalid rendezvous signal");
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const body = new TextEncoder().encode(JSON.stringify({ signalId: signal.signalId, sequence: signal.sequence, expiresAt: signal.expiresAt, payload: [...signal.payload] }));
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, key, body));
  return { nonce, ciphertext };
}

export class RendezvousReplayWindow {
  readonly #seen = new Set<string>();
  async decrypt(key: CryptoKey, encrypted: EncryptedSignal, now = Date.now()): Promise<RendezvousSignal> {
    if (encrypted.nonce.length !== 12 || encrypted.ciphertext.length > MAX_SIGNAL_BYTES + 1_024) throw new Error("invalid encrypted signal");
    const raw = new Uint8Array(await crypto.subtle.decrypt({ name: "AES-GCM", iv: bufferOf(encrypted.nonce) }, key, bufferOf(encrypted.ciphertext)));
    const value = JSON.parse(new TextDecoder().decode(raw)) as { signalId: string; sequence: number; expiresAt: number; payload: number[] };
    if (!Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.expiresAt < now || value.expiresAt > now + MAX_CLOCK_SKEW_MS || this.#seen.has(value.signalId)) throw new Error("expired or replayed rendezvous signal");
    this.#seen.add(value.signalId);
    return { signalId: value.signalId, sequence: value.sequence, expiresAt: value.expiresAt, payload: new Uint8Array(value.payload) };
  }
}
