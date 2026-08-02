import type { TimerSnapshot } from "../../engine/timer";
import { applyTheme, request, subscribeState } from "../../shared/surface";
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
const crewLinkEl = document.getElementById("crewLink")!;
const crewNameEl = document.getElementById("crewName")!;
const crewRankEl = document.getElementById("crewRank")!;
const crewMinutesEl = document.getElementById("crewMinutes")!;
const crewStreakEl = document.getElementById("crewStreak")!;

let latest: TimerSnapshot | null = null;

async function refreshCrew(): Promise<void> {
  const list = await request({ type: "pomo:crew:list" });
  const crewList = list.ok ? (list.crews ?? []) : [];
  if (crewList.length === 0) return;
  const crew = crewList[0]!;
  crewNameEl.textContent = crew.crewName;
  const board = await request({ type: "pomo:crew:board", crewId: crew.crewId, window: "today" });
  if (!board.ok || board.board === undefined) {
    crewRankEl.textContent = "—";
    crewMinutesEl.textContent = "— min";
    crewStreakEl.textContent = "streak —";
    crewLinkEl.hidden = false;
    return;
  }
  const result = board.board;
  const standing = result.standing;
  crewRankEl.textContent = standing === null || standing.unranked ? "—" : `#${standing.rank}`;
  crewMinutesEl.textContent = standing === null ? "— min" : `${standing.focusMinutes} min`;
  const self = result.board.members.find((m) => m.identityPublicKey === result.selfPublicKey);
  crewStreakEl.textContent = self === undefined ? "streak —" : `streak ${self.streak}`;
  crewLinkEl.hidden = false;
}

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

void refreshCrew();

attachTicker(
  () => latest,
  (state) => renderTime(timeEl, fractionEl, remainingOf(state)),
);

attachTimerControls(toggleEl, skipEl, resetEl);
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
