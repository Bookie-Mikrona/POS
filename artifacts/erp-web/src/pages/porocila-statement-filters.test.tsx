import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Porocila from "./porocila";

const queries = vi.hoisted(() => ({
  balance: vi.fn(), income: vi.fn(), userId: "user-a", companyId: "company-a",
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: (...args: unknown[]) => { queries.balance(...args); return { data: undefined }; },
  useGetIncomeStatement: (...args: unknown[]) => { queries.income(...args); return { data: undefined }; },
  useGetTrialBalance: () => ({ data: undefined }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: queries.companyId, naziv: "Test", role: "admin" } }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ userId: queries.userId, getToken: async () => "test-token" }),
}));

beforeEach(() => {
  sessionStorage.clear();
  vi.clearAllMocks();
  queries.userId = "user-a";
  queries.companyId = "company-a";
});
afterEach(cleanup);

function tab(name: string) {
  const target = screen.getByRole("tab", { name });
  fireEvent.mouseDown(target, { button: 0, ctrlKey: false });
  fireEvent.click(target);
}
const dates = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[type="date"]'));

describe("saved financial statement selections in report tabs", () => {
  it.each([
    ["Bilanca stanja", "balance"] as const,
    ["Izkaz poslovnega izida", "income"] as const,
  ])("requires a new click after an identity change in %s", (name, report) => {
    const view = render(<Porocila />);
    tab(name);
    fireEvent.change(dates()[0], { target: { value: "2024-02-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Prikaži/ }));
    expect(queries[report].mock.lastCall?.[2].query.enabled).toBe(true);

    queries.companyId = "company-b";
    const beforeSwitch = queries[report].mock.calls.length;
    view.rerender(<Porocila />);
    expect(dates()[0].value).not.toBe("2024-02-01");
    expect(queries[report].mock.calls.slice(beforeSwitch).every((call) => !call[2].query.enabled)).toBe(true);
    expect(screen.queryByRole("button", { name: /PDF|e-pošt/i })).not.toBeInTheDocument();
    fireEvent.change(dates()[0], { target: { value: "2023-03-01" } });
    fireEvent.click(screen.getByRole("button", { name: /Prikaži/ }));
    expect(queries[report].mock.lastCall?.[2].query.enabled).toBe(true);

    queries.userId = "user-b";
    const beforeUserSwitch = queries[report].mock.calls.length;
    view.rerender(<Porocila />);
    expect(dates()[0].value).not.toBe("2023-03-01");
    expect(queries[report].mock.calls.slice(beforeUserSwitch).every((call) => !call[2].query.enabled)).toBe(true);

    queries.userId = "user-a";
    queries.companyId = "company-a";
    view.rerender(<Porocila />);
    expect(dates()[0].value).toBe("2024-02-01");
    expect(queries[report].mock.lastCall?.[2].query.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Prikaži/ }));
    expect(queries[report].mock.lastCall?.[1]).toMatchObject(
      report === "balance" ? { asOf: "2024-02-01" } : { dateFrom: "2024-02-01" },
    );
    expect(queries[report].mock.lastCall?.[2].query.enabled).toBe(true);
  });

  it("restores both reports on real tab switches without automatically generating them", () => {
    render(<Porocila />);
    tab("Bilanca stanja");
    fireEvent.change(dates()[0], { target: { value: "2024-09-30" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(dates()[1], { target: { value: "2023-09-30" } });

    tab("Izkaz poslovnega izida");
    fireEvent.change(dates()[0], { target: { value: "2024-02-01" } });
    fireEvent.change(dates()[1], { target: { value: "2024-08-31" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.change(dates()[2], { target: { value: "2023-02-01" } });
    fireEvent.change(dates()[3], { target: { value: "2023-08-31" } });

    tab("Bilanca stanja");
    expect(dates().map((input) => input.value)).toEqual(["2024-09-30", "2023-09-30"]);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(queries.balance.mock.lastCall?.[2].query.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Prikaži/ }));
    expect(queries.balance.mock.lastCall).toMatchObject([
      "company-a", { asOf: "2024-09-30", compareAsOf: "2023-09-30" }, { query: { enabled: true } },
    ]);

    tab("Izkaz poslovnega izida");
    expect(dates().map((input) => input.value)).toEqual([
      "2024-02-01", "2024-08-31", "2023-02-01", "2023-08-31",
    ]);
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(queries.income.mock.lastCall?.[2].query.enabled).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /Prikaži/ }));
    expect(queries.income.mock.lastCall).toMatchObject([
      "company-a",
      { dateFrom: "2024-02-01", dateTo: "2024-08-31", compareDateFrom: "2023-02-01", compareDateTo: "2023-08-31" },
      { query: { enabled: true } },
    ]);
  });
});
