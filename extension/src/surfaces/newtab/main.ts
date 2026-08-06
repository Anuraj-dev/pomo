import type { DayStatRow, SessionRow } from "../../db/types";
import { lastNDays } from "../../engine/stats";
import { dateStringOf, utcOffsetMinutesAt } from "../../engine/dateLogic";
import type { PomoSettings } from "../../engine/settings";
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

type TabKey = "instrument" | "history" | "stats" | "settings";

const tabsEl = document.getElementById("tabs")!;
const pages: Record<TabKey, HTMLElement> = {
  instrument: document.getElementById("page-instrument")!,
  history: document.getElementById("page-history")!,
  stats: document.getElementById("page-stats")!,
  settings: document.getElementById("page-settings")!,
};

const buildVersionEl = document.getElementById("buildVersion")!;
const phaseEl = document.getElementById("phase")!;
const statusEl = document.getElementById("status")!;
const timeEl = document.getElementById("time")!;
const fractionEl = document.getElementById("fraction")!;
const progressEl = document.getElementById("progress")!;
const toggleEl = document.getElementById("toggle")!;
const skipEl = document.getElementById("skip")!;
const resetEl = document.getElementById("reset")!;
const todayCountEl = document.getElementById("todayCount")!;
const totalMinutesEl = document.getElementById("totalMinutes")!;
const streakEl = document.getElementById("streak")!;
const dayGroupsEl = document.getElementById("dayGroups")!;
const historySummaryEl = document.getElementById("historySummary")!;
const statsTodayEl = document.getElementById("statsToday")!;
const statsTotalEl = document.getElementById("statsTotal")!;
const statsStreakEl = document.getElementById("statsStreak")!;
const statsActiveDaysEl = document.getElementById("statsActiveDays")!;
const statsBarsEl = document.getElementById("statsBars")!;
const statsTrendMetaEl = document.getElementById("statsTrendMeta")!;
const statsTableBodyEl = document.getElementById("statsTableBody")!;
const statsNoteEl = document.getElementById("statsNote")!;
const settingsFormEl = document.getElementById("settingsForm") as HTMLFormElement;
const settingsStatusEl = document.getElementById("settingsStatus")!;
const settingWorkEl = document.getElementById("settingWork") as HTMLInputElement;
const settingShortEl = document.getElementById("settingShort") as HTMLInputElement;
const settingLongEl = document.getElementById("settingLong") as HTMLInputElement;
const settingAfterEl = document.getElementById("settingAfter") as HTMLInputElement;
const settingGoalEl = document.getElementById("settingGoal") as HTMLInputElement;
const settingTagEl = document.getElementById("settingTag") as HTMLInputElement;
const settingThemeEl = document.getElementById("settingTheme") as HTMLSelectElement;
const settingSoundEl = document.getElementById("settingSound") as HTMLInputElement;
const settingNewtabEl = document.getElementById("settingNewtab") as HTMLInputElement;

let activeTab: TabKey = "instrument";
let latest: TimerSnapshot | null = null;
let previousStatus: TimerSnapshot["status"] | null = null;
let userNavigated = false;
let tabLoadSeq = 0;

buildVersionEl.textContent = `v${chrome.runtime.getManifest().version}`;

function tabButtons(): HTMLElement[] {
  return Array.from(tabsEl.querySelectorAll<HTMLElement>('[role="tab"]'));
}

function setActiveTab(key: TabKey, updateUrl = true): void {
  activeTab = key;
  userNavigated = true;
  if (updateUrl) history.replaceState(null, "", `#${key}`);
  for (const tab of tabButtons()) {
    const active = tab.dataset["tab"] === key;
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
  for (const [name, el] of Object.entries(pages)) {
    el.hidden = name !== key;
  }
  const seq = ++tabLoadSeq;
  if (key === "history") void loadHistory(seq);
  if (key === "stats") void loadStats(seq);
  if (key === "settings") void loadSettingsPage(seq);
}

window.addEventListener("hashchange", () => {
  const hash = location.hash.slice(1);
  if (Object.hasOwn(pages, hash)) setActiveTab(hash as TabKey, false);
});

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
    // Exclude interactive elements (including buttons, which otherwise get a
    // click AND a toggle from the same spacebar press).
    if (
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      tag === "BUTTON" ||
      tag === "A" ||
      target.isContentEditable
    ) {
      return;
    }
  }
  event.preventDefault();
  sendCommand("toggle");
});

settingsFormEl.addEventListener("submit", (event) => {
  event.preventDefault();
  const invalid = validateSettingsForm();
  if (invalid !== null) {
    settingsStatusEl.textContent = invalid;
    settingsStatusEl.dataset["kind"] = "error";
    return;
  }
  const settings: Partial<PomoSettings> = {
    workMinutes: Number(settingWorkEl.value),
    shortMinutes: Number(settingShortEl.value),
    longMinutes: Number(settingLongEl.value),
    longBreakAfter: Number(settingAfterEl.value),
    dailyGoal: Number(settingGoalEl.value),
    tag: settingTagEl.value.trim(),
    theme: settingThemeEl.value as PomoSettings["theme"],
    soundEnabled: settingSoundEl.checked,
    newtabInstrument: settingNewtabEl.checked,
  };
  settingsStatusEl.textContent = "Saving…";
  void saveSettings(settings);
});

/** Client-side mirrors of the sanitizer's bounds; prevents sending junk that
 * the SW would silently clamp. Returns an error message or null. */
function validateSettingsForm(): string | null {
  const fields: Array<[HTMLInputElement, number, number, string]> = [
    [settingWorkEl, 1, 360, "Work duration"],
    [settingShortEl, 1, 120, "Short break"],
    [settingLongEl, 1, 240, "Long break"],
    [settingAfterEl, 1, 12, "Long break cadence"],
    [settingGoalEl, 0, 100, "Daily goal"],
  ];
  for (const [el, min, max, label] of fields) {
    const value = Number(el.value);
    if (!Number.isFinite(value) || value < min || value > max) {
      return `${label} must be between ${min} and ${max}.`;
    }
  }
  return null;
}

async function saveSettings(settings: Partial<PomoSettings>): Promise<void> {
  try {
    const response = await request({ type: "pomo:settings:set", settings });
    if (!response.ok || response.settings === undefined) {
      settingsStatusEl.textContent = response.error ?? "Could not save";
      settingsStatusEl.dataset["kind"] = "error";
      return;
    }
    populateSettings(response.settings);
    applySelectedTheme(response.settings.theme);
    settingsStatusEl.textContent = "Saved";
    settingsStatusEl.dataset["kind"] = "ok";
  } catch {
    settingsStatusEl.textContent = "Could not save";
    settingsStatusEl.dataset["kind"] = "error";
  }
}

async function fetchHistory(): Promise<HistoryPayload | null> {
  const response = await request({ type: "pomo:history" });
  if (response.ok && response.history !== undefined) return response.history;
  return null;
}

async function loadHistory(seq: number): Promise<void> {
  const payload = await fetchHistory();
  if (seq !== tabLoadSeq) return;
  renderHistory(payload);
}

async function loadStats(seq: number): Promise<void> {
  const payload = await fetchHistory();
  if (seq !== tabLoadSeq) return;
  void renderStats(payload);
}

async function loadSettingsPage(seq: number): Promise<void> {
  try {
    const response = await request({ type: "pomo:settings:get" });
    if (seq !== tabLoadSeq) return;
    if (!response.ok || response.settings === undefined) {
      settingsStatusEl.textContent = response.error ?? "Could not load settings";
      settingsStatusEl.dataset["kind"] = "error";
      return;
    }
    populateSettings(response.settings);
  } catch {
    if (seq !== tabLoadSeq) return;
    settingsStatusEl.textContent = "Could not load settings";
    settingsStatusEl.dataset["kind"] = "error";
  }
}

function populateSettings(settings: PomoSettings): void {
  settingWorkEl.value = String(settings.workMinutes);
  settingShortEl.value = String(settings.shortMinutes);
  settingLongEl.value = String(settings.longMinutes);
  settingAfterEl.value = String(settings.longBreakAfter);
  settingGoalEl.value = String(settings.dailyGoal);
  settingTagEl.value = settings.tag;
  settingThemeEl.value = settings.theme;
  settingSoundEl.checked = settings.soundEnabled;
  settingNewtabEl.checked = settings.newtabInstrument;
}

function applySelectedTheme(theme: PomoSettings["theme"]): void {
  if (theme === "system") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = theme;
  }
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
    historySummaryEl.textContent = "unavailable";
    dayGroupsEl.appendChild(note("Could not load history."));
    return;
  }
  const completed = payload.sessions.filter((session) => session.completed).length;
  historySummaryEl.textContent = `${payload.sessions.length} sessions · ${completed} completed`;
  if (payload.sessions.length === 0) {
    dayGroupsEl.appendChild(note("No sessions yet. Start a focus block to build history."));
    return;
  }
  const dayStatByDate = new Map(payload.dayStats.map((day) => [day.date, day]));
  // Group regardless of input order, emitting groups in date-descending order.
  const byDate = new Map<string, SessionRow[]>();
  for (const session of payload.sessions) {
    const list = byDate.get(session.date);
    if (list === undefined) byDate.set(session.date, [session]);
    else list.push(session);
  }
  const dates = [...byDate.keys()].sort((a, b) => b.localeCompare(a));
  for (const date of dates) {
    const group = dayGroup(date, dayStatByDate.get(date));
    for (const session of byDate.get(date)!) group.appendChild(sessionRow(session));
    dayGroupsEl.appendChild(group);
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
  const columns = document.createElement("div");
  columns.className = "session-head";
  for (const text of ["Time", "Phase", "Duration", "Result", "Tag"]) {
    const cell = document.createElement("span");
    cell.textContent = text;
    columns.appendChild(cell);
  }
  group.append(head, columns);
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
  statsTrendMetaEl.textContent = "—";
  statsActiveDaysEl.textContent = "—";
  if (payload === null) {
    statsNoteEl.textContent = "Could not load stats.";
    statsNoteEl.hidden = false;
    return;
  }
  let statsFailed = false;
  try {
    const stats = await readSurfaceStats();
    statsTodayEl.textContent = String(stats.todayEarned);
    statsTotalEl.textContent = String(Math.round(stats.totalFocusMinutes));
    statsStreakEl.textContent = String(stats.streak);
  } catch {
    statsFailed = true;
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
  const activeDays = last.filter((day) => day.earnedBlocks > 0);
  statsActiveDaysEl.textContent = String(activeDays.length);
  statsTrendMetaEl.textContent = `${activeDays.length} active days · ${Math.round(last.reduce((sum, day) => sum + day.focusMinutes, 0))} min`;
  last.forEach((day, index) => {
    const column = document.createElement("div");
    column.className = "bar-column";
    const bar = document.createElement("span");
    bar.className = "bar";
    bar.title = `${day.date} · ${Math.round(day.focusMinutes)} min`;
    bar.style.height = `${day.focusMinutes > 0 ? Math.max(5, Math.round((day.focusMinutes / max) * 100)) : 2}%`;
    if (day.focusMinutes > 0) bar.dataset["v"] = "";
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = index % 5 === 0 ? dayLabel(day.date).replace(/\.$/, "") : "";
    column.append(bar, label);
    statsBarsEl.appendChild(column);
  });

  if (!statsFailed && activeDays.length === 0) {
    statsNoteEl.textContent = "No sessions yet.";
    statsNoteEl.hidden = false;
  }
  for (const day of activeDays) {
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
  const hash = location.hash.slice(1);
  if (Object.hasOwn(pages, hash)) {
    setActiveTab(hash as TabKey, false);
    return;
  }
  const response = await request({ type: "pomo:settings:get" });
  // The user may have clicked a tab while this resolved; never override their
  // explicit navigation.
  if (!userNavigated && response.ok && response.settings?.newtabInstrument === false) {
    // chrome_url_overrides is manifest-scoped, so fall back to a non-instrument view.
    setActiveTab("history");
  }
}

applyTheme();
subscribeState((state) => {
  const completedOrStopped = previousStatus === "running" && state.status === "stopped";
  previousStatus = state.status;
  latest = state;
  applyInstrument(document.body, phaseEl, statusEl, state, { timeEl, fractionEl });
  void refreshStats(todayCountEl, totalMinutesEl, streakEl);
  if (completedOrStopped) {
    if (activeTab === "history") void loadHistory(tabLoadSeq);
    if (activeTab === "stats") void loadStats(tabLoadSeq);
  }
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

void chooseInitialTab();
