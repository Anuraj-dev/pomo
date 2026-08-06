import type { PomoSettings } from "../engine/settings";
import type { TimerSnapshot } from "../engine/timer";
import { SETTINGS_KEY, STATE_KEY, type PomoCommand, type PomoRequest, type PomoResponse } from "./messages";

const THEMES: ReadonlySet<string> = new Set(["system", "light", "dark"]);

/** Non-null DOM lookup with a descriptive failure for markup/script drift. */
export function requiredElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`missing element #${id}; surface markup drifted from script`);
  return el as T;
}

/** State subscription that tolerates a stale initial query: a storage event can
 * land after the query response (or vice versa), so each candidate is applied
 * only if it is at least as new as the last applied snapshot. */
export function subscribeState(onState: (state: TimerSnapshot) => void): void {
  let lastAppliedActionTime = -Infinity;
  const apply = (state: TimerSnapshot): void => {
    if (state.lastActionTime < lastAppliedActionTime) return;
    lastAppliedActionTime = state.lastActionTime;
    onState(state);
  };
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    const next = changes[STATE_KEY]?.newValue as TimerSnapshot | undefined;
    if (next !== undefined) apply(next);
  });
  chrome.runtime.sendMessage({ type: "pomo:query" }, (response) => {
    const state = (response as { ok?: boolean; state?: TimerSnapshot } | undefined)?.state;
    if (state !== undefined) apply(state);
  });
}

export function sendCommand(command: PomoCommand, seconds?: number): void {
  chrome.runtime.sendMessage({ type: "pomo:command", command, seconds });
}

export function request(message: PomoRequest): Promise<PomoResponse> {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError !== undefined || response === undefined) {
        resolve({ ok: false, error: runtimeError?.message ?? "service worker unavailable" });
        return;
      }
      resolve(response as PomoResponse);
    });
  });
}

function setTheme(theme: PomoSettings["theme"]): void {
  if (theme === "system") {
    delete document.documentElement.dataset["theme"];
  } else {
    document.documentElement.dataset["theme"] = theme;
  }
}

function validTheme(value: unknown): PomoSettings["theme"] | null {
  return typeof value === "string" && THEMES.has(value) ? (value as PomoSettings["theme"]) : null;
}

/** Apply the saved theme. Pass an already-known theme to avoid a flash before
 * the async storage read resolves; invalid stored values fall back to system. */
export function applyTheme(initial?: PomoSettings["theme"]): void {
  const boot = validTheme(initial);
  if (boot !== null) setTheme(boot);
  else setTheme("system");
  void chrome.storage.local
    .get(SETTINGS_KEY)
    .then((stored) => {
      const settings = stored[SETTINGS_KEY] as Partial<PomoSettings> | undefined;
      const theme = validTheme(settings?.theme);
      if (theme !== null) setTheme(theme);
    })
    .catch(() => {
      // Theme application is best-effort; keep the boot/default theme.
    });
}

/** Live theme updates when settings change in another surface. */
export function subscribeTheme(onChange: (theme: PomoSettings["theme"]) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    const settings = changes[SETTINGS_KEY]?.newValue as Partial<PomoSettings> | undefined;
    const theme = validTheme(settings?.theme);
    if (theme !== null) {
      setTheme(theme);
      onChange(theme);
    }
  });
}
