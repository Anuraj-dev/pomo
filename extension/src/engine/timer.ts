import { dateStringOf } from "./dateLogic";

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
  nextPhase: Phase;
  startTime: number;
  duration: number;
  remaining: number;
  completed: number;
  goal: number;
  date: string;
  lastActionTime: number;
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
  private completed = 0;
  private date = "";
  private tag = "";

  constructor(private readonly ports: EnginePorts) {
    const now = ports.now();
    this.date = this.today();
    this.armFullDuration();
    this.tag = ports.tag();
    this.completed = ports.earnedBlocksForDate(this.date);
    this.lastAction = now;
  }

  private offset(): number {
    return this.ports.offsetMinutes?.() ?? 0;
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
      return (completed + 1) % this.ports.longBreakAfter() === 0 ? "long" : "short";
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
    if (this.status !== "running") return;
    this.duration += seconds;
    this.lastAction = this.ports.now();
  }

  tick(): void {
    const now = this.ports.now();
    this.reconcileDate();
    if (this.status === "running" && this.derivedRemaining() <= 0) {
      this.complete(now);
    } else {
      this.lastAction = now;
    }
  }

  private complete(now: number): void {
    const endedPhase = this.phase;
    const tag = this.tag;
    const crossedDate = dateStringOf(this.startTime, this.offset()) !== this.today();
    this.ports.commit({ start: this.startTime, duration: this.duration, type: endedPhase, completed: true, tag });
    this.phase = this.nextPhaseOf(endedPhase, this.completed);
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
    this.status = saved.status;
    this.phase = saved.phase;
    this.startTime = saved.startTime;
    this.duration = saved.duration;
    this.remaining = saved.remaining;
    this.completed = saved.completed;
    this.date = saved.date;
    this.lastAction = saved.lastActionTime;
    this.tag = saved.tag;
    if (this.status === "running") {
      this.tick();
    } else if (this.date !== this.today()) {
      this.reconcileDate();
    } else {
      this.lastAction = now;
    }
  }

  snapshot(): TimerSnapshot {
    const running = this.status === "running";
    return {
      status: this.status,
      phase: this.phase,
      nextPhase: this.nextPhaseOf(this.phase, this.completed),
      startTime: this.startTime,
      duration: this.duration,
      remaining: Math.ceil(running ? this.derivedRemaining() : this.remaining),
      completed: this.completed,
      goal: this.ports.goal(),
      date: this.date,
      lastActionTime: this.lastAction,
      tag: this.tag,
      version: TIMER_STATE_VERSION,
    };
  }
}
