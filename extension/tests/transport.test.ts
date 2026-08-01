import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { serve, type ServerWebSocket } from "bun";
import type { NostrEvent } from "../src/crew/types";
import { fetchEventsBurst, publishEventBurst } from "../src/crew/transport";

interface FakeRelayConfig {
  events?: NostrEvent[];
  eose?: boolean;
  ok?: { ok: boolean; reason: string } | null;
  closeOnOpen?: boolean;
}

interface FakeRelay {
  url: string;
  received: unknown[][];
  stop: () => void;
}

const relays: FakeRelay[] = [];

function startFakeRelay(config: FakeRelayConfig): FakeRelay {
  const received: unknown[][] = [];
  const server = serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        if (config.closeOnOpen) ws.close(1000);
      },
      message(ws: ServerWebSocket, raw: string | Uint8Array) {
        let frame: unknown[];
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!Array.isArray(frame)) return;
        received.push(frame);
        const [type, ...rest] = frame;
        if (type === "REQ") {
          const subId = rest[0] as string;
          for (const evt of config.events ?? []) {
            ws.send(JSON.stringify(["EVENT", subId, evt]));
          }
          if (config.eose !== false) ws.send(JSON.stringify(["EOSE", subId]));
        } else if (type === "EVENT") {
          const evt = rest[0] as NostrEvent;
          const ok = config.ok === undefined ? { ok: true, reason: "" } : config.ok;
          if (ok !== null) ws.send(JSON.stringify(["OK", evt.id, ok.ok, ok.reason]));
        } else if (type === "CLOSE") {
          ws.close(1000);
        }
      },
      close() {},
    },
  });
  const relay: FakeRelay = {
    url: `ws://127.0.0.1:${server.port}`,
    received,
    stop: () => server.stop(),
  };
  relays.push(relay);
  return relay;
}

function sampleEvent(overrides: Partial<NostrEvent> = {}): NostrEvent {
  return {
    id: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    pubkey: "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    created_at: 1_700_000_000,
    kind: 39050,
    tags: [["d", "crew-1"]],
    content: "{}",
    sig: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef01",
    ...overrides,
  };
}

afterAll(() => {
  for (const relay of relays) relay.stop();
});

describe("fetchEventsBurst", () => {
  test("collects events from multiple relays and sends REQ + CLOSE", async () => {
    const a = startFakeRelay({ events: [sampleEvent({ id: "a".repeat(64) })] });
    const b = startFakeRelay({ events: [sampleEvent({ id: "b".repeat(64) })] });

    const result = await fetchEventsBurst([{ kinds: [39050] }], [a.url, b.url], { timeoutMs: 500 });

    expect(result.events.map((e) => e.id).sort()).toEqual(["a".repeat(64), "b".repeat(64)].sort());
    expect(result.completions.filter((c) => c.status === "completed").length).toBe(2);
    await new Promise((resolve) => setTimeout(resolve, 50));
    for (const relay of [a, b]) {
      const frames = relay.received.map((f) => f[0]);
      expect(frames).toContain("REQ");
      expect(frames).toContain("CLOSE");
    }
  });

  test("deduplicates identical events across relays", async () => {
    const shared = sampleEvent({ id: "c".repeat(64) });
    const a = startFakeRelay({ events: [shared] });
    const b = startFakeRelay({ events: [shared] });

    const result = await fetchEventsBurst([{ kinds: [39050] }], [a.url, b.url], { timeoutMs: 500 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0]?.id).toBe("c".repeat(64));
  });

  test("times out relays that never send EOSE but keeps collected events", async () => {
    const a = startFakeRelay({ events: [sampleEvent({ id: "d".repeat(64) })], eose: false });

    const result = await fetchEventsBurst([{ kinds: [39050] }], [a.url], { timeoutMs: 20 });

    expect(result.events.map((e) => e.id)).toEqual(["d".repeat(64)]);
    expect(result.completions).toEqual([{ relayUrl: a.url, status: "timedOut" }]);
  });

  test("marks relays that close the connection as failed", async () => {
    const a = startFakeRelay({ closeOnOpen: true });

    const result = await fetchEventsBurst([{ kinds: [39050] }], [a.url], { timeoutMs: 500 });

    expect(result.events).toHaveLength(0);
    expect(result.completions[0]?.status).toBe("failed");
  });

  test("returns an empty result for no relays", async () => {
    const result = await fetchEventsBurst([{ kinds: [39050] }], [], { timeoutMs: 500 });
    expect(result.events).toHaveLength(0);
    expect(result.completions).toHaveLength(0);
  });
});

describe("publishEventBurst", () => {
  test("returns ok once any relay confirms with OK true", async () => {
    const a = startFakeRelay({ ok: { ok: true, reason: "" } });
    const b = startFakeRelay({ ok: { ok: true, reason: "" } });
    const event = sampleEvent();

    const result = await publishEventBurst(event, [a.url, b.url], { timeoutMs: 500 });

    expect(result.ok).toBe(true);
    expect(result.okRelayUrl).not.toBeNull();
    for (const relay of [a, b]) {
      expect(relay.received.map((f) => f[0])).toContain("EVENT");
    }
  });

  test("reports ok=false with reason when relays reject", async () => {
    const a = startFakeRelay({ ok: { ok: false, reason: "rate-limited" } });
    const event = sampleEvent();

    const result = await publishEventBurst(event, [a.url], { timeoutMs: 500 });

    expect(result.ok).toBe(false);
    expect(result.reason).toBe("rate-limited");
  });

  test("reports ok=false when no relay answers before the timeout", async () => {
    const a = startFakeRelay({ ok: null });
    const event = sampleEvent();

    const result = await publishEventBurst(event, [a.url], { timeoutMs: 20 });

    expect(result.ok).toBe(false);
    expect(result.completions).toEqual([{ relayUrl: a.url, status: "timedOut" }]);
  });
});
