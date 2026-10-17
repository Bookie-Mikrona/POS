import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const state = vi.hoisted(() => ({
  accounts: [
    { id: "bank", code: "1100000", name: "Banka", isActive: true, allowsPosting: true },
    { id: "required", code: "4150000", name: "Strošek", isActive: true, allowsPosting: true, requiresPartner: true, requiresCostCenter: true, requiresProject: true },
    { id: "normal", code: "2200000", name: "Dobavitelji", isActive: true, allowsPosting: true, requiresPartner: true },
  ],
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company", role: "owner" } }),
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

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openReview() {
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
  fireEvent.click(screen.getByRole("button", { name: "Nadaljuj" }));
  await screen.findByText("Protikonto računa: 4150000 — Strošek");
  return fetchMock;
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
});
