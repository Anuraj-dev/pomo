import { describe, expect, test } from "bun:test";
import { classifyCandidate, orderedIceServers, reconstructRoutePeers } from "../../src/sync/transport/WebRtcRouteManager";
import { encryptSignal, RendezvousReplayWindow } from "../../src/sync/transport/nostrRendezvous";

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
});
