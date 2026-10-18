import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
vi.mock("@clerk/react", () => ({ useUser: () => ({ isLoaded: true, user: { id: "user" } }) }));

const state = vi.hoisted(() => ({
  company: { id: "company", role: "owner" },
  setActiveCompany: vi.fn(),
  accounts: [
    { id: "bank", code: "1100000", name: "Banka", isActive: true, allowsPosting: true },
    { id: "required", code: "4150000", name: "Strošek", isActive: true, allowsPosting: true, requiresPartner: true, requiresCostCenter: true, requiresProject: true },
    { id: "normal", code: "2200000", name: "Dobavitelji", isActive: true, allowsPosting: true, requiresPartner: true },
  ],
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company, setActiveCompany: state.setActiveCompany }),
}));
vi.mock("@workspace/api-client-react", async () => ({
  ...await vi.importActual("@workspace/api-client-react"),
  useListAccounts: () => ({ data: { accounts: state.accounts } }),
  useListPeriods: () => ({ data: { periods: [{ id: "period", name: "2026", status: "open" }] } }),
  useListCounterparties: () => ({ data: { counterparties: [{ id: "partner", name: "Partner" }] } }),
  useListPayments: () => ({ data: { payments: [] } }),
  useListInvoices: () => ({ data: { invoices: [{ id: "invoice", arApAccountId: "required" }] } }),
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={e => onValueChange(e.target.value)}>
      <option value="">Izberite</option>{children}
    </select>
  ),
  SelectTrigger: ({ children }: any) => <>{children}</>,
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectValue: () => null,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
}));
import BancniIzpis from "./bancni-izpis";

afterEach(() => {
  cleanup(); vi.restoreAllMocks(); localStorage.clear(); sessionStorage.clear(); vi.unstubAllGlobals();
  state.company = { id: "company", role: "owner" };
  state.setActiveCompany.mockReset();
});

async function openReview(autoPost = false) {
  const transaction = { id: "tx", date: "2026-10-01", amount: -25, reference: "REF",
    counterpartyName: "Partner", counterpartyIban: null, description: null, currency: "EUR" };
  const fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/import-config")) return Response.json({ bankAccountId: "bank", arAccountId: "normal", apAccountId: "normal" });
    if (url.endsWith("/parse")) return Response.json({ transactions: [transaction], count: 1 });
    if (url.endsWith("/match")) {
      const text = [
        { type: "suggestion", current: 1, total: 1, suggestion: { transaction, suggestions: [{
          invoiceId: "invoice", invoiceNumber: "INV-1", counterpartyId: "partner",
          counterpartyName: "Partner", remainingAmount: "25.00", confidence: 1,
          matchReasons: [],
        }] } },
        { type: "complete", total: 1 },
      ].map(e => JSON.stringify(e)).join("\n");
      return new Response(text);
    }
    return Response.json({ statements: [] });
  });
  vi.stubGlobal("fetch", fetchMock);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><BancniIzpis /></QueryClientProvider>);
  await waitFor(() => expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("bank"));
  fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "period" } });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["test"], "test.csv", { type: "text/csv" })] },
  });
  if (autoPost) fireEvent.click(screen.getByRole("checkbox", { name: /Samodejno poknjiži/ }));
  fireEvent.click(screen.getByRole("button", { name: "Nadaljuj" }));
  await screen.findByText("Protikonto računa: 4150000 — Strošek");
  return Object.assign(fetchMock, { view, client });
}

function confirmButtons() {
  return screen.getAllByRole("button", { name: /Potrdi 1 transakcij/ }) as HTMLButtonElement[];
}

describe("warnings before confirming bank imports", () => {
  it("shows per-row missing dimensions and disables both confirmation buttons without sending an import", async () => {
    const fetchMock = await openReview();
    expect(screen.getByText("Konto 4150000: manjkajo obvezne dimenzije — stroškovno mesto, projekt.")).toBeTruthy();
    expect(confirmButtons()).toHaveLength(2);
    confirmButtons().forEach(button => {
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    });
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/payments") || url.endsWith("/register"))).toBe(false);
  });
  it("updates warnings immediately after changing account and selecting partner", async () => {
    await openReview();
    fireEvent.click(screen.getByRole("button", { name: /Brez računa/ }));
    // Standalone defaults to a partner-required account; no partner is selected yet.
    expect(screen.getByText(/Konto 2200000:.*poslovni partner/)).toBeTruthy();
    confirmButtons().forEach(button => expect(button.disabled).toBe(true));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "partner" } });
    expect(screen.queryByText("Preverite obvezne dimenzije")).toBeNull();
    confirmButtons().forEach(button => expect(button.disabled).toBe(false));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "required" } });
    expect(screen.getByText(/Konto 4150000:.*stroškovno mesto, projekt/)).toBeTruthy();
    confirmButtons().forEach(button => expect(button.disabled).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Preskoči" }));
    expect(screen.queryByText("Preverite obvezne dimenzije")).toBeNull();
  });

  it.each(["focus", "visibilitychange"])("removes a posting warning on %s without remounting the page", async event => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = await openReview(true);
    fireEvent.click(screen.getByRole("button", { name: /Brez računa/ }));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "partner" } });
    let paymentStatus = "draft";
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/register")) return Response.json({ statementId: "statement", lineIds: { tx: "line" } });
      if (url.endsWith("/post")) return Response.json({ error: "Posting failed" }, { status: 500 });
      if (url.endsWith("/payments/statuses")) return Response.json({ payments: [{ id: "payment-1", status: paymentStatus }] });
      if (url.endsWith("/payments")) return Response.json({ id: "payment-1" });
      return Response.json({ statements: [] });
    });
    fireEvent.click(confirmButtons()[0]);
    await screen.findByText("Napake pri obdelavi izpiska");
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/payments/statuses"))).toBe(true));
    paymentStatus = "posted";
    await act(async () => fireEvent(event === "focus" ? window : document, new Event(event)));
    await waitFor(() => expect(screen.queryByText("Napake pri obdelavi izpiska")).toBeNull());
    expect(screen.getByText("Uvoz zaključen")).toBeTruthy();
  });
});

describe("odhod po delnem uvozu", () => {
  function blockResultStorage() {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key.startsWith("bank-import-result:")) throw new Error("Storage unavailable");
      return setItem.call(this, key, value);
    });
  }
  async function finishImport(failPosting = true) {
    const fetchMock = await openReview(true);
    fireEvent.click(screen.getByRole("button", { name: /Brez računa/ }));
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "partner" } });
    fetchMock.mockImplementation(async (url: string) => {
      if (url.endsWith("/register")) return Response.json({ statementId: "statement", lineIds: { tx: "line" } });
      if (url.endsWith("/post")) return failPosting
        ? Response.json({ error: "Posting failed" }, { status: 500 })
        : Response.json({ id: "payment-1", status: "posted" });
      if (url.endsWith("/payments/payment-1")) return Response.json({ id: "payment-1", status: "draft" });
      if (url.endsWith("/payments")) return Response.json({ id: "payment-1" });
      return Response.json({ statements: [] });
    });
    fireEvent.click(confirmButtons()[0]);
    await screen.findByText(failPosting ? "Uvoz je delno zaključen" : "Uvoz zaključen");
    if (failPosting) await screen.findByText("Napake pri obdelavi izpiska");
    return fetchMock;
  }

  function unloadIsBlocked() {
    return !window.dispatchEvent(new Event("beforeunload", { cancelable: true }));
  }

  it("ob napaki shranjevanja blokira odhod do ročne razrešitve brez ponovnega knjiženja", async () => {
    blockResultStorage();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = await finishImport();
    await screen.findByText(/Napak ni bilo mogoče shraniti v brskalnik/);
    expect(unloadIsBlocked()).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Nov uvoz" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Napake pri obdelavi izpiska")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Napake so ročno rešene" }));
    await waitFor(() => expect(unloadIsBlocked()).toBe(false));
    expect(screen.queryByText("Napake pri obdelavi izpiska")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/payments"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/post"))).toHaveLength(1);
  });

  it("izrecno potrjen nov uvoz odstrani zaščito", async () => {
    blockResultStorage();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = await finishImport();
    await waitFor(() => expect(unloadIsBlocked()).toBe(true));
    fireEvent.click(screen.getByRole("button", { name: "Nov uvoz" }));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(unloadIsBlocked()).toBe(false);
    expect(screen.queryByText("Napake pri obdelavi izpiska")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/post"))).toHaveLength(1);
  });

  it.each([true, false])("ne blokira odhoda pri uspešnem shranjevanju (napaka knjiženja: %s)", async failed => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await finishImport(failed);
    expect(unloadIsBlocked()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Nov uvoz" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("ob uspešnem shranjevanju v isti zavihek ne doda blokade", async () => {
    const setItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (this === localStorage) throw new Error("Local storage unavailable");
      return setItem.call(this, key, value);
    });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    await finishImport();
    await screen.findByText(/Napake je mogoče obnoviti po osvežitvi istega zavihka/);
    expect(unloadIsBlocked()).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Nov uvoz" }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it("uspešen uvoz ne blokira odhoda niti ob nedostopnem shranjevanju", async () => {
    blockResultStorage();
    const removeItem = Storage.prototype.removeItem;
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, key) {
      if (this === localStorage) throw new Error("Storage unavailable");
      return removeItem.call(this, key);
    });
    await finishImport(false);
    expect(unloadIsBlocked()).toBe(false);
  });

  it("shranjeno opozorilo obnovi brez ponovnega ustvarjanja ali knjiženja", async () => {
    const fetchMock = await finishImport();
    await waitFor(() => expect(localStorage.getItem('bank-import-result:["user","company"]')).not.toBeNull());
    cleanup();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<QueryClientProvider client={client}><BancniIzpis /></QueryClientProvider>);
    await screen.findByText("Napake pri obdelavi izpiska");
    expect(unloadIsBlocked()).toBe(false);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/payments"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/post"))).toHaveLength(1);
  });

  it("preklic menjave podjetja ohrani prejšnje napake in zaščito", async () => {
    blockResultStorage();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const fetchMock = await finishImport();
    await waitFor(() => expect(unloadIsBlocked()).toBe(true));
    state.setActiveCompany.mockImplementation(company => { state.company = company; });
    state.company = { id: "other-company", role: "owner" };
    fetchMock.view.rerender(<QueryClientProvider client={fetchMock.client}><BancniIzpis /></QueryClientProvider>);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(state.setActiveCompany).toHaveBeenCalledWith({ id: "company", role: "owner" });
    expect(screen.getByText("Napake pri obdelavi izpiska")).toBeTruthy();
    expect(unloadIsBlocked()).toBe(true);
    fetchMock.view.rerender(<QueryClientProvider client={fetchMock.client}><BancniIzpis /></QueryClientProvider>);
    expect(screen.getByText("Napake pri obdelavi izpiska")).toBeTruthy();
    expect(screen.queryByText("Podjetje je bilo zamenjano")).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/payments"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/post"))).toHaveLength(1);
  });

  it("potrjena menjava podjetja odstrani staro opozorilo in zaščito", async () => {
    blockResultStorage();
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    const fetchMock = await finishImport();
    await waitFor(() => expect(unloadIsBlocked()).toBe(true));
    state.company = { id: "other-company", role: "owner" };
    fetchMock.view.rerender(<QueryClientProvider client={fetchMock.client}><BancniIzpis /></QueryClientProvider>);
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(unloadIsBlocked()).toBe(false);
    expect(screen.queryByText("Napake pri obdelavi izpiska")).toBeNull();
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/post"))).toHaveLength(1);
  });
});
