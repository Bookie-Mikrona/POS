import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const recovery = vi.hoisted(() => ({
  userId: "user-1",
  companyId: "company-1",
  reconcile: vi.fn(),
}));
vi.mock("@clerk/react", () => ({ useUser: () => ({ isLoaded: true, user: { id: recovery.userId } }) }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: recovery.companyId } }),
}));
vi.mock("@workspace/api-client-react", async () => ({
  ...await vi.importActual("@workspace/api-client-react"),
  useListPeriods: () => ({ data: { periods: [{ id: "period", status: "open", name: "2026" }] } }),
  useListAccounts: () => ({ data: { accounts: [
    { id: "bank", code: "1100000", name: "Banka", isActive: true },
    { id: "ap", code: "2200000", name: "Dobavitelji", isActive: true },
  ] } }),
  useListCounterparties: () => ({ data: { counterparties: [{ id: "partner", name: "Partner" }] } }),
  useListPayments: () => ({ data: { payments: [] } }),
  useListInvoices: () => ({ data: { invoices: [] } }),
  reconcileBankStatementLine: recovery.reconcile,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => React.createElement("select", {
    value, onChange: (event: any) => onValueChange(event.target.value),
  }, React.createElement("option", { value: "" }, "Izberite"), children),
  SelectTrigger: ({ children }: any) => children,
  SelectContent: ({ children }: any) => children,
  SelectValue: () => null,
  SelectItem: ({ value, children }: any) => React.createElement("option", { value }, children),
}));
import BancniIzpis, { matchTransactions } from "./bancni-izpis";
import { bankImportDraftKey } from "@/lib/bank-import-draft";

const transactions = [
  {
    id: "tx-1",
    date: "2026-09-01",
    amount: 12,
    reference: null,
    counterpartyName: null,
    counterpartyIban: null,
    description: null,
    currency: "EUR",
  },
  {
    id: "tx-2",
    date: "2026-09-02",
    amount: -8,
    reference: null,
    counterpartyName: null,
    counterpartyIban: null,
    description: null,
    currency: "EUR",
  },
];

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function suggestionEvent(index: number) {
  return JSON.stringify({
    type: "suggestion",
    current: index + 1,
    total: transactions.length,
    suggestion: {
      transaction: transactions[index],
      suggestions: [],
    },
  });
}

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const draftKey = bankImportDraftKey("user-1", "company-1");
function seedDraft(autoPost = false, kind = "standalone") {
  const draft = {
    parsedStatement: {
      transactions, count: 2, skippedRows: [], metadata: { currency: "EUR" },
      sourceFilename: "statement.csv", sourceSha256: "hash",
    },
    suggestions: transactions.map(transaction => ({ transaction, suggestions: [] })),
    decisions: transactions.map(transaction => [transaction.id, kind === "reconcile"
      ? { kind, paymentId: `existing-${transaction.id}`, label: "Obstoječe plačilo" }
      : { kind, counterpartyId: "partner", arApAccountId: "ap" }]),
    periodId: "period", bankAccountId: "bank", arAccountId: "ap", apAccountId: "ap",
    autoPost, imported: {},
  };
  sessionStorage.setItem(draftKey, JSON.stringify(draft));
  return draft;
}
function readDraft() {
  return JSON.parse(sessionStorage.getItem(draftKey)!);
}
function mountWizard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(React.createElement(QueryClientProvider, { client }, React.createElement(BancniIzpis)));
}
function confirmImport(count: number) {
  fireEvent.click(screen.getAllByRole("button", { name: `Potrdi ${count} transakcij` })[0]);
}
function mockImportApi(
  create: (body: any) => Response | Promise<Response>,
  post: (url: string) => Response | Promise<Response> = () => Response.json({}),
) {
  let registered = false;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url.endsWith("/import-config")) return Response.json({ bankAccountId: "other-bank" });
    if (url.endsWith("/register")) {
      // Match the real endpoint: the same statement hash cannot be registered twice.
      if (registered) return Response.json({ error: "Ta datoteka bančnega izpiska je bila že evidentirana." }, { status: 409 });
      registered = true;
      return Response.json({
        statementId: "statement", lineIds: { "tx-1": "line-1", "tx-2": "line-2" },
      });
    }
    if (url.endsWith("/payments")) return create(JSON.parse(init!.body as string));
    if (url.endsWith("/post")) return post(url);
    return Response.json({ statements: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("obnovitev delno potrjenega bančnega uvoza", () => {
  beforeEach(() => {
    recovery.userId = "user-1";
    recovery.companyId = "company-1";
    recovery.reconcile.mockReset();
  });

  it("po vsaki uspešni vrstici shrani napredek in po 401 ponovno pošlje le preostalo vrstico", async () => {
    seedDraft();
    const create = vi.fn(() => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
      return Response.json({ id: "payment-1" });
    });
    mockImportApi(create);
    const first = mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await screen.findByText(/Seja je potekla\. Ponovno/);
    first.unmount();
    mountWizard();
    await screen.findByText("Že ustvarjeno plačilo");
    expect(readDraft().imported["tx-1"].posting).toBe("posted");
    expect(recovery.reconcile).toHaveBeenCalledTimes(2);
  });

  it("ne začne potrjevanja, če osnutka ni mogoče zapisati", async () => {
    seedDraft();
    const create = vi.fn(() => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
      return Response.json({ id: "payment-1" });
    });
    const post = vi.fn(() => {
      expect(readDraft().imported["tx-1"]).toEqual({ paymentId: "existing-tx-1", posting: "pending" });
      return Response.json({ error: "Prijavite se" }, { status: 401 });
    });
    mockImportApi(() => Response.json({}), post);
    const first = mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await screen.findByText(/Seja je potekla\. Ponovno/);
    expect(readDraft().imported).toEqual({});
    first.unmount();
    mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await waitFor(() => expect(readDraft().imported["tx-2"]?.paymentId).toBe("payment-2"));
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/register"))).toHaveLength(1);
    expect(create.mock.calls.map(([body]) => body.bankStatementLineId)).toEqual(["line-1", "line-1", "line-2"]);
  });

  it("tudi po izgubi odgovora knjiženja obnovi ustvarjeno vrstico kot nepotrjeno", async () => {
    const draft = seedDraft(true);
    sessionStorage.setItem(draftKey, JSON.stringify({
      ...draft, imported: { "tx-1": { paymentId: "payment-1", posting: "pending" } },
    }));
    const fetchMock = mockImportApi(create);
    mountWizard();
    await screen.findByText("Že ustvarjeno plačilo");
    expect(screen.getByText(/Knjiženje ni potrjeno/)).toBeTruthy();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/payments") || url.endsWith("/post"))).toBe(false);
  });

  it("ohrani potrjeno knjiženje in pri popolnem uvozu onemogoči novo potrjevanje", async () => {
    seedDraft(true);
    let id = 0;
    const create = vi.fn(() => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
      return Response.json({ id: "payment-1" });
    });
    mockImportApi(create);
    const first = mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await waitFor(() => expect(readDraft().imported["tx-2"]?.posting).toBe("posted"));
    first.unmount();
    mountWizard();
    await screen.findAllByText("Že ustvarjeno plačilo");
    expect(screen.getAllByText("Knjiženje potrjeno.")).toHaveLength(2);
    for (const button of screen.getAllByRole("button", { name: "Potrdi 0 transakcij" })) {
      expect((button as HTMLButtonElement).disabled).toBe(true);
    }
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("shrani tudi uspešno povezavo obstoječega plačila pred samodejnim knjiženjem", async () => {
    seedDraft(true, "reconcile");
    recovery.reconcile
      .mockResolvedValueOnce({ paymentId: "existing-tx-1", status: "draft", requiresExplicitPosting: true })
      .mockRejectedValueOnce({ status: 401 });
    const post = vi.fn(() => {
      expect(readDraft().imported["tx-1"]).toEqual({ paymentId: "existing-tx-1", posting: "pending" });
      return Response.json({ error: "Prijavite se" }, { status: 401 });
    });
    mockImportApi(() => Response.json({}), post);
    const first = mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await screen.findByText(/Seja je potekla\. Ponovno/);
    first.unmount();
    mountWizard();
    await screen.findByText("Že ustvarjeno plačilo");
    expect(readDraft().imported["tx-1"].posting).toBe("posted");
    expect(recovery.reconcile).toHaveBeenCalledTimes(2);
  });

  it("ne začne potrjevanja, če osnutka ni mogoče zapisati", async () => {
    seedDraft();
    const create = vi.fn(() => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
      return Response.json({ id: "payment-1" });
    });
    const fetchMock = mockImportApi(create);
    mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
    confirmImport(2);
    await screen.findByText(/Napredka uvoza ni mogoče shraniti/);
    expect(create).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/register"))).toBe(false);
  });

  it("ob napaki shranjevanja po uspešni izdelavi ustavi tudi knjiženje in naslednje vrstice", async () => {
    seedDraft(true);
    const create = vi.fn(() => {
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Quota exceeded"); });
      return Response.json({ id: "payment-1" });
    });
    const post = vi.fn(() => {
      expect(readDraft().imported["tx-1"]).toEqual({ paymentId: "existing-tx-1", posting: "pending" });
      return Response.json({ error: "Prijavite se" }, { status: 401 });
    });
    mockImportApi(create, post);
    mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await screen.findByText(/Plačilo je ustvarjeno, vendar napredka ni mogoče shraniti/);
    expect(screen.getByText("Uvoz je delno zaključen")).toBeTruthy();
    expect(create).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Nazaj na pregled" }));
    await screen.findByText("Že ustvarjeno plačilo");
    expect(screen.getAllByRole("button", { name: "Potrdi 1 transakcij" })).toHaveLength(2);
  });

  it("tudi izrecno potrjeno povezavo shrani pred potekom seje pri knjiženju", async () => {
    seedDraft(true, "reconcile");
    recovery.reconcile.mockRejectedValue({
      status: 409, data: { confirmationRequired: true, warnings: ["Različen datum"], requiredConfirmations: ["confirmDateMismatch"] },
    });
    const post = vi.fn(() => {
      expect(readDraft().imported["tx-1"]).toEqual({ paymentId: "existing-tx-1", posting: "pending" });
      return Response.json({ error: "Prijavite se" }, { status: 401 });
    });
    mockImportApi(() => Response.json({}), post);
    const first = mountWizard();
    await screen.findByText("Osnutek uvoza je obnovljen");
    confirmImport(2);
    await screen.findByText("Potrebna potrditev ujemanja (2)");
    recovery.reconcile.mockResolvedValue({ paymentId: "existing-tx-1", status: "draft", requiresExplicitPosting: true });
    fireEvent.click(screen.getAllByRole("button", { name: "Potrdi razliko in poveži" })[0]);
    await screen.findByText(/Seja je potekla\. Ponovno/);
    expect(readDraft().imported["tx-1"].posting).toBe("failed");
    expect(recovery.reconcile).toHaveBeenLastCalledWith("company-1", "line-1", {
      paymentId: "existing-tx-1", confirmDateMismatch: true,
    });
    first.unmount();
    mountWizard();
    await screen.findByText("Že ustvarjeno plačilo");
    expect(screen.getAllByRole("button", { name: "Potrdi 1 transakcij" })).toHaveLength(2);
  });

  it.each(["user", "company"])("ne obnovi osnutka drugega obsega: %s", async scope => {
    seedDraft();
    if (scope === "user") recovery.userId = "user-2";
    else recovery.companyId = "company-2";
    mockImportApi(() => Response.json({}));
    mountWizard();
    await screen.findByRole("button", { name: "Nadaljuj" });
    expect(screen.queryByText("Osnutek uvoza je obnovljen")).toBeNull();
    expect(sessionStorage.getItem(draftKey)).not.toBeNull();
  });
});

describe("pretočno iskanje ujemanj", () => {
  it("pravilno sestavi razdrobljene NDJSON dogodke in napredek", async () => {
    const payload = `${suggestionEvent(0)}\n${suggestionEvent(1)}\n${JSON.stringify({
      type: "complete",
      total: transactions.length,
    })}\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      payload.slice(0, 17),
      payload.slice(17, 83),
      payload.slice(83),
    ])));
    const progress = vi.fn();

    const result = await matchTransactions("company-1", transactions, progress);

    expect(result.suggestions.map(item => item.transaction.id)).toEqual(["tx-1", "tx-2"]);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("zavrne tok brez zaključnega dogodka", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      `${suggestionEvent(0)}\n${suggestionEvent(1)}\n`,
    ])));

    await expect(matchTransactions("company-1", transactions, vi.fn()))
      .rejects.toThrow("Iskanje ujemanj se je predčasno prekinilo");
  });

  it("zavrne zaključek, če manjka rezultat transakcije", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      `${suggestionEvent(0)}\n${JSON.stringify({ type: "complete", total: transactions.length })}\n`,
    ])));

    await expect(matchTransactions("company-1", transactions, vi.fn()))
      .rejects.toThrow("Iskanje ujemanj se je predčasno prekinilo");
  });
});
