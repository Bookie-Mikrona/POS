import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PorocilaAnalitika from "./porocila-dimenzije";

const mocks = vi.hoisted(() => ({
  report: vi.fn(),
  companyId: "company-1",
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    activeCompany: mocks.companyId ? { id: mocks.companyId, naziv: "Podjetje" } : null,
  }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: [{ id: "acc-1", code: "400", name: "Stroški" }] } }),
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
};

function lastRequest() {
  return mocks.report.mock.calls.at(-1)!;
}

beforeEach(() => {
  window.history.replaceState(null, "", path);
  mocks.companyId = "company-1";
  mocks.report.mockReset();
  mocks.report.mockImplementation((_company, _filters, options) => ({
    data: options.query.enabled ? reportData : undefined,
    isLoading: false,
    error: null,
  }));
});
afterEach(cleanup);

describe("dimension report URL filters", () => {
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
      source: "slack", dimensionType: "department", dateFrom: "2024-02-01", dateTo: "2024-02-29", accountId: "acc-1",
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
