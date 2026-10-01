import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DocumentReviewForm } from "./dokumenti";
import type { DocumentRecord } from "@workspace/api-client-react";

const state = vi.hoisted(() => ({
  activeCompany: {
    id: "company-identity-test",
    role: "admin",
    podjetjeDavcna: "SI12345678",
    naziv: "Mikrona d.o.o.",
    kratekNaziv: "Mikrona",
  },
  counterparties: [] as Array<Record<string, unknown>>,
  periods: [] as Array<Record<string, unknown>>,
  accountType: "expense" as string,
  globalFursVatCodes: [] as Array<Record<string, unknown>>,
  companyVatCodes: [] as Array<Record<string, unknown>>,
  fursVatCodeRequests: [] as Array<{ companyId: string; params: unknown; options: unknown }>,
  exchangeRateData: null as Record<string, unknown> | null,
  exchangeRateLoading: false,
  exchangeRateError: false,
  exchangeRateRequests: [] as Array<{ companyId: string; docId: string; params: unknown; options: unknown }>,
  exchangeRateRefetch: vi.fn(),
  confirmError: null as unknown,
  confirmMutate: vi.fn(),
  createCounterpartyMutate: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn(async () => null) }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.activeCompany }),
}));

vi.mock("@workspace/api-client-react", () => ({
  useListCounterparties: () => ({ data: { counterparties: state.counterparties } }),
  useListAccounts: () => ({
    data: {
      accounts: [{
        id: "account-1",
        code: "4000",
        name: "Storitve",
        type: state.accountType,
        isActive: true,
        allowsPosting: true,
      }],
    },
  }),
  useListPeriods: () => ({ data: { periods: state.periods } }),
  useListCompanyFursVatCodes: (companyId: string, params: unknown, options: unknown) => {
    state.fursVatCodeRequests.push({ companyId, params, options });
    const direction = (params as { direction?: string } | undefined)?.direction;
    return {
      data: {
        codes: state.globalFursVatCodes.filter(code => !direction || code.direction === direction),
      },
    };
  },
  useGetDocumentExchangeRate: (companyId: string, docId: string, params: unknown, options: unknown) => {
    state.exchangeRateRequests.push({ companyId, docId, params, options });
    return {
      data: state.exchangeRateData,
      isLoading: state.exchangeRateLoading,
      isFetching: state.exchangeRateLoading,
      isError: state.exchangeRateError,
      isPlaceholderData: false,
      refetch: state.exchangeRateRefetch,
    };
  },
  useListVatCodes: () => ({ data: { vatCodes: state.companyVatCodes } }),
  useGetCounterpartyAccountTemplates: () => ({
    data: { templates: [] },
    isLoading: false,
    isError: false,
  }),
  useConfirmDocument: () => ({
    mutate: state.confirmMutate,
    isPending: false,
    isError: !!state.confirmError,
    error: state.confirmError,
  }),
  useCreateCounterparty: () => ({
    mutate: state.createCounterpartyMutate,
    isPending: false,
    isError: false,
  }),
  getListDocumentsQueryKey: vi.fn(),
  getGetDocumentQueryKey: vi.fn(),
  getGetDocumentExchangeRateQueryKey: vi.fn((companyId: string, docId: string, params: unknown) => ["exchange-rate", companyId, docId, params]),
  getListCounterpartiesQueryKey: vi.fn(),
  getListVatCodesQueryKey: vi.fn(() => ["company-vat-codes"]),
  getListCompanyFursVatCodesQueryKey: vi.fn(() => ["furs-vat-codes"]),
}));

const validLine = {
  description: "Svetovanje",
  quantity: 1,
  unitPrice: 100,
  vatRate: 22,
  vatBase: 100,
  vatAmount: 22,
  confidence: 0.95,
  accountId: "account-1",
  accountCode: "4000",
};

function exchangeRateQuote(
  mode: "ecb" | "manual",
  requestedDate = "2026-09-01",
  unitsPerEur = 1.1,
  vatTreatment: "standard" | "gross-expense-no-input-vat" = "standard",
) {
  return {
    vatTreatment,
    mode,
    currency: "USD",
    targetCurrency: "EUR",
    requestedDate,
    rateDate: requestedDate,
    unitsPerEur,
    source: mode === "ecb" ? "ECB" : "manual",
    sourceUrl: mode === "ecb" ? "https://example.test/ecb" : null,
    sourceTotals: { net: 20, vat: 4.4, gross: 24.4 },
    eurTotals: vatTreatment === "gross-expense-no-input-vat"
      ? { net: 20.33, vat: 0, gross: 20.33 }
      : { net: 18.18, vat: 4, gross: 22.18 },
    convertedLines: [{
      quantity: 1,
      unitPrice: 90.91,
      vatRate: 22,
      vatBase: 18.18,
      vatAmount: 4,
    }],
    roundingDifference: 0.01,
  };
}

function createDocument(ocrOverrides: Record<string, unknown> = {}) {
  return {
    id: "document-identity-test",
    companyId: state.activeCompany.id,
    fileName: "racun.pdf",
    objectPath: "/objects/tests/racun.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    status: "done",
    createdAt: "2026-09-01T08:00:00.000Z",
    updatedAt: "2026-09-01T08:00:00.000Z",
    ocrResult: {
      rawText: "",
      confidence: 1,
      lines: [validLine],
      counterpartyName: "Dobavitelj",
      invoiceDate: "2026-09-01",
      ...ocrOverrides,
    },
  } as DocumentRecord;
}

function renderForm(doc: DocumentRecord) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const renderDocument = () => (
    <QueryClientProvider client={queryClient}>
      <DocumentReviewForm doc={doc} />
    </QueryClientProvider>
  );
  const view = render(renderDocument());
  return {
    ...view,
    rerenderDocument: () => view.rerender(renderDocument()),
  };
}

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
}

function getSelectForLabel(label: string) {
  const labels = Array.from(document.querySelectorAll("label"));
  for (const labelElement of labels) {
    if (labelElement.textContent?.trim().replace(/\s*\*$/, "") !== label) continue;
    const trigger = labelElement.parentElement?.querySelector<HTMLElement>('[role="combobox"]');
    if (trigger) return trigger;
  }
  return null;
}

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = () => false;
  HTMLElement.prototype.setPointerCapture = () => undefined;
  HTMLElement.prototype.releasePointerCapture = () => undefined;
});

beforeEach(() => {
  state.activeCompany = {
    id: "company-identity-test",
    role: "admin",
    podjetjeDavcna: "SI12345678",
    naziv: "Mikrona d.o.o.",
    kratekNaziv: "Mikrona",
  };
  state.counterparties = [];
  state.periods = [
    {
      id: "period-1",
      name: "2026",
      status: "open",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    },
  ];
  state.accountType = "expense";
  state.globalFursVatCodes = [];
  state.companyVatCodes = [];
  state.fursVatCodeRequests = [];
  state.exchangeRateData = null;
  state.exchangeRateLoading = false;
  state.exchangeRateError = false;
  state.exchangeRateRequests = [];
  state.exchangeRateRefetch.mockClear();
  state.confirmError = null;
  state.confirmMutate.mockClear();
  state.createCounterpartyMutate.mockClear();
});

afterEach(cleanup);

describe("DocumentReviewForm — partner identity and document roles", () => {
  it("recognizes legacy OCR for the active company, hides self-creation, and filters self from selection", () => {
    state.counterparties = [
      { id: "own-partner", name: "Different saved name", taxId: "12345678", type: "supplier" },
      { id: "external-partner", name: "Zunanji partner", taxId: "87654321", type: "supplier" },
    ];

    renderForm(createDocument({
      suggestedDocumentType: "invoice_issued",
      counterpartyName: "Mikrona d.o.o.",
      counterpartyTaxId: "12345678",
      suggestedCounterpartyId: "own-partner",
    }));

    expect(screen.getByText(/AI je kot partnerja prepoznal vaše podjetje/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ustvari partnerja iz AI podatkov/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/partnerja ni v sistemu/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Potrdi in shrani/ }));
    expect(state.confirmMutate).not.toHaveBeenCalled();

    const partnerSelect = screen.getAllByRole("combobox")[3];
    openSelect(partnerSelect);
    expect(screen.getByRole("option", { name: /Zunanji partner/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /Different saved name/ })).not.toBeInTheDocument();
  });

  it("uses case- and punctuation-normalized company names only when an OCR tax ID is absent", () => {
    state.counterparties = [
      { id: "own-name-only", name: "mikrona", taxId: null, type: "supplier" },
    ];

    renderForm(createDocument({
      suggestedDocumentType: "invoice_issued",
      counterpartyName: "MIKRONA!",
      suggestedCounterpartyId: "own-name-only",
    }));

    expect(screen.getByText(/AI je kot partnerja prepoznal vaše podjetje/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ustvari partnerja iz AI podatkov/ })).not.toBeInTheDocument();
  });

  it("leaves an unknown document type blank and blocks confirmation until selected", () => {
    state.counterparties = [
      { id: "known-external", name: "Zunanji partner", taxId: "87654321", type: "supplier" },
    ];

    renderForm(createDocument({
      suggestedDocumentType: "unsupported_type",
      counterpartyName: "Zunanji partner",
      suggestedCounterpartyId: "known-external",
    }));

    expect(screen.getByText("Izberite tip dokumenta")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: /Potrdi in shrani/ }));
    expect(state.confirmMutate).not.toHaveBeenCalled();
  });

  it("creates an OCR partner as a customer for an issued invoice", () => {
    renderForm(createDocument({
      suggestedDocumentType: "invoice_issued",
      counterpartyName: "Kupec d.o.o.",
      counterpartyTaxId: "87654321",
    }));

    fireEvent.click(screen.getByRole("button", { name: /Ustvari partnerja iz AI podatkov/ }));
    fireEvent.click(screen.getByRole("button", { name: "Shrani partnerja" }));

    expect(state.createCounterpartyMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          name: "Kupec d.o.o.",
          taxId: "87654321",
          type: "customer",
        }),
      }),
      expect.any(Object),
    );
  });

  it("keeps the missing external-partner action when OCR tax identity conflicts with the active company", () => {
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Mikrona d.o.o.",
      counterpartyTaxId: "SI87654321",
    }));

    expect(screen.queryByText(/AI je kot partnerja prepoznal vaše podjetje/)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ustvari partnerja iz AI podatkov/ })).toBeInTheDocument();
  });

  it("keeps the missing external-partner action for an ordinary unmatched counterparty", () => {
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Zunanji dobavitelj",
      counterpartyTaxId: "87654321",
    }));

    expect(screen.getByText(/partnerja ni v sistemu/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Ustvari partnerja iz AI podatkov/ })).toBeInTheDocument();
  });

  it("preselects the unique existing supplier and date-covering period when lists arrive late", () => {
    state.periods = [];
    const doc = createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Replit Inc",
      counterpartyTaxId: "US 12-3456789",
      invoiceDate: "2026-07-30",
      lines: [validLine],
    });
    const { rerenderDocument } = renderForm(doc);

    expect(getSelectForLabel("Partner")).toHaveTextContent("Izberite partnerja");
    expect(getSelectForLabel("Obdobje")).toHaveTextContent("Izberite obdobje");

    state.counterparties = [{
      id: "replit-usa",
      companyId: state.activeCompany.id,
      name: "Replit USA",
      type: "supplier",
      isActive: true,
      taxId: null,
      registrationNumber: null,
      country: "SI",
    }];
    state.periods = [{
      id: "bookie-2026",
      companyId: state.activeCompany.id,
      name: "Bookie Old 2026 – uvoz osnutkov",
      status: "open",
      startDate: "2026-01-01",
      endDate: "2026-12-31",
    }];
    rerenderDocument();

    expect(getSelectForLabel("Partner")).toHaveTextContent("Replit USA");
    expect(getSelectForLabel("Obdobje")).toHaveTextContent("Bookie Old 2026 – uvoz osnutkov");
    expect(state.confirmMutate).not.toHaveBeenCalled();
  });

  it("preserves a manual partner choice when a later identity refresh becomes ambiguous", () => {
    state.counterparties = [
      { id: "ai-match", name: "Recognized supplier", type: "supplier" },
      { id: "manual-choice", name: "Manually selected supplier", type: "supplier" },
    ];
    const { rerenderDocument } = renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Recognized supplier Inc.",
      invoiceDate: "2026-07-30",
    }));

    const partnerSelect = getSelectForLabel("Partner")!;
    expect(partnerSelect).toHaveTextContent("Recognized supplier");
    openSelect(partnerSelect);
    fireEvent.click(screen.getByRole("option", { name: /Manually selected supplier/ }));
    expect(partnerSelect).toHaveTextContent("Manually selected supplier");

    state.counterparties = [
      ...state.counterparties,
      { id: "second-ai-match", name: "Recognized supplier USA", type: "supplier" },
    ];
    rerenderDocument();

    expect(partnerSelect).toHaveTextContent("Manually selected supplier");
  });

  it("does not let a wrong OCR suggestion override identity and rejects conflicting identifiers or homonyms", () => {
    state.counterparties = [
      { id: "replit-usa", name: "Replit USA", type: "supplier" },
      { id: "wrong-suggestion", name: "Different supplier", type: "supplier" },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "wrong-suggestion",
      counterpartyName: "Replit Inc",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Partner")).toHaveTextContent("Replit USA");

    cleanup();
    state.counterparties = [{
      id: "conflicting-replit",
      name: "Replit USA",
      type: "supplier",
      taxId: "GB123456789",
    }];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "conflicting-replit",
      counterpartyName: "Replit Inc",
      counterpartyTaxId: "US123456789",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Partner")).toHaveTextContent("Izberite partnerja");

    cleanup();
    state.counterparties = [
      { id: "replit-usa", name: "Replit USA", type: "supplier" },
      { id: "replit-ireland", name: "Replit Ireland", type: "supplier" },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "replit-usa",
      counterpartyName: "Replit Inc",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Partner")).toHaveTextContent("Izberite partnerja");
  });

  it("matches a verified registration number across seven- and ten-digit forms", () => {
    state.counterparties = [{
      id: "registered-supplier",
      name: "Unrelated stored legal name",
      type: "supplier",
      registrationNumber: "1234567000",
    }];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Different OCR name",
      counterpartyRegistrationNumber: "1234567",
      invoiceDate: "2026-07-30",
    }));

    expect(getSelectForLabel("Partner")).toHaveTextContent("Unrelated stored legal name");

    cleanup();
    state.counterparties = [{
      id: "conflicting-registration",
      name: "Replit USA",
      type: "supplier",
      registrationNumber: "1234567001",
    }];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      counterpartyName: "Replit Inc",
      counterpartyRegistrationNumber: "1234567",
      invoiceDate: "2026-07-30",
    }));

    expect(getSelectForLabel("Partner")).toHaveTextContent("Izberite partnerja");
  });

  it("selects periods by inclusive invoice date, prefers a valid suggestion, and leaves closed periods unselected", () => {
    state.periods = [
      {
        id: "closed-2026",
        name: "Closed 2026",
        status: "locked",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Obdobje")).toHaveTextContent("Izberite obdobje");

    cleanup();
    state.periods = [
      {
        id: "period-july",
        name: "July",
        status: "open",
        startDate: "2026-07-01",
        endDate: "2026-07-30",
      },
      {
        id: "period-august",
        name: "August",
        status: "open",
        startDate: "2026-07-30",
        endDate: "2026-08-31",
      },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Obdobje")).toHaveTextContent("Izberite obdobje");

    cleanup();
    state.periods = [
      {
        id: "closed-2026",
        name: "Closed 2026",
        status: "locked",
        startDate: "2026-01-01",
        endDate: "2026-12-31",
      },
      {
        id: "period-july",
        name: "July",
        status: "open",
        startDate: "2026-07-01",
        endDate: "2026-07-30",
      },
      {
        id: "period-august",
        name: "August",
        status: "open",
        startDate: "2026-07-30",
        endDate: "2026-08-31",
      },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedPeriodId: "period-august",
      invoiceDate: "2026-07-30",
    }));
    expect(getSelectForLabel("Obdobje")).toHaveTextContent("August");
  });

  it("updates the automatic period for edited dates and preserves a manual period while it remains valid", () => {
    state.periods = [
      {
        id: "period-july-august",
        name: "July–August",
        status: "open",
        startDate: "2026-07-01",
        endDate: "2026-08-31",
      },
      {
        id: "period-july-december",
        name: "July–December",
        status: "open",
        startDate: "2026-07-01",
        endDate: "2026-12-31",
      },
    ];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      invoiceDate: "2026-07-30",
    }));
    const periodSelect = getSelectForLabel("Obdobje")!;
    expect(periodSelect).toHaveTextContent("Izberite obdobje");
    openSelect(periodSelect);
    fireEvent.click(screen.getByRole("option", { name: "July–August" }));
    expect(periodSelect).toHaveTextContent("July–August");

    fireEvent.change(screen.getByLabelText("Datum računa"), { target: { value: "2026-08-15" } });
    expect(periodSelect).toHaveTextContent("July–August");

    fireEvent.change(screen.getByLabelText("Datum računa"), { target: { value: "2026-09-01" } });
    expect(periodSelect).toHaveTextContent("July–December");
  });

  it("loads and offers received global FURS VAT codes with the IN direction", () => {
    state.globalFursVatCodes = [
      globalFursCode("furs-in", "IN", "P22"),
      globalFursCode("furs-out", "OUT", "I22"),
    ];

    renderForm(createDocument({ suggestedDocumentType: "invoice_received" }));

    expect(state.fursVatCodeRequests).toContainEqual(expect.objectContaining({
      params: { direction: "IN" },
    }));
    openSelect(screen.getByRole("combobox", { name: "Globalna FURS DDV-koda — Svetovanje" }));
    expect(screen.getByRole("option", { name: /P22/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /I22/ })).not.toBeInTheDocument();
  });

  it("loads and offers issued global FURS VAT codes with the OUT direction", () => {
    state.globalFursVatCodes = [
      globalFursCode("furs-in", "IN", "P22"),
      globalFursCode("furs-out", "OUT", "I22"),
    ];

    renderForm(createDocument({ suggestedDocumentType: "invoice_issued" }));

    expect(state.fursVatCodeRequests).toContainEqual(expect.objectContaining({
      params: { direction: "OUT" },
    }));
    openSelect(screen.getByRole("combobox", { name: "Globalna FURS DDV-koda — Svetovanje" }));
    expect(screen.getByRole("option", { name: /I22/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /P22/ })).not.toBeInTheDocument();
  });

  it("submits a manually corrected global FURS ID without changing the VAT amount or accounting classification", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const predicted = globalFursCode("furs-in-predicted", "IN", "P22");
    const corrected = globalFursCode("furs-in-corrected", "IN", "P22-ALT");
    state.globalFursVatCodes = [predicted, corrected];
    state.companyVatCodes = [
      companyVatCode("company-vat-predicted", predicted.id, "P22"),
      companyVatCode("company-vat-corrected", corrected.id, "P22-ALT"),
    ];

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      lines: [{ ...validLine, vatCodeId: predicted.id }],
    }));

    openSelect(screen.getByRole("combobox", { name: "Globalna FURS DDV-koda — Svetovanje" }));
    fireEvent.click(screen.getByRole("option", { name: /P22-ALT/ }));
    fireEvent.click(screen.getByRole("button", { name: /Potrdi in shrani/ }));

    expect(state.confirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          lines: [
            expect.objectContaining({
              vatCodeId: corrected.id,
              vatBase: 100,
              vatAmount: 22,
              accountId: "account-1",
            }),
          ],
        }),
      }),
      expect.any(Object),
    );
  });

  it("blocks an unmapped AI FURS VAT prediction and links to the company VAT-code settings", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const unmappedCode = globalFursCode("global-eus22", "IN", "EUS22");
    state.globalFursVatCodes = [unmappedCode];

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      lines: [{ ...validLine, vatCodeId: unmappedCode.id }],
    }));

    expect(screen.getByText(/EUS22 ni povezana z DDV-kodo podjetja/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Odprite DDV šifrant." })).toHaveAttribute("href", "/ddv");
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    expect(state.confirmMutate).not.toHaveBeenCalled();
  });

  it("reviews an ECB USD quote and submits reviewed FX metadata without converting the source lines", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const usdCode = globalFursCode("furs-usd", "IN", "P22");
    state.globalFursVatCodes = [usdCode];
    state.companyVatCodes = [companyVatCode("company-vat-usd", usdCode.id, "P22")];
    state.exchangeRateData = exchangeRateQuote("ecb");

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "USD",
      invoiceDate: "2026-09-01",
      totalNet: 20,
      totalVat: 4.4,
      totalGross: 24.4,
      lines: [{ ...validLine, vatBase: 20, vatAmount: 4.4, vatCodeId: usdCode.id }],
    }));

    const netSourceAmount = screen.getByText("Neto:").parentElement?.textContent ?? "";
    const vatSourceAmount = screen.getByText("DDV:").parentElement?.textContent ?? "";
    expect(netSourceAmount).toContain("20,00");
    expect(netSourceAmount).not.toContain("€");
    expect(vatSourceAmount).toContain("4,40");
    expect(vatSourceAmount).not.toContain("€");
    expect(screen.getByText("Pregled pretvorbe USD v EUR")).toBeInTheDocument();
    expect(screen.getByText("1 EUR = 1,1 USD")).toBeInTheDocument();
    expect(screen.getByText(/Razlika zaokroževanja/)).toBeInTheDocument();
    expect(state.exchangeRateRequests[0]).toEqual(expect.objectContaining({
      companyId: state.activeCompany.id,
      docId: "document-identity-test",
      params: { date: "2026-09-01", mode: "ecb", vatTreatment: "standard" },
    }));

    const confirmButton = screen.getByRole("button", { name: /Potrdi in shrani/ });
    expect(confirmButton).toBeDisabled();

    openSelect(screen.getByRole("combobox", { name: "Vir tečaja" }));
    fireEvent.click(screen.getByRole("option", { name: "Ročni tečaj" }));
    expect(confirmButton).toBeDisabled();
    openSelect(screen.getByRole("combobox", { name: "Vir tečaja" }));
    fireEvent.click(screen.getByRole("option", { name: "Samodejni tečaj ECB" }));
    expect(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ })).not.toBeChecked();
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(screen.getByRole("radio", { name: /Celoten znesek v strošek/ }));
    expect(confirmButton).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: /Običajna obravnava DDV/ }));
    expect(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ })).not.toBeChecked();
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(state.confirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createInvoice: true,
          exchangeRate: {
            vatTreatment: "standard",
            mode: "ecb",
            requestedDate: "2026-09-01",
            rateDate: "2026-09-01",
            unitsPerEur: 1.1,
            reviewed: true,
          },
          lines: [
            expect.objectContaining({
              vatCodeId: usdCode.id,
              unitPrice: 100,
              vatBase: 20,
              vatAmount: 4.4,
            }),
          ],
        }),
      }),
      expect.any(Object),
    );
  });

  it("requires gross-treatment acknowledgement, skips input-VAT mapping, and preserves all 21 USD source lines", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const eus22 = globalFursCode("global-eus22-gross", "IN", "EUS22");
    state.globalFursVatCodes = [eus22];
    const sourceLines = Array.from({ length: 20 }, (_, index) => ({
      ...validLine,
      description: `Postavka ${index + 1}`,
      unitPrice: 13,
      vatBase: 13,
      vatAmount: 2.86,
      vatCodeId: eus22.id,
      vatCodeReviewRequired: false,
      vatCodeReviewReason: "Globalna FURS koda EUS22 ni povezana z DDV-kodo podjetja.",
    }));
    sourceLines.push({
      ...validLine,
      description: "Dobropis",
      unitPrice: 9.2,
      vatBase: -9.2,
      vatAmount: -2.04,
      vatCodeId: eus22.id,
      vatCodeReviewRequired: false,
      vatCodeReviewReason: "Globalna FURS koda EUS22 ni povezana z DDV-kodo podjetja.",
    });
    const grossQuote = {
      ...exchangeRateQuote("ecb", "2026-07-30", 1.1476, "gross-expense-no-input-vat"),
      sourceTotals: { net: 250.8, vat: 55.18, gross: 305.98 },
      eurTotals: { net: 266.63, vat: 0, gross: 266.63 },
      sourceRoundingAdjustment: {
        sourceCurrency: "USD",
        sourceGross: 305.98,
        lineGross: 305.96,
        amount: 0.02,
        lineIndex: 2,
      },
      expenseEurRoundingAdjustment: {
        amount: 0.02,
        lineIndex: 2,
      },
      convertedLines: sourceLines.map(line => ({
        quantity: line.quantity,
        unitPrice: line.vatBase < 0 ? -9.79 : line.description === "Postavka 3" ? 13.84 : 13.82,
        vatRate: line.vatRate,
        vatBase: line.vatBase < 0 ? -9.79 : line.description === "Postavka 3" ? 13.84 : 13.82,
        vatAmount: 0,
      })),
      roundingDifference: 0,
    };
    state.exchangeRateData = grossQuote;

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "USD",
      invoiceDate: "2026-07-30",
      totalNet: 250.8,
      totalVat: 55.18,
      totalGross: 305.98,
      lines: sourceLines,
    }));

    expect(screen.getAllByText(/EUS22 ni povezana z DDV-kodo podjetja/).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Preglej tečaj in preračun" })).toBeInTheDocument();
    const confirmButton = screen.getByRole("button", { name: /Potrdi in shrani/ });
    expect(confirmButton).toBeDisabled();

    fireEvent.click(screen.getByRole("radio", { name: /Celoten znesek v strošek/ }));

    expect(screen.queryAllByText(/EUS22 ni povezana z DDV-kodo podjetja/)).toHaveLength(0);
    expect(screen.queryByRole("combobox", { name: /Globalna FURS DDV-koda/ })).not.toBeInTheDocument();
    const grossSourceAmounts = screen.getByText(/Izvorni račun \(USD\):/).textContent ?? "";
    expect(grossSourceAmounts).toContain("250,80");
    expect(grossSourceAmounts).toContain("55,18");
    expect(grossSourceAmounts).toContain("305,98");
    expect(screen.getByText(/Centna uskladitev OCR: seštevek vrstic 305,96.*znesek dokumenta 305,98.*razlika 0,02.*postavke 3/)).toBeInTheDocument();
    expect(screen.getByText(/Uskladitev EUR zaokroževanja: \+0,02 EUR pri postavki 3, da strošek ustreza preračunu celotnega zneska dokumenta/)).toBeInTheDocument();
    expect(screen.getByText("Neto stroška (EUR):").parentElement).toHaveTextContent("266,63");
    expect(screen.getByText("Odbitni DDV (EUR):").parentElement).toHaveTextContent("0,00");
    expect(screen.getByText("Celotni strošek (EUR):").parentElement).toHaveTextContent("266,63");
    expect(screen.getAllByText(/−9,79/).length).toBeGreaterThan(0);
    expect(screen.getByRole("checkbox", { name: /Pregledal sem knjiženje celotnega zneska.*uskladitev EUR zaokroževanja/ })).not.toBeChecked();
    expect(confirmButton).toBeDisabled();
    expect(state.exchangeRateRequests.some(request =>
      (request.params as { vatTreatment?: string }).vatTreatment === "gross-expense-no-input-vat",
    )).toBe(true);

    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ }));
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal sem knjiženje celotnega zneska.*uskladitev EUR zaokroževanja/ }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    const submittedData = state.confirmMutate.mock.calls[0][0].data;
    expect(submittedData).toEqual(expect.objectContaining({
      vatTreatment: "gross-expense-no-input-vat",
      vatTreatmentReviewed: true,
      exchangeRate: expect.objectContaining({
        vatTreatment: "gross-expense-no-input-vat",
        mode: "ecb",
        requestedDate: "2026-07-30",
        unitsPerEur: 1.1476,
        reviewed: true,
        sourceRoundingAdjustment: {
          sourceCurrency: "USD",
          sourceGross: 305.98,
          lineGross: 305.96,
          amount: 0.02,
          lineIndex: 2,
        },
        expenseEurRoundingAdjustment: {
          amount: 0.02,
          lineIndex: 2,
        },
      }),
    }));
    expect(submittedData.lines).toHaveLength(21);
    expect(submittedData.lines[0]).toEqual(expect.objectContaining({
      vatBase: 13,
      vatAmount: 2.86,
      vatCodeId: eus22.id,
      vatCodeReviewRequired: false,
    }));
    expect(submittedData.lines[20]).toEqual(expect.objectContaining({
      description: "Dobropis",
      vatBase: -9.2,
      vatAmount: -2.04,
      unitPrice: 9.2,
    }));
    expect(submittedData.lines.map((line: typeof sourceLines[number]) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      vatBase: line.vatBase,
      vatAmount: line.vatAmount,
    }))).toEqual(sourceLines.map(line => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      vatRate: line.vatRate,
      vatBase: line.vatBase,
      vatAmount: line.vatAmount,
    })));
  });

  it("previews an EUR gross expense without an FX quote and handles negative amounts", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "EUR",
      totalNet: -2,
      totalVat: -0.44,
      totalGross: -2.44,
      lines: [{ ...validLine, vatBase: -2, vatAmount: -0.43 }],
    }));

    fireEvent.click(screen.getByRole("radio", { name: /Celoten znesek v strošek/ }));
    expect(screen.getByText("Odbitni DDV (EUR):").parentElement).toHaveTextContent("0,00");
    expect(screen.getByText("Celotni strošek (EUR):").parentElement).toHaveTextContent("2,44");
    expect(screen.getByText(/Centna uskladitev OCR: seštevek vrstic −2,43.*znesek dokumenta −2,44.*razlika −0,01/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal sem knjiženje celotnega zneska.*uskladitev EUR zaokroževanja/ }));
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeEnabled();
  });

  it("requires an active posting expense account for gross treatment", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    state.accountType = "revenue";
    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "EUR",
      totalGross: 24.4,
      lines: [{ ...validLine, vatBase: 20, vatAmount: 4.4 }],
    }));

    fireEvent.click(screen.getByRole("radio", { name: /Celoten znesek v strošek/ }));
    const grossReview = screen.getByRole("checkbox", { name: /Pregledal sem knjiženje celotnega zneska/ });
    fireEvent.click(grossReview);
    expect(screen.getByText(/mora biti vsaka vrstica povezana z aktivnim, knjižljivim kontom vrste odhodek/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();

    state.accountType = "expense";
    fireEvent.click(grossReview);
    fireEvent.click(grossReview);
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeEnabled();
  });

  it("keeps an ECB draft blocked while the automatic quote is pending and offers retry after an error", () => {
    state.exchangeRateLoading = true;
    const pendingView = renderForm(createDocument({
      currency: "USD",
      invoiceDate: "2026-09-01",
    }));

    expect(screen.getByRole("status")).toHaveTextContent("Pridobivam tečaj");
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    expect(state.exchangeRateRequests[0].params).toEqual({ date: "2026-09-01", mode: "ecb", vatTreatment: "standard" });

    pendingView.unmount();
    state.exchangeRateLoading = false;
    state.exchangeRateError = true;
    state.exchangeRateRefetch.mockClear();
    renderForm(createDocument({
      currency: "USD",
      invoiceDate: "2026-09-01",
    }));

    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(state.exchangeRateRefetch).toHaveBeenCalledOnce();
    expect(screen.getByText(/Tečaja ni bilo mogoče pridobiti/)).toBeInTheDocument();
  });

  it("requires a valid manual rate and reason, and invalidates a reviewed preview when the invoice date changes", async () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const usdCode = globalFursCode("furs-usd-manual", "IN", "P22");
    state.globalFursVatCodes = [usdCode];
    state.companyVatCodes = [companyVatCode("company-vat-usd-manual", usdCode.id, "P22")];
    state.exchangeRateData = exchangeRateQuote("manual", "2026-09-01", 1.25);

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "USD",
      invoiceDate: "2026-09-01",
      lines: [{ ...validLine, vatBase: 20, vatAmount: 4.4, vatCodeId: usdCode.id }],
    }));

    openSelect(screen.getByRole("combobox", { name: "Vir tečaja" }));
    fireEvent.click(screen.getByRole("option", { name: "Ročni tečaj" }));
    fireEvent.change(screen.getByLabelText("1 EUR = koliko USD?"), { target: { value: "1,25" } });
    fireEvent.change(screen.getByLabelText("Datum veljavnosti tečaja"), { target: { value: "2026-09-02" } });
    fireEvent.change(screen.getByLabelText("Utemeljitev ročnega tečaja (obvezno)"), { target: { value: "Tečaj banke" } });
    expect(screen.getByText(/ne sme biti poznejši od datuma računa/)).toBeInTheDocument();
    expect(screen.queryByText("1 EUR = 1,25 USD")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Utemeljitev ročnega tečaja (obvezno)"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Datum veljavnosti tečaja"), { target: { value: "2026-09-01" } });
    await screen.findByText("1 EUR = 1,25 USD");
    expect(state.exchangeRateRequests.some(request =>
      JSON.stringify(request.params) === JSON.stringify({
        date: "2026-09-01",
        mode: "manual",
        vatTreatment: "standard",
        unitsPerEur: 1.25,
        rateDate: "2026-09-01",
      }),
    )).toBe(true);

    const reviewCheckbox = screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ });
    expect(reviewCheckbox).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Utemeljitev ročnega tečaja (obvezno)"), { target: { value: "Tečaj banke" } });
    fireEvent.click(screen.getByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ }));
    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: /Potrdi in shrani/ }));
    expect(state.confirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          exchangeRate: {
            vatTreatment: "standard",
            mode: "manual",
            requestedDate: "2026-09-01",
            rateDate: "2026-09-01",
            unitsPerEur: 1.25,
            reviewed: true,
            manualReason: "Tečaj banke",
          },
          lines: [expect.objectContaining({ unitPrice: 100, vatBase: 20, vatAmount: 4.4 })],
        }),
      }),
      expect.any(Object),
    );
    fireEvent.change(screen.getByLabelText("Datum računa"), { target: { value: "2026-09-03" } });

    expect(screen.getByRole("button", { name: /Potrdi in shrani/ })).toBeDisabled();
    expect(screen.queryByRole("checkbox", { name: /Pregledal\/-a sem tečaj/ })).not.toBeInTheDocument();
    expect(state.exchangeRateRequests.some(request =>
      (request.params as { date?: string }).date === "2026-09-03",
    )).toBe(true);
  });

  it("shows structured API JSON errors but replaces HTML server responses with a safe Slovenian status", () => {
    state.confirmError = Object.assign(new Error("HTTP 400 Bad Request: {\"error\":\"ignored wrapper\"}"), {
      status: 400,
      data: { error: "Globalna FURS koda EUS22 ni povezana z DDV-kodo podjetja." },
    });
    const structuredErrorForm = renderForm(createDocument());

    expect(screen.getByText("Globalna FURS koda EUS22 ni povezana z DDV-kodo podjetja.")).toBeInTheDocument();
    expect(screen.queryByText(/HTTP 400/)).not.toBeInTheDocument();

    structuredErrorForm.unmount();
    state.confirmError = Object.assign(
      new Error("HTTP 500 Internal Server Error: <!DOCTYPE html><html><body>SQL stack trace</body></html>"),
      { status: 500, data: "<!DOCTYPE html><html><body>SQL stack trace</body></html>" },
    );
    renderForm(createDocument());

    expect(screen.getByText(/Strežnik trenutno ne more potrditi dokumenta \(HTTP 500\)/)).toBeInTheDocument();
    expect(screen.queryByText(/DOCTYPE|SQL stack trace|<html>/i)).not.toBeInTheDocument();
  });
});

function globalFursCode(id: string, direction: "IN" | "OUT", code: string) {
  return {
    id,
    code,
    description: `Opis ${code}`,
    direction,
    rate: "22",
    validFrom: "2020-01-01",
    validTo: null,
    isReverseCharge: false,
    isImport: false,
    isNonDeductible: false,
  };
}

function companyVatCode(id: string, fursCodeId: string, fursCode: string) {
  return {
    id,
    companyId: state.activeCompany.id,
    code: fursCode,
    name: fursCode,
    rate: "22",
    fursCodeId,
    fursCodeDirection: "IN",
    validFrom: "2020-01-01",
    validTo: null,
    isActive: true,
  };
}