import { schnorr } from "noble-secp256k1";
import { utf8ToBytes } from "../shared/bytes";
import { bytesToHex, hexToBytes, isLowerHex } from "../shared/hex";
import type { NostrEvent } from "./types";
import { signSchnorr, verifySchnorr } from "./identity";

export const MAX_EVENT_CONTENT_BYTES = 64 * 1024;
export const MAX_CREATED_AT_SKEW_SECONDS = 2 * 60 * 60;
const ALLOWED_KINDS = new Set([39050]);

export interface UnsignedEvent {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface SignableEvent extends UnsignedEvent {
  id?: string;
}

function bufferOf(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function eventId(evt: UnsignedEvent): Promise<string> {
  const serialized = JSON.stringify([0, evt.pubkey, evt.created_at, evt.kind, evt.tags, evt.content]);
  const digest = await crypto.subtle.digest("SHA-256", bufferOf(utf8ToBytes(serialized)));
  return bytesToHex(new Uint8Array(digest));
}

export async function signEvent(evt: SignableEvent, privateKeyHex64: string): Promise<NostrEvent> {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKeyHex64)));
  const id = await eventId({
    pubkey,
    created_at: evt.created_at,
    kind: evt.kind,
    tags: evt.tags,
    content: evt.content,
  });
  const sig = await signSchnorr(id, privateKeyHex64);
  return {
    id,
    pubkey,
    created_at: evt.created_at,
    kind: evt.kind,
    tags: evt.tags,
    content: evt.content,
    sig,
  };
}

export async function verifyEvent(evt: NostrEvent, opts: { crewId: string; now: number }): Promise<boolean> {
  if (!isLowerHex(evt.id, 64) || !isLowerHex(evt.pubkey, 64) || !isLowerHex(evt.sig, 128)) return false;
  if (!Number.isInteger(evt.created_at)) return false;
  if (evt.created_at > opts.now + MAX_CREATED_AT_SKEW_SECONDS) return false;
  if (!ALLOWED_KINDS.has(evt.kind)) return false;
  if (utf8ToBytes(evt.content).length > MAX_EVENT_CONTENT_BYTES) return false;
  const hasCrewTag = evt.tags.some((tag) => tag.length >= 2 && tag[0] === "d" && tag[1] === opts.crewId);
  if (!hasCrewTag) return false;
  const expectedId = await eventId(evt);
  if (expectedId !== evt.id) return false;
  return verifySchnorr(evt.id, evt.sig, evt.pubkey);
}
