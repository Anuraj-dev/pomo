import { describe, expect, test } from "bun:test";
import { schnorr } from "noble-secp256k1";
import { bytesToHex, hexToBytes } from "../src/shared/hex";
import { fingerprint, generateIdentity, signSchnorr, verifySchnorr } from "../src/crew/identity";

const MSG = "42".repeat(32);

function flip(s: string, index: number): string {
  const char = s[index] === "0" ? "1" : "0";
  return s.slice(0, index) + char + s.slice(index + 1);
}

describe("identity", () => {
  test("generateIdentity produces lowercase-hex keys, public derived from private", () => {
    const id = generateIdentity();
    expect(id.privateKey).toMatch(/^[0-9a-f]{64}$/);
    expect(id.publicKey).toMatch(/^[0-9a-f]{64}$/);
    expect(id.publicKey).toBe(bytesToHex(schnorr.getPublicKey(hexToBytes(id.privateKey))));
  });

  test("generateIdentity produces unique keys", () => {
    expect(generateIdentity().privateKey).not.toBe(generateIdentity().privateKey);
    expect(generateIdentity().publicKey).not.toBe(generateIdentity().publicKey);
  });

  test("signSchnorr produces a 128-hex signature that verifies", async () => {
    const id = generateIdentity();
    const sig = await signSchnorr(MSG, id.privateKey);
    expect(sig).toMatch(/^[0-9a-f]{128}$/);
    expect(await verifySchnorr(MSG, sig, id.publicKey)).toBe(true);
  });

  test("signSchnorr rejects malformed hex inputs", async () => {
    const id = generateIdentity();
    await expect(signSchnorr("zz".repeat(32), id.privateKey)).rejects.toThrow(/hex/i);
    await expect(signSchnorr(MSG, "00".repeat(31))).rejects.toThrow(/hex/i);
    await expect(signSchnorr(MSG, "FF".repeat(32))).rejects.toThrow(/hex/i);
  });

  test("verifySchnorr rejects tampered signatures, messages, and keys", async () => {
    const id = generateIdentity();
    const sig = await signSchnorr(MSG, id.privateKey);
    expect(await verifySchnorr(MSG, flip(sig, sig.length - 1), id.publicKey)).toBe(false);
    expect(await verifySchnorr(flip(MSG, 10), sig, id.publicKey)).toBe(false);
    expect(await verifySchnorr(MSG, sig, flip(id.publicKey, 5))).toBe(false);
    expect(await verifySchnorr("zz".repeat(32), sig, id.publicKey)).toBe(false);
  });

  test("fingerprint is the last 8 hex characters", () => {
    const id = generateIdentity();
    expect(fingerprint(id.publicKey)).toBe(id.publicKey.slice(-8));
    expect(fingerprint("79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798")).toBe("5b16f81798".slice(-8));
  });
});
