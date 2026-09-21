export type PosJournalCadence = "monthly" | "daily" | null;

const POS_MODULES = "(?:PRODAJA|PORABA|LASTREPR)";
const DAILY_REFERENCE = new RegExp(`^POS:${POS_MODULES}:(\\d{4}-\\d{2}-\\d{2})(?::|$)`);
const MONTHLY_REFERENCE = new RegExp(`^POS:${POS_MODULES}:(\\d{4}-\\d{2})(?::|$)`);

export function classifyPosJournalReference(
  reference: string | null | undefined,
): PosJournalCadence {
  if (!reference) return null;
  if (DAILY_REFERENCE.test(reference)) return "daily";
  if (MONTHLY_REFERENCE.test(reference)) return "monthly";
  return null;
}

export function getMonthlyPosReferenceMonth(
  reference: string | null | undefined,
): string | null {
  if (!reference) return null;
  return MONTHLY_REFERENCE.exec(reference)?.[1] ?? null;
}