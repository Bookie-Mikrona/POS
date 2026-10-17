import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DocumentRecord } from "@workspace/api-client-react";

import Dokumenti from "./dokumenti";

const state = vi.hoisted(() => ({
  document: undefined as DocumentRecord | undefined,
  getToken: vi.fn(async () => null),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: state.getToken }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-preview-test", role: "admin" } }),
}));

// Uploading is unrelated to rendering an already processed document.
vi.mock("@/components/documents/document-upload", () => ({
  DocumentUpload: () => null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListDocuments: () => ({ data: { documents: [state.document] }, isLoading: false }),
  useGetDocument: () => ({ data: state.document, isLoading: false }),
  useConfirmDocument: () => ({ mutate: vi.fn(), isPending: false }),
  useRejectDocument: () => ({ mutate: vi.fn(), isPending: false }),
  getListDocumentsQueryKey: (companyId: string) => ["documents", companyId],
  getGetDocumentQueryKey: (companyId: string, id: string) => ["document", companyId, id],
}));

const blobUrl = "blob:document-preview-test";

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () =>
    new Response(new Blob(["%PDF-1.7\n"], { type: "application/pdf" }), { status: 200 }),
  ));
  vi.stubGlobal("URL", class extends URL {
    static createObjectURL = vi.fn(() => blobUrl);
    static revokeObjectURL = vi.fn();
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Dokumenti — predogled po potrditvi ali zavrnitvi", () => {
  it.each([
    { status: "confirmed", heading: "Dokument potrjen" },
    { status: "rejected", heading: "Dokument zavrnjen" },
  ] as const)("ohrani predogled in Razširi za status $status", async ({ status, heading }) => {
    state.document = {
      id: "document-preview-test",
      companyId: "company-preview-test",
      fileName: "izvirni-dokument.pdf",
      objectPath: "/objects/tests/izvirni-dokument.pdf",
      mimeType: "application/pdf",
      fileSizeBytes: 1024,
      status,
      createdAt: "2026-10-01T08:00:00.000Z",
      updatedAt: "2026-10-01T09:00:00.000Z",
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: Infinity } },
    });
    const view = render(
      <QueryClientProvider client={queryClient}>
        <Dokumenti />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /izvirni-dokument\.pdf/ }));

    expect(screen.getByRole("heading", { name: heading })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Predogled dokumenta" })).toBeVisible();
    const expandButton = await screen.findByRole("button", { name: "Razširi" });
    expect(expandButton).toBeVisible();
    expect(screen.getByTitle("Predogled PDF dokumenta")).toBeVisible();
    expect(screen.getByTitle("Predogled PDF dokumenta")).toHaveAttribute("src", blobUrl);
    expect(fetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/storage/objects/tests/izvirni-dokument.pdf"),
      { headers: {} },
    );

    fireEvent.click(expandButton);
    expect(screen.getByTitle("Celozaslonski predogled PDF dokumenta")).toBeVisible();
    expect(screen.getByTitle("Celozaslonski predogled PDF dokumenta")).toHaveAttribute("src", blobUrl);

    view.unmount();
    queryClient.clear();
  });
});
