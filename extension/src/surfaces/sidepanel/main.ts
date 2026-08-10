import { bootInstrument, refreshStats } from "../../shared/instrument";
import { requiredElement } from "../../shared/surface";

const todayCountEl = requiredElement("todayCount");
const totalMinutesEl = requiredElement("totalMinutes");
const streakEl = requiredElement("streak");
const historyLinkEl = requiredElement("historyLink");
const crewLinkEl = requiredElement("crewLink");

bootInstrument(document.body, {
  phaseEl: requiredElement("phase"),
  statusEl: requiredElement("status"),
  timeEl: requiredElement("time"),
  fractionEl: requiredElement("fraction"),
  progressEl: requiredElement("fill"),
  toggleEl: requiredElement("toggle"),
  skipEl: requiredElement("skip"),
  resetEl: requiredElement("reset"),
  onState: () => {
    void refreshStats(todayCountEl, totalMinutesEl, streakEl);
  },
});

historyLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("newtab.html#history") });
});
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});
