import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { BankBalanceReconciliation, moneyCents } from "./bank-balance-reconciliation";
import { BankBalanceCard } from "@/pages/dashboard";

const ledger = vi.hoisted(() => vi.fn());
vi.mock("@workspace/api-client-react", () => ({
  useGetLedger: ledger,
  getGetLedgerQueryKey: (companyId: string, params: unknown) => [companyId, params],
  useGetBankBalanceHistory: () => ({ data: { points: [] }, isLoading: false, isError: false }),
}));
afterEach(cleanup);
beforeEach(() => ledger.mockReturnValue({
  data: { totalDebit: "150.00", totalCredit: "50.00", lines: [] },
  isLoading: false, isError: false, isFetching: false,
}));

const props = { companyId: "company-a", accountId: "bank-a", accountCode: "1100" };
function enter(value: string) {
  fireEvent.change(screen.getByLabelText("Stanje po bančnem izpisku · 1100 (€)"), { target: { value } });
}

describe("primerjava knjiženega salda z izpiskom", () => {
  it("loads the full account totals with only one recent line, scoped to the company", () => {
    render(<BankBalanceReconciliation {...props} />);
    expect(ledger).toHaveBeenCalledWith("company-a", { accountId: "bank-a", recentLimit: 1 }, expect.anything());
    expect(screen.getByText("100,00 €")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each(["100", "100,01", "99.99"])("does not warn for %s (within one cent)", value => {
    render(<BankBalanceReconciliation {...props} />);
    enter(value);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain("Saldo je usklajen");
  });

  it.each([["99,98", "0,02"], ["100.02", "0,02"]])("warns beyond one cent for %s", (value, difference) => {
    render(<BankBalanceReconciliation {...props} />);
    enter(value);
    expect(screen.getByRole("alert").textContent).toContain("Saldo ni usklajen");
    expect(screen.getByRole("alert").textContent).toContain(difference);
    enter("");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("shows the sign of the difference when the statement balance exceeds the books", () => {
    render(<BankBalanceReconciliation {...props} />);
    enter("120");
    const text = screen.getByRole("alert").textContent!.replace(/−/g, "-");
    expect(text).toContain("-20,00");
  });

  it("supports zero and negative statement balances", () => {
    ledger.mockReturnValue({ data: { totalDebit: "0.00", totalCredit: "20.00" }, isLoading: false, isError: false });
    render(<BankBalanceReconciliation {...props} />);
    enter("-20,00");
    expect(screen.getByRole("status")).toBeTruthy();
    enter("0");
    expect(screen.getByRole("alert").textContent).toContain("20,00");
  });

  it.each(["abc", "1,234", "1e2", "NaN"])("rejects invalid input %s without a false mismatch", value => {
    render(<BankBalanceReconciliation {...props} />);
    enter(value);
    expect(screen.getByRole("textbox").getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    { data: undefined, isLoading: true },
    { data: undefined, isError: true },
    { data: { totalDebit: "100.00", totalCredit: "0.00" }, isFetching: true },
  ])("does not compare missing, failed or refreshing data", state => {
    ledger.mockReturnValue(state);
    render(<BankBalanceReconciliation {...props} />);
    enter("50");
    expect(screen.queryByText(/Saldo ni usklajen/)).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("keeps inputs separate for distinct accounts", () => {
    render(<><BankBalanceReconciliation {...props} /><BankBalanceReconciliation {...props} accountId="bank-b" accountCode="1101" /></>);
    enter("50");
    expect(screen.getByLabelText("Stanje po bančnem izpisku · 1101 (€)").getAttribute("value")).toBe("");
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("appears beside each dashboard account and clears the manual comparison on company change", () => {
    const cardProps = {
      companyId: "company-a", totalBalance: "90.00", loading: false,
      accounts: [{
        accountId: "bank-a", accountCode: "1100", accountName: "TRR", balance: "90.00",
        hasStatementBalance: true, evidenceDate: "2026-10-01",
      }],
    };
    const { rerender } = render(<BankBalanceCard {...cardProps} />);
    enter("90");
    expect(screen.getByRole("alert").textContent).toContain("10,00");
    rerender(<BankBalanceCard {...cardProps} companyId="company-b" />);
    expect(screen.getByRole("textbox").getAttribute("value")).toBe("");
    expect(screen.queryByRole("alert")).toBeNull();
  });
});

describe("decimal amounts in integer cents", () => {
  it.each([["0", 0], ["-1,01", -101], ["100.02", 10002], [" 12,3 ", 1230]])("parses %s", (value, expected) => {
    expect(moneyCents(value)).toBe(expected);
  });
  it("rejects amounts outside the safe integer range", () => {
    expect(moneyCents("999999999999999999.99")).toBeNull();
  });
});