import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import PorocilaAnalitika from "./porocila-dimenzije";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  accounts: vi.fn(),
  companyId: "company-1",
  setCompany: vi.fn(),
  access: { company: { id: "company-1", naziv: "Podjetje" } as { id: string; naziv: string } | null, checking: false, failed: false, retry: vi.fn() },
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    activeCompany: mocks.companyId ? { id: mocks.companyId, naziv: "Podjetje" } : null,
    setActiveCompany: mocks.setCompany,
  }),
  useSharedCompanyAccess: () => mocks.access,
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: mocks.accounts,
  useGetDimensionReport: mocks.report,
}));
// Native controls exercise the page's value/change wiring without Radix pointer APIs.
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: any) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>{children}</select>
  ),
  SelectContent: ({ children }: any) => <>{children}</>,
  SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));
vi.mock("@/components/ui/input", () => ({
  Input: (props: React.ComponentProps<"input">) => <input {...props} />,
}));

const path = "/porocila/dimenzije";
const firstView = "dimensionType=project&dateFrom=2025-01-01&dateTo=2025-12-31&accountId=acc-1";
const reportData = {
  rows: [],
  grandTotalDebit: "0",
  grandTotalCredit: "0",
  grandTotalBalance: "0",
  untaggedDebit: "0",
  untaggedCredit: "0",
  untaggedBalance: "0",
  untaggedLines: [],
};

function lastRequest() {
  return mocks.report.mock.calls.at(-1)!;
}

beforeEach(() => {
  window.history.replaceState(null, "", path);
  mocks.companyId = "company-1";
  mocks.setCompany.mockReset();
  mocks.access = { company: { id: "company-1", naziv: "Podjetje" }, checking: false, failed: false, retry: vi.fn() };
  mocks.report.mockReset();
  mocks.accounts.mockReset();
  mocks.accounts.mockReturnValue({ data: { accounts: [{ id: "acc-1", code: "400", name: "Stroški" }] } });
  mocks.report.mockImplementation((_company, _filters, options) => ({
    data: options.query.enabled ? reportData : undefined,
    isLoading: false,
    error: null,
  }));
});
afterEach(cleanup);

describe("untagged journal lines", () => {
  function showUntagged(count: number) {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    mocks.report.mockReturnValue({
      data: {
        ...reportData,
        // Zero net (and even zero debit/credit totals) must not hide actual lines.
        untaggedLines: Array.from({ length: count }, (_, index) => ({
          lineId: `line-${index}`,
          entryId: `entry-${index}`,
          entryDate: "2025-06-15",
          reference: index === 0 ? null : `TEM-${index}`,
          entryDescription: `Temeljnica ${index}`,
          description: `Vrstica ${index}`,
          accountCode: "400",
          accountName: "Stroški",
          side: index % 2 === 0 ? "debit" : "credit",
          amount: "125.50",
        })),
      },
      isLoading: false,
      error: null,
    });
  }

  it("shows at most 20 lines initially, expands all and collapses again", () => {
    showUntagged(21);
    render(<PorocilaAnalitika />);
    const table = screen.getByRole("table", { name: "Knjižbe brez dimenzije" });
    expect(within(table).getAllByRole("row")).toHaveLength(21); // header + 20
    expect(screen.queryByText("Vrstica 20")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži vse" }));
    expect(within(table).getAllByRole("row")).toHaveLength(22);
    expect(screen.getByText("Vrstica 20")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži manj" }));
    expect(within(table).getAllByRole("row")).toHaveLength(21);
  });

  it("shows dates, account, separate debit/credit and direct journal links even for zero totals", () => {
    showUntagged(2);
    render(<PorocilaAnalitika />);
    const table = screen.getByRole("table", { name: "Knjižbe brez dimenzije" });
    const rows = within(table).getAllByRole("row");
    expect(within(rows[1]).getByText("15.06.2025")).toBeTruthy();
    expect(within(rows[1]).getByText("400 — Stroški")).toBeTruthy();
    expect(within(rows[1]).getAllByRole("cell").slice(-2).map(cell => cell.textContent)).toEqual(["125,50", "—"]);
    expect(within(rows[2]).getAllByRole("cell").slice(-2).map(cell => cell.textContent)).toEqual(["—", "125,50"]);
    expect(screen.getByRole("link", { name: "Odpri temeljnico Temeljnica 0" }).getAttribute("href")).toBe("/temeljnice?id=entry-0");
    expect(screen.getByRole("link", { name: "Odpri temeljnico TEM-1" }).getAttribute("href")).toBe("/temeljnice?id=entry-1");
    expect(screen.queryByRole("button", { name: "Prikaži vse" })).toBeNull();
  });

  it("resets expansion when the report dimension changes", () => {
    showUntagged(21);
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži vse" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "department" } });
    expect(screen.queryByText("Vrstica 20")).toBeNull();
    expect(screen.getByRole("button", { name: "Prikaži vse" })).toBeTruthy();
  });

  it("does not show a warning for an empty untagged list", () => {
    showUntagged(0);
    render(<PorocilaAnalitika />);
    expect(screen.queryByRole("table", { name: "Knjižbe brez dimenzije" })).toBeNull();
    expect(screen.queryByText(/Poročilo ni popolno/)).toBeNull();
  });
});

describe("dimension report URL filters", () => {
  const invalidLinks = [
    ["dateFrom=2025-02-29", "datum »2025-02-29« ne obstaja"],
    ["dateTo=2025-04-31", "datum »2025-04-31« ne obstaja"],
    ["dateFrom=2025-13-01", "datum »2025-13-01« ne obstaja"],
    ["dateFrom=0000-01-01", "datum »0000-01-01« ne obstaja"],
    ["dateFrom=2025-1-01", "ni v obliki LLLL-MM-DD"],
    ["dateTo=31.01.2025", "ni v obliki LLLL-MM-DD"],
    ["dateFrom=2025-01-01T00%3A00%3A00Z", "ni v obliki LLLL-MM-DD"],
    ["dateFrom=2025-12-31&dateTo=2025-01-01", "je po datumu"],
    ["dimensionType=unknown", "Neznana vrsta dimenzije"],
    ["dimensionType=", "Neznana vrsta dimenzije"],
    ["accountId=deleted-or-foreign", "Konto »deleted-or-foreign« ne obstaja v izbranem podjetju"],
  ];

  it.each(invalidLinks)("blocks invalid URL filters: %s", (query, message) => {
    window.history.replaceState(null, "", `${path}?${query}`);
    // React Query may retain data even while a query is disabled.
    mocks.report.mockReturnValue({ data: reportData, isLoading: true, error: new Error("cached") });
    render(<PorocilaAnalitika />);
    expect(screen.getByRole("alert").textContent).toContain(message);
    expect(lastRequest()[2].query.enabled).toBe(false);
    expect(lastRequest()[1]).toEqual({ groupBy: "account" });
    expect((screen.getByRole("button", { name: "Prikaži poročilo" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByText("Ni knjižb z dimenzijami za izbrane filtre.")).toBeNull();
    expect(screen.queryByTitle("Izvozi v CSV")).toBeNull();
    expect(screen.queryByTitle("Izvozi v Excel")).toBeNull();
    expect(screen.queryByTitle("Natisni")).toBeNull();
    expect(screen.queryByText("Napaka pri nalaganju poročila.")).toBeNull();
  });

  it.each([
    ["", "", undefined, undefined],
    ["", "2024-02-29", undefined, "2024-02-29"],
    ["2024-02-29", "", "2024-02-29", undefined],
    ["2024-02-29", "2024-02-29", "2024-02-29", "2024-02-29"],
  ])("allows empty boundaries and leap days: %s – %s", (from, to, expectedFrom, expectedTo) => {
    window.history.replaceState(null, "", `${path}?dateFrom=${from}&dateTo=${to}`);
    render(<PorocilaAnalitika />);
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(lastRequest()[1].dateFrom).toBe(expectedFrom);
    expect(lastRequest()[1].dateTo).toBe(expectedTo);
  });

  it("keeps an unknown dimension invalid when other filters change, then allows explicit correction", () => {
    window.history.replaceState(null, "", `${path}?dimensionType=unknown&source=mail`);
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Tekoče leto" }));
    expect(new URLSearchParams(window.location.search).get("dimensionType")).toBe("unknown");
    expect(lastRequest()[2].query.enabled).toBe(false);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "department" } });
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(lastRequest()[1].dimensionType).toBe("department");
    expect(new URLSearchParams(window.location.search).get("source")).toBe("mail");
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
  });

  it("waits for the company's accounts and blocks cached results when the account is stale", () => {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    mocks.accounts.mockReturnValue({ data: undefined });
    mocks.report.mockReturnValue({ data: reportData, isLoading: false, error: null });
    const page = render(<PorocilaAnalitika />);
    expect(screen.getByRole("alert").textContent).toContain("Preverjanje konta »acc-1« še poteka");
    expect(lastRequest()[2].query.enabled).toBe(false);
    expect(screen.queryByTitle("Izvozi v CSV")).toBeNull();
    mocks.accounts.mockReturnValue({ data: { accounts: [] } });
    page.rerender(<PorocilaAnalitika />);
    expect(screen.getByRole("alert").textContent).toContain("Konto »acc-1« ne obstaja");
    expect(lastRequest()[2].query.enabled).toBe(false);
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "_all" } });
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(lastRequest()[1].accountId).toBeUndefined();
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
  });

  it("does not trust failed or placeholder account lists", () => {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    const accounts = { accounts: [{ id: "acc-1", code: "400", name: "Stroški" }] };
    mocks.accounts.mockReturnValue({ data: accounts, isPlaceholderData: true });
    const page = render(<PorocilaAnalitika />);
    expect(lastRequest()[2].query.enabled).toBe(false);
    mocks.accounts.mockReturnValue({ data: accounts, error: new Error("offline") });
    page.rerender(<PorocilaAnalitika />);
    expect(screen.getByRole("alert").textContent).toContain("nalaganje kontov ni uspelo");
    expect(lastRequest()[2].query.enabled).toBe(false);
    mocks.accounts.mockReturnValue({ data: accounts });
    page.rerender(<PorocilaAnalitika />);
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(mocks.accounts.mock.calls.at(-1)![1]).toEqual({ includeInactive: true });
  });

  it.each([
    ["dateFrom=2025-02-30&dateTo=2025-12-31", "dateFrom", "2025-02-28"],
    ["dateFrom=bad&dateTo=", "dateFrom", ""],
    ["dateFrom=2025-12-31&dateTo=2025-01-01", "dateTo", "2025-12-31"],
    ["dimensionType=unknown&dateFrom=&dateTo=", "dimensionType", "project"],
    ["accountId=deleted&dateFrom=&dateTo=", "accountId", "acc-1"],
  ])("restores invalid and valid views with Back/Forward: %s", async (query, key, value) => {
    window.history.replaceState(null, "", `${path}?${query}`);
    render(<PorocilaAnalitika />);
    if (key === "dimensionType") {
      fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value } });
    } else if (key === "accountId") {
      fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value } });
    } else {
      // A native date control sanitizes invalid strings to blank; select a real
      // date first so clearing it emits an actual change.
      const input = screen.getByLabelText(key === "dateFrom" ? "Obdobje od" : "Obdobje do");
      if (!value) fireEvent.change(input, { target: { value: "2025-01-01" } });
      fireEvent.change(input, { target: { value } });
    }
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
    await act(async () => { window.history.go(value ? -1 : -2); });
    await waitFor(() => expect(screen.getByText("Neveljavni filtri poročila")).toBeTruthy());
    expect(lastRequest()[2].query.enabled).toBe(false);
    expect(screen.queryByText("Ni knjižb z dimenzijami za izbrane filtre.")).toBeNull();
    await act(async () => { window.history.go(value ? 1 : 2); });
    await waitFor(() => expect(lastRequest()[2].query.enabled).toBe(true));
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
    expect(new URLSearchParams(window.location.search).get(key)).toBe(value);
    expect(screen.getByText("Ni knjižb z dimenzijami za izbrane filtre.")).toBeTruthy();
  });

  it("automatically generates a shared view and restores controls on reload", () => {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    const page = render(<PorocilaAnalitika />);
    expect(lastRequest()).toEqual([
      "company-1",
      { dimensionType: "project", dateFrom: "2025-01-01", dateTo: "2025-12-31", accountId: "acc-1", groupBy: "account" },
      { query: { enabled: true } },
    ]);
    expect((screen.getAllByRole("combobox")[0] as HTMLSelectElement).value).toBe("project");
    expect((screen.getAllByRole("combobox")[1] as HTMLSelectElement).value).toBe("acc-1");
    expect(page.container.querySelectorAll("input")[0].value).toBe("2025-01-01");
    page.unmount();
    render(<PorocilaAnalitika />);
    expect(lastRequest()[1].accountId).toBe("acc-1");
    expect(screen.getByText("Ni knjižb z dimenzijami za izbrane filtre.")).toBeTruthy();
  });

  it("writes all four filters, preserves other parameters and supports clearing optional filters", () => {
    window.history.replaceState(null, "", `${path}?source=slack`);
    const page = render(<PorocilaAnalitika />);
    expect(lastRequest()[2].query.enabled).toBe(false);
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "department" } });
    fireEvent.change(page.container.querySelectorAll("input")[0], { target: { value: "2024-02-01" } });
    fireEvent.change(page.container.querySelectorAll("input")[1], { target: { value: "2024-02-29" } });
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "acc-1" } });
    const params = new URLSearchParams(window.location.search);
    expect(Object.fromEntries(params)).toEqual({
      source: "slack", companyId: "company-1", dimensionType: "department", dateFrom: "2024-02-01", dateTo: "2024-02-29", accountId: "acc-1",
    });
    expect(lastRequest()[1].accountId).toBe("acc-1");
    fireEvent.change(screen.getAllByRole("combobox")[1], { target: { value: "_all" } });
    fireEvent.change(page.container.querySelectorAll("input")[0], { target: { value: "" } });
    expect(new URLSearchParams(window.location.search).get("dateFrom")).toBe("");
    expect(lastRequest()[1].dateFrom).toBeUndefined();
    expect(lastRequest()[1].accountId).toBeUndefined();
  });

  it("restores both report and controls with real browser back/forward navigation", async () => {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    const page = render(<PorocilaAnalitika />);
    const historyLength = window.history.length;
    fireEvent.click(screen.getByRole("button", { name: "Tekoče leto" }));
    expect(window.history.length).toBe(historyLength + 1);
    const currentYear = new Date().getFullYear();
    expect(lastRequest()[1].dateFrom).toBe(`${currentYear}-01-01`);
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(lastRequest()[1].dateFrom).toBe("2025-01-01"));
    expect(page.container.querySelectorAll("input")[0].value).toBe("2025-01-01");
    expect(lastRequest()[1].accountId).toBe("acc-1");
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(lastRequest()[1].dateFrom).toBe(`${currentYear}-01-01`));
    expect(page.container.querySelectorAll("input")[1].value).toBe(`${currentYear}-12-31`);
  });

  it("starts the default report on request and returns to the unqueried initial view with Back", async () => {
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    expect(lastRequest()[2].query.enabled).toBe(true);
    expect(new URLSearchParams(window.location.search).get("dimensionType")).toBe("costCenter");
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(lastRequest()[2].query.enabled).toBe(false));
  });

  it("handles partial links and never queries without an active company", () => {
    window.history.replaceState(null, "", `${path}?dimensionType=project`);
    mocks.companyId = "";
    const page = render(<PorocilaAnalitika />);
    expect(lastRequest()[1].dimensionType).toBe("project");
    expect(lastRequest()[1].dateFrom).toBe(`${new Date().getFullYear()}-01-01`);
    expect(lastRequest()[2].query.enabled).toBe(false);
    mocks.companyId = "company-2";
    page.rerender(<PorocilaAnalitika />);
    expect(lastRequest()[0]).toBe("company-2");
    expect(lastRequest()[2].query.enabled).toBe(true);
  });
});

describe("shared report company boundary", () => {
  beforeEach(() => {
    window.history.replaceState(null, "", `${path}?${firstView}&companyId=company-1`);
  });

  it("blocks all report hooks until an explicit switch, preserving the shared filters", () => {
    mocks.companyId = "company-2";
    mocks.access.company = { id: "company-1", naziv: "Ciljno podjetje" };
    const page = render(<PorocilaAnalitika />);
    expect(screen.getByText("Ciljno podjetje")).toBeTruthy();
    expect(screen.getByText(/Trenutno je izbrano podjetje/)).toBeTruthy();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(mocks.setCompany).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Preklopi na Ciljno podjetje" }));
    expect(mocks.setCompany).toHaveBeenCalledWith(mocks.access.company);
    mocks.companyId = "company-1";
    page.rerender(<PorocilaAnalitika />);
    expect(lastRequest()[0]).toBe("company-1");
    expect(lastRequest()[1].accountId).toBe("acc-1");
    expect(new URLSearchParams(window.location.search).get("dateFrom")).toBe("2025-01-01");
    // A later global switch must not silently run these filters for a new tenant.
    mocks.companyId = "company-2";
    mocks.report.mockClear();
    page.rerender(<PorocilaAnalitika />);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.queryByTitle("Izvozi v CSV")).toBeNull();
  });

  it("checks access even for the currently selected company and hides cached data", () => {
    mocks.access.company = null;
    mocks.report.mockReturnValue({ data: reportData });
    render(<PorocilaAnalitika />);
    expect(screen.getByText("Ni dostopa do poročila")).toBeTruthy();
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Preklopi/ })).toBeNull();
    expect(screen.queryByTitle("Izvozi v CSV")).toBeNull();
    expect(screen.queryByText(/Debet skupaj/)).toBeNull();
  });

  it("fails closed during access loading and errors, with a retry action", () => {
    mocks.access.checking = true;
    const page = render(<PorocilaAnalitika />);
    expect(screen.getByText("Preverjanje dostopa do podjetja …")).toBeTruthy();
    expect(mocks.report).not.toHaveBeenCalled();
    mocks.access.checking = false;
    mocks.access.failed = true;
    page.rerender(<PorocilaAnalitika />);
    expect(screen.getByText("Dostopa ni mogoče preveriti")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(mocks.access.retry).toHaveBeenCalled();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("requires a switch when no company is selected", () => {
    mocks.companyId = "";
    render(<PorocilaAnalitika />);
    expect(screen.getByRole("button", { name: "Preklopi na Podjetje" })).toBeTruthy();
    expect(mocks.report).not.toHaveBeenCalled();
  });

  it("restores the company boundary on browser Back without querying another company", async () => {
    const page = render(<PorocilaAnalitika />);
    expect(lastRequest()[0]).toBe("company-1");
    act(() => { window.history.pushState(null, "", `${path}?${firstView}&companyId=company-2`); });
    mocks.access.company = { id: "company-2", naziv: "Drugo podjetje" };
    mocks.report.mockClear();
    page.rerender(<PorocilaAnalitika />);
    expect(mocks.report).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Preklopi na Drugo podjetje" })).toBeTruthy();
    mocks.access.company = { id: "company-1", naziv: "Podjetje" };
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(lastRequest()[0]).toBe("company-1"));
  });
});

describe("dimension report expansion", () => {
  const rows = [
    {
      id: "dim-1", code: "SM1", name: "Prva dimenzija",
      totalDebit: "10", totalCredit: "0", balance: "10",
      accounts: [
        { accountId: "acc-1", code: "400", name: "Prvi konto", totalDebit: "6", totalCredit: "0", balance: "6" },
        { accountId: "acc-2", code: "401", name: "Drugi konto", totalDebit: "4", totalCredit: "0", balance: "4" },
      ],
    },
    {
      id: "dim-2", code: "SM2", name: "Druga dimenzija",
      totalDebit: "20", totalCredit: "0", balance: "20",
      accounts: [
        { accountId: "acc-3", code: "402", name: "Tretji konto", totalDebit: "20", totalCredit: "0", balance: "20" },
      ],
    },
    {
      id: "dim-3", code: "SM3", name: "Brez kontov",
      totalDebit: "0", totalCredit: "0", balance: "0", accounts: [],
    },
  ];

  beforeEach(() => {
    window.history.replaceState(null, "", `${path}?${firstView}`);
    mocks.report.mockReturnValue({ data: { ...reportData, rows }, isLoading: false, error: null });
  });

  it("expands and collapses every account with one click, ignoring rows without accounts", () => {
    render(<PorocilaAnalitika />);
    expect(screen.queryByText("Prvi konto")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Razširi vse" }));
    for (const name of ["Prvi konto", "Drugi konto", "Tretji konto"]) {
      expect(screen.getByText(name)).toBeTruthy();
    }
    expect(screen.getByRole("button", { name: "Strni vse" }).getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Strni vse" }));
    for (const name of ["Prvi konto", "Drugi konto", "Tretji konto"]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(screen.getByRole("button", { name: "Razširi vse" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("keeps the toggle in sync with individual row changes and expands a partial selection", () => {
    render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByText("Prva dimenzija"));
    expect(screen.getByText("Prvi konto")).toBeTruthy();
    expect(screen.queryByText("Tretji konto")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Razširi vse" }));
    fireEvent.click(screen.getByText("Prva dimenzija"));
    expect(screen.queryByText("Prvi konto")).toBeNull();
    expect(screen.getByText("Tretji konto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Razširi vse" })).toBeTruthy();
    fireEvent.click(screen.getByText("Prva dimenzija"));
    expect(screen.getByRole("button", { name: "Strni vse" })).toBeTruthy();
  });

  it.each([
    ["Enter", "{Enter}"],
    ["Space", " "],
  ])("opens and closes an individual dimension using %s", async (_name, key) => {
    const user = userEvent.setup();
    render(<PorocilaAnalitika />);
    const button = screen.getByRole("button", { name: "Razširi dimenzijo SM1 – Prva dimenzija" });
    // Reach the control using Tab rather than assigning focus programmatically.
    for (let step = 0; step < 40 && document.activeElement !== button; step++) {
      await user.tab();
    }
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    await user.keyboard(key);
    expect(button.getAttribute("aria-expanded")).toBe("true");
    expect(button.getAttribute("aria-label")).toBe("Strni dimenzijo SM1 – Prva dimenzija");
    expect(screen.getByText("Prvi konto")).toBeTruthy();
    expect(screen.queryByText("Tretji konto")).toBeNull();
    expect(screen.getByRole("button", { name: "Razširi vse" }).getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button);
    await user.keyboard(key);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Prvi konto")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("toggles only once on button clicks and keeps individual controls in sync with the group", async () => {
    const user = userEvent.setup();
    render(<PorocilaAnalitika />);
    const first = screen.getByRole("button", { name: "Razširi dimenzijo SM1 – Prva dimenzija" });
    const second = screen.getByRole("button", { name: "Razširi dimenzijo SM2 – Druga dimenzija" });
    expect(screen.queryByRole("button", { name: /dimenzijo SM3/ })).toBeNull();
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("true");
    await user.click(second);
    expect(second.getAttribute("aria-expanded")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Strni vse" }));
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("false");
    await user.click(screen.getByRole("button", { name: "Razširi vse" }));
    expect(first.getAttribute("aria-expanded")).toBe("true");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    await user.click(first);
    expect(first.getAttribute("aria-expanded")).toBe("false");
    expect(second.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByRole("button", { name: "Razširi vse" })).toBeTruthy();
  });

  it("preserves expansion through rerenders and filter changes until the report is generated again", () => {
    const page = render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Razširi vse" }));
    page.rerender(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Tekoče leto" }));
    expect(screen.getByText("Prvi konto")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Strni vse" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    expect(screen.queryByText("Prvi konto")).toBeNull();
    expect(screen.getByRole("button", { name: "Razširi vse" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Razširi vse" }));
    fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
    expect(screen.queryByText("Tretji konto")).toBeNull();
  });

  it("clears expansion when switching companies", () => {
    const page = render(<PorocilaAnalitika />);
    fireEvent.click(screen.getByRole("button", { name: "Razširi vse" }));
    mocks.companyId = "company-2";
    page.rerender(<PorocilaAnalitika />);
    expect(screen.queryByText("Prvi konto")).toBeNull();
    expect(screen.getByRole("button", { name: "Razširi vse" })).toBeTruthy();
  });

  it("does not offer expansion for empty reports or rows with no account breakdown", () => {
    mocks.report.mockReturnValue({ data: reportData, isLoading: false, error: null });
    const page = render(<PorocilaAnalitika />);
    expect(screen.queryByRole("button", { name: "Razširi vse" })).toBeNull();
    mocks.report.mockReturnValue({
      data: { ...reportData, rows: [rows[2], { ...rows[2], id: "dim-4", accounts: undefined }] },
      isLoading: false, error: null,
    });
    page.rerender(<PorocilaAnalitika />);
    expect(screen.queryByRole("button", { name: "Razširi vse" })).toBeNull();
    expect(within(screen.getByRole("table")).getAllByRole("row")).toHaveLength(3);
  });
});
