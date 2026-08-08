import { describe, expect, test } from "bun:test";
import {
  MAX_ENCODED_LENGTH,
  MIN_PASSPHRASE_LENGTH,
  RECOVERY_PREFIX,
  decodeRecovery,
  encodeRecovery,
  exportWrappingKey,
  generateWrappingKey,
  importWrappingKey,
  unwrapIdentityKey,
  wrapIdentityKey,
} from "../src/crew/keyring";
import { base64UrlToBytes, bytesToBase64Url, bytesToUtf8, utf8ToBytes } from "../src/shared/bytes";

const PRIVATE_KEY = "0".repeat(63) + "1";
const PASSPHRASE = "correct horse battery staple";

describe("wrapping key round trip", () => {
  test("wrap and unwrap returns the same key material", async () => {
    const wrappingKey = await generateWrappingKey();
    const envelope = await wrapIdentityKey(PRIVATE_KEY, wrappingKey);
    expect(await unwrapIdentityKey(envelope, wrappingKey)).toBe(PRIVATE_KEY);
  });

  test("exporting and importing the wrapping key preserves identity", async () => {
    const wrappingKey = await generateWrappingKey();
    const encoded = await exportWrappingKey(wrappingKey);
    const reimported = await importWrappingKey(encoded);
    const envelope = await wrapIdentityKey(PRIVATE_KEY, reimported);
    expect(await unwrapIdentityKey(envelope, reimported)).toBe(PRIVATE_KEY);
  });

  test("a different wrapping key cannot unwrap", async () => {
    const envelope = await wrapIdentityKey(PRIVATE_KEY, await generateWrappingKey());
    await expect(unwrapIdentityKey(envelope, await generateWrappingKey())).rejects.toThrow(/wrong wrapping key/);
  });

  test("rejects malformed key material", async () => {
    const wrappingKey = await generateWrappingKey();
    await expect(wrapIdentityKey("not hex at all", wrappingKey)).rejects.toThrow(/64-char lowercase hex/);
    await expect(unwrapIdentityKey("not json", wrappingKey)).rejects.toThrow(/invalid keyring envelope/);
    await expect(unwrapIdentityKey('{"version":99,"nonce":"","ciphertext":""}', wrappingKey)).rejects.toThrow(
      /unsupported keyring version/,
    );
  });
});

describe("recovery codec", () => {
  test("encode and decode round trips the identity and memberships", async () => {
    const memberships = [
      { crewId: "a".repeat(32), crewName: "Late Night", relays: ["wss://relay.example"], key: "b".repeat(64) },
    ];
    const encoded = await encodeRecovery(PRIVATE_KEY, memberships, PASSPHRASE);
    expect(encoded.startsWith(RECOVERY_PREFIX)).toBe(true);

    const decoded = await decodeRecovery(encoded, PASSPHRASE);
    expect(decoded).not.toBeNull();
    expect(decoded!.identityPrivateKey).toBe(PRIVATE_KEY);
    expect(decoded!.memberships[0]).toMatchObject({
      crewId: memberships[0]!.crewId,
      crewName: memberships[0]!.crewName,
      joinCode: expect.stringMatching(/^pomo-crew\.v2\./),
      relays: memberships[0]!.relays,
      key: memberships[0]!.key,
      displayName: memberships[0]!.crewName,
      protocolVersion: 2,
      isArchived: false,
    });
  });

  test("the wrong passphrase decodes to null", async () => {
    const encoded = await encodeRecovery(PRIVATE_KEY, [], PASSPHRASE);
    expect(await decodeRecovery(encoded, "wrong passphrase 123")).toBeNull();
  });

  test("short passphrases are rejected at encode", async () => {
    const short = "a".repeat(MIN_PASSPHRASE_LENGTH - 1);
    await expect(encodeRecovery(PRIVATE_KEY, [], short)).rejects.toThrow(/at least 12 characters/);
  });

  test("rejects private keys outside the secp256k1 scalar range", async (): Promise<void> => {
    await expect(encodeRecovery("0".repeat(64), [], PASSPHRASE)).rejects.toThrow(/secp256k1/);
  });

  test("a valid passphrase at the minimum length works", async () => {
    const min = "a".repeat(MIN_PASSPHRASE_LENGTH);
    const encoded = await encodeRecovery(PRIVATE_KEY, [], min);
    expect(await decodeRecovery(encoded, min)).not.toBeNull();
  });

  test("rejects non-prefixed or oversized values", async () => {
    expect(await decodeRecovery("not-a-recovery-file", PASSPHRASE)).toBeNull();
    const blob = "x".repeat(MAX_ENCODED_LENGTH + 1);
    expect(await decodeRecovery(RECOVERY_PREFIX + blob, PASSPHRASE)).toBeNull();
  });

  test("rejects envelopes with unsupported parameters", async () => {
    const encoded = await encodeRecovery(PRIVATE_KEY, [], PASSPHRASE);
    const body = encoded.slice(RECOVERY_PREFIX.length);
    const envelope = JSON.parse(bytesToUtf8(base64UrlToBytes(body)));
    const rebuild = (patch: Record<string, unknown>) =>
      RECOVERY_PREFIX + bytesToBase64Url(utf8ToBytes(JSON.stringify({ ...envelope, ...patch })));

    expect(await decodeRecovery(rebuild({ version: 2 }), PASSPHRASE)).toBeNull();
    expect(await decodeRecovery(rebuild({ iterations: 50_000 }), PASSPHRASE)).toBeNull();
    expect(await decodeRecovery(rebuild({ cipher: "AES/CTR/NoPadding" }), PASSPHRASE)).toBeNull();
    expect(await decodeRecovery(rebuild({ salt: "" }), PASSPHRASE)).toBeNull();
    expect(await decodeRecovery(rebuild({ nonce: "" }), PASSPHRASE)).toBeNull();
    expect(await decodeRecovery(rebuild({ ciphertext: "" }), PASSPHRASE)).toBeNull();
  });

  test("tampered ciphertext decodes to null", async () => {
    const encoded = await encodeRecovery(PRIVATE_KEY, [], PASSPHRASE);
    const body = encoded.slice(RECOVERY_PREFIX.length);
    const envelope = JSON.parse(bytesToUtf8(base64UrlToBytes(body)));
    envelope.ciphertext = "AAAAAAAAAAAAAAAAAAAAAA";
    const tampered = RECOVERY_PREFIX + bytesToBase64Url(utf8ToBytes(JSON.stringify(envelope)));
    expect(await decodeRecovery(tampered, PASSPHRASE)).toBeNull();
  });
});
