export function dateStringOf(epochSeconds: number, offsetMinutes: number): string {
  const ms = epochSeconds * 1000 + offsetMinutes * 60000;
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function localDateStringOf(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function nextLocalMidnightAt(epochSeconds: number): number {
  const d = new Date(epochSeconds * 1000);
  d.setHours(24, 0, 0, 0);
  return d.getTime() / 1000;
}
