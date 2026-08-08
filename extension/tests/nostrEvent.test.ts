import { describe, expect, test } from "bun:test";
import { eventId, signEvent, verifyEvent } from "../src/crew/nostrEvent";
import type { NostrEvent } from "../src/crew/types";

const PRIVATE_KEY = "00".repeat(31) + "01";
const PUBLIC_KEY = "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";
const CREW_ID = "bb".repeat(16);
const EVENT = {
  pubkey: PUBLIC_KEY,
  created_at: 1700000000,
  kind: 39050,
  tags: [["d", CREW_ID]],
  content: "hello crew",
};
const EXPECTED_ID = "dae9a5cc2d069c5c5817e830efe61643ff53001eea11631435192289058ffbec";

function flip(s: string, index: number): string {
  const char = s[index] === "0" ? "1" : "0";
  return s.slice(0, index) + char + s.slice(index + 1);
}

function opts(overrides: Partial<{ crewId: string; now: number }> = {}) {
  return { crewId: CREW_ID, now: EVENT.created_at, ...overrides };
}

describe("nostrEvent", () => {
  test("eventId matches an independently computed SHA-256", async () => {
    expect(await eventId(EVENT)).toBe(EXPECTED_ID);
  });

  test("signEvent produces a complete, self-consistent Nostr event", async () => {
    const evt = await signEvent(EVENT, PRIVATE_KEY);
    expect(evt.id).toBe(EXPECTED_ID);
    expect(evt.pubkey).toBe(PUBLIC_KEY);
    expect(evt.created_at).toBe(EVENT.created_at);
    expect(evt.kind).toBe(EVENT.kind);
    expect(evt.tags).toEqual(EVENT.tags);
    expect(evt.content).toBe(EVENT.content);
    expect(evt.sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifyEvent(evt, opts())).toBe(true);
  });

  test("verifyEvent accepts a genuine event", async () => {
    const evt: NostrEvent = {
      id: EXPECTED_ID,
      pubkey: PUBLIC_KEY,
      created_at: EVENT.created_at,
      kind: EVENT.kind,
      tags: EVENT.tags,
      content: EVENT.content,
      sig: (await signEvent(EVENT, PRIVATE_KEY)).sig,
    };
    expect(await verifyEvent(evt, opts())).toBe(true);
  });

  test("verifyEvent rejects tampered events", async () => {
    const evt = await signEvent(EVENT, PRIVATE_KEY);
    expect(await verifyEvent({ ...evt, id: flip(evt.id, 3) }, opts())).toBe(false);
    expect(await verifyEvent({ ...evt, sig: flip(evt.sig, 7) }, opts())).toBe(false);
    expect(await verifyEvent({ ...evt, content: evt.content + "!" }, opts())).toBe(false);
    expect(await verifyEvent({ ...evt, pubkey: flip(evt.pubkey, 1) }, opts())).toBe(false);
    expect(await verifyEvent({ ...evt, id: "zz".repeat(32) }, opts())).toBe(false);
    expect(await verifyEvent({ ...evt, sig: "ab".repeat(63) }, opts())).toBe(false);
  });

  test("verifyEvent rejects events outside the allowed kind", async () => {
    const evt = await signEvent({ ...EVENT, kind: 1 }, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts())).toBe(false);
  });

  test("verifyEvent rejects events whose crew d-tag does not match", async () => {
    const evt = await signEvent({ ...EVENT, tags: [["d", "aa".repeat(16)]] }, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts())).toBe(false);
  });

  test("verifyEvent rejects events missing the crew d-tag", async () => {
    const evt = await signEvent({ ...EVENT, tags: [] }, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts())).toBe(false);
  });

  test("verifyEvent rejects events with excessive content", async () => {
    const evt = await signEvent({ ...EVENT, content: "x".repeat(64 * 1024 + 1) }, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts())).toBe(false);
  });

  test("verifyEvent rejects non-integer created_at", async () => {
    const evt = await signEvent({ ...EVENT, created_at: 1700000000.5 }, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts())).toBe(false);
  });

  test("verifyEvent rejects future-skewed created_at but accepts old events", async () => {
    const evt = await signEvent(EVENT, PRIVATE_KEY);
    expect(await verifyEvent(evt, opts({ now: EVENT.created_at - 3 * 60 * 60 }))).toBe(false);
    expect(await verifyEvent(evt, opts({ now: EVENT.created_at - 60 * 60 }))).toBe(true);
    expect(await verifyEvent(evt, opts({ now: EVENT.created_at + 3 * 60 * 60 }))).toBe(true);
  });
});
