import { describe, expect, test } from "bun:test";
import { classifyCandidate, orderedIceServers, reconstructRoutePeers } from "../../src/sync/transport/WebRtcRouteManager";
import {
  encodeSdpSignal,
  decodeSdpSignal,
  encryptSignal,
  importRendezvousSignalKey,
  RendezvousReplayWindow,
  signalLocator,
  WebRtcRendezvousSignaling,
  type NostrSyncEvent,
  type NostrSyncTransport,
} from "../../src/sync/transport/nostrRendezvous";

class MemoryRelay implements NostrSyncTransport {
  readonly events: NostrSyncEvent[] = [];
  publish(event: NostrSyncEvent): void {
    this.events.push(event);
  }
  pull(): NostrSyncEvent[] {
    return [...this.events];
  }
}

describe("packaged Chrome WebRTC and encrypted rendezvous", () => {
  test("tries direct ICE providers before optional TURN and labels relay honestly", () => {
    const servers = orderedIceServers({ stunUrls: ["stun:one", "stun:two"], turnUrls: ["turn:relay?transport=udp", "turns:relay?transport=tcp"], turnUsername: "u", turnCredential: "p" });
    expect(servers.map((server) => server.urls)).toEqual(["stun:one", "stun:two", "turn:relay?transport=udp", "turns:relay?transport=tcp"]);
    expect(classifyCandidate("host", "udp", null)).toBe("DIRECT_HOST");
    expect(classifyCandidate("srflx", "udp", null)).toBe("DIRECT_SERVER_REFLEXIVE");
    expect(classifyCandidate("relay", "udp", "turn:relay")).toBe("RELAYED_TURN_UDP");
    expect(classifyCandidate("relay", "tcp", "turns:relay")).toBe("RELAYED_TURN_TCP_TLS");
  });

  test("reconstructs route intent from durable obligations after worker or offscreen loss", () => {
    expect(reconstructRoutePeers([
      { peerDeviceId: "chrome-b", operationId: "op-2" },
      { peerDeviceId: "chrome-a", operationId: "op-1" },
      { peerDeviceId: "chrome-b", operationId: "op-3" },
    ])).toEqual(["chrome-a", "chrome-b"]);
  });

  test("encrypts bounded signaling and rejects replay", async () => {
    const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    const encrypted = await encryptSignal(key, { signalId: "signal-1", sequence: 1, expiresAt: Date.now() + 60_000, payload: new Uint8Array([1, 2, 3]) });
    const window = new RendezvousReplayWindow();
    expect((await window.decrypt(key, encrypted)).payload).toEqual(new Uint8Array([1, 2, 3]));
    await expect(window.decrypt(key, encrypted)).rejects.toThrow(/replayed/);
  });

  test("SDP signals round-trip and use a replaceable locator per pair", async () => {
    const from = "aa".repeat(32);
    const to = "bb".repeat(32);
    const encoded = encodeSdpSignal({ kind: "sdp-offer", from, to, sdpType: "offer", sdp: "v=0" });
    expect(decodeSdpSignal(encoded)).toEqual({ kind: "sdp-offer", from, to, sdpType: "offer", sdp: "v=0" });
    expect(signalLocator("session-1", from, to)).toBe(`session-1:signal:${from}:${to}`);
    expect(signalLocator("session-1", from, to)).not.toBe("session-1");
  });

  test("encrypted SDP publish is replay-safe and never tagged as a durable offer", async () => {
    const relay = new MemoryRelay();
    const key = await importRendezvousSignalKey(crypto.getRandomValues(new Uint8Array(32)));
    const from = "aa".repeat(32);
    const to = "bb".repeat(32);
    const signaling = new WebRtcRendezvousSignaling(from, "session-1", key, relay, from);
    await signaling.publish({ kind: "sdp-offer", from, to, sdpType: "offer", sdp: "offer-1" });
    await signaling.publish({ kind: "sdp-offer", from, to, sdpType: "offer", sdp: "offer-2" });
    const pulled = await signaling.pull(from, to);
    expect(pulled[pulled.length - 1]?.sdp).toBe("offer-2");
    expect(relay.events.every((event) => event.tags.some((tag) => tag[0] === "pomo" && tag[1] === "signal"))).toBeTrue();
    expect(relay.events.some((event) => event.tags.some((tag) => tag[0] === "pomo" && tag[1] === "offer"))).toBeFalse();
    expect(await signaling.pull(from, to)).toHaveLength(2);
  });
});
