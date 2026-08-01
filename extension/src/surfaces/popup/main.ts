import type { TimerSnapshot } from "../../engine/timer";
import { formatRemaining, phaseLabel, statusLabel } from "../../shared/format";
import { applyTheme, sendCommand, subscribeState } from "../../shared/surface";

const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
const crewLinkEl = document.getElementById("crewLink")!;

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
  toggleEl.textContent = state.status === "running" ? "Pause" : "Start";
  renderTime(remainingOf(state));
}

function renderTime(remaining: number): void {
  timeEl.textContent = formatRemaining(remaining);
}

applyTheme();
subscribeState((state) => {
  latest = state;
  apply(state);
});

setInterval(() => {
  if (latest !== null) renderTime(remainingOf(latest));
}, 1000);

toggleEl.addEventListener("click", () => sendCommand("toggle"));
skipEl.addEventListener("click", () => sendCommand("skip"));
resetEl.addEventListener("click", () => sendCommand("reset"));
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
