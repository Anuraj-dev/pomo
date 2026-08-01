import "./helpers/db";

import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { serve, type ServerWebSocket } from "bun";
import { CrewDao } from "../src/db/dao";
import { DB_NAME, openDb } from "../src/db/schema";
import { epochOfDate } from "../src/engine/dateLogic";
import { generateIdentity } from "../src/crew/identity";
import { buildEnvelope } from "../src/crew/snapshot";
import { signEvent } from "../src/crew/nostrEvent";
import { buildOwnSnapshot } from "../src/crew/ownSnapshot";
import { loadCrewBoard, publishOwnSnapshot, refreshMembership, snapshotToRow } from "../src/crew/crewService";
import type { DayStatRow, SessionRow } from "../src/db/types";
import { SNAPSHOT_EVENT_KIND, type NostrEvent } from "../src/crew/types";

interface FakeRelay {
  url: string;
  stop: () => void;
}

const relays: FakeRelay[] = [];
let db: IDBDatabase;
let dao: CrewDao;

function startRelay(config: { events?: NostrEvent[]; ok?: { ok: boolean; reason: string } | null }): FakeRelay {
  const server = serve({
    port: 0,
    fetch(req, srv) {
      if (srv.upgrade(req)) return undefined;
      return new Response("expected websocket", { status: 400 });
    },
    websocket: {
      open() {},
      message(ws: ServerWebSocket, raw: string | Uint8Array) {
        let frame: unknown[];
        try {
          frame = JSON.parse(String(raw));
        } catch {
          return;
        }
        if (!Array.isArray(frame)) return;
        const [type, ...rest] = frame;
        if (type === "REQ") {
          const subId = rest[0] as string;
          for (const evt of config.events ?? []) {
            ws.send(JSON.stringify(["EVENT", subId, evt]));
          }
          ws.send(JSON.stringify(["EOSE", subId]));
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
  const relay: FakeRelay = { url: `ws://127.0.0.1:${server.port}`, stop: () => server.stop() };
  relays.push(relay);
  return relay;
}

const NOW = epochOfDate("2026-08-01", 330) + 5 * 3600;
const OFFSET = 330;
const CREW_ID = "ab".repeat(16);
const CREW_KEY = "cd".repeat(32);

function day(date: string, earnedBlocks: number, focusMinutes: number, breakMinutes: number): DayStatRow {
  return { date, earnedBlocks, focusMinutes, breakMinutes, lastUpdated: NOW * 1000 };
}

function session(start: number, date: string, type: SessionRow["type"], duration: number, completed = true): SessionRow {
  return { start, date, type, duration, completed, tag: null };
}

const membership = {
  crewId: CREW_ID,
  crewName: "Late Night",
  relays: [] as string[],
  key: CREW_KEY,
};

async function makeEvent(): Promise<NostrEvent> {
  const identity = generateIdentity();
  const snapshot = buildOwnSnapshot({
    crewId: CREW_ID,
    identityPublicKey: identity.publicKey,
    displayName: "Snehit",
    avatarBase64: null,
    dayStats: [day("2026-08-01", 2, 50, 10), day("2026-07-31", 3, 75, 15)],
    sessions: [session(NOW - 3600, "2026-08-01", "work", 1500)],
    now: NOW,
    offsetMinutes: OFFSET,
  });
  const content = await buildEnvelope(snapshot, CREW_KEY);
  return signEvent(
    { pubkey: identity.publicKey, created_at: NOW, kind: SNAPSHOT_EVENT_KIND, tags: [["d", CREW_ID]], content },
    identity.privateKey,
  );
}

afterAll(() => {
  for (const relay of relays) {
    relay.stop();
  }
  if (db !== undefined) {
    db.close();
  }
});

describe("refreshMembership", () => {
  beforeEach(async () => {
    db = await openDb();
    dao = new CrewDao(db);
  });

  afterEach(async () => {
    db.close();
    await new Promise<void>((resolve, reject) => {
      const request = globalThis.indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  });

  test("accepts valid events and records relay success", async () => {
    const relay = startRelay({ events: [await makeEvent()] });
    membership.relays = [relay.url];

    const result = await refreshMembership(membership, dao, NOW);
    expect(result.acceptedEvents).toBe(1);

    const rows = await dao.snapshotsForCrew(CREW_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Snehit");
    expect(rows[0]!.allTimeFocusMinutes).toBe(125);

    const states = await dao.relayStates(CREW_ID);
    expect(states).toHaveLength(1);
    expect(states[0]!.lastSuccessEpochSeconds).toBe(NOW);
    expect(states[0]!.lastError).toBeNull();
  });

  test("ignores invalid events", async () => {
    const valid = await makeEvent();
    const tampered: NostrEvent = { ...valid, content: valid.content + "!" };
    const relay = startRelay({ events: [tampered] });
    membership.relays = [relay.url];

    const result = await refreshMembership(membership, dao, NOW);
    expect(result.acceptedEvents).toBe(0);
    expect(await dao.snapshotsForCrew(CREW_ID)).toHaveLength(0);
  });

  test("latest-wins by publishedAt", async () => {
    const identity = generateIdentity();
    const older = buildOwnSnapshot({
      crewId: CREW_ID,
      identityPublicKey: identity.publicKey,
      displayName: "Snehit",
      avatarBase64: null,
      dayStats: [day("2026-08-01", 1, 10, 0)],
      sessions: [],
      now: NOW - 3600,
      offsetMinutes: OFFSET,
    });
    const newer = buildOwnSnapshot({
      crewId: CREW_ID,
      identityPublicKey: identity.publicKey,
      displayName: "Snehit",
      avatarBase64: null,
      dayStats: [day("2026-08-01", 2, 50, 10)],
      sessions: [],
      now: NOW,
      offsetMinutes: OFFSET,
    });
    const olderEvent = await signEvent(
      {
        pubkey: identity.publicKey,
        created_at: NOW - 3600,
        kind: SNAPSHOT_EVENT_KIND,
        tags: [["d", CREW_ID]],
        content: await buildEnvelope(older, CREW_KEY),
      },
      identity.privateKey,
    );
    const newerEvent = await signEvent(
      {
        pubkey: identity.publicKey,
        created_at: NOW,
        kind: SNAPSHOT_EVENT_KIND,
        tags: [["d", CREW_ID]],
        content: await buildEnvelope(newer, CREW_KEY),
      },
      identity.privateKey,
    );
    const relay = startRelay({ events: [olderEvent, newerEvent] });
    membership.relays = [relay.url];

    const result = await refreshMembership(membership, dao, NOW);
    expect(result.acceptedEvents).toBe(2);
    const rows = await dao.snapshotsForCrew(CREW_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.publishedAtEpochSeconds).toBe(NOW);
    expect(rows[0]!.allTimeFocusMinutes).toBe(50);
  });

  test("publishOwnSnapshot round-trips through the board", async () => {
    const relay = startRelay({});
    membership.relays = [relay.url];
    const identity = generateIdentity();

    const publish = await publishOwnSnapshot(
      {
        membership,
        identityPrivateKey: identity.privateKey,
        displayName: "Snehit",
        avatarBase64: null,
        dayStats: [day("2026-08-01", 2, 50, 10)],
        sessions: [],
        now: NOW,
        offsetMinutes: OFFSET,
      },
      dao,
    );
    expect(publish.ok).toBe(true);
    expect(publish.okRelayUrl).toBe(relay.url);

    const states = await dao.relayStates(CREW_ID);
    expect(states[0]!.lastSuccessEpochSeconds).toBe(NOW);

    const rows = await dao.snapshotsForCrew(CREW_ID);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.displayName).toBe("Snehit");
  });

  test("loadCrewBoard assembles snapshots with daily aggregates", async () => {
    const relay = startRelay({ events: [await makeEvent()] });
    membership.relays = [relay.url];
    await refreshMembership(membership, dao, NOW);

    const { board, relayStates, memberCount } = await loadCrewBoard(dao, CREW_ID, "today", NOW);
    expect(memberCount).toBe(1);
    expect(board.members).toHaveLength(1);
    expect(board.members[0]!.focusMinutes).toBe(50);
    expect(board.members[0]!.rank).toBe(1);
    expect(board.summary.rankedMembers).toBe(1);
    expect(relayStates).toHaveLength(1);
  });
});

describe("row conversion", () => {
  test("snapshotToRow and back preserves the plain snapshot", async () => {
    const identity = generateIdentity();
    const snapshot = buildOwnSnapshot({
      crewId: CREW_ID,
      identityPublicKey: identity.publicKey,
      displayName: "Snehit",
      avatarBase64: null,
      dayStats: [day("2026-08-01", 2, 50, 10)],
      sessions: [],
      now: NOW,
      offsetMinutes: OFFSET,
    });
    const row = snapshotToRow(snapshot);
    expect(row.statsJson).not.toBeNull();
    expect(JSON.parse(row.statsJson!)).toEqual(snapshot.stats);
  });
});
