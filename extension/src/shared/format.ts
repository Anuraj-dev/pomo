import type { Phase, Status as TimerStatus } from "../engine/timer";

export interface MillisecondsFormat {
  whole: string;
  milliseconds: string;
}

export function formatMilliseconds(totalSeconds: number): MillisecondsFormat {
  const millisecondsTotal = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0) * 1000);
  const whole = Math.floor(millisecondsTotal / 1000);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return {
    whole: `${minutes}:${seconds.toString().padStart(2, "0")}`,
    milliseconds: String(millisecondsTotal % 1000).padStart(3, "0"),
  };
}

export function formatMss(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(Number.isFinite(totalSeconds) ? totalSeconds : 0));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

export function phaseLabel(phase: Phase): string {
  switch (phase) {
    case "work":
      return "Focus";
    case "short":
      return "Short break";
    case "long":
      return "Long break";
  }
}

export function statusLabel(status: TimerStatus): string {
  switch (status) {
    case "running":
      return "Running";
    case "paused":
      return "Paused";
    case "stopped":
      return "Ready";
  }
}
