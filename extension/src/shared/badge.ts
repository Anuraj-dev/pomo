import type { Phase } from "../engine/timer";

export const FOCUS_BADGE_COLOR = "#ff4d3d";
export const MUTED_BADGE_COLOR = "#8b95a3";

const MINUTE_MS = 60_000;
const M_SS_THRESHOLD_MS = 10 * MINUTE_MS;
const MAX_MINUTES = 999;

export function badgeTextOf(remainingMs: number): string {
  if (remainingMs <= 0) return "0:00";
  if (remainingMs >= M_SS_THRESHOLD_MS) {
    return `${Math.min(MAX_MINUTES, Math.floor(remainingMs / MINUTE_MS))}m`;
  }
  const totalSeconds = Math.floor(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function badgeColorOf(phase: Phase): string {
  return phase === "work" ? FOCUS_BADGE_COLOR : MUTED_BADGE_COLOR;
}
