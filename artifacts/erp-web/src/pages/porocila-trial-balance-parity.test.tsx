import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExcelJS from "exceljs";
import { afterEach, expect, it, vi } from "vitest";
import fixture from "../../../../tests/fixtures/trial-balance-export.json";
import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  useGetTrialBalance: vi.fn(),
  blob: null as Blob | null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: () => ({ data: undefined }),
  useGetIncomeStatement: () => ({ data: undefined }),
  useGetTrialBalance: state.useGetTrialBalance,
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "trial-parity", naziv: "Preizkus d.o.o.", role: "accountant" } }),
}));
vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  state.blob = null;
});

it("exports the same 150-account opening, turnover and closing values used by the multipage PDF", async () => {
  vi.stubGlobal("URL", {
    createObjectURL: vi.fn((blob: Blob) => {
      state.blob = blob;
      return "blob:trial-parity";
    }),
    revokeObjectURL: vi.fn(),
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  const fields = ["openingBalanceDebit", "openingBalanceCredit", "turnoverDebit",
    "turnoverCredit", "balanceDebit", "balanceCredit"] as const;
  const rows = Array.from({ length: 150 }, (_, index) => ({
    ...fixture.rows[index % 3]!,
    accountId: String(index), accountCode: String(1000000 + index),
  }));
  state.useGetTrialBalance.mockReturnValue({
    data: { rows }, isFetching: false, isError: false, error: null,
  });
  render(<Porocila />);
  const tab = screen.getByRole("tab", { name: "Bilanca kontov / zaključni račun" });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  fireEvent.click(await screen.findByRole("button", { name: "Prikaži" }));
  fireEvent.click(screen.getByRole("button", { name: "Izvozi XLSX" }));
  await waitFor(() => expect(state.blob).not.toBeNull());
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    await state.blob!.arrayBuffer() as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
  );
  const sheet = workbook.getWorksheet("Bruto bilanca")!;
  expect(sheet.rowCount).toBe(157);
  rows.forEach((row, index) => {
    expect(sheet.getCell(index + 6, 1).value).toBe(row.accountCode);
    expect(sheet.getCell(index + 6, 2).value).toBe(row.accountName);
    const amounts = fields.map(field => Number(row[field]));
    amounts.push(Math.round((amounts[4]! - amounts[5]!) * 100) / 100);
    amounts.forEach((amount, column) => {
      const cell = sheet.getCell(index + 6, column + 4);
      expect(cell.value).toBe(amount);
      expect(cell.numFmt).toBe("#,##0.00");
    });
  });
  expect(sheet.getCell(157, 2).value).toBe("SKUPAJ");
  fixture.totals.forEach((total, index) => {
    expect(sheet.getCell(157, index + 4).value).toBeCloseTo(total * 50, 2);
  });
});
