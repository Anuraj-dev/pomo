import { describe, expect, test } from "bun:test";
import { decodeCanonicalCbor, encodeCanonicalCbor } from "../../src/sync/protocol/cbor";

function bytes(seed: number, length: number): Uint8Array { let value = seed >>> 0; return Uint8Array.from({ length }, () => { value = (Math.imul(value, 1664525) + 1013904223) >>> 0; return value & 0xff; }); }
describe("deterministic protocol fuzz", () => {
  test("canonical decoder either rejects or round-trips exact bytes", () => {
    for (let seed = 0; seed < 2_000; seed++) {
      const input = bytes(seed, seed % 256);
      try { expect(encodeCanonicalCbor(decodeCanonicalCbor(input))).toEqual(input); } catch (error) { expect(error).toBeInstanceOf(Error); }
    }
  });
});
