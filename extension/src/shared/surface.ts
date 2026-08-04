import type { PomoSettings } from "../engine/settings";
import type { TimerSnapshot } from "../engine/timer";
import { SETTINGS_KEY, STATE_KEY, type PomoCommand, type PomoRequest, type PomoResponse } from "./messages";

export function subscribeState(onState: (state: TimerSnapshot) => void): void {
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "session") return;
    const next = changes[STATE_KEY]?.newValue as TimerSnapshot | undefined;
    if (next !== undefined) onState(next);
  });
  chrome.runtime.sendMessage({ type: "pomo:query" }, (response) => {
    const state = (response as { ok?: boolean; state?: TimerSnapshot } | undefined)?.state;
    if (state !== undefined) onState(state);
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

export function applyTheme(): void {
  void chrome.storage.local.get(SETTINGS_KEY).then((stored) => {
    const settings = stored[SETTINGS_KEY] as Partial<PomoSettings> | undefined;
    const theme = settings?.theme ?? "system";
    if (theme === "system") {
      delete document.documentElement.dataset["theme"];
    } else {
      document.documentElement.dataset["theme"] = theme;
    }
  });
}
