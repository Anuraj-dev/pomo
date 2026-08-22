import { afterEach, describe, expect, test } from "bun:test";
import { bytesToHex } from "../../src/shared/hex";
import {
  LIVE_PEER_IDENTITY_KEY,
  LIVE_PEERS_KEY,
  RENDEZVOUS_KEY,
  installChromeLivePeer,
  linkMemoryPipes,
  loadOrCreateLivePeerIdentity,
  MemoryLivePipe,
  resetChromeLivePeer,
  type LivePeerStorage,
} from "../../src/sync/transport/chromeLivePeer";
import { drainOrdinaryOutbox } from "../../src/sync/transport/ordinaryDrain";
import { replicaLanDrainRoutes } from "../../src/sync/transport/replicaLan";
import type { NostrSyncEvent, NostrSyncTransport } from "../../src/sync/transport/nostrRendezvous";

class MemoryRelay implements NostrSyncTransport {
  readonly events: NostrSyncEvent[] = [];
  publish(event: NostrSyncEvent): void {
    this.events.push(event);
  }
  pull(): NostrSyncEvent[] {
    return [...this.events];
  }
}

class SdpMemoryPipe extends MemoryLivePipe {
  private local: RTCSessionDescriptionInit | undefined;
  private remote: RTCSessionDescriptionInit | undefined;

  async open(_routeId: string, _iceServers: readonly RTCIceServer[], remoteDescription?: RTCSessionDescriptionInit) {
    if (remoteDescription !== undefined) {
      this.remote = remoteDescription;
      this.local = { type: "answer", sdp: "answer" };
      return { description: this.local };
    }
    this.local = { type: "offer", sdp: "offer" };
    return { description: this.local };
  }

  async setRemoteDescription(_routeId: string, remoteDescription: RTCSessionDescriptionInit) {
    this.remote = remoteDescription;
  }

  async waitUntilOpen(_routeId: string) {
    if (this.local === undefined || this.remote === undefined) throw new Error("sdp not complete");
  }

  async send(routeId: string, bytes: Uint8Array) {
    await this.waitUntilOpen(routeId);
    await super.send(routeId, bytes);
  }
}

function linkSdpPipes(): [SdpMemoryPipe, SdpMemoryPipe] {
  const left = new SdpMemoryPipe();
  const right = new SdpMemoryPipe();
  left.attach(right);
  right.attach(left);
  return [left, right];
}

class MemoryStorage implements LivePeerStorage {
  constructor(private readonly data: Record<string, unknown> = {}) {}
  async get(keys: readonly string[]): Promise<Record<string, unknown>> {
    return Object.fromEntries(keys.flatMap((key) => this.data[key] === undefined ? [] : [[key, this.data[key]]]));
  }
  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.data, items);
  }
}

afterEach(() => {
  resetChromeLivePeer();
});

describe("chrome live peer", () => {
  test("reuses the persisted replica identity", async () => {
    const storage = new MemoryStorage();
    const first = await loadOrCreateLivePeerIdentity(storage);
    const second = await loadOrCreateLivePeerIdentity(storage);
    expect(second.deviceId).toBe(first.deviceId);
    expect((await storage.get([LIVE_PEER_IDENTITY_KEY]))[LIVE_PEER_IDENTITY_KEY]).toBeDefined();
  });

  test("installs drain routes from the peer directory and durable obligations", async () => {
    const storage = new MemoryStorage();
    const identity = await loadOrCreateLivePeerIdentity(storage);
    const peerId = "bb".repeat(32);
    await storage.set({
      [LIVE_PEERS_KEY]: [{ deviceId: peerId }, { deviceId: identity.deviceId }],
    });
    const [pipe] = linkMemoryPipes();
    await installChromeLivePeer({
      storage,
      identity,
      ingest: () => "ACCEPTED",
      outbox: () => [],
      pipe,
      inbox: { takeAll: () => [] },
      obligations: [{ peerDeviceId: "cc".repeat(32), operationId: "op-1" }],
    });
    expect(replicaLanDrainRoutes().map((route) => route.name).sort()).toEqual([`lan:${peerId}`, `lan:${"cc".repeat(32)}`].sort());
  });

  test("signed DataChannel exchange clears covered outbox", async () => {
    const storageA = new MemoryStorage();
    const storageB = new MemoryStorage();
    const [pipeA, pipeB] = linkMemoryPipes();
    const identityA = await loadOrCreateLivePeerIdentity(storageA);
    const identityB = await loadOrCreateLivePeerIdentity(storageB);
    await storageA.set({ [LIVE_PEERS_KEY]: [{ deviceId: identityB.deviceId }] });
    const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([9]) };
    const ingested: Uint8Array[] = [];
    await installChromeLivePeer({
      storage: storageB,
      identity: identityB,
      ingest: (wire) => {
        ingested.push(wire.slice());
        return "ACCEPTED";
      },
      outbox: () => [],
      pipe: pipeB,
      inbox: { takeAll: () => [] },
    });
    await installChromeLivePeer({
      storage: storageA,
      identity: identityA,
      ingest: () => "ACCEPTED",
      outbox: () => [envelope],
      pipe: pipeA,
      inbox: { takeAll: () => [] },
    });
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: replicaLanDrainRoutes(),
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(result.localOnly).toBeFalse();
    expect(result.live).toBeTrue();
    expect(delivered).toEqual(["op-1"]);
    expect(ingested).toHaveLength(1);
    expect([...ingested[0]!]).toEqual([9]);
  });

  test("WebRTC peers exchange SDP over encrypted rendezvous before the DataChannel drain", async () => {
    const storageA = new MemoryStorage();
    const storageB = new MemoryStorage();
    const [pipeA, pipeB] = linkSdpPipes();
    const identityA = await loadOrCreateLivePeerIdentity(storageA);
    const identityB = await loadOrCreateLivePeerIdentity(storageB);
    const contentKeyHex = bytesToHex(crypto.getRandomValues(new Uint8Array(32)));
    const rendezvous = {
      sessionId: "session-chrome",
      contentKeyHex,
      relays: [],
      peerDeviceIds: [identityA.deviceId, identityB.deviceId],
    };
    await storageA.set({ [LIVE_PEERS_KEY]: [{ deviceId: identityB.deviceId }], [RENDEZVOUS_KEY]: rendezvous });
    await storageB.set({ [LIVE_PEERS_KEY]: [{ deviceId: identityA.deviceId }], [RENDEZVOUS_KEY]: rendezvous });
    const relay = new MemoryRelay();
    const envelope = { operationId: "op-1", feedKey: "feed", sequence: 1, wire: new Uint8Array([9]) };
    const ingested: Uint8Array[] = [];
    await installChromeLivePeer({
      storage: storageB,
      identity: identityB,
      ingest: (wire) => {
        ingested.push(wire.slice());
        return "ACCEPTED";
      },
      outbox: () => [],
      pipe: pipeB,
      inbox: { takeAll: () => [] },
      signalingTransport: relay,
    });
    await installChromeLivePeer({
      storage: storageA,
      identity: identityA,
      ingest: () => "ACCEPTED",
      outbox: () => [envelope],
      pipe: pipeA,
      inbox: { takeAll: () => [] },
      signalingTransport: relay,
    });
    const delivered: string[] = [];
    const result = await drainOrdinaryOutbox({
      obligations: [envelope],
      routes: replicaLanDrainRoutes(),
      ingest() {},
      markDelivered(id) { delivered.push(id); },
    });
    expect(result.localOnly).toBeFalse();
    expect(delivered).toEqual(["op-1"]);
    expect(ingested).toHaveLength(1);
    expect(relay.events.some((event) => event.tags.some((tag) => tag[0] === "pomo" && tag[1] === "signal"))).toBeTrue();
    expect(relay.events.some((event) => event.tags.some((tag) => tag[0] === "pomo" && tag[1] === "offer"))).toBeFalse();
  });
});
