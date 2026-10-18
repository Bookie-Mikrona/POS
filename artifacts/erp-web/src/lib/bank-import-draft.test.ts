import { afterEach, describe, expect, it, vi } from "vitest";
import { bankImportDraftKey, readBankImportDraft, writeBankImportDraft } from "./bank-import-draft";

afterEach(() => { sessionStorage.clear(); vi.restoreAllMocks(); });

describe("recovery lifetime versus acknowledged server progress", () => {
  const key = bankImportDraftKey("test-user", "test-company");
  const value = { imported: {} };

  it("expires an unsubmitted review after thirty minutes", () => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    writeBankImportDraft(key, value);
    vi.mocked(Date.now).mockReturnValue(now + 30 * 60 * 1000);
    expect(readBankImportDraft(key)).toBeNull();
    expect(sessionStorage.getItem(key)).toBeNull();
  });

  it.each([
    { imported: {}, registered: { statementId: "statement", lineIds: {} } },
    { imported: { tx: { paymentId: "payment", posting: "pending" } } },
  ])("retains acknowledged server progress beyond the review TTL: %j", progress => {
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    writeBankImportDraft(key, progress);
    vi.mocked(Date.now).mockReturnValue(now + 31 * 60 * 1000);
    expect(readBankImportDraft(key)).toMatchObject(progress);
  });

  it("does not swallow storage errors needed to stop financial writes", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Full"); });
    expect(() => writeBankImportDraft(key, value)).toThrow("Full");
  });
});
