import type { CrewDailyRow, CrewRelayStateRow, CrewSnapshotRow } from "../db/dao";
import type { DayStatRow, SessionRow } from "../db/types";
import { aggregateBoard, type Board, type WindowKey } from "./leaderboard";
import { buildEnvelope, decryptEnvelope } from "./snapshot";
import { MAX_CREATED_AT_SKEW_SECONDS, signEvent, verifyEvent } from "./nostrEvent";
import { buildOwnSnapshot } from "./ownSnapshot";
import { publicKeyOf } from "./identity";
import { fetchEventsBurst, publishEventBurst, type RelayCompletion } from "./transport";
import { SNAPSHOT_EVENT_KIND } from "./types";
import type { CrewMembership, DailyAggregate, SnapshotPlain } from "./types";

export interface CrewStore {
  upsertLatest(snapshot: CrewSnapshotRowLike, daily: CrewDailyRowLike[]): Promise<boolean>;
  updateRelayState(
    crewId: string,
    relayUrl: string,
    attempt: number,
    success: number | null,
    error: string | null,
  ): Promise<void>;
  snapshotsForCrew(crewId: string): Promise<CrewSnapshotRowLike[]>;
  hiddenKeys(crewId: string): Promise<string[]>;
  dailyFor(crewId: string, identityPublicKey: string): Promise<CrewDailyRowLike[]>;
  relayStates(crewId: string): Promise<CrewRelayStateRow[]>;
}

export type CrewSnapshotRowLike = CrewSnapshotRow;

export type CrewDailyRowLike = CrewDailyRow;

export interface BurstSeam {
  timeoutMs?: number;
  socketFactory?: (url: string) => WebSocket;
}

export interface RefreshResult {
  crewId: string;
  acceptedEvents: number;
  completions: RelayCompletion[];
}

export interface PublishResult {
  crewId: string;
  ok: boolean;
  okRelayUrl: string | null;
  reason: string | null;
  completions: RelayCompletion[];
}

export function snapshotToRow(snapshot: SnapshotPlain): CrewSnapshotRowLike {
  return {
    crewId: snapshot.crewId,
    identityPublicKey: snapshot.identityPublicKey,
    displayName: snapshot.displayName,
    avatarBase64: snapshot.avatarBase64,
    allTimeFocusMinutes: snapshot.allTimeFocusMinutes,
    publishedAtEpochSeconds: snapshot.publishedAtEpochSeconds,
    localDate: snapshot.localDate,
    utcOffsetMinutes: snapshot.utcOffsetMinutes,
    currentStreak: snapshot.currentStreak,
    lastFocusedAtEpochSeconds: snapshot.lastFocusedAtEpochSeconds,
    protocolVersion: snapshot.version,
    statsJson: snapshot.stats === null ? null : JSON.stringify(snapshot.stats),
  };
}

export function rowToSnapshot(row: CrewSnapshotRowLike): SnapshotPlain {
  return {
    crewId: row.crewId,
    identityPublicKey: row.identityPublicKey,
    displayName: row.displayName,
    avatarBase64: row.avatarBase64,
    allTimeFocusMinutes: row.allTimeFocusMinutes,
    publishedAtEpochSeconds: row.publishedAtEpochSeconds,
    localDate: row.localDate,
    utcOffsetMinutes: row.utcOffsetMinutes,
    dailyAggregates: [],
    currentStreak: row.currentStreak,
    lastFocusedAtEpochSeconds: row.lastFocusedAtEpochSeconds,
    version: row.protocolVersion,
    stats: row.statsJson === null ? null : (JSON.parse(row.statsJson) as SnapshotPlain["stats"]),
  };
}

async function recordCompletions(
  dao: CrewStore,
  crewId: string,
  attempt: number,
  completions: RelayCompletion[],
  requirePublishAcceptance = false,
): Promise<void> {
  for (const completion of completions) {
    const success =
      completion.status === "completed" && (!requirePublishAcceptance || completion.note === "ok") ? attempt : null;
    const error =
      completion.status === "failed"
        ? (completion.reason ?? "connection closed")
        : completion.status === "rejected"
          ? (completion.reason ?? "relay rejected event")
          : completion.status === "timedOut"
            ? "relay timed out"
            : null;
    await dao.updateRelayState(crewId, completion.relayUrl, attempt, success, error);
  }
}

function dailyRowsFor(
  crewId: string,
  identityPublicKey: string,
  aggregates: DailyAggregate[],
): CrewDailyRow[] {
  return aggregates.map((aggregate) => ({
    crewId,
    identityPublicKey,
    localDate: aggregate.localDate,
    focusMinutes: aggregate.focusMinutes,
    completedWorkBlocks: aggregate.completedWorkBlocks,
  }));
}

export async function refreshMembership(
  membership: CrewMembership,
  dao: CrewStore,
  now: number,
  seam: BurstSeam = {},
): Promise<RefreshResult> {
  const { events, completions } = await fetchEventsBurst(
    [{ kinds: [SNAPSHOT_EVENT_KIND], "#d": [membership.crewId] }],
    membership.relays,
    { timeoutMs: seam.timeoutMs, socketFactory: seam.socketFactory },
  );

  let accepted = 0;
  for (const event of events) {
    if (!(await verifyEvent(event, { crewId: membership.crewId, now }))) continue;
    let snapshot: SnapshotPlain;
    try {
      snapshot = await decryptEnvelope(event.content, membership.key);
    } catch {
      continue;
    }
    if (snapshot.identityPublicKey !== event.pubkey || snapshot.crewId !== membership.crewId) continue;
    if (snapshot.publishedAtEpochSeconds > now + MAX_CREATED_AT_SKEW_SECONDS) continue;
    if (snapshot.publishedAtEpochSeconds > event.created_at + MAX_CREATED_AT_SKEW_SECONDS) continue;
    const daily = dailyRowsFor(membership.crewId, snapshot.identityPublicKey, snapshot.dailyAggregates);
    if (await dao.upsertLatest(snapshotToRow(snapshot), daily)) {
      accepted++;
    }
  }

  await recordCompletions(dao, membership.crewId, now, completions);
  return { crewId: membership.crewId, acceptedEvents: accepted, completions };
}

export interface PublishSnapshotInput {
  membership: CrewMembership;
  identityPrivateKey: string;
  displayName: string;
  avatarBase64: string | null;
  dayStats: DayStatRow[];
  sessions: SessionRow[];
  now: number;
  offsetMinutes: number;
}

export async function publishOwnSnapshot(
  input: PublishSnapshotInput,
  dao: CrewStore,
  seam: BurstSeam = {},
): Promise<PublishResult> {
  const { membership, identityPrivateKey, now, offsetMinutes } = input;
  const identityPublicKey = publicKeyOf(identityPrivateKey);
  const snapshot = buildOwnSnapshot({
    crewId: membership.crewId,
    identityPublicKey,
    displayName: input.displayName,
    avatarBase64: input.avatarBase64,
    dayStats: input.dayStats,
    sessions: input.sessions,
    now,
    offsetMinutes,
  });
  const content = await buildEnvelope(snapshot, membership.key);
  await dao.upsertLatest(
    snapshotToRow(snapshot),
    dailyRowsFor(membership.crewId, snapshot.identityPublicKey, snapshot.dailyAggregates),
  );
  const event = await signEvent(
    {
      pubkey: identityPublicKey,
      created_at: now,
      kind: SNAPSHOT_EVENT_KIND,
      tags: [["d", membership.crewId]],
      content,
    },
    identityPrivateKey,
  );
  const result = await publishEventBurst(event, membership.relays, {
    timeoutMs: seam.timeoutMs,
    socketFactory: seam.socketFactory,
  });
  await recordCompletions(dao, membership.crewId, now, result.completions, true);
  return { crewId: membership.crewId, ok: result.ok, okRelayUrl: result.okRelayUrl, reason: result.reason, completions: result.completions };
}

export async function loadCrewBoard(
  dao: CrewStore,
  crewId: string,
  window: WindowKey,
  now: number,
): Promise<{ board: Board; relayStates: CrewRelayStateRow[]; memberCount: number }> {
  const rows = await dao.snapshotsForCrew(crewId);
  const hiddenKeys = new Set(await dao.hiddenKeys(crewId));
  const snapshots: SnapshotPlain[] = [];
  for (const row of rows) {
    const daily = await dao.dailyFor(crewId, row.identityPublicKey);
    snapshots.push({
      ...rowToSnapshot(row),
      dailyAggregates: daily.map((d) => ({
        localDate: d.localDate,
        focusMinutes: d.focusMinutes,
        completedWorkBlocks: d.completedWorkBlocks,
      })),
    });
  }
  const board = aggregateBoard(snapshots, { window, now, hiddenKeys });
  const relayStates = await dao.relayStates(crewId);
  return { board, relayStates, memberCount: snapshots.length };
}
