import type { Phase } from "../engine/timer";
import { formatMss } from "./format";

export const FOCUS_BADGE_COLOR = "#ff4d3d";
export const MUTED_BADGE_COLOR = "#8b95a3";

const MINUTE_MS = 60_000;
// Chrome action badges render roughly 4 characters (documented platform
// limit), so "9:59" is the widest M:SS that fits. At 10:00+ M:SS would need
// 5 characters ("10:00"), so we fall back to whole minutes ("10m"). The cap
// of 999 minutes keeps the largest value ("999m") at exactly 4 characters.
const M_SS_THRESHOLD_MS = 10 * MINUTE_MS;
const MAX_MINUTES = 999;

export function badgeTextOf(remainingMs: number): string {
  if (remainingMs <= 0) return "0:00";
  if (remainingMs >= M_SS_THRESHOLD_MS) {
    return `${Math.min(MAX_MINUTES, Math.floor(remainingMs / MINUTE_MS))}m`;
  }
  return formatMss(remainingMs / 1000);
}

export function badgeColorOf(phase: Phase): string {
  return phase === "work" ? FOCUS_BADGE_COLOR : MUTED_BADGE_COLOR;
}
