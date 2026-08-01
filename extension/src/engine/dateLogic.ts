export function dateStringOf(epochSeconds: number, offsetMinutes: number): string {
  const ms = epochSeconds * 1000 + offsetMinutes * 60000;
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

export function epochOfDate(date: string, offsetMinutes: number): number {
  const [y, m, d] = date.split("-").map(Number);
  const utcMs = Date.UTC(y!, m! - 1, d!);
  return (utcMs - offsetMinutes * 60000) / 1000;
}

export function nextLocalMidnight(epochSeconds: number, offsetMinutes: number): number {
  const day = epochOfDate(dateStringOf(epochSeconds, offsetMinutes), offsetMinutes);
  return day + 86400;
}

export function prevDate(date: string, offsetMinutes: number): string {
  return dateStringOf(epochOfDate(date, offsetMinutes) - 86400, offsetMinutes);
}

export function utcOffsetMinutesAt(epochSeconds: number): number {
  return -new Date(epochSeconds * 1000).getTimezoneOffset();
}
