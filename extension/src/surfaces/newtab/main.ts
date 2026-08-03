import type { DayStatRow, SessionRow } from "../../db/types";
import { lastNDays } from "../../engine/stats";
import { dateStringOf, utcOffsetMinutesAt } from "../../engine/dateLogic";
import type { TimerSnapshot } from "../../engine/timer";
import { formatMss } from "../../shared/format";
import type { HistoryPayload } from "../../shared/messages";
import { applyTheme, request, sendCommand, subscribeState } from "../../shared/surface";
import { readSurfaceStats } from "../../shared/statsReader";
import {
  applyInstrument,
  attachTicker,
  attachTimerControls,
  refreshStats,
  remainingOf,
  renderProgress,
  renderTime,
} from "../../shared/instrument";

type TabKey = "instrument" | "history" | "stats";

const tabsEl = document.getElementById("tabs")!;
const pages: Record<TabKey, HTMLElement> = {
  instrument: document.getElementById("page-instrument")!,
  history: document.getElementById("page-history")!,
  stats: document.getElementById("page-stats")!,
};

const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const fractionEl = document.getElementById("fraction")!;
const progressEl = document.getElementById("progress")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
const crewLinkEl = document.getElementById("crewLink")!;
const todayCountEl = document.getElementById("todayCount")!;
const totalMinutesEl = document.getElementById("totalMinutes")!;
const streakEl = document.getElementById("streak")!;
const dayGroupsEl = document.getElementById("dayGroups")!;
const statsTodayEl = document.getElementById("statsToday")!;
const statsTotalEl = document.getElementById("statsTotal")!;
const statsStreakEl = document.getElementById("statsStreak")!;
const statsBarsEl = document.getElementById("statsBars")!;
const statsTableBodyEl = document.getElementById("statsTableBody")!;
const statsNoteEl = document.getElementById("statsNote")!;

let activeTab: TabKey = "instrument";
let latest: TimerSnapshot | null = null;

function tabButtons(): HTMLElement[] {
  return Array.from(tabsEl.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function setActiveTab(key: TabKey): void {
  activeTab = key;
  for (const tab of tabButtons()) {
    const active = tab.dataset["tab"] === key;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const [name, el] of Object.entries(pages)) {
    el.hidden = name !== key;
  }
  if (key === "history") void loadHistory();
  if (key === "stats") void loadStats();
}

tabsEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset["tab"] === undefined) return;
  setActiveTab(target.dataset["tab"] as TabKey);
});

tabsEl.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const tabs = tabButtons();
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  const next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  setActiveTab(tabs[next]!.dataset["tab"] as TabKey);
  tabs[next]!.focus();
});

document.addEventListener("keydown", (event) => {
  if (activeTab !== "instrument") return;
  if (event.code !== "Space" || event.repeat) return;
  if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
  const target = event.target as HTMLElement | null;
  if (target !== null && target !== document.body) {
    const tag = target.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
  }
  event.preventDefault();
  sendCommand("toggle");
});

async function fetchHistory(): Promise<HistoryPayload | null> {
  const response = await request({ type: "pomo:history" });
  if (response.ok && response.history !== undefined) return response.history;
  return null;
}

async function loadHistory(): Promise<void> {
  renderHistory(await fetchHistory());
}

async function loadStats(): Promise<void> {
  void renderStats(await fetchHistory());
}

function note(message: string): HTMLElement {
  const el = document.createElement("div");
  el.className = "note";
  el.textContent = message;
  return el;
}

function dayLabel(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!)).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function timeOf(epochSeconds: number): string {
  const d = new Date(epochSeconds * 1000);
  return `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function renderHistory(payload: HistoryPayload | null): void {
  dayGroupsEl.textContent = "";
  if (payload === null) {
    dayGroupsEl.appendChild(note("Could not load history."));
    return;
  }
  if (payload.sessions.length === 0) {
    dayGroupsEl.appendChild(note("No sessions yet. Start a focus block to build history."));
    return;
  }
  const dayStatByDate = new Map(payload.dayStats.map((day) => [day.date, day]));
  let currentDate: string | null = null;
  let group: HTMLElement | null = null;
  for (const session of payload.sessions) {
    if (session.date !== currentDate) {
      currentDate = session.date;
      group = dayGroup(session.date, dayStatByDate.get(session.date));
      dayGroupsEl.appendChild(group);
    }
    group!.appendChild(sessionRow(session));
  }
}

function dayGroup(date: string, day: DayStatRow | undefined): HTMLElement {
  const group = document.createElement("section");
  group.className = "day-group";
  const head = document.createElement("header");
  head.className = "day-head";
  const label = document.createElement("span");
  label.className = "day-date";
  label.textContent = dayLabel(date);
  const meta = document.createElement("span");
  meta.className = "day-meta num";
  meta.textContent = day === undefined ? "" : `${day.earnedBlocks} blocks · ${Math.round(day.focusMinutes)} min`;
  head.append(label, meta);
  group.appendChild(head);
  return group;
}

function sessionRow(session: SessionRow): HTMLElement {
  const row = document.createElement("div");
  row.className = "session-row";
  const time = document.createElement("span");
  time.className = "s-time num";
  time.textContent = timeOf(session.start);
  const phase = document.createElement("span");
  phase.className = "s-phase";
  phase.textContent = session.type === "work" ? "Work" : "Break";
  const duration = document.createElement("span");
  duration.className = "s-duration num";
  duration.textContent = formatMss(session.duration);
  const mark = document.createElement("span");
  mark.className = "s-mark";
  mark.dataset["state"] = session.completed ? "done" : "aborted";
  mark.textContent = session.completed ? "done" : "aborted";
  const tag = document.createElement("span");
  tag.className = "s-tag";
  tag.textContent = session.tag ?? "";
  row.append(time, phase, duration, mark, tag);
  return row;
}

async function renderStats(payload: HistoryPayload | null): Promise<void> {
  statsNoteEl.hidden = true;
  statsNoteEl.textContent = "";
  statsBarsEl.textContent = "";
  statsTableBodyEl.textContent = "";
  if (payload === null) {
    statsNoteEl.textContent = "Could not load stats.";
    statsNoteEl.hidden = false;
    return;
  }
  try {
    const stats = await readSurfaceStats();
    statsTodayEl.textContent = String(stats.todayEarned);
    statsTotalEl.textContent = String(Math.round(stats.totalFocusMinutes));
    statsStreakEl.textContent = String(stats.streak);
  } catch {
    statsTodayEl.textContent = "—";
    statsTotalEl.textContent = "—";
    statsStreakEl.textContent = "—";
    statsNoteEl.textContent = "Could not load stats.";
    statsNoteEl.hidden = false;
  }

  const days = payload.dayStats;
  const now = Date.now() / 1000;
  const offset = utcOffsetMinutesAt(now);
  const today = dateStringOf(now, offset);
  const last = lastNDays(days, today, 30, offset);
  const max = Math.max(1, ...last.map((day) => day.focusMinutes));
  for (const day of last) {
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.title = `${day.date} · ${Math.round(day.focusMinutes)} min`;
    if (day.focusMinutes > 0) {
      bar.dataset["v"] = "";
      bar.style.height = `${Math.round((day.focusMinutes / max) * 100)}%`;
    }
    statsBarsEl.appendChild(bar);
  }

  if (days.length === 0) {
    statsNoteEl.textContent = "No sessions yet.";
    statsNoteEl.hidden = false;
  }
  for (const day of last) {
    const row = document.createElement("tr");
    const date = document.createElement("td");
    date.textContent = dayLabel(day.date);
    const blocks = document.createElement("td");
    blocks.className = "num";
    blocks.textContent = String(day.earnedBlocks);
    const focus = document.createElement("td");
    focus.className = "num";
    focus.textContent = String(Math.round(day.focusMinutes));
    row.append(date, blocks, focus);
    statsTableBodyEl.appendChild(row);
  }
}

async function chooseInitialTab(): Promise<void> {
  const response = await request({ type: "pomo:settings:get" });
  if (response.ok && response.settings?.newtabInstrument === false) {
    // chrome_url_overrides is manifest-scoped, so fall back to a non-instrument view.
    setActiveTab("history");
  }
}

applyTheme();
subscribeState((state) => {
  latest = state;
  applyInstrument(document.body, phaseEl, statusEl, state, { timeEl, fractionEl });
  void refreshStats(todayCountEl, totalMinutesEl, streakEl);
});

attachTicker(
  () => latest,
  (state) => {
    if (activeTab !== "instrument") return;
    renderTime(timeEl, fractionEl, remainingOf(state));
    renderProgress(progressEl, state);
  },
);

attachTimerControls(toggleEl, skipEl, resetEl);
crewLinkEl.addEventListener("click", () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL("crew.html") });
});

void chooseInitialTab();
