import { describe, expect, it } from "vitest";
import { getJournalEntryPostingErrorMessage } from "./journalEntryPostingError";

describe("journal posting error", () => {
  it("shows the structured KIR evidence warning, not the HTTP status", () => {
    expect(getJournalEntryPostingErrorMessage({
      status: 409, message: "Conflict",
      data: { code: "VAT_LEDGER_ERROR", message: "Manjka zanesljiv davčni razrez za KIR." },
    })).toBe("Manjka zanesljiv davčni razrez za KIR.");
  });
  it.each([null, {}, { data: { message: "<html>proxy failure</html>" } },
    { data: { message: "Failed query: SELECT * FROM secret" } }])("uses a safe fallback for %j", error => {
    expect(getJournalEntryPostingErrorMessage(error)).toBe(
      "Temeljnice ni bilo mogoče potrditi. Osvežite podatke in poskusite znova.",
    );
  });
});
