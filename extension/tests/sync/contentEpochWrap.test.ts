import { describe, expect, test } from "bun:test";
import { generateHpkeRecipientKeyPair } from "../../src/sync/crypto/PomoCrypto";
import { openContentEpochKey, wrapContentEpochKey } from "../../src/sync/identity/contentEpochWrap";
import { installProviderContentKey, openProviderBytes, wrapProviderBytes } from "../../src/sync/transport/providerWrap";
import { configureWebRtcIce, recordIceRoute, turnConfigured } from "../../src/sync/transport/webRtcInbox";

describe("content-epoch wrapping on provider routes", () => {
  test("wraps and opens a content key for a device recipient", async () => {
    const pair = await generateHpkeRecipientKeyPair();
    const contentKey = crypto.getRandomValues(new Uint8Array(32));
    const wrap = await wrapContentEpochKey({
      memberId: "aa".repeat(32),
      contentEpoch: 3,
      authorizationFrontierHash: "bb".repeat(32),
      contentKey,
      recipient: { recipientType: "DEVICE", recipientId: "cc".repeat(32), agreementPublicKey: new Uint8Array(65) },
      recipientPublicKey: pair.publicKey,
    });
    const opened = await openContentEpochKey({
      memberId: "aa".repeat(32),
      contentEpoch: 3,
      authorizationFrontierHash: "bb".repeat(32),
      wrap,
      recipient: { recipientType: "DEVICE", recipientId: "cc".repeat(32), agreementPublicKey: new Uint8Array(65) },
      recipientKey: pair,
    });
    expect([...opened]).toEqual([...contentKey]);
  });

  test("provider object wrap round-trips under an installed content key", async () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    installProviderContentKey(key);
    try {
      const plain = new Uint8Array([1, 2, 3, 4]);
      const wrapped = await wrapProviderBytes(plain);
      expect(wrapped.length).toBeGreaterThan(plain.length);
      expect([...(await openProviderBytes(wrapped))]).toEqual([...plain]);
    } finally {
      installProviderContentKey(null);
    }
  });

  test("optional TURN is configured after STUN and labeled honestly", () => {
    configureWebRtcIce({
      stunUrls: ["stun:example"],
      turnUrls: ["turn:relay?transport=udp"],
      turnUsername: "u",
      turnCredential: "p",
    });
    expect(turnConfigured()).toBeTrue();
    expect(recordIceRoute("relay", "udp", "turn:relay")).toBe("RELAYED_TURN_UDP");
  });
});
