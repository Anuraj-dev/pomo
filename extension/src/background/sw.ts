import { HistoryDao } from "../db/dao";
import { openDb } from "../db/schema";
import type { SessionRow } from "../db/types";
import { deltaForSegment, splitBlockByCalendarDay } from "../engine/blocks";
import { dateStringOf, prevDate, utcOffsetMinutesAt } from "../engine/dateLogic";
import { DEFAULT_SETTINGS, sanitizeSettings, type PomoSettings } from "../engine/settings";
import { currentStreak, totals } from "../engine/stats";
import { TimerEngine, type CompletedBlock, type Phase, type TimerSnapshot } from "../engine/timer";
import { PomoLink, type LinkEngineAdapter, type LinkPersist } from "../link/client";
import { historyDelta, type PhoneConfig, type PhoneHistorySession, type PhoneTimerState } from "../link/phoneState";
import { PhoneRest, browserSocket } from "../link/rest";
import { decodePortableBackup, encodePortableBackup } from "../shared/backup";
import { badgeColorOf, badgeTextOf } from "../shared/badge";
import {
  ENGINE_KEY,
  LINK_KEY,
  LINK_STATUS_KEY,
  SETTINGS_KEY,
  STATE_KEY,
  isPomoRequest,
  type PomoRequest,
  type PomoResponse,
} from "../shared/messages";

const ALARM_NAME = "pomo-tick";
const ALARM_PERIOD_MINUTES = 0.5;
const PHASE_COMPLETE_NOTIFICATION = "pomo-phase-complete";

let db: IDBDatabase | null = null;
let dao: HistoryDao | null = null;
let settings: PomoSettings = { ...DEFAULT_SETTINGS };
let engine: TimerEngine;
let link: PomoLink | null = null;
let earnedByDate = new Map<string, number>();
let pendingWrite = Promise.resolve();
let syncPromise: Promise<void> = Promise.resolve();
let linkPump = Promise.resolve();
let initPromise: Promise<void> | null = null;
let linkRetryTimer: ReturnType<typeof setTimeout> | null = null;

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

function timezoneOffsetMinutes(now: number = nowSeconds()): number {
  return utcOffsetMinutesAt(now);
}

function earnedBlocksForDate(date: string): number {
  return earnedByDate.get(date) ?? 0;
}

function commit(block: CompletedBlock): void {
  const offset = utcOffsetMinutesAt;
  const segments = splitBlockByCalendarDay({
    start: block.start,
    duration: block.duration,
    completed: block.completed,
    type: block.type,
    tag: block.tag,
    offsetMinutes: offset,
  });
  pendingWrite = pendingWrite
    .catch((error: unknown) => {
      console.error("session commit failed", error);
    })
    .then(async () => {
      const insertedStarts = await dao!.insertBlock(
        segments.map((segment) => {
          const delta = deltaForSegment(segment, block.completed);
          return {
            row: {
              start: segment.start,
              date: segment.date,
              type: segment.type,
              duration: segment.duration,
              completed: segment.completed,
              tag: segment.tag,
            } satisfies SessionRow,
            delta,
          };
        }),
      );
      const inserted = new Set(insertedStarts);
      for (const segment of segments) {
        if (segment.type === "work" && segment.completed && inserted.has(segment.start)) {
          earnedByDate.set(segment.date, earnedBlocksForDate(segment.date) + 1);
        }
      }
    });
  if (block.completed) {
    notifyPhaseComplete(block.type);
    link?.enqueueCompleted(block.type, block.duration, block.start, block.tag);
  }
}

async function syncAfterWrites(): Promise<void> {
  try {
    await pendingWrite;
  } catch (error) {
    console.error("state sync continued after history commit failure", error);
  }
  await sync();
}

function notifyPhaseComplete(phase: Phase): void {
  if (!settings.soundEnabled) return;
  const isWork = phase === "work";
  chrome.notifications
    .create(PHASE_COMPLETE_NOTIFICATION, {
      type: "basic",
      iconUrl: "icons/icon128.png",
      title: isWork ? "Focus session complete" : "Break over",
      message: isWork ? "Great work. Time for a break." : "Ready for the next focus session?",
      priority: 0,
    })
    .catch((error: unknown) => {
      console.error("phase-complete notification failed", error);
    });
}

function enginePorts(): ConstructorParameters<typeof TimerEngine>[0] {
  return {
    now: nowSeconds,
    offsetMinutes: timezoneOffsetMinutes,
    offsetMinutesAt: utcOffsetMinutesAt,
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

function followingPhone(): boolean {
  return link !== null && !link.localOwner;
}

function publishLinkStatus(): Promise<void> {
  if (link === null) return Promise.resolve();
  return chrome.storage.session.set({ [LINK_STATUS_KEY]: link.status() });
}

function scheduleLinkRetry(ms: number): void {
  if (linkRetryTimer !== null) clearTimeout(linkRetryTimer);
  linkRetryTimer = setTimeout(() => {
    linkRetryTimer = null;
    void pumpLink();
  }, ms);
}

function pumpLink(): Promise<void> {
  const operation = linkPump.then(async () => {
    if (link === null) return;
    await link.tick();
    await publishLinkStatus();
    const mode = link.mode;
    if (mode === "OFFLINE" || mode === "DISCOVERING" || mode === "CONNECTING") {
      scheduleLinkRetry(5_000);
    }
  });
  linkPump = operation.catch((error: unknown) => {
    console.error("link pump failed", error);
  });
  return operation;
}

function sync(): Promise<void> {
  const operation = syncPromise.then(async () => {
    if (!followingPhone()) engine.tick();
    const state = engine.snapshot();
    await chrome.storage.local.set({ [ENGINE_KEY]: state });
    await chrome.storage.session.set({ [STATE_KEY]: state });
    applyBadge(state);
    await publishLinkStatus();
  });
  syncPromise = operation.catch(() => undefined);
  return operation;
}

async function awaitHistoryWrites(): Promise<void> {
  try {
    await pendingWrite;
  } catch (error) {
    console.error("history write failed; continuing with possibly stale data", error);
  }
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

async function loadEarnedCount(extraDate?: string): Promise<void> {
  const now = nowSeconds();
  const offset = timezoneOffsetMinutes(now);
  const today = dateStringOf(now, offset);
  const dates = new Set([today, prevDate(today, offset)]);
  if (extraDate !== undefined) dates.add(extraDate);
  await Promise.all([...dates].map(async (date) => earnedByDate.set(date, await dao!.earnedBlocksForDate(date))));
}

async function exportPortableBackup(): Promise<string> {
  const [dayStats, sessions] = await Promise.all([dao!.dayStats(), dao!.allSessions()]);
  return encodePortableBackup({ dayStats, sessions });
}

async function importPortableBackup(payload: string): Promise<PomoResponse> {
  const backup = decodePortableBackup(payload);
  const result = await dao!.mergeBackup(
    backup.history.dayStats.map((day) => ({
      date: day.date,
      earnedBlocks: day.completed,
      focusMinutes: day.workMinutes,
      breakMinutes: day.breakMinutes,
      lastUpdated: Date.now(),
    })),
    backup.history.sessions,
  );
  await loadEarnedCount();
  return { ok: true, backupImport: result };
}

async function openDbCached(): Promise<IDBDatabase> {
  const connection = await openDb();
  connection.onversionchange = () => {
    connection.close();
    db = null;
    dao = null;
  };
  return connection;
}

async function ensureDb(): Promise<void> {
  if (dao !== null) return;
  db = await openDbCached();
  dao = new HistoryDao(db);
}

function engineAdapter(): LinkEngineAdapter {
  return {
    localOwner: true,
    snapshot: () => {
      const state = engine.peek();
      return {
        status: state.status,
        phase: state.phase,
        remaining: state.remaining,
        duration: state.duration,
        startTime: state.startTime,
        completed: state.completed,
        goal: state.goal,
        tag: state.tag,
        date: state.date,
      };
    },
    isLive: () => engine.isLive(),
    follow: (state: PhoneTimerState, remaining: number, date: string) => {
      engine.follow({
        status: state.status,
        phase: state.phase,
        startTime: state.start_time,
        duration: state.duration,
        remaining,
        completed: state.completed,
        date,
        tag: state.tag,
      });
    },
    setLocalOwner(owns: boolean) {
      this.localOwner = owns;
    },
    stampStartTime: () => engine.stampStartTimeIfLive(),
  };
}

function currentPhoneConfig(): PhoneConfig {
  return {
    workMinutes: settings.workMinutes,
    shortMinutes: settings.shortMinutes,
    longMinutes: settings.longMinutes,
    longBreakAfter: settings.longBreakAfter,
    dailyGoal: settings.dailyGoal,
  };
}

async function applyPhoneConfig(config: PhoneConfig): Promise<void> {
  settings = sanitizeSettings({
    ...settings,
    workMinutes: config.workMinutes,
    shortMinutes: config.shortMinutes,
    longMinutes: config.longMinutes,
    longBreakAfter: config.longBreakAfter,
    dailyGoal: config.dailyGoal,
  });
  engine.reconfigure();
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
  await sync();
}

async function persistLink(data: LinkPersist): Promise<void> {
  await chrome.storage.local.set({ [LINK_KEY]: data });
}

async function applyPhoneHistory(sessions: PhoneHistorySession[]): Promise<void> {
  if (dao === null || sessions.length === 0) return;
  try {
    const inserted = await dao.insertBlock(
      sessions.map((session) => ({
        row: {
          start: session.start,
          date: session.date,
          type: session.type,
          duration: session.duration,
          completed: session.completed,
          tag: session.tag,
        } satisfies SessionRow,
        delta: historyDelta(session),
      })),
    );
    if (inserted.length === 0) return;
    await loadEarnedCount();
    engine.refreshCompletedCount();
    await sync();
  } catch (error) {
    console.error("phone history merge failed", error);
  }
}

async function init(): Promise<void> {
  db = await openDbCached();
  dao = new HistoryDao(db);
  await loadSettings();
  const stored = await chrome.storage.local.get([ENGINE_KEY, LINK_KEY]);
  const saved = stored[ENGINE_KEY] as TimerSnapshot | undefined;
  const linkStored = stored[LINK_KEY] as LinkPersist | undefined;
  const restoredStartDate =
    saved?.startTime !== undefined && saved.startTime > 0 ? dateStringOf(saved.startTime, utcOffsetMinutesAt(saved.startTime)) : undefined;
  await loadEarnedCount(restoredStartDate);
  engine = new TimerEngine(enginePorts());
  const wasFollowing = linkStored !== undefined && linkStored.token.length > 0 && linkStored.localOwner === false;
  if (saved !== undefined) {
    try {
      engine.restore(saved, { reconcile: !wasFollowing });
    } catch (error) {
      console.error("engine restore failed; starting fresh", error);
    }
  }
  const adapter = engineAdapter();
  link = new PomoLink({
    rest: new PhoneRest(),
    connectSocket: browserSocket,
    engine: adapter,
    persist: linkStored ?? null,
    hooks: {
      persist: (data) => {
        void persistLink(data);
      },
      applyConfig: (config) => {
        void applyPhoneConfig(config);
      },
      applyHistory: (sessions) => applyPhoneHistory(sessions),
      currentConfig: currentPhoneConfig,
      onPhaseComplete: (phase) => notifyPhaseComplete(phase),
      onChange: () => {
        void sync();
      },
    },
  });
  await ensureAlarm();
  await link.start();
  await sync();
  void pumpLink();
}

function reconcileEngine(): boolean {
  const before = engine.snapshot();
  engine.tick();
  const after = engine.snapshot();
  return (
    before.status !== after.status ||
    before.phase !== after.phase ||
    before.completed !== after.completed ||
    before.date !== after.date
  );
}

async function handleRequest(request: PomoRequest): Promise<PomoResponse> {
  await ensureDb();
  switch (request.type) {
    case "pomo:command":
      if (link?.phoneCommandsActive()) {
        const sent = await link.sendGesture(request.command, request.seconds);
        await sync();
        void pumpLink();
        return { ok: sent, state: engine.peek(), error: sent ? undefined : link.message || "phone command failed" };
      }
      switch (request.command) {
        case "toggle": {
          const before = engine.peek();
          engine.tick();
          if (before.status === "running" && engine.peek().status !== "running") break;
          engine.toggle();
          break;
        }
        case "skip": {
          const before = engine.peek();
          engine.tick();
          if (before.status === "running" && engine.peek().status !== "running") break;
          engine.skip();
          break;
        }
        case "reset":
          engine.tick();
          engine.reset();
          break;
        case "extend":
          engine.extend(request.seconds ?? 0);
          break;
      }
      await syncAfterWrites();
      return { ok: true, state: engine.snapshot() };
    case "pomo:query":
      if (!followingPhone() && reconcileEngine()) await syncAfterWrites();
      return { ok: true, state: engine.snapshot(), link: link?.status() };
    case "pomo:stats": {
      if (link !== null) await link.refreshHistory();
      await awaitHistoryWrites();
      const days = await dao!.dayStats();
      const now = nowSeconds();
      const offset = timezoneOffsetMinutes(now);
      const today = dateStringOf(now, offset);
      const sum = totals(days);
      return {
        ok: true,
        stats: {
          todayEarned: days.find((day) => day.date === today)?.earnedBlocks ?? 0,
          totalFocusMinutes: sum.focusMinutes,
          streak: currentStreak(
            days.filter((day) => day.earnedBlocks > 0).map((day) => day.date),
            today,
            offset,
          ),
        },
      };
    }
    case "pomo:history": {
      if (link !== null) await link.refreshHistory();
      await awaitHistoryWrites();
      const [sessions, dayStats] = await Promise.all([dao!.allSessions(), dao!.dayStats()]);
      sessions.sort((a, b) => b.start - a.start);
      dayStats.sort((a, b) => b.date.localeCompare(a.date));
      return {
        ok: true,
        history: { sessions: sessions.slice(0, 200), dayStats: dayStats.slice(0, 120) },
      };
    }
    case "pomo:settings:get":
      return { ok: true, settings, link: link?.status() };
    case "pomo:settings:set":
      settings = sanitizeSettings({ ...settings, ...request.settings });
      engine.reconfigure();
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      if (link?.phoneCommandsActive()) {
        await link.pushConfig(currentPhoneConfig());
      }
      await sync();
      return { ok: true, settings, link: link?.status() };
    case "pomo:link:get":
      return { ok: true, link: link?.status() };
    case "pomo:link:pair":
      if (link === null) return { ok: false, error: "link not ready" };
      if (!link.applyPairing(request.payload)) {
        return { ok: false, error: "pairing payload needs url and token", link: link.status() };
      }
      await persistLink(link.persistState());
      await pumpLink();
      await sync();
      return { ok: true, link: link.status() };
    case "pomo:link:unpair":
      if (link === null) return { ok: false, error: "link not ready" };
      link.unpair();
      await persistLink(link.persistState());
      await sync();
      return { ok: true, link: link.status() };
    case "pomo:backup:export":
      try {
        return { ok: true, backup: await exportPortableBackup() };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    case "pomo:backup:import":
      try {
        return await importPortableBackup(request.payload);
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
  }
}

function logTopLevelError(context: string): (error: unknown) => void {
  return (error: unknown) => {
    console.error(`[${context}]`, error);
  };
}

chrome.runtime.onInstalled.addListener(() => {
  void initOnce().catch(logTopLevelError("onInstalled"));
});

chrome.runtime.onStartup.addListener(() => {
  void initOnce().catch(logTopLevelError("onStartup"));
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== ALARM_NAME) return;
  void initOnce()
    .then(async () => {
      await ensureDb();
      if (!followingPhone()) engine.tick();
      await syncAfterWrites();
      return pumpLink();
    })
    .catch(logTopLevelError("alarm"));
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

void initOnce().catch(logTopLevelError("module"));
