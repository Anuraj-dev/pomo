import { CrewDao, HistoryDao } from "../db/dao";
import { openDb } from "../db/schema";
import type { SessionRow } from "../db/types";
import { deltasForBlock, splitBlockByCalendarDay } from "../engine/blocks";
import { dateStringOf, utcOffsetMinutesAt } from "../engine/dateLogic";
import { DEFAULT_SETTINGS, sanitizeSettings, type PomoSettings } from "../engine/settings";
import { currentStreak, totals } from "../engine/stats";
import { TimerEngine, type CompletedBlock, type Phase, type TimerSnapshot } from "../engine/timer";
import { loadCrewBoard, publishOwnSnapshot, refreshMembership } from "../crew/crewService";
import { publicKeyOf } from "../crew/identity";
import { decodePayload, encodePayload, newPayload } from "../crew/joinCode";
import {
  KEYRING_STORAGE_KEY,
  decodeRecovery,
  encodeRecovery,
  exportWrappingKey,
  generateWrappingKey,
  importWrappingKey,
  unwrapIdentityKey,
  wrapIdentityKey,
} from "../crew/keyring";
import { standingFor, type WindowKey } from "../crew/leaderboard";
import { generateIdentity } from "../crew/identity";
import type { StoredMembership } from "../crew/types";
import { badgeColorOf, badgeTextOf } from "../shared/badge";
import {
  CREW_MEMBERSHIPS_KEY,
  CREW_SYNC_KEY,
  ENGINE_KEY,
  SETTINGS_KEY,
  STATE_KEY,
  isPomoRequest,
  type CrewBoardResult,
  type CrewSummary,
  type PomoRequest,
  type PomoResponse,
} from "../shared/messages";

const ALARM_NAME = "pomo-tick";
const ALARM_PERIOD_MINUTES = 0.5;
const PHASE_COMPLETE_NOTIFICATION = "pomo-phase-complete";
const CREW_SYNC_MIN_INTERVAL = 60;

let db: IDBDatabase;
let dao: HistoryDao;
let crewDao: CrewDao;
let settings: PomoSettings = { ...DEFAULT_SETTINGS };
let engine: TimerEngine;
let earnedByDate = new Map<string, number>();
let pendingWrite = Promise.resolve();
let initPromise: Promise<void> | null = null;
let identityPrivateKey: string | null = null;
let crewMemberships: StoredMembership[] = [];
let crewSyncInFlight = false;

function initOnce(): Promise<void> {
  if (initPromise === null) {
    initPromise = init().catch((error) => {
      initPromise = null;
      throw error;
    });
  }
  return initPromise;
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function timezoneOffsetMinutes(): number {
  return utcOffsetMinutesAt(nowSeconds());
}

function earnedBlocksForDate(date: string): number {
  return earnedByDate.get(date) ?? 0;
}

function commit(block: CompletedBlock): void {
  const offset = timezoneOffsetMinutes();
  const deltasByDate = new Map(deltasForBlock(block, offset).map((delta) => [delta.date, delta]));
  const segments = splitBlockByCalendarDay({
    start: block.start,
    duration: block.duration,
    completed: block.completed,
    type: block.type,
    tag: block.tag,
    offsetMinutes: offset,
  });
  for (const segment of segments) {
    const row: SessionRow = {
      start: segment.start,
      date: segment.date,
      type: segment.type,
      duration: segment.duration,
      completed: segment.completed,
      tag: segment.tag,
    };
    const delta = deltasByDate.get(segment.date)!;
    earnedByDate.set(segment.date, earnedBlocksForDate(segment.date) + delta.earnedBlocks);
    pendingWrite = pendingWrite
      .then(() => dao.insertSessionWithDayStats(row, delta))
      .catch((error: unknown) => console.error("session commit failed", error));
  }
  if (block.completed) {
    notifyPhaseComplete(block.type);
    if (block.type === "work") {
      void crewSync();
    }
  }
}

function notifyPhaseComplete(phase: Phase): void {
  if (!settings.soundEnabled) return;
  const isWork = phase === "work";
  chrome.notifications.create(PHASE_COMPLETE_NOTIFICATION, {
    type: "basic",
    iconUrl: "icons/icon128.png",
    title: isWork ? "Focus session complete" : "Break over",
    message: isWork ? "Great work. Time for a break." : "Ready for the next focus session?",
    priority: 0,
  });
}

function enginePorts(): ConstructorParameters<typeof TimerEngine>[0] {
  return {
    now: nowSeconds,
    offsetMinutes: timezoneOffsetMinutes,
    commit,
    earnedBlocksForDate,
    phaseSeconds: (phase) =>
      phase === "work" ? settings.workMinutes * 60 : phase === "short" ? settings.shortMinutes * 60 : settings.longMinutes * 60,
    goal: () => settings.dailyGoal,
    tag: () => settings.tag,
    longBreakAfter: () => settings.longBreakAfter,
  };
}

function applyBadge(state: TimerSnapshot): void {
  if (state.status === "stopped") {
    chrome.action.setBadgeText({ text: "" });
    return;
  }
  chrome.action.setBadgeText({ text: badgeTextOf(state.remaining * 1000) });
  chrome.action.setBadgeBackgroundColor({ color: badgeColorOf(state.phase) });
}

async function sync(): Promise<void> {
  const state = engine.snapshot();
  await chrome.storage.local.set({ [ENGINE_KEY]: state });
  await chrome.storage.session.set({ [STATE_KEY]: state });
  applyBadge(state);
}

async function ensureAlarm(): Promise<void> {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (existing === undefined) {
    await chrome.alarms.create(ALARM_NAME, { periodInMinutes: ALARM_PERIOD_MINUTES });
  }
}

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(SETTINGS_KEY);
  settings = sanitizeSettings(stored[SETTINGS_KEY]);
}

async function loadEarnedCount(): Promise<void> {
  const today = dateStringOf(nowSeconds(), timezoneOffsetMinutes());
  earnedByDate.set(today, await dao.earnedBlocksForDate(today));
}

async function initIdentity(): Promise<void> {
  const stored = await chrome.storage.local.get(KEYRING_STORAGE_KEY);
  const keyring = stored[KEYRING_STORAGE_KEY] as { wrappingKey?: string; identity?: string } | undefined;
  if (keyring?.wrappingKey !== undefined && keyring.identity !== undefined) {
    try {
      const wrapping = await importWrappingKey(keyring.wrappingKey);
      identityPrivateKey = await unwrapIdentityKey(keyring.identity, wrapping);
      return;
    } catch (error) {
      console.error("keyring unwrap failed; regenerating identity", error);
    }
  }
  const identity = generateIdentity();
  const wrapping = await generateWrappingKey();
  const identityEnvelope = await wrapIdentityKey(identity.privateKey, wrapping);
  await chrome.storage.local.set({
    [KEYRING_STORAGE_KEY]: {
      wrappingKey: await exportWrappingKey(wrapping),
      identity: identityEnvelope,
    },
  });
  identityPrivateKey = identity.privateKey;
}

async function loadMemberships(): Promise<void> {
  const stored = await chrome.storage.local.get(CREW_MEMBERSHIPS_KEY);
  crewMemberships = Array.isArray(stored[CREW_MEMBERSHIPS_KEY])
    ? (stored[CREW_MEMBERSHIPS_KEY] as StoredMembership[])
    : [];
}

async function saveMemberships(): Promise<void> {
  await chrome.storage.local.set({ [CREW_MEMBERSHIPS_KEY]: crewMemberships });
}

async function publishSelf(membership: StoredMembership, now: number): Promise<void> {
  if (identityPrivateKey === null) return;
  try {
    const [dayStats, sessions] = await Promise.all([dao.dayStats(), dao.allSessions()]);
    await publishOwnSnapshot(
      {
        membership,
        identityPrivateKey,
        displayName: membership.displayName,
        avatarBase64: null,
        dayStats,
        sessions,
        now,
        offsetMinutes: timezoneOffsetMinutes(),
      },
      crewDao,
    );
  } catch (error) {
    console.error(`crew publish failed for ${membership.crewId}`, error);
  }
}

async function crewSync(force = false): Promise<void> {
  if (crewSyncInFlight || crewMemberships.length === 0) return;
  const now = nowSeconds();
  const stored = await chrome.storage.local.get(CREW_SYNC_KEY);
  const lastSync = (stored[CREW_SYNC_KEY] as number | undefined) ?? 0;
  if (!force && now - lastSync < CREW_SYNC_MIN_INTERVAL) return;
  crewSyncInFlight = true;
  await chrome.storage.local.set({ [CREW_SYNC_KEY]: now });
  try {
    for (const membership of crewMemberships) {
      try {
        await refreshMembership(membership, crewDao, now);
      } catch (error) {
        console.error(`crew refresh failed for ${membership.crewId}`, error);
      }
      await publishSelf(membership, now);
    }
  } finally {
    crewSyncInFlight = false;
  }
}

async function crewSummaries(): Promise<CrewSummary[]> {
  const summaries: CrewSummary[] = [];
  for (const membership of crewMemberships) {
    const states = await crewDao.relayStates(membership.crewId);
    summaries.push({
      crewId: membership.crewId,
      crewName: membership.crewName,
      displayName: membership.displayName,
      relays: membership.relays,
      lastAttemptEpochSeconds: states.reduce((max, state) => Math.max(max, state.lastAttemptEpochSeconds), 0) || null,
      lastSuccessEpochSeconds:
        states.reduce((max, state) => Math.max(max, state.lastSuccessEpochSeconds ?? 0), 0) || null,
    });
  }
  return summaries;
}

async function buildBoardResponse(crewId: string, window: WindowKey, now: number): Promise<CrewBoardResult> {
  const membership = crewMemberships.find((m) => m.crewId === crewId)!;
  const { board, relayStates } = await loadCrewBoard(crewDao, crewId, window, now);
  const selfKey = identityPrivateKey === null ? "" : publicKeyOf(identityPrivateKey);
  const crew = (await crewSummaries()).find((c) => c.crewId === crewId) ?? {
    crewId: membership.crewId,
    crewName: membership.crewName,
    displayName: membership.displayName,
    relays: membership.relays,
    lastAttemptEpochSeconds: null,
    lastSuccessEpochSeconds: null,
  };
  return { crew, board, relayStates, standing: standingFor(board, selfKey), selfPublicKey: selfKey };
}

async function init(): Promise<void> {
  db = await openDb();
  dao = new HistoryDao(db);
  crewDao = new CrewDao(db);
  await loadSettings();
  await loadEarnedCount();
  await initIdentity();
  await loadMemberships();
  engine = new TimerEngine(enginePorts());
  const stored = await chrome.storage.local.get(ENGINE_KEY);
  const saved = stored[ENGINE_KEY] as TimerSnapshot | undefined;
  if (saved !== undefined) {
    try {
      engine.restore(saved);
    } catch (error) {
      console.error("engine restore failed; starting fresh", error);
    }
  }
  await ensureAlarm();
  await sync();
  void crewSync();
}

async function handleRequest(request: PomoRequest): Promise<PomoResponse> {
  switch (request.type) {
    case "pomo:command":
      switch (request.command) {
        case "toggle":
          engine.toggle();
          break;
        case "skip":
          engine.skip();
          break;
        case "reset":
          engine.reset();
          break;
        case "extend":
          engine.extend(request.seconds ?? 0);
          break;
      }
      void sync();
      return { ok: true, state: engine.snapshot() };
    case "pomo:query":
      return { ok: true, state: engine.snapshot() };
    case "pomo:stats": {
      const days = await dao.dayStats();
      const now = nowSeconds();
      const offset = timezoneOffsetMinutes();
      const today = dateStringOf(now, offset);
      const sum = totals(days);
      return {
        ok: true,
        stats: {
          todayEarned: days.find((day) => day.date === today)?.earnedBlocks ?? 0,
          totalFocusMinutes: sum.focusMinutes,
          streak: currentStreak(days.map((day) => day.date), today, offset),
        },
      };
    }
    case "pomo:history": {
      const [sessions, dayStats] = await Promise.all([dao.allSessions(), dao.dayStats()]);
      sessions.sort((a, b) => b.start - a.start);
      dayStats.sort((a, b) => (a.date < b.date ? 1 : -1));
      return {
        ok: true,
        history: { sessions: sessions.slice(0, 200), dayStats: dayStats.slice(0, 120) },
      };
    }
    case "pomo:settings:get":
      return { ok: true, settings };
    case "pomo:settings:set":
      settings = sanitizeSettings({ ...settings, ...request.settings });
      void chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      void sync();
      return { ok: true, settings };
    case "pomo:crew:list":
      return { ok: true, crews: await crewSummaries() };
    case "pomo:crew:board": {
      const membership = crewMemberships.find((m) => m.crewId === request.crewId);
      if (membership === undefined) return { ok: false, error: "crew not found" };
      return { ok: true, board: await buildBoardResponse(request.crewId, request.window, nowSeconds()) };
    }
    case "pomo:crew:join": {
      const decoded = decodePayload(request.payload);
      if (crewMemberships.some((m) => m.crewId === decoded.crewId)) {
        return { ok: false, error: "already a member of this crew" };
      }
      crewMemberships.push({
        crewId: decoded.crewId,
        crewName: decoded.crewName,
        relays: decoded.relays,
        key: decoded.key,
        displayName: request.displayName,
        joinedAtEpochSeconds: nowSeconds(),
      });
      await saveMemberships();
      void crewSync(true);
      return { ok: true, crews: await crewSummaries() };
    }
    case "pomo:crew:create": {
      const payload = newPayload(request.crewName);
      crewMemberships.push({
        crewId: payload.crewId,
        crewName: payload.crewName,
        relays: payload.relays,
        key: payload.key,
        displayName: request.displayName,
        joinedAtEpochSeconds: nowSeconds(),
      });
      await saveMemberships();
      void crewSync(true);
      return { ok: true, crews: await crewSummaries() };
    }
    case "pomo:crew:leave":
      crewMemberships = crewMemberships.filter((m) => m.crewId !== request.crewId);
      await saveMemberships();
      await crewDao.deleteCrew(request.crewId);
      return { ok: true, crews: await crewSummaries() };
    case "pomo:crew:hide":
      if (request.hidden) {
        await crewDao.setHidden(request.crewId, request.identityPublicKey, nowSeconds());
      } else {
        await crewDao.unhide(request.crewId, request.identityPublicKey);
      }
      return { ok: true };
    case "pomo:crew:rename": {
      const membership = crewMemberships.find((m) => m.crewId === request.crewId);
      if (membership === undefined) return { ok: false, error: "crew not found" };
      const displayName = request.displayName.trim();
      if (displayName.length === 0) return { ok: false, error: "display name cannot be empty" };
      membership.displayName = displayName;
      await saveMemberships();
      void crewSync(true);
      return { ok: true, crews: await crewSummaries() };
    }
    case "pomo:crew:refresh": {
      await crewSync(true);
      const membership = crewMemberships.find((m) => m.crewId === request.crewId);
      if (membership === undefined) return { ok: false, error: "crew not found" };
      return { ok: true, board: await buildBoardResponse(request.crewId, request.window ?? "today", nowSeconds()) };
    }
    case "pomo:crew:joinCode": {
      const membership = crewMemberships.find((m) => m.crewId === request.crewId);
      if (membership === undefined) return { ok: false, error: "crew not found" };
      return {
        ok: true,
        joinCode: encodePayload({
          version: 2,
          crewId: membership.crewId,
          crewName: membership.crewName,
          relays: membership.relays,
          key: membership.key,
        }),
      };
    }
    case "pomo:recovery:export": {
      if (identityPrivateKey === null) return { ok: false, error: "identity not ready" };
      try {
        const recovery = await encodeRecovery(identityPrivateKey, crewMemberships, request.passphrase);
        return { ok: true, recovery };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
    case "pomo:recovery:import": {
      const payload = await decodeRecovery(request.payload, request.passphrase);
      if (payload === null) return { ok: false, error: "invalid recovery file or passphrase" };
      try {
        const memberships: StoredMembership[] = [];
        for (const membership of payload.memberships) {
          const extras = membership as { displayName?: unknown; joinedAtEpochSeconds?: unknown };
          if (
            typeof membership.crewId !== "string" ||
            typeof membership.crewName !== "string" ||
            !Array.isArray(membership.relays) ||
            !membership.relays.every((relay) => typeof relay === "string") ||
            typeof membership.key !== "string"
          ) {
            return { ok: false, error: "invalid recovery file or passphrase" };
          }
          memberships.push({
            crewId: membership.crewId,
            crewName: membership.crewName,
            relays: membership.relays,
            key: membership.key,
            displayName:
              typeof extras.displayName === "string" && extras.displayName.length > 0
                ? extras.displayName
                : membership.crewName,
            joinedAtEpochSeconds:
              typeof extras.joinedAtEpochSeconds === "number" ? extras.joinedAtEpochSeconds : nowSeconds(),
          });
        }
        identityPrivateKey = payload.identityPrivateKey;
        const wrapping = await generateWrappingKey();
        const identityEnvelope = await wrapIdentityKey(identityPrivateKey, wrapping);
        await chrome.storage.local.set({
          [KEYRING_STORAGE_KEY]: {
            wrappingKey: await exportWrappingKey(wrapping),
            identity: identityEnvelope,
          },
        });
        crewMemberships = memberships;
        await saveMemberships();
        void crewSync(true);
        return { ok: true, crews: await crewSummaries() };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  void initOnce();
});

chrome.runtime.onStartup.addListener(() => {
  void initOnce();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  void initOnce().then(() => {
    engine.tick();
    void sync();
    void crewSync();
  });
});

chrome.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
  if (!isPomoRequest(message)) return;
  void initOnce()
    .then(() => handleRequest(message))
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) });
    });
  return true;
});

void initOnce();
