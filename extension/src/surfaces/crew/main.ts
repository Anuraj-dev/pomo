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
const createBtn = document.getElementById("createBtn")!;
const joinBtn = document.getElementById("joinBtn")!;
const shareBtn = document.getElementById("shareBtn")!;
const refreshBtn = document.getElementById("refreshBtn")!;
const windowTabsEl = document.getElementById("windowTabs")!;

let crews: CrewSummary[] = [];
let activeCrewId: string | null = null;
let windowKey: WindowKey = "today";
let boardResult: CrewBoardResult | null = null;
let syncing = false;

function nowSeconds(): number {
  return Date.now() / 1000;
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
    return { label: `partial · ${formatAge(ageSeconds)}`, kind: "partial" };
  }
  return { label: `updated ${formatAge(ageSeconds)}`, kind: ageSeconds > 24 * 3600 ? "stale" : "synced" };
}

function formatAge(seconds: number): string {
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function renderChips(): void {
  chipsEl.textContent = "";
  for (const crew of crews) {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.dataset["active"] = String(crew.crewId === activeCrewId);
    chip.textContent = crew.crewName;
    chip.addEventListener("click", () => {
      activeCrewId = crew.crewId;
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
  if (boardResult === null) {
    summaryEl.textContent = "";
    return;
  }
  const summary = boardResult.board.summary;
  summaryEl.innerHTML = "";
  const stats: Array<[string, string]> = [
    [String(summary.totalFocusMinutes), "crew focus min"],
    [String(summary.rankedMembers), "ranked members"],
    [String(summary.medianFocusMinutes), "median min"],
  ];
  for (const [value, caption] of stats) {
    const stat = document.createElement("div");
    stat.className = "stat";
    const num = document.createElement("span");
    num.className = "num";
    num.textContent = value;
    const cap = document.createElement("span");
    cap.className = "caption";
    cap.textContent = caption;
    stat.append(num, cap);
    summaryEl.appendChild(stat);
  }
}

function renderStanding(): void {
  standingEl.textContent = "";
  if (boardResult === null || boardResult.standing === null) {
    const note = document.createElement("span");
    note.className = "meta";
    note.textContent = "You are not on this leaderboard yet.";
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

function renderMember(member: BoardMember): HTMLElement {
  const row = document.createElement("div");
  row.className = "member";
  row.dataset["ranked"] = String(member.rank !== null);
  row.dataset["state"] = member.inactive ? "inactive" : member.stale ? "stale" : "active";

  const rankCell = document.createElement("span");
  rankCell.className = "rank-cell num";
  rankCell.textContent = member.rank !== null ? String(member.rank) : "·";

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
  if (member.identityPublicKey !== boardResult!.selfPublicKey) {
    const hide = document.createElement("button");
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

  row.append(rankCell, name, score, actions);
  return row;
}

function renderBoard(): void {
  if (boardResult === null) {
    boardEl.dataset["empty"] = "true";
    boardEl.textContent =
      crews.length === 0
        ? "No crews yet. Create one or paste a join link to get started."
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
  for (const member of boardResult.board.members) {
    boardEl.appendChild(renderMember(member));
  }
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
    }
  } finally {
    syncing = false;
  }
  renderFreshness(boardResult?.relayStates ?? []);
  renderSummary();
  renderStanding();
  renderBoard();
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

function button(text: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.textContent = text;
  btn.addEventListener("click", onClick);
  return btn;
}

function showError(message: string): void {
  const error = document.createElement("span");
  error.className = "error";
  error.textContent = message;
  manageBodyEl.appendChild(error);
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
        manageEl.hidden = true;
        crews = response.crews ?? crews;
        const joined = crews.find((crew) => crew.displayName === displayName) ?? crews[crews.length - 1];
        activeCrewId = joined?.crewId ?? crews[0]?.crewId ?? null;
        renderChips();
        void loadBoard();
      });
  });
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
        manageEl.hidden = true;
        crews = response.crews ?? crews;
        activeCrewId = crews[crews.length - 1]?.crewId ?? null;
        renderChips();
        void loadBoard();
      });
  });
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

createBtn.addEventListener("click", openCreate);
joinBtn.addEventListener("click", openJoin);
shareBtn.addEventListener("click", openShare);
manageCloseEl.addEventListener("click", () => {
  manageEl.hidden = true;
});
refreshBtn.addEventListener("click", () => {
  void loadBoard(true);
});
windowTabsEl.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.dataset["window"] === undefined) return;
  windowKey = target.dataset["window"] as WindowKey;
  for (const tab of windowTabsEl.querySelectorAll<HTMLElement>(".tab")) {
    tab.dataset["active"] = String(tab.dataset["window"] === windowKey);
  }
  void loadBoard();
});

applyTheme();
void loadCrews();
