import "@testing-library/jest-dom";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dokumenti from "./dokumenti";

const state = vi.hoisted(() => ({
  activeCompany: { id: "company-polling-test", role: "admin" },
  responses: {} as Record<string, Array<{ documents: Array<Record<string, unknown>> }>>,
  calls: {} as Record<string, number>,
  emittedDocuments: {} as Record<string, Array<Array<Record<string, unknown>>>>,
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn(async () => null) }),
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.activeCompany }),
}));

vi.mock("@workspace/api-client-react", async () => {
  const { useQuery } = await import("@tanstack/react-query");
  const listKey = (companyId: string) => ["documents", companyId] as const;

  return {
    useListDocuments: (companyId: string, _params: unknown, options: any) =>
      useQuery({
        queryKey: listKey(companyId),
        queryFn: () => {
          const callIndex = state.calls[companyId] ?? 0;
          state.calls[companyId] = callIndex + 1;
          const responses = state.responses[companyId] ?? [];
          const response = responses[Math.min(callIndex, responses.length - 1)];
          if (!response) throw new Error(`No document-list response configured for ${companyId}`);
          (state.emittedDocuments[companyId] ??= []).push(response.documents);
          return response;
        },
        enabled: options?.query?.enabled,
        retry: false,
        gcTime: Infinity,
      }),
    useGetDocument: vi.fn(),
    useRegisterDocument: () => ({ mutateAsync: vi.fn() }),
    useConfirmDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useRejectDocument: () => ({ mutate: vi.fn(), isPending: false }),
    useRequestUploadUrl: () => ({ mutateAsync: vi.fn() }),
    useListCounterparties: () => ({ data: { counterparties: [] } }),
    useCreateCounterparty: () => ({ mutate: vi.fn(), isPending: false, isError: false }),
    useListAccounts: () => ({ data: { accounts: [] } }),
    useListPeriods: () => ({ data: { periods: [] } }),
    useListVatCodes: () => ({ data: { vatCodes: [] } }),
    useGetCounterpartyAccountTemplates: () => ({ data: { templates: [] }, isLoading: false, isError: false }),
    useListCompanyFursVatCodes: () => ({ data: { codes: [] } }),
    getListDocumentsQueryKey: listKey,
    getGetDocumentQueryKey: (companyId: string, documentId: string) => ["document", companyId, documentId],
    getListCounterpartiesQueryKey: (companyId: string) => ["counterparties", companyId],
    getListVatCodesQueryKey: (companyId: string, params: unknown) => ["/vat-codes", companyId, params],
    getListCompanyFursVatCodesQueryKey: (companyId: string, params: unknown) => ["/furs-vat-codes", companyId, params],
  };
});

function documentWithStatus(status: string) {
  return {
    id: "document-polling-test",
    companyId: state.activeCompany.id,
    fileName: "polling-regression.pdf",
    objectPath: "/objects/tests/polling-regression.pdf",
    mimeType: "application/pdf",
    fileSizeBytes: 1024,
    status,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
  };
}

function reply(status: string) {
  return { documents: [documentWithStatus(status)] };
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
      },
    },
  });
}

function renderPage(queryClient: QueryClient) {
  return render(
    <QueryClientProvider client={queryClient}>
      <Dokumenti />
    </QueryClientProvider>,
  );
}

async function pollOnce(queryClient: QueryClient) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
    for (let i = 0; i < 20 && queryClient.isFetching(); i += 1) {
      await Promise.resolve();
    }
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1);
  });
}

async function settleQueries() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(0);
  });
}

beforeEach(() => {
  state.activeCompany.id = "company-polling-test";
  state.responses = {};
  state.calls = {};
  state.emittedDocuments = {};
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Dokumenti processing polling regression", () => {
  it("keeps polling across structurally shared unchanged replies, then shows done and stops", async () => {
    const companyId = state.activeCompany.id;
    state.responses[companyId] = [reply("processing"), reply("processing"), reply("processing"), reply("done")];
    const queryClient = createQueryClient();

    renderPage(queryClient);
    await settleQueries();
    expect(screen.getByText("polling-regression.pdf")).toBeInTheDocument();
    expect(state.calls[companyId]).toBe(1);

    const initialDocuments = state.emittedDocuments[companyId][0];

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(2);
    expect(queryClient.getQueryData<{ documents: Array<Record<string, unknown>> }>(["documents", companyId])?.documents)
      .toBe(initialDocuments);

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(3);
    expect(queryClient.getQueryData<{ documents: Array<Record<string, unknown>> }>(["documents", companyId])?.documents)
      .toBe(initialDocuments);

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(4);
    expect(state.emittedDocuments[companyId].at(-1)?.[0]?.status).toBe("done");
    expect(queryClient.getQueryData<{ documents: Array<{ status: string }> }>(["documents", companyId])?.documents[0].status)
      .toBe("done");
    expect(screen.getByText("Pripravljen")).toBeInTheDocument();

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(4);
    queryClient.clear();
  });

  it("treats an error status as terminal and stops polling", async () => {
    const companyId = state.activeCompany.id;
    state.responses[companyId] = [reply("processing"), reply("error")];
    const queryClient = createQueryClient();

    renderPage(queryClient);
    await settleQueries();
    expect(screen.getByText("polling-regression.pdf")).toBeInTheDocument();

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(2);
    expect(state.emittedDocuments[companyId].at(-1)?.[0]?.status).toBe("error");
    expect(screen.getByText("Napaka")).toBeInTheDocument();

    await pollOnce(queryClient);
    expect(state.calls[companyId]).toBe(2);
    queryClient.clear();
  });

  it("isolates polling on company switch and clears the active interval on unmount", async () => {
    const firstCompanyId = state.activeCompany.id;
    const secondCompanyId = "company-polling-switched";
    state.responses[firstCompanyId] = [reply("processing")];
    state.responses[secondCompanyId] = [reply("processing")];
    const queryClient = createQueryClient();
    const view = renderPage(queryClient);
    await settleQueries();
    expect(screen.getByText("polling-regression.pdf")).toBeInTheDocument();

    state.activeCompany.id = secondCompanyId;
    view.rerender(
      <QueryClientProvider client={queryClient}>
        <Dokumenti />
      </QueryClientProvider>,
    );
    await settleQueries();
    expect(state.calls[secondCompanyId]).toBe(1);

    await pollOnce(queryClient);
    expect(state.calls[firstCompanyId]).toBe(1);
    expect(state.calls[secondCompanyId]).toBe(2);

    view.unmount();
    await pollOnce(queryClient);
    expect(state.calls[firstCompanyId]).toBe(1);
    expect(state.calls[secondCompanyId]).toBe(2);
    queryClient.clear();
  });
});