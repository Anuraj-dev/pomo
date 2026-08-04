import { describe, expect, test } from "bun:test";
import {
  DEFAULT_RELAYS,
  decodePayload,
  encodePayload,
  newPayload,
  type CrewJoinPayload,
} from "../src/crew/joinCode";

function payload(overrides: Partial<CrewJoinPayload> = {}): CrewJoinPayload {
  return {
    version: 2,
    crewId: "ab".repeat(16),
    crewName: "Test Crew",
    relays: [...DEFAULT_RELAYS],
    key: "cd".repeat(32),
    ...overrides,
  };
}

function toBase64Url(json: string): string {
  return btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

describe("join code encode/decode", () => {
  test("encodePayload emits unpadded base64url of JSON in declared field order", () => {
    const p = payload();
    const out = encodePayload(p);
    expect(out).not.toMatch(/[+/=]/);
    const json = atob(out.replace(/-/g, "+").replace(/_/g, "/"));
    expect(json).toBe(
      JSON.stringify({ version: 2, crewId: p.crewId, crewName: p.crewName, relays: p.relays, key: p.key }),
    );
  });

  test("decodePayload roundtrips a bare payload", () => {
    const p = payload();
    expect(decodePayload(encodePayload(p))).toEqual(p);
  });

  test("decodePayload accepts the pomo://crew/join/v2/ prefix", () => {
    const p = payload();
    expect(decodePayload(`pomo://crew/join/v2/${encodePayload(p)}`)).toEqual(p);
  });

  test("decodePayload accepts the pomo-crew.v2. prefix", () => {
    const p = payload();
    expect(decodePayload(`pomo-crew.v2.${encodePayload(p)}`)).toEqual(p);
  });

  test("decodePayload rejects legacy v1 codes", () => {
    expect(() => decodePayload("pomo-crew.abc")).toThrow("v1 join codes are not supported");
  });

  test("decodePayload rejects versions other than 2", () => {
    expect(() => decodePayload(encodePayload(payload({ version: 1 })))).toThrow(/version/i);
    const stringVersion = { ...payload(), version: "2" };
    expect(() => decodePayload(toBase64Url(JSON.stringify(stringVersion)))).toThrow(/version/i);
  });

  test("decodePayload rejects invalid crewId values", () => {
    expect(() => decodePayload(encodePayload(payload({ crewId: "AB".repeat(16) })))).toThrow(/crewId/i);
    expect(() => decodePayload(encodePayload(payload({ crewId: "ab".repeat(15) })))).toThrow(/crewId/i);
  });

  test("decodePayload rejects invalid keys", () => {
    expect(() => decodePayload(encodePayload(payload({ key: "CD".repeat(32) })))).toThrow(/key/i);
  });

  test("decodePayload rejects non-wss or blank-host relays", () => {
    expect(() => decodePayload(encodePayload(payload({ relays: ["http://relay.example.com"] })))).toThrow(/relay/i);
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://"] })))).toThrow(/relay/i);
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://host/path"] })))).not.toThrow();
  });

  test("accepts ordinary DNS names beginning with private IPv6 prefixes", () => {
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://fdroid.example.org"] })))).not.toThrow();
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://fc-relay.example.com"] })))).not.toThrow();
  });

  test("rejects IPv4-mapped private IPv6 relay hosts", () => {
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://[::ffff:127.0.0.1]"] })))).toThrow(/relay/i);
  });

  test("rejects IPv6 unspecified and loopback relay hosts", () => {
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://[::]"] })))).toThrow(/relay/i);
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://[::1]"] })))).toThrow(/relay/i);
  });

  test("decodePayload rejects relays with userinfo credentials", () => {
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://user:pass@relay.example.com"] })))).toThrow(
      /relay/i,
    );
    expect(() => decodePayload(encodePayload(payload({ relays: ["wss://user@relay.example.com"] })))).toThrow(/relay/i);
  });

  test("crew names are measured in graphemes, not code points", () => {
    const emojiFamily = "👨‍👩‍👧‍👦"; // 7 code points, 1 grapheme
    expect(decodePayload(encodePayload(payload({ crewName: emojiFamily }))).crewName).toBe(emojiFamily);
    const many = emojiFamily.repeat(41);
    expect(() => decodePayload(encodePayload(payload({ crewName: many })))).toThrow(/crew name/i);
    expect(decodePayload(encodePayload(payload({ crewName: emojiFamily.repeat(40) }))).crewName).toBe(
      emojiFamily.repeat(40),
    );
  });

  test("decodePayload rejects duplicate relays", () => {
    const dupe = [DEFAULT_RELAYS[0]!, DEFAULT_RELAYS[0]!];
    expect(() => decodePayload(encodePayload(payload({ relays: dupe })))).toThrow(/relay/i);
  });

  test("decodePayload rejects more than 8 relays", () => {
    const many = Array.from({ length: 9 }, (_, i) => `wss://relay${i}.example.com`);
    expect(() => decodePayload(encodePayload(payload({ relays: many })))).toThrow(/relay/i);
  });

  test("decodePayload falls back to DEFAULT_RELAYS for an empty relay list", () => {
    const decoded = decodePayload(encodePayload(payload({ relays: [] })));
    expect(decoded.relays).toEqual(DEFAULT_RELAYS);
  });

  test("decodePayload defaults relays when the field is absent", () => {
    const json = JSON.stringify({
      version: 2,
      crewId: "ab".repeat(16),
      crewName: "Test",
      key: "cd".repeat(32),
    });
    expect(decodePayload(toBase64Url(json)).relays).toEqual(DEFAULT_RELAYS);
  });

  test("decodePayload NFC-normalizes and collapses whitespace in crew names", () => {
    const decoded = decodePayload(encodePayload(payload({ crewName: "  e\u0301quipe   Test \t " })));
    expect(decoded.crewName).toBe("équipe Test");
  });

  test("decodePayload rejects crew names with control characters or bidi overrides", () => {
    expect(() => decodePayload(encodePayload(payload({ crewName: "Bad\u0000Name" })))).toThrow(/crew name/i);
    expect(() => decodePayload(encodePayload(payload({ crewName: "Bad\u007fName" })))).toThrow(/crew name/i);
    expect(() => decodePayload(encodePayload(payload({ crewName: "Bad\u202eName" })))).toThrow(/crew name/i);
  });

  test("decodePayload rejects blank or over-long crew names", () => {
    expect(() => decodePayload(encodePayload(payload({ crewName: "   " })))).toThrow(/crew name/i);
    expect(() => decodePayload(encodePayload(payload({ crewName: "a".repeat(41) })))).toThrow(/crew name/i);
    expect(decodePayload(encodePayload(payload({ crewName: "a".repeat(40) }))).crewName).toBe("a".repeat(40));
  });

  test("decodePayload rejects malformed or truncated input", () => {
    expect(() => decodePayload("pomo://crew/join/v2/")).toThrow();
    expect(() => decodePayload("pomo-crew.v2.!!!!")).toThrow();
    expect(() => decodePayload("not base64url !!!")).toThrow();
    expect(() => decodePayload("a".repeat(20_000))).toThrow();
  });

  test("decodePayload rejects payloads missing required fields", () => {
    const json = JSON.stringify({
      version: 2,
      crewName: "Test",
      relays: [...DEFAULT_RELAYS],
      key: "cd".repeat(32),
    });
    expect(() => decodePayload(toBase64Url(json))).toThrow(/crewId/i);
  });
});

describe("join code creation", () => {
  test("newPayload generates a valid, unique payload", () => {
    const a = newPayload("  My   Crew  ");
    const b = newPayload("My Crew");
    expect(a.version).toBe(2);
    expect(a.crewName).toBe("My Crew");
    expect(a.relays).toEqual(DEFAULT_RELAYS);
    expect(a.crewId).toMatch(/^[0-9a-f]{32}$/);
    expect(a.key).toMatch(/^[0-9a-f]{64}$/);
    expect(a.crewId).not.toBe(b.crewId);
    expect(a.key).not.toBe(b.key);
  });

  test("newPayload rejects invalid crew names", () => {
    expect(() => newPayload("   ")).toThrow(/crew name/i);
    expect(() => newPayload("x".repeat(41))).toThrow(/crew name/i);
  });
});
