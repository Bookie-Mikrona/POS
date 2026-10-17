import { describe, expect, it } from "vitest";
import { getJournalEntryPostingFailure } from "./journalEntryPostingPolicy";

describe("general journal posting policy", () => {
  it("returns a warning for amortization in a mixed posting batch", () => {
    const entries = [
      { id: "manual", sourceType: "manual" },
      { id: "amort", sourceType: "amortizacija" },
      { id: "bank", sourceType: "bank_import" },
    ];
    const eligible = entries.filter(entry => !getJournalEntryPostingFailure(entry));
    expect(eligible.map(entry => entry.id)).toEqual(["manual", "bank"]);
    expect(getJournalEntryPostingFailure(entries[1])).toEqual({
      code: "ACCESS_DENIED",
      message: expect.stringContaining("ostati osnutek"),
    });
  });

  it.each(["manual", "bank_import", "document", "ai_suggestion", "pos"])(
    "does not block ordinary source %s",
    sourceType => expect(getJournalEntryPostingFailure({ sourceType })).toBeNull(),
  );
});
