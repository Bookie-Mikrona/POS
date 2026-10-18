import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { CompanyWithRole } from "@workspace/api-client-react";

const auth = vi.hoisted(() => ({
  user: { id: "user-a" } as { id: string } | null,
  isLoaded: true,
}));
// The SDK/network boundary alone is simulated. CompanyProvider, its storage,
// and the bank wizard are real; no pre-populated review snapshot is used.
vi.mock("@clerk/react", () => ({
  useUser: () => ({ ...auth, isSignedIn: !!auth.user }),
}));
vi.mock("@workspace/api-client-react", async () => ({
  ...await vi.importActual("@workspace/api-client-react"),
  useListAccounts: () => ({ data: { accounts: [
    { id: "bank", code: "1100000", name: "Banka", isActive: true, allowsPosting: true },
    { id: "ar", code: "1200000", name: "Terjatve", isActive: true, allowsPosting: true },
    { id: "ap", code: "2200000", name: "Obveznosti", isActive: true, allowsPosting: true },
    { id: "custom", code: "4150000", name: "Provizije", isActive: true, allowsPosting: true },
  ] } }),
  useListPeriods: () => ({ data: { periods: [{ id: "period", name: "2026", status: "open" }] } }),
  useListCounterparties: () => ({ data: { counterparties: [{ id: "partner", name: "Partner" }] } }),
  useListPayments: () => ({ data: { payments: [] } }),
  useListInvoices: () => ({ data: { invoices: [{ id: "invoice", arApAccountId: "ar" }] } }),
}));
// Native selects avoid testing Radix pointer geometry in jsdom.
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

import { useUser } from "@clerk/react";
import { CompanyProvider, useCompany } from "@/contexts/CompanyContext";
import { bankImportDraftKey } from "@/lib/bank-import-draft";
import BancniIzpis from "./bancni-izpis";

const companyA: CompanyWithRole = {
  id: "company-a", naziv: "Podjetje A", role: "owner", podjetjeDavcna: "12345678",
  createdAt: "2026-10-01", employerControlledTipsEnabled: false,
};
const companyB: CompanyWithRole = { ...companyA, id: "company-b", naziv: "Podjetje B" };
const transactions = [1, 2].map(i => ({
  id: `tx-${i}`, date: "2026-10-01", amount: i === 1 ? 25 : -5,
  reference: `REF-${i}`, counterpartyName: "Partner", counterpartyIban: null,
  description: `Vrstica ${i}`, currency: "EUR",
}));
let fetchMock: ReturnType<typeof vi.fn>;

function SessionBoundary() {
  const { isLoaded, isSignedIn } = useUser();
  const { activeCompany, setActiveCompany } = useCompany();
  if (!isLoaded) return <p>Nalaganje prijave</p>;
  if (!isSignedIn) return <p>Prijava</p>;
  return <>
    <output data-testid="company">{activeCompany?.id ?? "brez podjetja"}</output>
    <button onClick={() => setActiveCompany(companyA)}>Izberi A</button>
    <button onClick={() => setActiveCompany(companyB)}>Izberi B</button>
    {activeCompany && <BancniIzpis />}
  </>;
}

function mountSession() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = () => <React.StrictMode><QueryClientProvider client={client}>
    <CompanyProvider><SessionBoundary /></CompanyProvider>
  </QueryClientProvider></React.StrictMode>;
  const view = render(tree());
  return {
    ...view,
    async transition(userId: string | null, isLoaded = true) {
      await act(async () => {
        auth.user = userId ? { id: userId } : null;
        auth.isLoaded = isLoaded;
        view.rerender(tree());
      });
    },
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  auth.user = { id: "user-a" };
  auth.isLoaded = true;
  fetchMock = vi.fn(async (url: string) => {
    if (url.endsWith("/import-config")) return Response.json({
      bankAccountId: "bank", arAccountId: "ar", apAccountId: "ap",
    });
    if (url.endsWith("/parse")) return Response.json({
      transactions, count: 2, skippedRows: [], sourceFilename: "izpis.csv", sourceSha256: "hash",
      metadata: { statementNumber: "1", statementDate: "2026-10-01", currency: "EUR" },
    });
    if (url.endsWith("/match")) return new Response([
      ...transactions.map((transaction, index) => ({
        type: "suggestion", current: index + 1, total: 2, suggestion: {
          transaction, suggestions: index === 0 ? [{
            invoiceId: "invoice", invoiceNumber: "INV-1", counterpartyId: "partner",
            counterpartyName: "Partner", remainingAmount: "25.00", confidence: 1, matchReasons: [],
          }] : [],
        },
      })),
      { type: "complete", total: 2 },
    ].map(e => JSON.stringify(e)).join("\n"));
    if (url.endsWith("/bank-statements")) return Response.json({ statements: [] });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function startReview(view: ReturnType<typeof mountSession>) {
  fireEvent.click(screen.getByRole("button", { name: "Izberi A" }));
  await waitFor(() => expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("bank"));
  const controls = screen.getAllByRole("combobox");
  fireEvent.change(controls[0], { target: { value: "period" } });
  // A deliberate change must beat the server's older import configuration.
  fireEvent.change(controls[3], { target: { value: "custom" } });
  fireEvent.change(view.container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["test"], "izpis.csv", { type: "text/csv" })] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Nadaljuj" }));
  await screen.findByText(/✓ INV-1 — 25.00/);
  fireEvent.click(screen.getAllByRole("button", { name: /Brez računa/ })[1]);
  fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "partner" } });
  await waitFor(() => expect(screen.getAllByRole("button", { name: "Potrdi 2 transakcij" })).toHaveLength(2));
  expect(sessionStorage.getItem(bankImportDraftKey("user-a", companyA.id))).not.toBeNull();
}

function expectUploadOnly(companyId: string) {
  expect(screen.getByTestId("company").textContent).toBe(companyId);
  expect(screen.getByRole("button", { name: "Nadaljuj" })).toBeTruthy();
  expect(screen.queryByText(/✓ INV-1/)).toBeNull();
  expect(screen.queryByText("REF-2")).toBeNull();
  expect(screen.queryByRole("button", { name: /Potrdi .* transakcij/ })).toBeNull();
}

describe("obnova bančnega pregleda skozi odjavo in ponovno prijavo", () => {
  it("po poteku seje in ponovni prijavi obnovi podjetje, pregled, konte in spremenjene odločitve", async () => {
    const view = mountSession();
    await startReview(view);
    const draft = sessionStorage.getItem(bankImportDraftKey("user-a", companyA.id));
    await view.transition(null);
    expect(screen.getByText("Prijava")).toBeTruthy();
    expect(screen.queryByText(/✓ INV-1/)).toBeNull();
    expect(sessionStorage.getItem(bankImportDraftKey("user-a", companyA.id))).toBe(draft);
    // A redirect/reload destroys React state and query cache, but retains tab storage.
    view.unmount();
    const reloaded = mountSession();
    await reloaded.transition(null, false);
    expect(screen.getByText("Nalaganje prijave")).toBeTruthy();
    await reloaded.transition("user-a");
    await screen.findByText(/✓ INV-1 — 25.00/);
    expect(screen.getByTestId("company").textContent).toBe(companyA.id);
    expect(screen.getAllByRole("button", { name: "Potrdi 2 transakcij" })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: "Nadaljuj" })).toBeNull();
    const controls = screen.getAllByRole("combobox") as HTMLSelectElement[];
    expect(controls.map(c => c.value)).toEqual(["custom", "partner"]);
    // Check all global accounts and period, not only the visible row decision.
    fireEvent.click(screen.getByRole("button", { name: /Nazaj na uvoz/ }));
    expect((screen.getAllByRole("combobox") as HTMLSelectElement[]).map(c => c.value))
      .toEqual(["period", "bank", "ar", "custom"]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/parse"))).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/match"))).toHaveLength(1);
    expect(fetchMock.mock.calls.some(([url]) => /\/(register|payments)$/.test(url))).toBe(false);
  });

  it("drug uporabnik ne prevzame niti podjetja niti osnutka prvega uporabnika", async () => {
    const view = mountSession();
    await startReview(view);
    await view.transition(null);
    await view.transition("user-b");
    expect(screen.getByTestId("company").textContent).toBe("brez podjetja");
    fireEvent.click(screen.getByRole("button", { name: "Izberi A" }));
    await screen.findByRole("button", { name: "Nadaljuj" });
    expectUploadOnly(companyA.id);
    expect(sessionStorage.getItem(bankImportDraftKey("user-b", companyA.id))).toBeNull();
    // Signing in as B must not erase A's review either.
    await view.transition("user-a");
    await screen.findByText(/✓ INV-1 — 25.00/);
    expect(screen.getAllByRole("button", { name: "Potrdi 2 transakcij" })).toHaveLength(2);
  });

  it("drugo podjetje ne prevzame osnutka, tudi če se obnovi ob ponovni prijavi", async () => {
    const view = mountSession();
    await startReview(view);
    fireEvent.click(screen.getByRole("button", { name: "Izberi B" }));
    await screen.findByRole("button", { name: "Nadaljuj" });
    expectUploadOnly(companyB.id);
    await view.transition(null);
    await view.transition("user-a");
    await screen.findByRole("button", { name: "Nadaljuj" });
    expectUploadOnly(companyB.id);
    expect(sessionStorage.getItem(bankImportDraftKey("user-a", companyB.id))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Izberi A" }));
    await screen.findByText(/✓ INV-1 — 25.00/);
    expect(screen.getAllByRole("button", { name: "Potrdi 2 transakcij" })).toHaveLength(2);
  });

  it("po 30 minutah ne obnovi zastarelega pregleda", async () => {
    const view = mountSession();
    await startReview(view);
    await view.transition(null);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now + 30 * 60 * 1000);
    await view.transition("user-a");
    await screen.findByRole("button", { name: "Nadaljuj" });
    expectUploadOnly(companyA.id);
    expect(sessionStorage.getItem(bankImportDraftKey("user-a", companyA.id))).toBeNull();
  });
});
