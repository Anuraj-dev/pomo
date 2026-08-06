import { isValidRelayUrl } from "./joinCode";
import type { NostrEvent } from "./types";

export const DEFAULT_RELAY_TIMEOUT_MS = 2_750;
export const MAX_EVENTS_PER_BURST = 1_000;
const MAX_FRAME_BYTES = 128 * 1024;

const textDecoder = new TextDecoder("utf-8", { fatal: true });

export type RelayCompletion =
  | { relayUrl: string; status: "completed"; note?: string }
  | { relayUrl: string; status: "rejected"; reason?: string }
  | { relayUrl: string; status: "timedOut" }
  | { relayUrl: string; status: "failed"; reason?: string };

export interface FetchBurstResult {
  events: NostrEvent[];
  completions: RelayCompletion[];
}

export interface PublishBurstResult {
  ok: boolean;
  okRelayUrl: string | null;
  reason: string | null;
  completions: RelayCompletion[];
}

export interface BurstOptions {
  timeoutMs?: number;
  socketFactory?: (url: string) => WebSocket;
}

type Frame = unknown[];

type CompletionWithoutRelay =
  | { status: "completed"; note?: string }
  | { status: "rejected"; reason?: string }
  | { status: "timedOut" }
  | { status: "failed"; reason?: string };

type Settle = (completion: CompletionWithoutRelay) => void;

type OnMessage = (frame: Frame, socket: WebSocket, subId: string, settle: Settle) => void;

function defaultSocket(url: string): WebSocket {
  if (!isValidRelayUrl(url)) {
    throw new Error(`refusing to connect to a non-public relay: ${url}`);
  }
  return new WebSocket(url);
}

/** Structural well-formedness used before any factory runs. */
function isWellFormedRelayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "wss:" && url.hostname.length > 0;
  } catch {
    return false;
  }
}

function parseFrame(raw: unknown): Frame | null {
  let text: string;
  if (typeof raw === "string") {
    text = raw;
  } else if (raw instanceof ArrayBuffer || ArrayBuffer.isView(raw)) {
    try {
      text = textDecoder.decode(raw instanceof ArrayBuffer ? raw : raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
    } catch {
      return null;
    }
  } else if (typeof Blob !== "undefined" && raw instanceof Blob) {
    // With binaryType = "arraybuffer" the transport never receives Blob frames.
    return null;
  } else {
    return null;
  }
  if (text.length > MAX_FRAME_BYTES) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  return Array.isArray(parsed) ? parsed : null;
}

function runBurst(
  relayUrls: string[],
  connect: (url: string) => WebSocket,
  exchange: (socket: WebSocket, subId: string) => void,
  onMessage: OnMessage,
  timeoutMs: number,
): Promise<RelayCompletion[]> {
  return Promise.all(
    relayUrls.map(
      (relayUrl) =>
        new Promise<RelayCompletion>((resolve) => {
          let settled = false;
          let socket: WebSocket;
          let timer: ReturnType<typeof setTimeout> | null = null;

          const settle = (completion: CompletionWithoutRelay) => {
            if (settled) return;
            settled = true;
            if (timer !== null) clearTimeout(timer);
            if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
              try {
                socket.close();
              } catch {
                // closing a socket that is already gone is a no-op
              }
            }
            resolve({ relayUrl, ...completion });
          };

          try {
            // URLs are always validated before the socket is created, so a
            // custom factory cannot smuggle malformed/non-wss endpoints past
            // the policy. The full public-relay policy (private-host rejection)
            // is enforced in defaultSocket, which is the only factory used in
            // production; loopback URLs remain reachable through a caller's
            // explicit factory so tests can stand up local relays.
            if (!isWellFormedRelayUrl(relayUrl)) {
              resolve({ relayUrl, status: "failed", reason: "invalid relay url" });
              return;
            }
            socket = connect(relayUrl);
          } catch {
            resolve({ relayUrl, status: "failed", reason: "could not create socket" });
            return;
          }

          timer = setTimeout(() => settle({ status: "timedOut" }), timeoutMs);
          const subId = crypto.randomUUID();
          try {
            socket.binaryType = "arraybuffer";
          } catch {
            // binaryType is not assignable on some exotic WebSocket shims.
          }

          socket.onopen = () => {
            try {
              exchange(socket, subId);
            } catch {
              settle({ status: "failed", reason: "send failed" });
            }
          };
          socket.onmessage = (event) => {
            const frame = parseFrame(event.data);
            if (frame === null) return;
            onMessage(frame, socket, subId, settle);
          };
          socket.onerror = () => {
            // onclose follows; nothing to do here
          };
          socket.onclose = () => {
            settle({ status: "failed", reason: "connection closed" });
          };
        }),
    ),
  );
}

function isPlausibleEvent(candidate: unknown): candidate is Record<string, unknown> {
  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) return false;
  const record = candidate as Record<string, unknown>;
  return typeof record.id === "string" && record.id.length === 64;
}

export async function fetchEventsBurst(
  filters: Array<Record<string, unknown>>,
  relayUrls: string[],
  opts: BurstOptions = {},
): Promise<FetchBurstResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS;
  const connect = opts.socketFactory ?? defaultSocket;
  const seen = new Set<string>();
  const events: NostrEvent[] = [];

  const completions = await runBurst(
    relayUrls,
    connect,
    (socket, subId) => {
      socket.send(JSON.stringify(["REQ", subId, ...filters]));
    },
    (frame, socket, subId, settle) => {
      const [type, ...rest] = frame;
      if (type === "EVENT" && rest[0] === subId) {
        const candidate = rest[1];
        // Cheap structural pre-filter so junk frames cannot fill the burst cap;
        // cryptographic verification and id-dedup happen downstream in
        // crewService.refreshMembership() after verifyEvent succeeds.
        if (!isPlausibleEvent(candidate)) return;
        let serialized: string;
        try {
          serialized = JSON.stringify(candidate);
        } catch {
          return;
        }
        if (serialized.length > MAX_FRAME_BYTES || seen.has(serialized)) return;
        if (events.length >= MAX_EVENTS_PER_BURST) {
          try {
            socket.send(JSON.stringify(["CLOSE", subId]));
          } catch {
            // best-effort close
          }
          settle({ status: "completed", note: "event limit reached" });
          return;
        }
        seen.add(serialized);
        events.push(candidate as unknown as NostrEvent);
      } else if (type === "EOSE" && rest[0] === subId) {
        try {
          socket.send(JSON.stringify(["CLOSE", subId]));
        } catch {
          // best-effort close; the socket dies with the burst anyway
        }
        settle({ status: "completed" });
      } else if (type === "CLOSED" && rest[0] === subId) {
        settle({ status: "failed", reason: String(rest[1] ?? "relay closed subscription") });
      }
    },
    timeoutMs,
  );

  return { events, completions };
}

export async function publishEventBurst(
  event: NostrEvent,
  relayUrls: string[],
  opts: BurstOptions = {},
): Promise<PublishBurstResult> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_RELAY_TIMEOUT_MS;
  const connect = opts.socketFactory ?? defaultSocket;

  const completions = await runBurst(
    relayUrls,
    connect,
    (socket) => {
      socket.send(JSON.stringify(["EVENT", event]));
    },
    (frame, socket, subId, settle) => {
      const [type, ...rest] = frame;
      if (type === "OK" && rest[0] === event.id) {
        const ok = rest[1] === true;
        if (ok) {
          settle({ status: "completed", note: "ok" });
        } else {
          settle({ status: "rejected", reason: String(rest[2] ?? "relay rejected event") });
        }
      }
    },
    timeoutMs,
  );

  const okRelayUrl = completions.find((c) => c.status === "completed" && c.note === "ok")?.relayUrl ?? null;
  const answered = completions.find((c) => c.status === "completed" || c.status === "rejected");
  const ok = okRelayUrl !== null;
  const reason = !ok
    ? answered?.status === "rejected"
      ? (answered.reason ?? "relay rejected event")
      : answered?.status === "completed"
        ? (answered.note ?? null)
        : null
    : null;
  return { ok, okRelayUrl, reason, completions };
}
