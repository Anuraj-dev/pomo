export const MAX_DISPLAY_NAME_GRAPHEMES = 24;
export const MAX_CREW_NAME_GRAPHEMES = 40;

function graphemeCount(value: string): number {
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) count++;
  return count;
}

function unsafeNameCharacter(character: string): boolean {
  // Unicode property escapes: Cc (control), Cf (format), Bidi_Control (explicit
  // directionality) plus the byte-order mark. ZWJ (\u200d) is allowed so emoji
  // ZWJ sequences survive.
  if (character === "\u200d") return false;
  return /[\p{Cc}\p{Cf}\p{Bidi_Control}\ufeff]/u.test(character);
}

function normalizeName(value: string, limit: number): string | null {
  const normalized = value.normalize("NFC").trim().replace(/\s+/gu, " ");
  if (normalized.length === 0 || [...normalized].some(unsafeNameCharacter)) return null;
  if (graphemeCount(normalized) > limit) return null;
  return normalized;
}

export function normalizeDisplayName(value: string): string | null {
  return normalizeName(value, MAX_DISPLAY_NAME_GRAPHEMES);
}

export function normalizeCrewName(value: string): string | null {
  return normalizeName(value, MAX_CREW_NAME_GRAPHEMES);
}
