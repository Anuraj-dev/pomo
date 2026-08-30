export interface AdoptClock {
  status: string;
  phase: string;
  remaining: number;
  start_time: number;
}

const LIVE = new Set(["running", "paused"]);

export function isLiveStatus(status: string): boolean {
  return LIVE.has(status);
}

export function isSameSession(phone: AdoptClock, payload: AdoptClock): boolean {
  const phoneStart = Number(phone.start_time) || 0;
  const payloadStart = Number(payload.start_time) || 0;
  if (phoneStart <= 0 || payloadStart <= 0) return false;
  return phoneStart === payloadStart && phone.phase === payload.phase;
}

/** Whether the phone should take `payload` as the sole live clock. */
export function canAdopt(phone: AdoptClock, payload: AdoptClock): boolean {
  if (phone.status === "stopped") return true;
  if (isSameSession(phone, payload)) return true;
  if (!isLiveStatus(phone.status) || !isLiveStatus(payload.status)) return false;
  return Number(payload.remaining) < Number(phone.remaining);
}
