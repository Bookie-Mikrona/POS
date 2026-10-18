import "@testing-library/jest-dom/vitest";
import React from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Link, Route, Router } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import type { TrialBalanceRow } from "@workspace/api-client-react";
import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  company: { id: "company-a", naziv: "Podjetje A", role: "accountant" },
  trialBalance: vi.fn(),
}));

// Identity and server responses are isolated to this test. Production auth,
// the real persistence hook, page handlers, routing, Tabs and Select stay intact.
vi.mock("@clerk/react", () => ({
  useAuth: () => ({
    isLoaded: true, isSignedIn: true, userId: "filters-user",
    getToken: async () => "test-token",
  }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: () => ({ data: undefined, isFetching: false }),
  useGetIncomeStatement: () => ({ data: undefined, isFetching: false }),
  useGetTrialBalance: (...args: unknown[]) => state.trialBalance(...args),
}));

const trialTab = "Bilanca kontov / zaključni račun";
const periodA = { dateFrom: "2025-02-01", dateTo: "2025-09-30" };
const periodB = { dateFrom: "2024-03-01", dateTo: "2024-08-31" };

function row(accountCode: string, accountName: string): TrialBalanceRow {
  return {
    accountId: accountCode, accountCode, accountName, accountType: "expense",
    openingBalanceDebit: "10.00", openingBalanceCredit: "0.00",
    turnoverDebit: "20.00", turnoverCredit: "0.00",
    balanceDebit: "30.00", balanceCredit: "0.00",
  };
}

const rowsA = [
  row("400", "Material A"),
  row("401", "Elektrika A"), // Same class, excluded only by search.
  row("700", "Material prihodki A"), // Same search, excluded only by class.
];
const rowsB = [
  row("700", "Prodaja B"),
  row("701", "Drugi prihodki B"),
  row("400", "Prodaja stroški B"),
];

beforeEach(() => {
  sessionStorage.clear();
  state.company = { id: "company-a", naziv: "Podjetje A", role: "accountant" };
  state.trialBalance.mockReset();
  state.trialBalance.mockImplementation((
    company: string,
    params: { dateFrom: string; dateTo: string },
    options: { query: { enabled: boolean } },
  ) => {
    const expectedPeriod = company === "company-a" ? periodA : periodB;
    const correctPeriod = params.dateFrom === expectedPeriod.dateFrom && params.dateTo === expectedPeriod.dateTo;
    return {
      data: options.query.enabled ? {
        rows: correctPeriod ? (company === "company-a" ? rowsA : rowsB) : [row("999", "Drugo obdobje")],
        totalTurnoverDebit: "60.00", totalTurnoverCredit: "0.00",
      } : undefined,
      isFetching: false, isError: false, error: null,
    };
  });
  // jsdom has no scrolling layout; keep the real Radix selection behavior.
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
});

const originalScroll = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
  if (originalScroll) Object.defineProperty(Element.prototype, "scrollIntoView", originalScroll);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

function mountReports() {
  const location = memoryLocation({ path: "/porocila" });
  function App() {
    return (
      <Router hook={location.hook}>
        <nav>
          <Link href="/porocila">Poročila</Link>
          <Link href="/druga-stran">Druga stran</Link>
        </nav>
        <Route path="/porocila"><Porocila /></Route>
        <Route path="/druga-stran"><h1>Druga stran</h1></Route>
      </Router>
    );
  }
  const view = render(<App />);
  return { ...view, refreshCompany: () => view.rerender(<App />) };
}

async function openTrialBalance(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("tab", { name: trialTab }));
  expect(screen.getByRole("tab", { name: trialTab })).toHaveAttribute("aria-selected", "true");
}

function setDates(from: string, to: string) {
  // Exercise the actual localized date inputs, not the filter hook directly.
  fireEvent.change(screen.getByLabelText("Datum od", { selector: "input" }), { target: { value: from } });
  fireEvent.change(screen.getByLabelText("Datum do", { selector: "input" }), { target: { value: to } });
}

async function chooseClass(user: ReturnType<typeof userEvent.setup>, label: string) {
  const select = screen.getByRole("combobox");
  select.focus();
  await user.keyboard("{ArrowDown}");
  await user.click(await screen.findByRole("option", { name: label }));
  expect(select).toHaveTextContent(label);
}

function expectDates(from: string, to: string) {
  expect(screen.getByLabelText("Datum od", { selector: "input" })).toHaveValue(from);
  expect(screen.getByLabelText("Datum do", { selector: "input" })).toHaveValue(to);
}

function expectSelection(from: string, to: string, classLabel: string, search: string) {
  expectDates(from, to);
  expect(screen.getByRole("combobox")).toHaveTextContent(classLabel);
  expect(screen.getByLabelText("Iskanje konta")).toHaveValue(search);
}

function expectFilteredRows(expected: TrialBalanceRow) {
  const table = within(screen.getByRole("table"));
  // Two header rows, exactly one account row and the totals row.
  expect(table.getAllByRole("row")).toHaveLength(4);
  expect(table.getByRole("cell", { name: expected.accountCode })).toBeVisible();
  expect(table.getByText(expected.accountName, { exact: true })).toBeVisible();
  for (const other of [...rowsA, ...rowsB].filter(r => r !== expected)) {
    expect(table.queryByText(other.accountName, { exact: true })).not.toBeInTheDocument();
  }
  expect(table.queryByText("Drugo obdobje")).not.toBeInTheDocument();
}

function expectRequest(company: string, period: typeof periodA) {
  expect(state.trialBalance).toHaveBeenLastCalledWith(
    company, period, expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
  );
}

async function selectCompanyAFilters(user: ReturnType<typeof userEvent.setup>) {
  await openTrialBalance(user);
  setDates("01.02.2025", "30.09.2025");
  await user.click(screen.getByRole("button", { name: "Prikaži" }));
  expectRequest("company-a", periodA);
  await chooseClass(user, "Razred 4");
  await user.type(screen.getByLabelText("Iskanje konta"), "Material");
  expectSelection("01.02.2025", "30.09.2025", "Razred 4", "Material");
  expectFilteredRows(rowsA[0]!);
}

describe("Bruto bilanca – ohranitev filtrov pri dejanski navigaciji", () => {
  it("restores both dates, class, search and filtered rows after switching reports and leaving the page", async () => {
    const user = userEvent.setup();
    mountReports();
    await selectCompanyAFilters(user);
    const originalDateInput = screen.getByLabelText("Datum od", { selector: "input" });

    await user.click(screen.getByRole("tab", { name: "Izkaz poslovnega izida" }));
    expect(screen.getByRole("tab", { name: "Izkaz poslovnega izida" })).toHaveAttribute("aria-selected", "true");
    expect(originalDateInput).not.toBeInTheDocument();
    await openTrialBalance(user);
    expectDates("01.02.2025", "30.09.2025");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Prikaži" }));
    expectSelection("01.02.2025", "30.09.2025", "Razred 4", "Material");
    expectRequest("company-a", periodA);
    expectFilteredRows(rowsA[0]!);

    await user.click(screen.getByRole("link", { name: "Druga stran" }));
    expect(screen.getByRole("heading", { name: "Druga stran" })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Finančna poročila" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: "Poročila" }));
    await openTrialBalance(user);
    expectDates("01.02.2025", "30.09.2025");
    await user.click(screen.getByRole("button", { name: "Prikaži" }));
    expectSelection("01.02.2025", "30.09.2025", "Razred 4", "Material");
    expectRequest("company-a", periodA);
    expectFilteredRows(rowsA[0]!);
  });

  it("separates company filters while the report is mounted and restores each company's own selection", async () => {
    const user = userEvent.setup();
    const view = mountReports();
    await selectCompanyAFilters(user);

    state.company = { id: "company-b", naziv: "Podjetje B", role: "accountant" };
    view.refreshCompany();
    const today = new Date().toISOString().slice(0, 10).split("-").reverse().join(".");
    expectSelection(`01.01.${new Date().getFullYear()}`, today, "Vsi razredi", "");
    expect(screen.queryByText("Material A")).not.toBeInTheDocument();
    setDates("01.03.2024", "31.08.2024");
    await user.click(screen.getByRole("button", { name: "Prikaži" }));
    await chooseClass(user, "Razred 7");
    await user.type(screen.getByLabelText("Iskanje konta"), "Prodaja");
    expectSelection("01.03.2024", "31.08.2024", "Razred 7", "Prodaja");
    expectRequest("company-b", periodB);
    expectFilteredRows(rowsB[0]!);

    state.company = { id: "company-a", naziv: "Podjetje A", role: "accountant" };
    view.refreshCompany();
    expectSelection("01.02.2025", "30.09.2025", "Razred 4", "Material");
    await user.click(screen.getByRole("button", { name: "Prikaži" }));
    expectRequest("company-a", periodA);
    expectFilteredRows(rowsA[0]!);

    state.company = { id: "company-b", naziv: "Podjetje B", role: "accountant" };
    view.refreshCompany();
    expectSelection("01.03.2024", "31.08.2024", "Razred 7", "Prodaja");
    await user.click(screen.getByRole("button", { name: "Prikaži" }));
    expectRequest("company-b", periodB);
    expectFilteredRows(rowsB[0]!);
  });
});
