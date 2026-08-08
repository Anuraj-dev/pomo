import type { TimerSnapshot } from "../../engine/timer";
import { applyTheme, subscribeState } from "../../shared/surface";
import {
  applyInstrument,
  attachTicker,
  attachTimerControls,
  remainingOf,
  renderTime,
} from "../../shared/instrument";

const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const fractionEl = document.getElementById("fraction")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
let latest: TimerSnapshot | null = null;

applyTheme();
subscribeState((state) => {
  latest = state;
  applyInstrument(document.body, phaseEl, statusEl, state, {
    timeEl,
    fractionEl,
    toggleEl,
    toggleText: (s) => (s.status === "running" ? "Pause" : "Start"),
  });
});

attachTicker(
  () => latest,
  (state) => renderTime(timeEl, fractionEl, remainingOf(state)),
);

attachTimerControls(toggleEl, skipEl, resetEl);
