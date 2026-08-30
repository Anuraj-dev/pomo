import { beforeEach, describe, expect, test } from "bun:test";
import { subscribeLink } from "../src/shared/surface";
import type { LinkStatus } from "../src/link/client";

type StorageListener = (changes: Record<string, { newValue?: unknown }>, area: string) => void;
type MessageCallback = (response: unknown) => void;

let storageListeners: StorageListener[] = [];
let messageCallback: ((msg: unknown, cb: MessageCallback) => void) | null = null;

// Minimal chrome mock for surface tests
function setupChrome(): void {
  storageListeners = [];
  (global as unknown as { chrome: typeof chrome }).chrome = {
    storage: {
      onChanged: {
        addListener: (fn: StorageListener): void => {
          storageListeners.push(fn);
        },
      },
      session: {
        set: (): Promise<void> => Promise.resolve(),
      },
      local: {
        get: (): Promise<Record<string, unknown>> => Promise.resolve({}),
      },
    },
    runtime: {
      sendMessage: (msg: unknown, cb: MessageCallback): void => {
        if (messageCallback !== null) messageCallback(msg, cb);
      },
      lastError: undefined,
    },
  } as unknown as typeof chrome;
}

// Helper to emit storage with correct key name (LINK_STATUS_KEY = "pomo:link:status")
function emitLinkStatus(status: LinkStatus): void {
  for (const listener of storageListeners) {
    listener({ "pomo:link:status": { newValue: status } } as Record<string, { newValue?: unknown }>, "session");
  }
}

describe("subscribeLink revision ordering", (): void => {
  beforeEach((): void => {
    setupChrome();
  });

  test("delayed callback does not overwrite newer storage status", async (): Promise<void> => {
    let pendingCb: MessageCallback | null = null;
    messageCallback = (_msg, cb): void => {
      pendingCb = cb;
    };

    const seen: LinkStatus[] = [];
    subscribeLink((status: LinkStatus): void => {
      seen.push(status);
    });

    // Storage event arrives first with revision 2 (newer)
    const newer: LinkStatus = {
      mode: "SYNCED",
      paired: true,
      host: "10.0.0.2",
      port: 9876,
      message: "",
      queued: 0,
      localOwner: false,
      revision: 2,
    };
    emitLinkStatus(newer);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.revision).toBe(2);

    // Delayed callback arrives with older revision 1 – must be ignored
    const older: LinkStatus = {
      mode: "OFFLINE",
      paired: true,
      host: "10.0.0.2",
      port: 9876,
      message: "offline",
      queued: 1,
      localOwner: true,
      revision: 1,
    };
    if (pendingCb !== null) (pendingCb as (v: unknown) => void)({ link: older } as unknown);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.mode).toBe("SYNCED");

    // Newer callback with revision 3 should be applied
    messageCallback = (_msg, cb): void => {
      cb({ link: { ...older, revision: 3, mode: "SYNCED" } } as unknown);
    };
    // Re-subscribe to get a fresh callback path with revision 3
    const seen2: LinkStatus[] = [];
    subscribeLink((status: LinkStatus): void => {
      seen2.push(status);
    });
    // Trigger storage for seen2 with revision 2 again, then callback 3 will overwrite
    // But we already tested core invariant: older < newer is ignored.
    // Ensure a newer revision does overwrite
    const newer2: LinkStatus = {
      mode: "SYNCED",
      paired: true,
      host: "10.0.0.2",
      port: 9876,
      message: "",
      queued: 0,
      localOwner: false,
      revision: 4,
    };
    emitLinkStatus(newer2);
    expect(seen2[seen2.length - 1]?.revision).toBe(4);
  });
});
