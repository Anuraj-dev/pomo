import type { TimerSnapshot } from "../../engine/timer";
import { applyTheme, subscribeState } from "../../shared/surface";
import {
  applyInstrument,
  attachTicker,
  attachTimerControls,
  refreshStats,
  remainingOf,
  renderProgress,
  renderTime,
} from "../../shared/instrument";

const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const fractionEl = document.getElementById("fraction")!;
const progressEl = document.getElementById("fill")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
const todayCountEl = document.getElementById("todayCount")!;
const totalMinutesEl = document.getElementById("totalMinutes")!;
const streakEl = document.getElementById("streak")!;
const historyLinkEl = document.getElementById("historyLink")!;
const crewLinkEl = document.getElementById("crewLink")!;

let latest: TimerSnapshot | null = null;

applyTheme();
subscribeState((state) => {
  latest = state;
  applyInstrument(document.body, phaseEl, statusEl, state, { timeEl, fractionEl, progressEl });
  void refreshStats(todayCountEl, totalMinutesEl, streakEl);
});

attachTicker(
  () => latest,
  (state) => {
    renderTime(timeEl, fractionEl, remainingOf(state));
    renderProgress(progressEl, state);
  },
);

attachTimerControls(toggleEl, skipEl, resetEl);

historyLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html") });
});
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
