import type { TimerSnapshot } from "../../engine/timer";
import { formatTenths, phaseLabel, statusLabel } from "../../shared/format";
import { applyTheme, request, sendCommand, subscribeState } from "../../shared/surface";

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
  const { whole, tenths } = formatTenths(remaining);
  timeEl.textContent = whole;
  fractionEl.textContent = `.${tenths}`;
}

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
  apply(state);
});

void refreshCrew();

setInterval(() => {
  if (latest !== null) renderTime(remainingOf(latest));
}, 100);

toggleEl.addEventListener("click", () => sendCommand("toggle"));
skipEl.addEventListener("click", () => sendCommand("skip"));
resetEl.addEventListener("click", () => sendCommand("reset"));
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
