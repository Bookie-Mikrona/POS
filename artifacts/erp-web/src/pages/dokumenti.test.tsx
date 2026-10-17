import "@testing-library/jest-dom/vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@workspace/api-client-react";
import { DocumentReviewForm } from "./dokumenti";

const state = vi.hoisted(() => ({
  company: { id: "company-templates", role: "admin" },
  confirm: vi.fn(),
  counterparties: [
    { id: "partner-a", name: "Dobavitelj A", isActive: true },
    { id: "partner-b", name: "Dobavitelj B", isActive: true },
  ],
  accounts: [
    { id: "initial", code: "4000000", name: "Material", type: "expense", isActive: true, allowsPosting: true },
    { id: "template-a", code: "4100000", name: "Storitve", type: "expense", isActive: true, allowsPosting: true },
    { id: "template-b", code: "4190000", name: "Drugi stroški", type: "expense", isActive: true, allowsPosting: true },
  ],
  periods: [{ id: "period", name: "2026", status: "open", startDate: "2026-01-01", endDate: "2026-12-31" }],
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));
vi.mock("@workspace/api-client-react", async importOriginal => ({
  // Keep the generated template hook and its real partner-specific query key.
  ...await importOriginal<typeof import("@workspace/api-client-react")>(),
  useListCounterparties: () => ({ data: { counterparties: state.counterparties } }),
  useListAccounts: () => ({ data: { accounts: state.accounts } }),
  useListPeriods: () => ({ data: { periods: state.periods } }),
  useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
  useListVatCodes: () => ({ data: { vatCodes: [] } }),
  useGetDocumentExchangeRate: () => ({ data: undefined }),
  useConfirmDocument: () => ({ mutate: state.confirm, isPending: false }),
  useCreateCounterparty: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
}));

const doc = {
  id: "document-templates", companyId: "company-templates", fileName: "racun.pdf",
  objectPath: "/objects/tests/racun.pdf", mimeType: "application/pdf", fileSizeBytes: 1024,
  status: "done", createdAt: "2026-09-01T08:00:00Z", updatedAt: "2026-09-01T08:00:00Z",
  ocrResult: {
    rawText: "", confidence: 1, currency: "EUR",
    suggestedDocumentType: "invoice_received", counterpartyName: "Dobavitelj A",
    invoiceDate: "2026-09-01", invoiceNumber: "TEST-1",
    lines: ["Prva postavka", "Druga postavka"].map(description => ({
      description, quantity: 1, unitPrice: 100, vatRate: 0, vatBase: 100, vatAmount: 0,
      confidence: 1, accountId: "initial", accountCode: "4000000",
    })),
  },
} as DocumentRecord;

let queryClient: QueryClient;
let requests: string[];
const pointerMethods = ["hasPointerCapture", "setPointerCapture", "releasePointerCapture", "scrollIntoView"] as const;
const originalMethods = pointerMethods.map(name => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));

beforeAll(() => {
  for (const name of pointerMethods) {
    Object.defineProperty(HTMLElement.prototype, name, { configurable: true, value: () => false });
  }
});
afterAll(() => {
  pointerMethods.forEach((name, index) => {
    const original = originalMethods[index];
    if (original) Object.defineProperty(HTMLElement.prototype, name, original);
    else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[name];
  });
});

beforeEach(() => {
  state.company.role = "admin";
  state.confirm.mockReset();
  requests = [];
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    requests.push(url);
    const partnerId = url.match(/\/counterparties\/(partner-[ab])\/account-templates$/)?.[1];
    if (!partnerId) throw new Error(`Unexpected request: ${url}`);
    const isA = partnerId === "partner-a";
    return Response.json({ templates: [{
      id: `saved-${partnerId}`, companyId: state.company.id, counterpartyId: partnerId,
      accountId: isA ? "template-a" : "template-b", accountCode: isA ? "4100000" : "4190000",
      usageCount: isA ? 7 : 3,
    }] });
  }));
  vi.stubGlobal("PointerEvent", MouseEvent);
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderForm() {
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentReviewForm doc={doc} />
    </QueryClientProvider>,
  );
}

function lineRow(description: string) {
  return within(screen.getByText(description).closest("tr")!);
}

async function loadedRows() {
  await screen.findAllByRole("button", { name: "4100000 (7×)" });
  return [lineRow("Prva postavka"), lineRow("Druga postavka")];
}

describe("DocumentReviewForm — shranjene predloge partnerja", () => {
  it("prikaže kodo in število uporab v povzetku ter pri vsaki vrstici", async () => {
    renderForm();
    const rows = await loadedRows();
    expect(screen.getAllByText("4100000 (7×)")).toHaveLength(3);
    for (const row of rows) {
      expect(row.getByRole("button", { name: "4100000 (7×)" })).toBeEnabled();
      expect(row.getByRole("combobox", { name: "" })).toHaveTextContent("4000000");
    }
    expect(requests).toContain("/api/companies/company-templates/counterparties/partner-a/account-templates");
  });

  it("klik predloge na drugi vrstici spremeni samo drugo vrstico in njen shranjeni konto", async () => {
    renderForm();
    const [first, second] = await loadedRows();
    fireEvent.click(second.getByRole("button", { name: "4100000 (7×)" }));
    expect(first.getByRole("combobox", { name: "" })).toHaveTextContent("4000000");
    expect(second.getByRole("combobox", { name: "" })).toHaveTextContent("4100000");
    // Save reviewed coding without requiring unrelated invoice VAT mappings.
    fireEvent.click(screen.getByRole("checkbox", { name: "Ustvari osnutek računa" }));
    const confirm = screen.getByRole("button", { name: /Potrdi in shrani/ });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    expect(state.confirm).toHaveBeenCalledOnce();
    expect(state.confirm.mock.calls[0][0].data.lines).toEqual([
      expect.objectContaining({ description: "Prva postavka", accountId: "initial", accountCode: "4000000" }),
      expect.objectContaining({ description: "Druga postavka", accountId: "template-a", accountCode: "4100000" }),
    ]);
  });

  it("ob menjavi partnerja pridobi njegove predloge in odstrani prejšnje iz vseh vrstic", async () => {
    renderForm();
    const [first, second] = await loadedRows();
    const label = screen.getByText(
      (_text, element) => element?.textContent?.trim() === "Partner *",
      { selector: "label" },
    );
    const partnerSelect = label.parentElement!.querySelector('[role="combobox"]')!;
    fireEvent.keyDown(partnerSelect, { key: "ArrowDown" });
    fireEvent.click(screen.getByRole("option", { name: "Dobavitelj B" }));
    await waitFor(() => expect(screen.getAllByRole("button", { name: "4190000 (3×)" })).toHaveLength(2));
    expect(screen.queryByText("4100000 (7×)")).not.toBeInTheDocument();
    expect(screen.getAllByText("4190000 (3×)")).toHaveLength(3);
    expect(requests).toContain("/api/companies/company-templates/counterparties/partner-b/account-templates");
    for (const row of [first, second]) {
      expect(row.getByRole("button", { name: "4190000 (3×)" })).toBeEnabled();
      expect(row.getByRole("combobox", { name: "" })).toHaveTextContent("4000000");
    }
    fireEvent.click(second.getByRole("button", { name: "4190000 (3×)" }));
    expect(first.getByRole("combobox", { name: "" })).toHaveTextContent("4000000");
    expect(second.getByRole("combobox", { name: "" })).toHaveTextContent("4190000");
  });

  it("v načinu samo za ogled pokaže predloge, vendar jih ni mogoče uporabiti", async () => {
    state.company.role = "viewer";
    renderForm();
    const rows = await loadedRows();
    for (const row of rows) {
      const template = row.getByRole("button", { name: "4100000 (7×)" });
      expect(template).toBeDisabled();
      fireEvent.click(template);
      expect(row.getByRole("combobox", { name: "" })).toHaveTextContent("4000000");
    }
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    expect(state.confirm).not.toHaveBeenCalled();
  });
});
