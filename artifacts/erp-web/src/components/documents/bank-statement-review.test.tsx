import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DocumentRecord } from "@workspace/api-client-react";
import { BankStatementReview } from "./bank-statement-review";

const mocks = vi.hoisted(() => ({
  company: { id: "company", role: "owner" },
  accounts: [] as any[],
  mutate: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: mocks.company }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidate }) }));
vi.mock("@workspace/api-client-react", () => ({
  useConfirmBankDocument: () => ({ mutate: mocks.mutate, isPending: false, error: null }),
  useListAccounts: () => ({ data: { accounts: mocks.accounts } }),
  useListPeriods: () => ({ data: { periods: [{ id: "period", name: "2026", status: "open", startDate: "2026-01-01", endDate: "2026-12-31" }] } }),
  useListCounterparties: () => ({ data: { counterparties: [{ id: "partner", name: "Synthetic partner" }] } }),
  getListDocumentsQueryKey: () => ["documents"],
  getGetDocumentQueryKey: () => ["document"],
  getListJournalEntriesQueryKey: () => ["entries"],
  getListInvoicesQueryKey: () => ["invoices"],
}));
function document(overrides: Partial<DocumentRecord> = {}): DocumentRecord {
  return {
    id: "document", companyId: "company", status: "done", fileName: "test.pdf", mimeType: "application/pdf",
    objectPath: "/objects/test", createdAt: "", updatedAt: "",
    bankStatement: {
      statementNumber: "1", statementDate: "2026-01-06", sourceIban: "SI56040010000000001", currency: "EUR",
      openingBalance: 2866.75, closingBalance: 3266.75, errors: [],
      transactions: [{ transactionId: "TX-1", bookingDate: "2026-01-06", amount: 400,
        description: "Plačilo računov", counterpartyName: "Synthetic partner", suggestedCounterpartyId: "partner" }],
    }, ...overrides,
  } as DocumentRecord;
}
afterEach(cleanup);
beforeEach(() => {
  mocks.company.role = "owner";
  mocks.accounts = [
    { id: "bank", code: "1100000", name: "TRR", isActive: true, allowsPosting: true },
    { id: "ar", code: "1200000", name: "Kupci", isActive: true, allowsPosting: true, requiresPartner: true },
    { id: "ap", code: "2200000", name: "Dobavitelji", isActive: true, allowsPosting: true, requiresPartner: true },
  ];
  mocks.mutate.mockReset();
  mocks.invalidate.mockReset();
});
describe("bank review", () => {
  it("submits only reviewed selections, not client amounts or VAT, and displays the saved draft link", () => {
    mocks.mutate.mockImplementation((_request, callbacks) => callbacks.onSuccess({ journalEntryId: "entry", statementId: "statement" }));
    render(<BankStatementReview doc={document()} />);
    expect(screen.getByLabelText("Protikonto")).toHaveValue("ar");
    expect(screen.getByLabelText("Partner")).toHaveValue("partner");
    fireEvent.click(screen.getByTestId("button-confirm-bank"));
    expect(mocks.mutate.mock.calls[0][0]).toEqual({
      companyId: "company", id: "document", data: { bankAccountId: "bank", periodId: "period", replaceDraftInvoice: false,
        transactions: [{ transactionId: "TX-1", counterAccountId: "ar", counterpartyId: "partner" }] },
    });
    expect(screen.getByText("Osnutek temeljnice je shranjen (neknjižen).")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Odpri temeljnico" })).toHaveAttribute("href", "/temeljnice?id=entry");
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["entries"] });
    expect(mocks.invalidate).toHaveBeenCalledWith({ queryKey: ["invoices"] });
    expect(screen.queryByTestId("button-confirm-bank")).not.toBeInTheDocument();
  });
  it("allows an old confirmed document to replace its draft invoice only after explicit consent", () => {
    render(<BankStatementReview doc={document({ status: "confirmed", linkedInvoiceId: "invoice" })} />);
    expect(screen.getByTestId("button-confirm-bank")).toBeDisabled();
    fireEvent.click(screen.getByTestId("checkbox-replace-invoice"));
    expect(screen.getByTestId("button-confirm-bank")).toBeEnabled();
    fireEvent.click(screen.getByTestId("button-confirm-bank"));
    expect(mocks.mutate.mock.calls[0][0].data.replaceDraftInvoice).toBe(true);
  });
  it("does not choose the first of several bank accounts", () => {
    mocks.accounts.push({ id: "bank2", code: "1100001", name: "Drugi TRR", isActive: true, allowsPosting: true });
    render(<BankStatementReview doc={document()} />);
    expect(screen.getByTestId("select-bank-account")).toHaveValue("");
    expect(screen.getByTestId("button-confirm-bank")).toBeDisabled();
    fireEvent.change(screen.getByTestId("select-bank-account"), { target: { value: "bank2" } });
    expect(screen.getByTestId("button-confirm-bank")).toBeEnabled();
  });
  it("requires a partner for the selected counteraccount", () => {
    render(<BankStatementReview doc={document()} />);
    fireEvent.change(screen.getByLabelText("Partner"), { target: { value: "" } });
    expect(screen.getByTestId("button-confirm-bank")).toBeDisabled();
    expect(screen.getByText("Manjka protikonto ali obvezni partner.")).toBeInTheDocument();
  });
  it("blocks malformed statements and viewer confirmation", () => {
    const doc = document();
    doc.bankStatement!.errors = ["Manjka začetno ali končno stanje."];
    doc.bankStatement!.openingBalance = undefined;
    render(<BankStatementReview doc={doc} />);
    expect(screen.getByTestId("bank-statement-errors")).toBeInTheDocument();
    expect(screen.getByText("Ni prepoznano")).toBeInTheDocument();
    expect(screen.getByTestId("button-confirm-bank")).toBeDisabled();
  });
  it("restores the persisted link without a second confirmation", () => {
    mocks.company.role = "viewer";
    render(<BankStatementReview doc={document({
      status: "confirmed", bankStatementDraft: { journalEntryId: "saved", statementId: "statement" },
    })} />);
    expect(screen.getByRole("link", { name: "Odpri temeljnico" })).toHaveAttribute("href", "/temeljnice?id=saved");
    expect(screen.queryByTestId("button-confirm-bank")).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
    expect(screen.getByTestId("select-bank-account")).toBeDisabled();
  });
});
