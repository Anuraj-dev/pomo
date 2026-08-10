const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** A fixed UTC offset in minutes, or a callback resolving the offset at a given epoch. */
export type OffsetMinutes = number | ((epochSeconds: number) => number);

export function isValidDateString(date: string): boolean {
  if (typeof date !== "string" || !DATE_PATTERN.test(date)) return false;
  const [y, m, d] = date.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const utc = new Date(Date.UTC(y!, m! - 1, d!));
  return utc.getUTCFullYear() === y! && utc.getUTCMonth() === m! - 1 && utc.getUTCDate() === d!;
}

export function dateStringOf(epochSeconds: number, offsetMinutes: number): string {
  const ms = epochSeconds * 1000 + offsetMinutes * 60000;
  const date = new Date(ms);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function epochOfDate(date: string, offsetMinutes: number): number {
  if (!isValidDateString(date)) {
    throw new Error(`invalid date: ${date}`);
  }
  const [y, m, d] = date.split("-").map(Number);
  const utcMs = Date.UTC(y!, m! - 1, d!);
  return (utcMs - offsetMinutes * 60000) / 1000;
}

export function nextLocalMidnight(epochSeconds: number, offsetMinutes: number): number {
  const day = epochOfDate(dateStringOf(epochSeconds, offsetMinutes), offsetMinutes);
  return day + 86400;
}

/** Finds the next local midnight for a timezone whose offset varies over time. */
export function nextLocalMidnightAtOffset(
  epochSeconds: number,
  offsetAt: (epochSeconds: number) => number
): number {
  const startDate = dateStringOf(epochSeconds, offsetAt(epochSeconds));
  let low = epochSeconds + 1;
  let high = epochSeconds + 2 * 86400;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (dateStringOf(mid, offsetAt(mid)) === startDate) {
      low = mid + 1;
    } else {
      high = mid;
    }
  }
  return low;
}

export function prevDate(date: string, offsetMinutes: number): string {
  return dateStringOf(epochOfDate(date, offsetMinutes) - 86400, offsetMinutes);
}

export function utcOffsetMinutesAt(epochSeconds: number): number {
  return -new Date(epochSeconds * 1000).getTimezoneOffset();
}
