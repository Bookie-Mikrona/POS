import { describe, expect, it } from "vitest";
import { getJournalEntryDeletionErrorMessage } from "./journalEntryDeletionError";

describe("journal deletion error feedback", () => {
  it("shows a safe server explanation", () => {
    expect(getJournalEntryDeletionErrorMessage({ data: { error: "Osnutek ima evidentirano plačilo." } }))
      .toBe("Osnutek ima evidentirano plačilo.");
  });
  it.each([
    { message: '<html lang="en"><pre>Error: Failed query: delete from journal_entries</pre></html>' },
    { message: "Error: Failed query: delete from journal_entries" },
    { data: { error: "&lt;html&gt;Interna napaka&lt;/html&gt;" } },
    { message: "error\n at NodePgPreparedQuery" },
    undefined,
  ])("never displays HTML, SQL or stack traces", error => {
    expect(getJournalEntryDeletionErrorMessage(error)).toMatch(/^Osnutka ni bilo mogoče izbrisati/);
  });
});
