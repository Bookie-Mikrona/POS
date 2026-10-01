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
  globalFursVatCodes: [] as Array<Record<string, unknown>>,
  companyVatCodes: [] as Array<Record<string, unknown>>,
  fursVatCodeRequests: [] as Array<{ companyId: string; params: unknown; options: unknown }>,
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
        isActive: true,
        allowsPosting: true,
      }],
    },
  }),
  useListPeriods: () => ({
    data: { periods: [{ id: "period-1", name: "2026", status: "open" }] },
  }),
  useListCompanyFursVatCodes: (companyId: string, params: unknown, options: unknown) => {
    state.fursVatCodeRequests.push({ companyId, params, options });
    const direction = (params as { direction?: string } | undefined)?.direction;
    return {
      data: {
        codes: state.globalFursVatCodes.filter(code => !direction || code.direction === direction),
      },
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
      ...ocrOverrides,
    },
  } as DocumentRecord;
}

function renderForm(doc: DocumentRecord) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DocumentReviewForm doc={doc} />
    </QueryClientProvider>,
  );
}

function openSelect(trigger: HTMLElement) {
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
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
  state.globalFursVatCodes = [];
  state.companyVatCodes = [];
  state.fursVatCodeRequests = [];
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

  it("shows OCR totals in their source currency and does not create a foreign-currency invoice", () => {
    state.counterparties = [{ id: "supplier-1", name: "Dobavitelj", type: "supplier" }];
    const usdCode = globalFursCode("furs-usd", "IN", "P22");
    state.globalFursVatCodes = [usdCode];
    state.companyVatCodes = [companyVatCode("company-vat-usd", usdCode.id, "P22")];

    renderForm(createDocument({
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "supplier-1",
      currency: "USD",
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
    expect(screen.getByText(/Dokument je prepoznan v valuti USD/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "obstoječi vnos računov" })).toHaveAttribute("href", "/racuni");

    const confirmButton = screen.getByRole("button", { name: /Potrdi in shrani/ });
    expect(confirmButton).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox", { name: "Ustvari osnutek računa" }));
    expect(confirmButton).toBeEnabled();
    fireEvent.click(confirmButton);

    expect(state.confirmMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          createInvoice: false,
          lines: [
            expect.objectContaining({
              vatCodeId: usdCode.id,
              vatBase: 20,
              vatAmount: 4.4,
            }),
          ],
        }),
      }),
      expect.any(Object),
    );
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