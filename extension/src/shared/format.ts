import type { Phase, Status as TimerStatus } from "../engine/timer";

export function formatRemaining(totalSeconds: number): string {
  const clamped = Math.max(0, Math.ceil(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function formatFraction(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const whole = Math.floor(clamped);
  const tenths = Math.floor((clamped - whole) * 10);
  return `${formatRemaining(whole)}.${tenths}`;
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
