import { isValidDateString } from "../engine/dateLogic";
import type { Phase, Status } from "../engine/timer";

export interface PhoneTimerState {
  status: Status;
  phase: Phase;
  remaining: number;
  duration: number;
  start_time: number;
  completed: number;
  daily_goal: number;
  tag: string;
  date?: string;
  server_time: number;
}

const STATUSES = new Set<string>(["stopped", "running", "paused"]);
const PHASES = new Set<string>(["work", "short", "long"]);

function finiteNumber(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function parsePhoneState(data: unknown): PhoneTimerState | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const status = String(record.status ?? "stopped");
  const phase = String(record.phase ?? "work");
  if (!STATUSES.has(status) || !PHASES.has(phase)) return null;
  const remaining = Math.max(0, finiteNumber(record.remaining, 0));
  const duration = Math.max(0, finiteNumber(record.duration, 0));
  return {
    status: status as Status,
    phase: phase as Phase,
    remaining: duration > 0 ? Math.min(remaining, duration) : remaining,
    duration,
    start_time: Math.max(0, finiteNumber(record.start_time, 0)),
    completed: Math.max(0, Math.floor(finiteNumber(record.completed, 0))),
    daily_goal: Math.max(0, Math.floor(finiteNumber(record.daily_goal, 8))),
    tag: typeof record.tag === "string" ? record.tag : "",
    date: typeof record.date === "string" ? record.date : undefined,
    server_time: Math.max(0, Math.floor(finiteNumber(record.server_time, 0))),
  };
}

export function projectRemaining(state: PhoneTimerState, epochNow: number): number {
  if (state.status !== "running" || state.server_time <= 0 || epochNow <= state.server_time) {
    return state.remaining;
  }
  return Math.max(0, state.remaining - (epochNow - state.server_time));
}

export function shouldIgnoreSnapshot(args: {
  force: boolean;
  localOwner: boolean;
  hasState: boolean;
  sameSession: boolean;
  lastServerTime: number;
  incoming: PhoneTimerState;
  projectedRemaining: number;
  currentRemaining: number;
  currentDuration: number;
}): boolean {
  if (args.force || args.localOwner || !args.hasState || !args.sameSession) return false;
  if (args.incoming.server_time > 0 && args.lastServerTime > 0 && args.incoming.server_time < args.lastServerTime) {
    return true;
  }
  if (args.incoming.status === "running") {
    if (args.projectedRemaining > args.currentRemaining + 1) {
      const likelyExtend = args.incoming.duration > args.currentDuration + 0.5;
      if (!likelyExtend) return true;
    }
  }
  return false;
}

export interface PhoneConfig {
  workMinutes: number;
  shortMinutes: number;
  longMinutes: number;
  longBreakAfter: number;
  dailyGoal: number;
}

export function parsePhoneConfig(data: unknown, fallback: PhoneConfig): PhoneConfig | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const durations = record.durations;
  const dur = typeof durations === "object" && durations !== null ? (durations as Record<string, unknown>) : {};
  const positive = (value: unknown, fb: number): number => {
    const n = Math.floor(finiteNumber(value, fb));
    return n >= 1 ? n : fb;
  };
  const goal = Math.floor(finiteNumber(record.daily_goal, fallback.dailyGoal));
  return {
    workMinutes: positive(dur.work, fallback.workMinutes),
    shortMinutes: positive(dur.short_break, fallback.shortMinutes),
    longMinutes: positive(dur.long_break, fallback.longMinutes),
    longBreakAfter: positive(record.long_break_after, fallback.longBreakAfter),
    dailyGoal: goal >= 0 ? goal : fallback.dailyGoal,
  };
}

export interface PhoneHistorySession {
  date: string;
  type: Phase;
  start: number;
  duration: number;
  completed: boolean;
  tag: string | null;
}

export function historyDelta(session: PhoneHistorySession): {
  earnedBlocks: number;
  focusMinutes: number;
  breakMinutes: number;
} {
  if (session.type === "work") {
    return {
      earnedBlocks: session.completed ? 1 : 0,
      focusMinutes: session.duration / 60,
      breakMinutes: 0,
    };
  }
  return { earnedBlocks: 0, focusMinutes: 0, breakMinutes: session.duration / 60 };
}

/** Phone GET /api/history is a date-keyed map. Sessions are already split by phone-local day. */
export function parsePhoneHistory(data: unknown): PhoneHistorySession[] | null {
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const out: PhoneHistorySession[] = [];
  for (const [date, entry] of Object.entries(data as Record<string, unknown>)) {
    if (!isValidDateString(date)) continue;
    if (typeof entry !== "object" || entry === null) return null;
    const sessions = (entry as Record<string, unknown>).sessions;
    if (sessions === undefined) continue;
    if (!Array.isArray(sessions)) return null;
    for (const row of sessions) {
      if (typeof row !== "object" || row === null) continue;
      const record = row as Record<string, unknown>;
      const type = String(record.type ?? "");
      if (!PHASES.has(type)) continue;
      const start = Math.floor(finiteNumber(record.start, 0));
      const duration = Math.floor(finiteNumber(record.duration, 0));
      if (start <= 0 || duration <= 0) continue;
      const tag = typeof record.tag === "string" && record.tag.length > 0 ? record.tag : null;
      out.push({
        date,
        type: type as Phase,
        start,
        duration,
        completed: record.completed === true,
        tag,
      });
    }
  }
  return out;
}

export function configBody(config: PhoneConfig): Record<string, unknown> {
  return {
    durations: {
      work: config.workMinutes,
      short_break: config.shortMinutes,
      long_break: config.longMinutes,
    },
    long_break_after: config.longBreakAfter,
    daily_goal: config.dailyGoal,
  };
}
