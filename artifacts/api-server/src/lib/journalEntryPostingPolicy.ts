import { accountingError } from "./accountingErrors";

/** Shared by individual posting and any future bulk posting. */
export function getJournalEntryPostingFailure(entry: { sourceType: string }) {
  if (entry.sourceType === "amortizacija") {
    return accountingError(
      "ACCESS_DENIED",
      "Amortizacijska temeljnica mora ostati osnutek in je ni mogoče potrditi prek splošnega knjiženja.",
    );
  }
  return null;
}
