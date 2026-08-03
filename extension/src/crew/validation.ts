const BIDI_OVERRIDES = new Set([
  "\u202a",
  "\u202b",
  "\u202c",
  "\u202d",
  "\u202e",
  "\u2066",
  "\u2067",
  "\u2068",
  "\u2069",
]);

export const MAX_DISPLAY_NAME_GRAPHEMES = 24;
export const MAX_CREW_NAME_GRAPHEMES = 40;

function graphemeCount(value: string): number {
  let count = 0;
  for (const _ of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(value)) count++;
  return count;
}

function unsafeNameCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  if (code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f)) return true;
  if (BIDI_OVERRIDES.has(character)) return true;
  // Unicode General Category Cc/Cf without requiring a Unicode-property-regex runtime.
  return /[\u00ad\u0600-\u0605\u061c\u06dd\u070f\u0890-\u0891\u08e2\u180e\u200b-\u200f\u202a-\u202e\u2060-\u2064\u2066-\u206f\u206a\u206b\u206c\u206d\u206e\u206f\ufeff]/u.test(character);
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
