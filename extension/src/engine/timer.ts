import { dateStringOf, isValidDateString } from "./dateLogic";

export type Phase = "work" | "short" | "long";
export type Status = "stopped" | "running" | "paused";

export interface CompletedBlock {
  start: number;
  duration: number;
  type: Phase;
  completed: boolean;
  tag: string;
}

export interface EnginePorts {
  now(): number;
  offsetMinutes?(): number;
  offsetMinutesAt?(epochSeconds: number): number;
  commit(block: CompletedBlock): void;
  earnedBlocksForDate(date: string): number;
  phaseSeconds(phase: Phase): number;
  goal(): number;
  tag(): string;
  longBreakAfter(): number;
}

export const TIMER_STATE_VERSION = 2;

export interface TimerSnapshot {
  status: Status;
  phase: Phase;
  startTime: number;
  duration: number;
  remaining: number;
  completed: number;
  goal: number;
  date: string;
  lastUpdatedTime: number;
  revision: number;
  tag: string;
  version: number;
}

export class TimerEngine {
  private status: Status = "stopped";
  private phase: Phase = "work";
  private startTime = 0;
  private duration = 0;
  private remaining = 0;
  private lastAction = 0;
  private revision = 0;
  private completed = 0;
  private date = "";
  private tag = "";

  constructor(private readonly ports: EnginePorts) {
    const now = ports.now();
    this.date = dateStringOf(now, this.offsetAt(now));
    this.armFullDuration();
    this.tag = ports.tag();
    this.completed = ports.earnedBlocksForDate(this.date);
    this.lastAction = now;
  }

  private offsetAt(epochSeconds: number): number {
    return this.ports.offsetMinutesAt?.(epochSeconds) ?? this.ports.offsetMinutes?.() ?? 0;
  }

  private offset(): number {
    return this.offsetAt(this.ports.now());
  }

  private today(): string {
    return dateStringOf(this.ports.now(), this.offset());
  }

  private armFullDuration(): void {
    this.duration = this.ports.phaseSeconds(this.phase);
    this.remaining = this.duration;
  }

  private endAt(): number {
    return this.startTime + this.duration;
  }

  private derivedRemaining(): number {
    return Math.max(0, this.endAt() - this.ports.now());
  }

  private elapsedSeconds(): number {
    if (this.status === "running") {
      return Math.min(this.duration, Math.max(0, this.ports.now() - this.startTime));
    }
    return this.duration - this.remaining;
  }

  private nextPhaseOf(phase: Phase, completed: number): Phase {
    if (phase === "work") {
      const cadence = this.ports.longBreakAfter();
      if (!Number.isFinite(cadence) || Math.floor(cadence) < 1) return "short";
      return (completed + 1) % Math.floor(cadence) === 0 ? "long" : "short";
    }
    return "work";
  }

  private reconcileDate(): void {
    const t = this.today();
    if (t === this.date) return;
    this.date = t;
    this.completed = this.ports.earnedBlocksForDate(t);
    if (this.status !== "running") {
      this.status = "stopped";
      this.phase = "work";
      this.armFullDuration();
    }
  }

  toggle(): void {
    const now = this.ports.now();
    this.reconcileDate();
    if (this.status === "running") {
      this.status = "paused";
      this.remaining = this.derivedRemaining();
    } else {
      if (this.status === "stopped") {
        this.armFullDuration();
        this.tag = this.ports.tag();
      }
      this.startTime = now - (this.duration - this.remaining);
      this.status = "running";
    }
    this.lastAction = now;
  }

  skip(): void {
    const now = this.ports.now();
    this.reconcileDate();
    if (this.phase === "work") {
      const elapsed = this.elapsedSeconds();
      if (elapsed >= 60) {
        this.ports.commit({ start: this.startTime, duration: elapsed, type: "work", completed: false, tag: this.tag });
      }
    }
    // Skipped work is not an earned block, so it never earns a long break.
    this.phase = this.phase === "work" ? "short" : "work";
    this.status = "stopped";
    this.armFullDuration();
    this.lastAction = now;
  }

  reset(): void {
    const now = this.ports.now();
    this.reconcileDate();
    this.status = "stopped";
    this.armFullDuration();
    this.lastAction = now;
  }

  extend(seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    const secondsToAdd = Math.floor(seconds);
    if (secondsToAdd <= 0) return;
    const now = this.ports.now();
    this.tick();
    if (this.status !== "running") return;
    this.duration += secondsToAdd;
    this.lastAction = now;
  }

  refreshCompletedCount(): void {
    this.reconcileDate();
    this.completed = this.ports.earnedBlocksForDate(this.date);
  }

  /**
   * Re-applies settings-dependent state: re-arms a stopped phase so a changed
   * duration/goal/tag takes effect immediately. Running/paused sessions keep
   * their in-progress durations until they next start.
   */
  reconfigure(): void {
    this.reconcileDate();
    if (this.status === "stopped") {
      this.tag = this.ports.tag();
      this.armFullDuration();
    }
  }

  tick(): void {
    const now = this.ports.now();
    this.reconcileDate();
    if (this.status === "running" && this.derivedRemaining() <= 0) {
      this.complete(now);
    }
  }

  private complete(now: number): void {
    const endedPhase = this.phase;
    const tag = this.tag;
    const startDate = dateStringOf(this.startTime, this.offsetAt(this.startTime));
    const crossedDate = startDate !== this.today();
    const cadenceCount = crossedDate ? this.ports.earnedBlocksForDate(startDate) : this.completed;
    this.ports.commit({ start: this.startTime, duration: this.duration, type: endedPhase, completed: true, tag });
    this.phase = this.nextPhaseOf(endedPhase, cadenceCount);
    if (endedPhase === "work") {
      this.completed = crossedDate ? this.ports.earnedBlocksForDate(this.today()) : this.completed + 1;
    }
    this.status = "stopped";
    this.armFullDuration();
    this.lastAction = now;
  }

  restore(saved: TimerSnapshot): void {
    const now = this.ports.now();
    if (saved.version !== TIMER_STATE_VERSION) {
      throw new Error(`unsupported saved state version: ${saved.version}`);
    }
    this.status = sanitizeStatus(saved.status);
    this.phase = sanitizePhase(saved.phase);
    this.startTime = finiteAtLeast(saved.startTime, 0, "startTime");
    this.duration = finiteAtLeast(saved.duration, 0, "duration");
    this.remaining = Math.min(finiteAtLeast(saved.remaining, 0, "remaining"), this.duration);
    this.completed = finiteAtLeast(saved.completed, 0, "completed");
    if (!Number.isInteger(this.completed)) {
      throw new Error(`invalid saved completed: ${String(this.completed)}`);
    }
    this.date = sanitizeDate(saved.date);
    this.lastAction = Number.isFinite(saved.lastUpdatedTime) && saved.lastUpdatedTime >= 0 ? saved.lastUpdatedTime : now;
    this.revision = Number.isFinite(saved.revision) && saved.revision >= 0 ? saved.revision : 0;
    this.tag = typeof saved.tag === "string" ? saved.tag : "";
    if (this.status === "running") {
      this.tick();
    } else if (this.date !== this.today()) {
      this.reconcileDate();
    } else {
      this.lastAction = now;
    }
  }

  snapshot(): TimerSnapshot {
    this.revision += 1;
    const running = this.status === "running";
    return {
      status: this.status,
      phase: this.phase,
      startTime: this.startTime,
      duration: this.duration,
      remaining: Math.ceil(running ? this.derivedRemaining() : this.remaining),
      completed: this.completed,
      goal: this.ports.goal(),
      date: this.date,
      lastUpdatedTime: this.lastAction,
      revision: this.revision,
      tag: this.tag,
      version: TIMER_STATE_VERSION,
    };
  }
}

const VALID_STATUSES: ReadonlySet<string> = new Set(["stopped", "running", "paused"]);
const VALID_PHASES: ReadonlySet<string> = new Set(["work", "short", "long"]);

function sanitizeStatus(value: Status): Status {
  if (!VALID_STATUSES.has(value)) throw new Error(`invalid saved status: ${String(value)}`);
  return value;
}

function sanitizePhase(value: Phase): Phase {
  if (!VALID_PHASES.has(value)) throw new Error(`invalid saved phase: ${String(value)}`);
  return value;
}

function finiteAtLeast(value: number, min: number, field: string): number {
  if (!Number.isFinite(value) || value < min) {
    throw new Error(`invalid saved ${field}: ${String(value)}`);
  }
  return value;
}

function sanitizeDate(value: string): string {
  if (typeof value !== "string" || !isValidDateString(value)) {
    throw new Error(`invalid saved date: ${String(value)}`);
  }
  return value;
}
