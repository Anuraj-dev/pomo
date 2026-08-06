import type { TimerSnapshot } from "../engine/timer";
import { formatMilliseconds, phaseLabel, statusLabel } from "./format";
import { readSurfaceStats } from "./statsReader";
import { applyTheme, sendCommand, subscribeState } from "./surface";

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
  const { whole, milliseconds } = formatMilliseconds(remaining);
  timeEl.textContent = whole;
  fractionEl.textContent = `.${milliseconds}`;
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

/** Renders at a fixed cadence while the timer runs, once per static-state
 * transition otherwise, and returns a stop() function. */
export function attachTicker(
  getLatest: () => TimerSnapshot | null,
  render: (state: TimerSnapshot) => void,
  intervalMs = 50,
): () => void {
  let lastStatus: TimerSnapshot["status"] | null = null;
  const timer = setInterval(() => {
    const latest = getLatest();
    if (latest === null) return;
    if (latest.status !== "running") {
      // Static states only need one render; constant ticking is wasted work.
      if (lastStatus === latest.status) return;
      lastStatus = latest.status;
    }
    render(latest);
  }, intervalMs);
  return () => clearInterval(timer);
}

let statsRequestSeq = 0;

/** Loads surface stats, validating values and ignoring stale responses so
 * concurrent refreshes cannot overwrite newer data. */
export async function refreshStats(todayEl: HTMLElement, minutesEl: HTMLElement, streakEl: HTMLElement): Promise<void> {
  const requestSeq = ++statsRequestSeq;
  try {
    const stats = await readSurfaceStats();
    if (requestSeq !== statsRequestSeq) return;
    todayEl.textContent = String(Number.isFinite(stats.todayEarned) ? stats.todayEarned : 0);
    minutesEl.textContent = String(Number.isFinite(stats.totalFocusMinutes) ? Math.round(stats.totalFocusMinutes) : 0);
    streakEl.textContent = String(Number.isFinite(stats.streak) ? stats.streak : 0);
  } catch {
    if (requestSeq !== statsRequestSeq) return;
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

export interface InstrumentBootstrap {
  phaseEl: HTMLElement;
  statusEl: HTMLElement;
  timeEl: HTMLElement;
  fractionEl: HTMLElement;
  progressEl?: HTMLElement;
  toggleEl: HTMLElement;
  skipEl: HTMLElement;
  resetEl: HTMLElement;
  toggleText?: (state: TimerSnapshot) => string;
  onState?: (state: TimerSnapshot) => void;
}

/** Shared wiring for simple instrument surfaces (popup/sidepanel): theme,
 * state subscription, ticking, and controls, in one place so the surfaces do
 * not drift. */
export function bootInstrument(bodyEl: HTMLElement, config: InstrumentBootstrap): void {
  let latest: TimerSnapshot | null = null;
  applyTheme();
  subscribeState((state) => {
    latest = state;
    applyInstrument(bodyEl, config.phaseEl, config.statusEl, state, {
      timeEl: config.timeEl,
      fractionEl: config.fractionEl,
      progressEl: config.progressEl,
      toggleEl: config.toggleEl,
      toggleText: config.toggleText,
    });
    config.onState?.(state);
  });
  attachTicker(
    () => latest,
    (state) => {
      renderTime(config.timeEl, config.fractionEl, remainingOf(state));
      if (config.progressEl !== undefined) renderProgress(config.progressEl, state);
    },
  );
  attachTimerControls(config.toggleEl, config.skipEl, config.resetEl);
}
