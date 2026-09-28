/**
 * Trim an article name and uppercase only its first Unicode letter using
 * Slovenian casing rules. The remainder (including acronyms) is left intact.
 */
export function normalizeSlovenianArticleName(value: string): string {
  const trimmed = value.trim();
  const firstLetter = /\p{L}/u.exec(trimmed);
  if (!firstLetter || firstLetter.index === undefined) return trimmed;
  const index = firstLetter.index;
  return `${trimmed.slice(0, index)}${firstLetter[0].toLocaleUpperCase("sl")}${trimmed.slice(index + firstLetter[0].length)}`;
}

/** Blank optional purchase names are stored as null, not as empty whitespace. */
export function normalizeOptionalSlovenianArticleName(value: string | null | undefined): string | null {
  if (value == null) return null;
  return normalizeSlovenianArticleName(value) || null;
}