import QRCode from "qrcode";
import { applyTheme, request } from "../../shared/surface";
import type { BoardMember, WindowKey } from "../../crew/leaderboard";
import type { CrewRelayStateRow } from "../../db/dao";
import type { CrewBoardResult, CrewSummary } from "../../shared/messages";

const chipsEl = document.getElementById("chips")!;
const freshnessEl = document.getElementById("freshness")!;
const summaryEl = document.getElementById("summary")!;
const standingEl = document.getElementById("standing")!;
const boardEl = document.getElementById("board")!;
const manageEl = document.getElementById("manage")!;
const manageBodyEl = document.getElementById("manageBody")!;
const manageCloseEl = document.getElementById("manageClose")!;
const manageBtn = document.getElementById("manageBtn")!;
const refreshBtn = document.getElementById("refreshBtn")!;
const windowTabsEl = document.getElementById("windowTabs")!;

let crews: CrewSummary[] = [];
let activeCrewId: string | null = null;
let windowKey: WindowKey = "today";
let boardResult: CrewBoardResult | null = null;
let syncing = false;
let lastFocus: HTMLElement | null = null;
let chipIndex = 0;

function nowSeconds(): number {
  return Date.now() / 1000;
}

function formatAge(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function freshnessOf(relayStates: CrewRelayStateRow[]): { label: string; kind: string } {
  if (relayStates.length === 0) return { label: "not yet synced", kind: "offline" };
  const now = nowSeconds();
  const lastSuccess = relayStates.reduce((max, state) => Math.max(max, state.lastSuccessEpochSeconds ?? 0), 0);
  const lastAttempt = relayStates.reduce((max, state) => Math.max(max, state.lastAttemptEpochSeconds), 0);
  const successCount = relayStates.filter((state) => state.lastSuccessEpochSeconds !== null).length;
  if (syncing) return { label: "syncing…", kind: "syncing" };
  if (lastAttempt > 0 && now - lastAttempt < 30 && successCount < relayStates.length) {
    return { label: "syncing…", kind: "syncing" };
  }
  if (lastSuccess === 0) return { label: "never synced", kind: "offline" };
  const ageSeconds = now - lastSuccess;
  if (successCount < relayStates.length) {
    return { label: `partial ${successCount}/${relayStates.length} · ${formatAge(ageSeconds)}`, kind: "partial" };
  }
  return { label: `updated ${formatAge(ageSeconds)}`, kind: ageSeconds > 24 * 3600 ? "stale" : "synced" };
}

function renderChips(): void {
  chipsEl.textContent = "";
  for (const crew of crews) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.type = "button";
    chip.setAttribute("role", "radio");
    const active = crew.crewId === activeCrewId;
    chip.dataset["active"] = String(active);
    chip.setAttribute("aria-checked", String(active));
    chip.tabIndex = active ? 0 : -1;
    chip.textContent = crew.crewName;
    chip.addEventListener("click", () => {
      activeCrewId = crew.crewId;
      chipIndex = crews.findIndex((c) => c.crewId === crew.crewId);
      void loadBoard();
    });
    chipsEl.appendChild(chip);
  }
}

function renderFreshness(relayStates: CrewRelayStateRow[]): void {
  const { label, kind } = freshnessOf(relayStates);
  freshnessEl.textContent = label;
  freshnessEl.dataset["kind"] = kind;
}

function renderSummary(): void {
  summaryEl.textContent = "";
  if (boardResult === null) return;
  const summary = boardResult.board.summary;
  const items: Array<[string, string]> = [
    [String(summary.totalFocusMinutes), "crew min"],
    [String(summary.rankedMembers), "ranked"],
    [String(summary.medianFocusMinutes), "median"],
  ];
  for (const [value, caption] of items) {
    const item = document.createElement("span");
    item.className = "item";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = value;
    const cap = document.createElement("span");
    cap.textContent = caption;
    item.append(num, cap);
    summaryEl.appendChild(item);
  }
}

function renderStanding(): void {
  standingEl.textContent = "";
  if (boardResult === null) return;
  if (boardResult.standing === null) {
    const note = document.createElement("span");
    note.className = "meta";
    note.textContent = "You are not on this leaderboard yet. Publish a block to join.";
    standingEl.appendChild(note);
    return;
  }
  const standing = boardResult.standing;
  const slot = document.createElement("div");
  slot.className = "slot";
  const rank = document.createElement("span");
  rank.className = "rank num";
  rank.textContent = standing.unranked ? "—" : `#${standing.rank}`;
  const meta = document.createElement("span");
  meta.className = "meta";
  const parts: string[] = [`${standing.focusMinutes} min`];
  if (standing.tieCount > 1) parts.push(`tied with ${standing.tieCount}`);
  if (standing.gapToNext !== null) parts.push(`${standing.gapToNext} min to next`);
  if (standing.unranked) parts.push("unranked");
  meta.textContent = parts.join(" · ");
  slot.append(rank, meta);
  standingEl.appendChild(slot);
}

function barsFor(member: BoardMember, container: HTMLElement): void {
  const max = Math.max(1, ...member.dailyTrend.filter((v): v is number => v !== null));
  for (const value of member.dailyTrend) {
    const bar = document.createElement("span");
    if (value !== null && value > 0) {
      bar.dataset["v"] = "";
      bar.style.height = `${Math.round((value / max) * 100)}%`;
    }
    container.appendChild(bar);
  }
}

function renderMember(member: BoardMember, selfKey: string): DocumentFragment {
  const frag = document.createDocumentFragment();

  const row = document.createElement("div");
  row.className = "member";
  row.dataset["ranked"] = String(member.rank !== null);
  row.dataset["state"] = member.inactive ? "inactive" : member.stale ? "stale" : "active";

  const rankCell = document.createElement("span");
  rankCell.className = "rank-cell num";
  rankCell.textContent = member.rank !== null ? String(member.rank) : "—";

  const name = document.createElement("div");
  name.className = "name";
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = member.displayName;
  const bars = document.createElement("div");
  bars.className = "bars";
  barsFor(member, bars);
  name.append(who, bars);

  const score = document.createElement("div");
  score.className = "score";
  const minutes = document.createElement("span");
  minutes.className = "minutes num";
  minutes.textContent = `${member.focusMinutes} min`;
  const sub = document.createElement("span");
  sub.className = "sub";
  sub.textContent = `streak ${member.streak}${member.stale ? " · stale" : ""}`;
  score.append(minutes, sub);

  const actions = document.createElement("div");
  actions.className = "actions";
  if (member.identityPublicKey !== selfKey) {
    const hide = document.createElement("button");
    hide.type = "button";
    hide.textContent = "Hide";
    hide.addEventListener("click", () => {
      void request({
        type: "pomo:crew:hide",
        crewId: activeCrewId!,
        identityPublicKey: member.identityPublicKey,
        hidden: true,
      }).then(() => loadBoard());
    });
    actions.appendChild(hide);
  }
  const details = document.createElement("button");
  details.type = "button";
  details.textContent = "Details";
  details.setAttribute("aria-expanded", "false");
  details.addEventListener("click", () => {
    const existing = row.nextElementSibling;
    const expanded = details.getAttribute("aria-expanded") === "true";
    if (expanded) {
      existing?.remove();
      details.setAttribute("aria-expanded", "false");
      return;
    }
    const detail = document.createElement("div");
    detail.className = "member-detail";
    const lastFocused = member.lastFocusedAtEpochSeconds > 0
      ? new Date(member.lastFocusedAtEpochSeconds * 1000).toLocaleString()
      : "never";
    detail.append(
      detailSpan(`key ${member.fingerprint}`),
      detailSpan(`last focused ${lastFocused}`),
      detailSpan(`${member.dailyTrend.filter((v): v is number => v !== null).length}/7 days active`),
    );
    row.after(detail);
    details.setAttribute("aria-expanded", "true");
  });
  actions.appendChild(details);

  row.append(rankCell, name, score, actions);
  frag.appendChild(row);
  return frag;
}

function detailSpan(text: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.textContent = text;
  return span;
}

function renderBoard(): void {
  boardEl.dataset["error"] = "false";
  if (boardResult === null) {
    boardEl.dataset["empty"] = "true";
    boardEl.textContent =
      crews.length === 0
        ? "No crews yet. Open Manage to create one or paste a join link."
        : "Loading leaderboard…";
    return;
  }
  boardEl.dataset["empty"] = "false";
  boardEl.textContent = "";
  if (boardResult.board.members.length === 0) {
    boardEl.dataset["empty"] = "true";
    boardEl.textContent = "No members on this leaderboard yet. Share your join code to invite them.";
    return;
  }

  const selfKey = boardResult.selfPublicKey;
  const active = boardResult.board.members.filter((m) => !m.inactive);
  const inactive = boardResult.board.members.filter((m) => m.inactive);

  for (const member of active) {
    boardEl.appendChild(renderMember(member, selfKey));
  }

  if (inactive.length > 0) {
    const group = document.createElement("div");
    group.className = "inactive-group";
    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "inactive-toggle";
    toggle.textContent = `Inactive members (${inactive.length})`;
    toggle.setAttribute("aria-expanded", "false");
    toggle.addEventListener("click", () => {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!expanded));
    });
    const list = document.createElement("div");
    list.className = "inactive-list";
    for (const member of inactive) {
      list.appendChild(renderMember(member, selfKey));
    }
    group.append(toggle, list);
    boardEl.appendChild(group);
  }
}

function renderBoardError(message: string): void {
  boardEl.dataset["error"] = "true";
  boardEl.dataset["empty"] = "false";
  boardEl.textContent = "";
  const wrap = document.createElement("div");
  wrap.className = "board-error";
  const msg = document.createElement("span");
  msg.className = "msg";
  msg.textContent = message;
  const retry = document.createElement("button");
  retry.type = "button";
  retry.textContent = "Retry";
  retry.addEventListener("click", () => {
    void loadBoard(true);
  });
  wrap.append(msg, retry);
  boardEl.appendChild(wrap);
}

async function loadBoard(forceRefresh = false): Promise<void> {
  if (activeCrewId === null) return;
  syncing = true;
  renderFreshness(boardResult?.relayStates ?? []);
  try {
    const response = await request(
      forceRefresh
        ? { type: "pomo:crew:refresh", crewId: activeCrewId, window: windowKey }
        : { type: "pomo:crew:board", crewId: activeCrewId, window: windowKey },
    );
    if (response.ok && response.board !== undefined) {
      boardResult = response.board;
      renderSummary();
      renderStanding();
      renderBoard();
    } else {
      renderBoardError(response.error ?? "could not load leaderboard");
    }
  } catch {
    renderBoardError("Could not reach the crew service.");
  } finally {
    syncing = false;
  }
  renderFreshness(boardResult?.relayStates ?? []);
}

async function loadCrews(): Promise<void> {
  const response = await request({ type: "pomo:crew:list" });
  if (response.ok) {
    crews = response.crews ?? [];
  } else {
    crews = [];
  }
  if (activeCrewId === null || !crews.some((crew) => crew.crewId === activeCrewId)) {
    activeCrewId = crews[0]?.crewId ?? null;
  }
  chipIndex = Math.max(0, crews.findIndex((c) => c.crewId === activeCrewId));
  renderChips();
  renderSummary();
  renderStanding();
  await loadBoard();
}

function openManage(title: string, body: HTMLElement): void {
  manageBodyEl.textContent = "";
  const heading = document.createElement("h3");
  heading.textContent = title;
  manageBodyEl.append(heading, body);
  manageEl.hidden = false;
  lastFocus = document.activeElement as HTMLElement | null;
  focusFirst(manageBodyEl);
}

function closeManage(): void {
  manageEl.hidden = true;
  lastFocus?.focus();
}

function focusFirst(container: HTMLElement): void {
  const target = container.querySelector<HTMLElement>("input, button, textarea, select");
  target?.focus();
}

function trapFocus(event: KeyboardEvent): void {
  if (manageEl.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    closeManage();
    return;
  }
  if (event.key !== "Tab") return;
  const focusable = Array.from(
    manageEl.querySelectorAll<HTMLButtonElement | HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, button, textarea, select",
    ),
  ).filter((el) => !el.disabled);
  if (focusable.length === 0) return;
  const first = focusable[0]!;
  const last = focusable[focusable.length - 1]!;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

function field(label: string, placeholder: string): { wrap: HTMLElement; input: HTMLInputElement } {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const caption = document.createElement("span");
  caption.textContent = label;
  const input = document.createElement("input");
  input.placeholder = placeholder;
  input.spellcheck = false;
  wrap.append(caption, input);
  return { wrap, input };
}

function button(text: string, onClick: () => void, className?: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = text;
  if (className !== undefined) btn.className = className;
  btn.addEventListener("click", onClick);
  return btn;
}

function showError(message: string): void {
  manageBodyEl.querySelector(".error")?.remove();
  const error = document.createElement("span");
  error.className = "error";
  error.textContent = message;
  manageBodyEl.appendChild(error);
}

function openManageHome(): void {
  const body = document.createElement("div");
  body.className = "manage-menu";

  const activeCrew = crews.find((crew) => crew.crewId === activeCrewId);
  if (activeCrew !== undefined) {
    const section = document.createElement("h4");
    section.className = "section-title";
    section.textContent = activeCrew.crewName;
    body.append(section);

    const nameField = field("Your display name in this crew", activeCrew.displayName);
    nameField.input.value = activeCrew.displayName;
    const save = button("Save name", () => {
      void request({ type: "pomo:crew:rename", crewId: activeCrew.crewId, displayName: nameField.input.value })
        .then((response) => {
          if (!response.ok) {
            showError(response.error ?? "rename failed");
            return;
          }
          crews = response.crews ?? crews;
          closeManage();
          renderChips();
        });
    }, "primary");
    body.append(nameField.wrap, save);

    body.append(button("Share invite / QR", () => openShare()));
    body.append(button("Leave crew", () => {
      void request({ type: "pomo:crew:leave", crewId: activeCrew.crewId }).then((response) => {
        if (!response.ok) {
          showError(response.error ?? "leave failed");
          return;
        }
        crews = response.crews ?? crews;
        closeManage();
        if (activeCrewId === activeCrew.crewId) {
          activeCrewId = crews[0]?.crewId ?? null;
        }
        renderChips();
        void loadBoard();
      });
    }, "danger"));
  }

  const addSection = document.createElement("h4");
  addSection.className = "section-title";
  addSection.textContent = "Add a crew";
  body.append(addSection);
  body.append(button("Create crew", () => openCreate()));
  body.append(button("Join with link", () => openJoin()));

  openManage("Manage crew", body);
}

function openJoin(): void {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.75rem";
  const joinField = field("Paste a pomo://crew/join/v2 link or code", "pomo://crew/join/v2/…");
  const nameField = field("Your display name in this crew", "Name");
  const submit = button("Join crew", () => {
    const payload = joinField.input.value.trim();
    const displayName = nameField.input.value.trim();
    if (payload.length === 0 || displayName.length === 0) return;
    void request({ type: "pomo:crew:join", payload, displayName })
      .then((response) => {
        if (!response.ok) {
          showError(response.error ?? "join failed");
          return;
        }
        crews = response.crews ?? crews;
        activeCrewId = crews[crews.length - 1]?.crewId ?? null;
        closeManage();
        renderChips();
        void loadBoard();
      });
  }, "primary");
  body.append(joinField.wrap, nameField.wrap, submit);
  openManage("Join a crew", body);
}

function openCreate(): void {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.75rem";
  const nameField = field("Crew name", "Late Night Focus");
  const displayField = field("Your display name in this crew", "Name");
  const submit = button("Create crew", () => {
    const crewName = nameField.input.value.trim();
    const displayName = displayField.input.value.trim();
    if (crewName.length === 0 || displayName.length === 0) return;
    void request({ type: "pomo:crew:create", crewName, displayName })
      .then((response) => {
        if (!response.ok) {
          showError(response.error ?? "create failed");
          return;
        }
        crews = response.crews ?? crews;
        activeCrewId = crews[crews.length - 1]?.crewId ?? null;
        closeManage();
        renderChips();
        void loadBoard();
      });
  }, "primary");
  body.append(nameField.wrap, displayField.wrap, submit);
  openManage("Create a crew", body);
}

function openShare(): void {
  const body = document.createElement("div");
  body.style.display = "flex";
  body.style.flexDirection = "column";
  body.style.gap = "0.9rem";
  const bodyEl = body as HTMLDivElement;
  bodyEl.className = "qr";
  void request({ type: "pomo:crew:joinCode", crewId: activeCrewId! }).then((response) => {
    if (!response.ok || response.joinCode === undefined) {
      showError(response.error ?? "could not build join code");
      return;
    }
    const uri = `pomo://crew/join/v2/${response.joinCode}`;
    const canvas = document.createElement("canvas");
    canvas.width = 220;
    canvas.height = 220;
    void QRCode.toCanvas(canvas, uri, { width: 220, margin: 2 }).catch(() => undefined);
    body.append(canvas);
    const row = document.createElement("div");
    row.className = "row";
    const code = document.createElement("span");
    code.className = "meta num";
    code.textContent = uri;
    row.appendChild(code);
    const copy = button("Copy", () => {
      void navigator.clipboard.writeText(uri).then(() => {
        copy.textContent = "Copied";
      });
    });
    row.appendChild(copy);
    body.append(row);
  });
  openManage("Share invite", body);
}

manageBtn.addEventListener("click", () => openManageHome());
manageCloseEl.addEventListener("click", closeManage);
manageEl.addEventListener("keydown", trapFocus);
refreshBtn.addEventListener("click", () => {
  void loadBoard(true);
});

chipsEl.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const chips = chipsEl.querySelectorAll<HTMLElement>(".chip");
  if (chips.length === 0) return;
  const current = Array.from(chips).indexOf(document.activeElement as HTMLElement);
  const delta = event.key === "ArrowRight" ? 1 : -1;
  const next = (current === -1 ? chipIndex : current) + delta;
  const index = (next + chips.length) % chips.length;
  for (const chip of chips) {
    chip.tabIndex = -1;
  }
  chips[index]!.tabIndex = 0;
  chips[index]!.focus();
  chips[index]!.click();
});

windowTabsEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset["window"] === undefined) return;
  selectWindow(target.dataset["window"] as WindowKey);
});

windowTabsEl.addEventListener("keydown", (event) => {
  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  event.preventDefault();
  const tabs = Array.from(windowTabsEl.querySelectorAll<HTMLElement>(".tab"));
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  const next = (current + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
  tabs[next]?.focus();
  const windowKeyOf = tabs[next]?.dataset["window"];
  if (windowKeyOf !== undefined) selectWindow(windowKeyOf as WindowKey);
});

function selectWindow(key: WindowKey): void {
  windowKey = key;
  const panelEl = document.getElementById("windowPanel")!;
  for (const tab of windowTabsEl.querySelectorAll<HTMLElement>(".tab")) {
    const active = tab.dataset["window"] === windowKey;
    tab.dataset["active"] = String(active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
    if (active) {
      panelEl.setAttribute("aria-labelledby", tab.id);
    }
  }
  void loadBoard();
}

function initTabs(): void {
  for (const tab of windowTabsEl.querySelectorAll<HTMLElement>(".tab")) {
    const active = tab.dataset["window"] === windowKey;
    tab.dataset["active"] = String(active);
    tab.setAttribute("aria-selected", String(active));
    tab.tabIndex = active ? 0 : -1;
  }
}

initTabs();
applyTheme();
void loadCrews();
