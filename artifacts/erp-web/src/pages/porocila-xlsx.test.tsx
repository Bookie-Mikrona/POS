import "@testing-library/jest-dom";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ExcelJS from "exceljs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  useGetBalanceSheet: vi.fn(),
  useGetIncomeStatement: vi.fn(),
  useGetTrialBalance: vi.fn(),
  activeCompany: {
    id: "company-xlsx-characterization",
    naziv: "Karakterizacija d.o.o.",
    role: "accountant",
  },
}));

const downloadState = vi.hoisted(() => ({
  blob: null as Blob | null,
  filename: "",
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetBalanceSheet: state.useGetBalanceSheet,
  useGetIncomeStatement: state.useGetIncomeStatement,
  useGetTrialBalance: state.useGetTrialBalance,
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.activeCompany }),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

const praznaPoizvedba = {
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
};

describe("Bruto bilanca – XLSX karakterizacija", () => {
  beforeEach(() => {
    downloadState.blob = null;
    downloadState.filename = "";
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn((blob: Blob) => {
        downloadState.blob = blob;
        return "blob:bruto-bilanca-test";
      }),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function click(this: HTMLAnchorElement) {
      downloadState.filename = this.download;
    });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
  });

  it("iz pravega gumba ustvari berljiv XLSX z glavo, vrsticami, skupno vrstico in številskim formatom", async () => {
    state.useGetBalanceSheet.mockReturnValue(praznaPoizvedba);
    state.useGetIncomeStatement.mockReturnValue(praznaPoizvedba);
    state.useGetTrialBalance.mockReturnValue({
      data: {
        dateFrom: "2026-01-01",
        dateTo: "2026-01-31",
        totalTurnoverDebit: "130.50",
        totalTurnoverCredit: "130.50",
        totalBalanceDebit: "155.50",
        totalBalanceCredit: "155.50",
        rows: [
          {
            accountId: "konto-1",
            accountCode: "1200",
            accountName: "Terjatve do kupcev",
            accountType: "asset",
            openingBalanceDebit: "100.00",
            openingBalanceCredit: "0",
            turnoverDebit: "30.50",
            turnoverCredit: "5",
            balanceDebit: "125.50",
            balanceCredit: "0",
          },
          {
            accountId: "konto-2",
            accountCode: "2200",
            accountName: "Obveznosti do dobaviteljev",
            accountType: "liability",
            openingBalanceDebit: "0",
            openingBalanceCredit: "25",
            turnoverDebit: "0",
            turnoverCredit: "125.50",
            balanceDebit: "0",
            balanceCredit: "155.50",
          },
        ],
      },
      isFetching: false,
      isError: false,
      error: null,
    });

    render(<Porocila />);

    const brutoBilancaTab = screen.getByRole("tab", { name: "Bruto bilanca" });
    fireEvent.mouseDown(brutoBilancaTab, { button: 0, ctrlKey: false });
    fireEvent.click(brutoBilancaTab);
    const prikazi = await screen.findByRole("button", { name: "Prikaži" });
    fireEvent.click(prikazi);
    const izvoziXlsx = await screen.findByRole("button", { name: "Izvozi XLSX" });
    fireEvent.click(izvoziXlsx);

    await waitFor(() => expect(downloadState.blob).not.toBeNull());
    expect(downloadState.filename).toMatch(/^bruto-bilanca-\d{4}-\d{2}-\d{2}-\d{4}-\d{2}-\d{2}\.xlsx$/);

    // ExcelJS writeBuffer gre skozi pravi Blob/download tok. Tukaj preneseno
    // vsebino znova preberemo z ExcelJS, brez SheetJS odvisnosti.
    const roundTrip = new ExcelJS.Workbook();
    await roundTrip.xlsx.load(
      await downloadState.blob!.arrayBuffer() as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
    );
    expect(roundTrip.worksheets.map((worksheet) => worksheet.name)).toEqual(["Bruto bilanca"]);
    const sheet = roundTrip.getWorksheet("Bruto bilanca")!;
    const rowValues = (rowNumber: number) =>
      Array.from(
        { length: 9 },
        (_unused, columnIndex) => sheet.getCell(rowNumber, columnIndex + 1).value ?? "",
      );
    const rows = Array.from({ length: 9 }, (_unused, rowIndex) => rowValues(rowIndex + 1));

    expect(rows[0]).toEqual(["Karakterizacija d.o.o.", "", "", "", "", "", "", "", ""]);
    expect(rows[1]?.[0]).toBe("Bruto bilanca (preizkusna bilanca)");
    expect(rows[2]?.[0]).toMatch(/^Obdobje: \d{4}-\d{2}-\d{2} – \d{4}-\d{2}-\d{2}$/);
    expect(rows[4]).toEqual([
      "Šifra",
      "Naziv konta",
      "Tip",
      "Začetni saldo B",
      "Začetni saldo D",
      "Promet breme",
      "Promet dobro",
      "Saldo breme",
      "Saldo dobro",
    ]);
    expect(rows[5]).toEqual([
      "1200",
      "Terjatve do kupcev",
      "Sredstva",
      100,
      0,
      30.5,
      5,
      125.5,
      0,
    ]);
    expect(rows[6]).toEqual([
      "2200",
      "Obveznosti do dobaviteljev",
      "Obveznosti",
      0,
      25,
      0,
      125.5,
      0,
      155.5,
    ]);
    expect(rows[7]).toEqual(["", "", "", "", "", "", "", "", ""]);
    expect(rows[8]).toEqual(["", "SKUPAJ", "", 100, 25, 30.5, 130.5, 125.5, 155.5]);
    expect(sheet.getCell("D6").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("I9").numFmt).toBe("#,##0.00");
  });
});