import type { TimerSnapshot } from "../../engine/timer";
import { formatFraction, phaseLabel, statusLabel } from "../../shared/format";
import { applyTheme, sendCommand, subscribeState } from "../../shared/surface";
import { readSurfaceStats } from "../../shared/statsReader";

const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const fractionEl = document.getElementById("fraction")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
const crewLinkEl = document.getElementById("crewLink")!;
const todayCountEl = document.getElementById("todayCount")!;
const totalMinutesEl = document.getElementById("totalMinutes")!;
const streakEl = document.getElementById("streak")!;

let latest: TimerSnapshot | null = null;

function remainingOf(state: TimerSnapshot): number {
  if (state.status === "running") {
    return Math.max(0, state.startTime + state.duration - Date.now() / 1000);
  }
  return state.remaining;
}

function apply(state: TimerSnapshot): void {
  document.body.dataset["empty"] = "false";
  document.body.dataset["phase"] = state.phase;
  document.body.dataset["status"] = state.status;
  phaseEl.textContent = phaseLabel(state.phase);
  statusEl.textContent = statusLabel(state.status);
  renderTime(remainingOf(state));
}

function renderTime(remaining: number): void {
  const [whole, tenths] = formatFraction(remaining).split(".");
  timeEl.textContent = whole ?? "";
  fractionEl.textContent = `.${tenths ?? "0"}`;
}

async function refreshStats(): Promise<void> {
  try {
    const stats = await readSurfaceStats();
    todayCountEl.textContent = String(stats.todayEarned);
    totalMinutesEl.textContent = String(Math.round(stats.totalFocusMinutes));
    streakEl.textContent = String(stats.streak);
  } catch {
    todayCountEl.textContent = "—";
    totalMinutesEl.textContent = "—";
    streakEl.textContent = "—";
  }
}

applyTheme();
subscribeState((state) => {
  latest = state;
  apply(state);
  void refreshStats();
});

setInterval(() => {
  if (latest !== null) renderTime(remainingOf(latest));
}, 100);

toggleEl.addEventListener("click", () => sendCommand("toggle"));
skipEl.addEventListener("click", () => sendCommand("skip"));
resetEl.addEventListener("click", () => sendCommand("reset"));
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
