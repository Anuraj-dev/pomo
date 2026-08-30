import { HistoryDao } from "../db/dao";
import { openDb } from "../db/schema";
import type { SessionRow } from "../db/types";
import { deltaForSegment, splitBlockByCalendarDay } from "../engine/blocks";
import { dateStringOf, prevDate, utcOffsetMinutesAt } from "../engine/dateLogic";
import { DEFAULT_SETTINGS, sanitizeSettings, type PomoSettings } from "../engine/settings";
import { currentStreak, totals } from "../engine/stats";
import { TimerEngine, type CompletedBlock, type Phase, type TimerSnapshot } from "../engine/timer";
import { decodePortableBackup, encodePortableBackup } from "../shared/backup";
import { badgeColorOf, badgeTextOf } from "../shared/badge";
import {
  ENGINE_KEY,
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
let earnedByDate = new Map<string, number>();
let pendingWrite = Promise.resolve();
let syncPromise: Promise<void> = Promise.resolve();
let initPromise: Promise<void> | null = null;

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
  if (block.completed) notifyPhaseComplete(block.type);
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

function sync(): Promise<void> {
  const operation = syncPromise.then(async () => {
    engine.tick();
    const state = engine.snapshot();
    await chrome.storage.local.set({ [ENGINE_KEY]: state });
    await chrome.storage.session.set({ [STATE_KEY]: state });
    applyBadge(state);
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

async function init(): Promise<void> {
  db = await openDbCached();
  dao = new HistoryDao(db);
  await loadSettings();
  const stored = await chrome.storage.local.get(ENGINE_KEY);
  const saved = stored[ENGINE_KEY] as TimerSnapshot | undefined;
  const restoredStartDate =
    saved?.startTime !== undefined && saved.startTime > 0 ? dateStringOf(saved.startTime, utcOffsetMinutesAt(saved.startTime)) : undefined;
  await loadEarnedCount(restoredStartDate);
  engine = new TimerEngine(enginePorts());
  if (saved !== undefined) {
    try {
      engine.restore(saved);
    } catch (error) {
      console.error("engine restore failed; starting fresh", error);
    }
  }
  await ensureAlarm();
  await sync();
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
      switch (request.command) {
        case "toggle": {
          const before = engine.snapshot();
          engine.tick();
          if (before.status === "running" && engine.snapshot().status !== "running") break;
          engine.toggle();
          break;
        }
        case "skip": {
          const before = engine.snapshot();
          engine.tick();
          if (before.status === "running" && engine.snapshot().status !== "running") break;
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
      if (reconcileEngine()) await syncAfterWrites();
      return { ok: true, state: engine.snapshot() };
    case "pomo:stats": {
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
      return { ok: true, settings };
    case "pomo:settings:set":
      settings = sanitizeSettings({ ...settings, ...request.settings });
      engine.reconfigure();
      await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
      await sync();
      return { ok: true, settings };
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
      engine.tick();
      return syncAfterWrites();
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
