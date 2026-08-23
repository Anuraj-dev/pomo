import { describe, expect, test } from "bun:test";
import { resumeAdmission } from "../../src/sync/identity/admissionRuntime";
import { decodeReplicaOffer } from "../../src/sync/identity/replicaOffer";
import { LIVE_PEERS_KEY, type LivePeerStorage } from "../../src/sync/transport/chromeLivePeer";

class MemoryStorage implements LivePeerStorage {
  constructor(private readonly data: Record<string, unknown> = {}) {}
  async get(keys: readonly string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.flatMap((key) => this.data[key] === undefined ? [] : [[key, this.data[key]]]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }
}

describe("admission runtime", () => {
  test("first resume creates an offer and reaches READY_ACK_COMMITTED without skipping fingerprints", async () => {
    const storage = new MemoryStorage();
    const first = await resumeAdmission({ storage, lanDeviceId: "aa".repeat(32) });
    const offer = decodeReplicaOffer(first.offer);
    expect(offer.lanDeviceId).toBe("aa".repeat(32));
    expect(first.state.admission.stage).toBe("READY_ACK_COMMITTED");
    expect(first.state.admission.fingerprint).toContain(offer.memberId);
  });

  test("pasted offer with a different Member is not stored as a peer", async () => {
    const storage = new MemoryStorage();
    await resumeAdmission({ storage, lanDeviceId: "aa".repeat(32) });
    await resumeAdmission({
      storage,
      lanDeviceId: "aa".repeat(32),
      remoteOffer: JSON.stringify({
        schema: 1,
        kind: "pomo-replica-offer",
        memberId: "ff".repeat(32),
        admissionId: "11".repeat(32),
        identityDeviceId: "22".repeat(32),
        lanDeviceId: "33".repeat(32),
        transcriptHash: "44".repeat(32),
        endpoint: "http://192.168.0.2:1/replica",
      }),
    });
    const peers = (await storage.get([LIVE_PEERS_KEY]))[LIVE_PEERS_KEY];
    expect(peers ?? []).toEqual([]);
  });

  test("same-Member offer stores the HTTP peer", async () => {
    const storage = new MemoryStorage();
    const first = await resumeAdmission({ storage, lanDeviceId: "aa".repeat(32) });
    const local = decodeReplicaOffer(first.offer);
    const next = await resumeAdmission({
      storage,
      lanDeviceId: "aa".repeat(32),
      remoteOffer: JSON.stringify({
        schema: 1,
        kind: "pomo-replica-offer",
        memberId: local.memberId,
        admissionId: "11".repeat(32),
        identityDeviceId: "22".repeat(32),
        lanDeviceId: "33".repeat(32),
        transcriptHash: "44".repeat(32),
        endpoint: "http://192.168.0.2:9/replica",
      }),
    });
    const peers = (await storage.get([LIVE_PEERS_KEY]))[LIVE_PEERS_KEY] as Array<{ deviceId: string; endpoint?: string }>;
    expect(next.state.admission.stage).toBe("READY_ACK_COMMITTED");
    expect(peers.some((peer) => peer.deviceId === "33".repeat(32) && peer.endpoint === "http://192.168.0.2:9/replica")).toBeTrue();
  });

  test("same-Member offer drops a non-LAN endpoint", async () => {
    const storage = new MemoryStorage();
    const first = await resumeAdmission({ storage, lanDeviceId: "aa".repeat(32) });
    const local = decodeReplicaOffer(first.offer);
    await resumeAdmission({
      storage,
      lanDeviceId: "aa".repeat(32),
      remoteOffer: JSON.stringify({
        schema: 1,
        kind: "pomo-replica-offer",
        memberId: local.memberId,
        admissionId: "11".repeat(32),
        identityDeviceId: "22".repeat(32),
        lanDeviceId: "33".repeat(32),
        transcriptHash: "44".repeat(32),
        endpoint: "https://example.com/replica",
      }),
    });
    const peers = (await storage.get([LIVE_PEERS_KEY]))[LIVE_PEERS_KEY] as Array<{ deviceId: string; endpoint?: string | null }>;
    expect(peers.some((peer) => peer.deviceId === "33".repeat(32) && peer.endpoint == null)).toBeTrue();
  });
});
