import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  useListAccounts: () => ({ data: { accounts: [] } }),
  useListPeriods: () => ({ data: { periods: [] } }),
  useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
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
  getListCounterpartiesQueryKey: vi.fn(),
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

describe("DocumentReviewForm — prazne OCR vrstice", () => {
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
});