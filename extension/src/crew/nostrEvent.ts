import { schnorr } from "noble-secp256k1";
import { bufferOf, utf8ToBytes } from "../shared/bytes";
import { bytesToHex, hexToBytes, isLowerHex } from "../shared/hex";
import { SNAPSHOT_EVENT_KIND } from "./types";
import type { NostrEvent } from "./types";
import { signSchnorr, verifySchnorr } from "./identity";

export const MAX_EVENT_CONTENT_BYTES = 64 * 1024;
export const MAX_CREATED_AT_SKEW_SECONDS = 2 * 60 * 60;
/** Events older than this horizon are rejected as a resource guard; it is far
 * beyond any legitimate snapshot age and purely bounds replay/DoS vectors. */
export const MAX_EVENT_AGE_SECONDS = 2 * 365 * 86400;
export const MAX_EVENT_TAGS = 32;
export const MAX_TAG_VALUES = 8;
export const MAX_TAG_VALUE_BYTES = 256;
const ALLOWED_KINDS = new Set([SNAPSHOT_EVENT_KIND]);

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Total over untrusted input: returns false instead of throwing. */
export async function verifyEvent(evt: unknown, opts: { crewId: string; now: number }): Promise<boolean> {
  if (!isRecord(evt)) return false;
  const { id, pubkey, sig, created_at, kind, tags, content } = evt as Record<string, unknown>;
  if (typeof id !== "string" || typeof pubkey !== "string" || typeof sig !== "string") return false;
  if (typeof content !== "string") return false;
  if (!Number.isInteger(created_at) || !Number.isInteger(kind)) return false;
  const createdAt = created_at as number;
  const eventKind = kind as number;
  if (createdAt <= 0) return false;
  if (createdAt > opts.now + MAX_CREATED_AT_SKEW_SECONDS) return false;
  if (createdAt < opts.now - MAX_EVENT_AGE_SECONDS) return false;
  if (!ALLOWED_KINDS.has(eventKind)) return false;
  if (!isLowerHex(id, 64) || !isLowerHex(pubkey, 64) || !isLowerHex(sig, 128)) return false;
  if (utf8ToBytes(content).length > MAX_EVENT_CONTENT_BYTES) return false;
  if (!Array.isArray(tags) || tags.length > MAX_EVENT_TAGS) return false;
  for (const tag of tags) {
    if (!Array.isArray(tag) || tag.length < 1 || tag.length > MAX_TAG_VALUES) return false;
    for (const value of tag) {
      if (typeof value !== "string" || utf8ToBytes(value).length > MAX_TAG_VALUE_BYTES) return false;
    }
  }
  // Canonical single ["d", crewId] tag; anything else is rejected.
  if (tags.length !== 1 || tags[0]!.length !== 2 || tags[0]![0] !== "d" || tags[0]![1] !== opts.crewId) return false;
  const expectedId = await eventId(evt as unknown as UnsignedEvent);
  if (expectedId !== id) return false;
  return verifySchnorr(id, sig, pubkey);
}
