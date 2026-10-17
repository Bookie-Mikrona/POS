import "@testing-library/jest-dom";

import type { DocumentRecord } from "@workspace/api-client-react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dokumenti from "./dokumenti";

const state = vi.hoisted(() => ({
  companyId: "company-preview-test",
  documents: [] as DocumentRecord[],
  detail: null as DocumentRecord | null,
  listFetch: vi.fn(),
  detailFetch: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: async () => null }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: state.companyId, role: "admin" } }),
}));

// Unrelated upload/review workflows are not part of preview lifecycle coverage.
vi.mock("@/components/documents/document-upload", () => ({ DocumentUpload: () => null }));

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const listKey = (companyId: string) => ["documents", companyId];
  const detailKey = (companyId: string, id: string) => ["document", companyId, id];
  return {
    useListDocuments: (companyId: string) => useQuery({
      queryKey: listKey(companyId),
      queryFn: () => {
        state.listFetch();
        return { documents: state.documents };
      },
    }),
    useGetDocument: (companyId: string, id: string) => useQuery({
      queryKey: detailKey(companyId, id),
      queryFn: () => {
        state.detailFetch();
        if (!state.detail || state.detail.id !== id) throw new Error(`Unexpected document ${id}`);
        return state.detail;
      },
    }),
    useConfirmDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useRejectDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useListCounterparties: () => ({ data: { counterparties: [] } }),
    useCreateCounterparty: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
    useListAccounts: () => ({ data: { accounts: [] } }),
    useListPeriods: () => ({ data: { periods: [] } }),
    useListVatCodes: () => ({ data: { vatCodes: [] } }),
    useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
    useGetCounterpartyAccountTemplates: () => ({ data: { templates: [] }, isLoading: false, isError: false }),
    useGetDocumentExchangeRate: () => ({
      data: undefined, isLoading: false, isFetching: false,
      isError: false, isPlaceholderData: false, refetch: vi.fn(),
    }),
    getListDocumentsQueryKey: listKey,
    getGetDocumentQueryKey: detailKey,
    getGetDocumentExchangeRateQueryKey: () => ["exchange-rate"],
    getListCounterpartiesQueryKey: (companyId: string) => ["counterparties", companyId],
    getListVatCodesQueryKey: (companyId: string) => ["vat-codes", companyId],
    getListCompanyFursVatCodesQueryKey: (companyId: string) => ["furs-vat-codes", companyId],
  };
});

function documentRecord(id: string, status: DocumentRecord["status"]): DocumentRecord {
  return {
    id,
    companyId: state.companyId,
    fileName: `${id}.pdf`,
    objectPath: `/objects/tests/${id}.pdf`,
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    status,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ocrResult: { rawText: "", confidence: 1, lines: [] },
  } as DocumentRecord;
}

let queryClient: QueryClient;
let storageFetch: ReturnType<typeof vi.fn>;
let createObjectURL: ReturnType<typeof vi.fn>;
let revokeObjectURL: ReturnType<typeof vi.fn>;

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1);
  });
}

async function poll() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  await settle();
}

async function openCompletedDocument() {
  render(<QueryClientProvider client={queryClient}><Dokumenti /></QueryClientProvider>);
  await settle();
  fireEvent.click(screen.getByRole("button", { name: /selected.pdf/ }));
  await settle();
  await settle();
  expect(state.detailFetch).toHaveBeenCalledTimes(1);
  return screen.getByTitle("Predogled PDF dokumenta");
}

beforeEach(() => {
  vi.useFakeTimers();
  state.listFetch.mockClear();
  state.detailFetch.mockClear();
  state.detail = documentRecord("selected", "done");
  state.documents = [state.detail, documentRecord("other", "processing")];
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  storageFetch = vi.fn(async () => ({
    ok: true,
    blob: async () => new Blob(["%PDF-1.4 preview"], { type: "application/pdf" }),
  }));
  createObjectURL = vi.fn(() => "blob:document-preview");
  revokeObjectURL = vi.fn();
  vi.stubGlobal("fetch", storageFetch);
  vi.stubGlobal("URL", Object.assign(class extends URL {}, { createObjectURL, revokeObjectURL }));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Dokumenti preview stability", () => {
  it.each([
    { status: "done", heading: null },
    { status: "confirmed", heading: "Dokument potrjen" },
    { status: "rejected", heading: "Dokument zavrnjen" },
  ] as const)("does not remount the preview when the same document is refreshed from done to $status", async ({ status, heading }) => {
    const iframe = await openCompletedDocument();
    const src = iframe.getAttribute("src");
    expect(src).toBe("blob:document-preview");
    const removedNodes: Node[] = [];
    const observer = new MutationObserver(records => {
      records.forEach(record => removedNodes.push(...record.removedNodes));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      state.detail = {
        ...state.detail!,
        status,
        fileName: "selected-refreshed.pdf",
        updatedAt: "2026-01-01T09:00:00.000Z",
      };
      state.documents = [state.detail, state.documents[1]];

      // Exercise the real background refetch used after confirm/reject, not a remount
      // or a mocked hook rerender. The selected document and its file stay the same.
      await act(async () => {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ["documents", state.companyId] }),
          queryClient.invalidateQueries({ queryKey: ["document", state.companyId, "selected"] }),
        ]);
      });
      await settle();

      expect(state.listFetch).toHaveBeenCalledTimes(2);
      expect(state.detailFetch).toHaveBeenCalledTimes(2);
      expect(screen.getByRole("heading", { name: "selected-refreshed.pdf" })).toBeInTheDocument();
      if (heading) {
        expect(screen.getByRole("heading", { name: heading })).toBeVisible();
        expect(screen.queryByRole("button", { name: "Zavrni" })).not.toBeInTheDocument();
      } else {
        expect(screen.getByRole("button", { name: "Zavrni" })).toBeVisible();
      }
      expect(screen.getByTitle("Predogled PDF dokumenta")).toBe(iframe);
      expect(iframe.isConnected).toBe(true);
      expect(iframe).toHaveAttribute("src", src);
      expect(removedNodes.some(node => node === iframe || node.contains(iframe))).toBe(false);
      expect(storageFetch).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
    }
  });

  it("polls another active document without refetching the selected done document", async () => {
    const iframe = await openCompletedDocument();
    expect(state.listFetch).toHaveBeenCalledTimes(1);

    await poll();
    await poll();
    expect(state.listFetch).toHaveBeenCalledTimes(3);
    expect(state.detailFetch).toHaveBeenCalledTimes(1);

    state.documents = [state.documents[0], { ...state.documents[1], status: "done" }];
    await poll();
    expect(state.listFetch).toHaveBeenCalledTimes(4);
    expect(screen.queryByText("Obdelava")).not.toBeInTheDocument();
    expect(state.detailFetch).toHaveBeenCalledTimes(1);
    expect(screen.getByTitle("Predogled PDF dokumenta")).toBe(iframe);
    expect(iframe.isConnected).toBe(true);
    expect(storageFetch).toHaveBeenCalledTimes(1);

    await poll();
    expect(state.listFetch).toHaveBeenCalledTimes(4);
  });

  it("keeps the same connected iframe and blob when other list and detail data change", async () => {
    const iframe = await openCompletedDocument();
    const src = iframe.getAttribute("src");
    const removedNodes: Node[] = [];
    const observer = new MutationObserver(records => {
      records.forEach(record => removedNodes.push(...record.removedNodes));
    });
    observer.observe(document.body, { childList: true, subtree: true });

    try {
      state.documents = [
        state.documents[0],
        { ...state.documents[1], fileName: "other-updated.pdf" },
      ];
      await poll();
      expect(screen.getByText("other-updated.pdf")).toBeInTheDocument();
      expect(state.detailFetch).toHaveBeenCalledTimes(1);

      // Simulate a detail-cache update from another action, without changing the file.
      act(() => {
        queryClient.setQueryData(["document", state.companyId, "selected"], {
          ...state.detail,
          fileName: "selected-updated.pdf",
          updatedAt: "2026-01-01T09:00:00.000Z",
        });
      });
      await settle();
      expect(screen.getByRole("heading", { name: "selected-updated.pdf" })).toBeInTheDocument();
      expect(screen.getByTitle("Predogled PDF dokumenta")).toBe(iframe);
      expect(iframe.isConnected).toBe(true);
      expect(iframe).toHaveAttribute("src", src);
      expect(removedNodes.some(node => node === iframe || node.contains(iframe))).toBe(false);
      expect(storageFetch).toHaveBeenCalledTimes(1);
      expect(createObjectURL).toHaveBeenCalledTimes(1);
      expect(revokeObjectURL).not.toHaveBeenCalled();
    } finally {
      observer.disconnect();
    }
  });
});
