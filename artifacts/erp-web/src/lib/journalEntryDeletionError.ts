export function getJournalEntryDeletionErrorMessage(error: unknown): string {
  const fallback = "Osnutka ni bilo mogoče izbrisati. Podatki so ostali nespremenjeni. Osvežite podatke in poskusite znova.";
  const record = error && typeof error === "object" ? error as Record<string, unknown> : {};
  const data = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : {};
  const message = [data.error, record.message].find(value => typeof value === "string" && value.trim());
  if (typeof message !== "string" || message.length > 800
    || /<\/?[a-z!][^>]*>|&(?:lt|gt|quot);|\bSQLSTATE\b|Failed query:|\b(?:SELECT|INSERT|UPDATE|DELETE)\b.{0,60}\b(?:FROM|INTO|SET)\b|(?:\n|\r)\s*at\s/i.test(message)) {
    return fallback;
  }
  return message.trim();
}
