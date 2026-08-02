import type { TimerSnapshot } from "../engine/timer";
import { formatTenths, phaseLabel, statusLabel } from "./format";
import { readSurfaceStats } from "./statsReader";
import { sendCommand } from "./surface";

export function remainingOf(state: TimerSnapshot): number {
  if (state.status === "running") {
    return Math.max(0, state.startTime + state.duration - Date.now() / 1000);
  }
  return state.remaining;
}

export function elapsedFraction(state: TimerSnapshot): number {
  const remaining = remainingOf(state);
  if (state.duration <= 0) return 0;
  return Math.min(1, Math.max(0, 1 - remaining / state.duration));
}

export function renderTime(timeEl: HTMLElement, fractionEl: HTMLElement, remaining: number): void {
  const { whole, tenths } = formatTenths(remaining);
  timeEl.textContent = whole;
  fractionEl.textContent = `.${tenths}`;
}

export function renderProgress(progressEl: HTMLElement, state: TimerSnapshot): void {
  progressEl.style.transform = `scaleX(${elapsedFraction(state)})`;
}

export interface InstrumentOpts {
  timeEl?: HTMLElement;
  fractionEl?: HTMLElement;
  progressEl?: HTMLElement;
  toggleEl?: HTMLElement;
  toggleText?: (state: TimerSnapshot) => string;
}

export function applyInstrument(
  bodyEl: HTMLElement,
  phaseEl: HTMLElement,
  statusEl: HTMLElement,
  state: TimerSnapshot,
  opts?: InstrumentOpts,
): void {
  bodyEl.dataset["empty"] = "false";
  bodyEl.dataset["phase"] = state.phase;
  bodyEl.dataset["status"] = state.status;
  phaseEl.textContent = phaseLabel(state.phase);
  statusEl.textContent = statusLabel(state.status);
  if (opts?.timeEl !== undefined && opts.fractionEl !== undefined) {
    renderTime(opts.timeEl, opts.fractionEl, remainingOf(state));
  }
  if (opts?.progressEl !== undefined) {
    renderProgress(opts.progressEl, state);
  }
  if (opts?.toggleEl !== undefined && opts.toggleText !== undefined) {
    opts.toggleEl.textContent = opts.toggleText(state);
  }
}

export function attachTicker(
  getLatest: () => TimerSnapshot | null,
  render: (state: TimerSnapshot) => void,
  intervalMs = 100,
): void {
  setInterval(() => {
    const latest = getLatest();
    if (latest !== null) render(latest);
  }, intervalMs);
}

export async function refreshStats(todayEl: HTMLElement, minutesEl: HTMLElement, streakEl: HTMLElement): Promise<void> {
  try {
    const stats = await readSurfaceStats();
    todayEl.textContent = String(stats.todayEarned);
    minutesEl.textContent = String(Math.round(stats.totalFocusMinutes));
    streakEl.textContent = String(stats.streak);
  } catch {
    todayEl.textContent = "—";
    minutesEl.textContent = "—";
    streakEl.textContent = "—";
  }
}

export function attachTimerControls(toggleEl: HTMLElement, skipEl: HTMLElement, resetEl: HTMLElement): void {
  toggleEl.addEventListener("click", () => sendCommand("toggle"));
  skipEl.addEventListener("click", () => sendCommand("skip"));
  resetEl.addEventListener("click", () => sendCommand("reset"));
}
