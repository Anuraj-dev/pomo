import type { Phase, Status as TimerStatus } from "../engine/timer";

export interface TenthsFormat {
  whole: string;
  tenths: string;
}

export function formatTenths(totalSeconds: number): TenthsFormat {
  const tenthsTotal = Math.max(0, Math.floor(totalSeconds * 10));
  const whole = Math.floor(tenthsTotal / 10);
  const minutes = Math.floor(whole / 60);
  const seconds = whole % 60;
  return {
    whole: `${minutes}:${seconds.toString().padStart(2, "0")}`,
    tenths: String(tenthsTotal % 10),
  };
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
