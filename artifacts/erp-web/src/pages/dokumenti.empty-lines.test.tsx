import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewForm } from "./dokumenti";
import type { DocumentRecord } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({
  confirmMutate: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn(async () => null) }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    activeCompany: { id: "company-empty-lines", role: "admin" },
  }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListCounterparties: () => ({ data: { counterparties: [] } }),
  useListAccounts: () => ({
    data: {
      accounts: [
        { id: "account-ai", code: "4150", name: "Računovodske storitve", isActive: true, allowsPosting: true },
        { id: "account-manual", code: "4100", name: "Druge storitve", isActive: true, allowsPosting: true },
      ],
    },
  }),
  useListPeriods: () => ({ data: { periods: [] } }),
  useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
  useGetDocumentExchangeRate: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    isError: false,
    isPlaceholderData: false,
    refetch: vi.fn(),
  }),
  useListVatCodes: () => ({ data: { vatCodes: [] } }),
  useGetCounterpartyAccountTemplates: () => ({
    data: { templates: [] },
    isLoading: false,
    isError: false,
  }),
  useConfirmDocument: () => ({
    mutate: state.confirmMutate,
    isPending: false,
  }),
  useCreateCounterparty: () => ({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
  }),
  getListDocumentsQueryKey: vi.fn(),
  getGetDocumentQueryKey: vi.fn(),
  getGetDocumentExchangeRateQueryKey: vi.fn(() => ["exchange-rate"]),
  getListCounterpartiesQueryKey: vi.fn(),
  getListVatCodesQueryKey: vi.fn(),
  getListCompanyFursVatCodesQueryKey: vi.fn(),
}));

const emptyLinesDocument = {
  id: "document-empty-lines",
  companyId: "company-empty-lines",
  fileName: "prazne-vrstice.pdf",
  objectPath: "/objects/tests/prazne-vrstice.pdf",
  mimeType: "application/pdf",
  fileSizeBytes: 1024,
  status: "done",
  createdAt: "2026-09-01T08:00:00.000Z",
  updatedAt: "2026-09-01T08:00:00.000Z",
  ocrResult: {
    rawText: "",
    confidence: 1,
    lines: [],
  },
} as DocumentRecord;

describe("DocumentReviewForm — OCR vrstice", () => {
  const originalScrollIntoView = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");

  beforeAll(() => {
    // Radix Select scrolls the focused option; jsdom does not implement scrolling.
    Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  });

  afterAll(() => {
    if (originalScrollIntoView) {
      Object.defineProperty(Element.prototype, "scrollIntoView", originalScrollIntoView);
    } else {
      Reflect.deleteProperty(Element.prototype, "scrollIntoView");
    }
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    state.confirmMutate.mockClear();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 404 })));
  });

  it("prikaže opozorilo in onemogoči Potrdi in shrani", () => {
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <DocumentReviewForm doc={emptyLinesDocument} />
      </QueryClientProvider>,
    );

    expect(
      screen.getByText("Dokument nima vrstic za kontiranje — dodajte vsaj eno vrstico."),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    expect(state.confirmMutate).not.toHaveBeenCalled();
  });

  it.each([
    { source: "history" as const, indicator: "Na podlagi 7 potrjenih kontiranj tega partnerja" },
    { source: "pattern" as const, indicator: "Tipičen vzorec kontiranja" },
  ])("po ročni izbiri konta odstrani vir $source in ne obnovi starega števila kontiranj", async ({ source, indicator }) => {
    const doc: DocumentRecord = {
      ...emptyLinesDocument,
      ocrResult: {
        rawText: "",
        confidence: 0.95,
        lines: [{
          description: "Računovodska storitev",
          quantity: 1,
          unitPrice: 100,
          vatRate: 22,
          vatBase: 100,
          vatAmount: 22,
          confidence: 0.95,
          accountId: "account-ai",
          accountCode: "4150",
          suggestionSource: source,
          suggestionCount: 7,
        }],
      },
    };
    const queryClient = new QueryClient();
    const review = () => (
      <QueryClientProvider client={queryClient}>
        <DocumentReviewForm doc={doc} />
      </QueryClientProvider>
    );
    const { rerender } = render(review());
    const row = screen.getByRole("row", { name: /Računovodska storitev/ });
    const accountSelect = within(row).getByRole("combobox");

    expect(within(row).getByText(indicator)).toBeInTheDocument();
    expect(accountSelect).toHaveTextContent("4150");
    expect(within(row).queryByText("Ročna izbira")).not.toBeInTheDocument();

    fireEvent.keyDown(accountSelect, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /4100.*Druge storitve/ }));

    const expectManualChoice = () => {
      expect(accountSelect).toHaveTextContent("4100");
      expect(within(row).getByText("Ročna izbira")).toBeInTheDocument();
      expect(within(row).queryByText(/Na podlagi .*potrjen.*kontiranj/)).not.toBeInTheDocument();
      expect(within(row).queryByText("Tipičen vzorec kontiranja")).not.toBeInTheDocument();
    };
    expectManualChoice();

    // A parent refresh must not reapply the unchanged OCR source/count.
    rerender(review());
    expectManualChoice();

    // Even choosing the originally proposed account again is a manual choice.
    fireEvent.keyDown(accountSelect, { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: /4150.*Računovodske storitve/ }));
    expect(accountSelect).toHaveTextContent("4150");
    expect(within(row).getByText("Ročna izbira")).toBeInTheDocument();
    expect(within(row).queryByText(indicator)).not.toBeInTheDocument();
    expect(within(row).queryByText(/Na podlagi .*potrjen.*kontiranj/)).not.toBeInTheDocument();
  });
});