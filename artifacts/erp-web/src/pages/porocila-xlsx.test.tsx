import "@testing-library/jest-dom";

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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

vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

const praznaPoizvedba = {
  data: undefined,
  isLoading: false,
  isFetching: false,
  isError: false,
  error: null,
};

describe("Bruto bilanca – XLSX karakterizacija", () => {
  it("brez začetnega datuma označi začetne salde, ohrani kumulativo v XLSX in obnovi običajni prikaz", async () => {
    state.useGetBalanceSheet.mockReturnValue(praznaPoizvedba);
    state.useGetIncomeStatement.mockReturnValue(praznaPoizvedba);
    state.useGetTrialBalance.mockReturnValue({
      data: { rows: [{
        accountId: "1", accountCode: "1100000", accountName: "Banka", accountType: "asset",
        openingBalanceDebit: "0", openingBalanceCredit: "0",
        turnoverDebit: "123.45", turnoverCredit: "23.45",
        balanceDebit: "123.45", balanceCredit: "23.45",
      }], totalTurnoverDebit: "123.45", totalTurnoverCredit: "23.45" },
      isFetching: false, isError: false, error: null,
    });
    render(<Porocila />);
    const tab = screen.getByRole("tab", { name: "Bilanca kontov / zaključni račun" });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    fireEvent.change(screen.getByLabelText("Datum od"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Prikaži" }));
    expect(screen.getByRole("columnheader", { name: "Ni začetnega datuma" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Kumulativni promet" })).toBeInTheDocument();
    const cells = within(screen.getByText("1100000").closest("tr")!).getAllByRole("cell");
    expect(cells[2]).toHaveTextContent("—");
    expect(cells[3]).toHaveTextContent("—");
    expect(cells[8]).toHaveTextContent("100,00");
    const totals = within(screen.getByText("Skupaj", { selector: "td" }).closest("tr")!).getAllByRole("cell");
    expect(totals[1]).toHaveTextContent("—");
    expect(totals[2]).toHaveTextContent("—");
    fireEvent.click(screen.getByRole("button", { name: "Izvozi XLSX" }));
    await waitFor(() => expect(downloadState.blob).not.toBeNull());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await downloadState.blob!.arrayBuffer() as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
    const sheet = workbook.getWorksheet("Bruto bilanca")!;
    expect(sheet.getCell("A3").value).toContain("Kumulativno od začetka evidence");
    expect(sheet.getCell("D5").value).toBe("Ni začetnega datuma");
    expect(sheet.getCell("D6").value).toBe("—");
    expect(sheet.getCell("E6").value).toBe("—");
    expect(sheet.getCell("D8").value).toBe("—");
    expect(sheet.getCell("F8").value).toBe(123.45);
    expect(sheet.getCell("H8").value).toBe(123.45);
    expect(sheet.getCell("J8").value).toBe(100);
    fireEvent.change(screen.getByLabelText("Datum od"), { target: { value: "2026-01-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Prikaži" }));
    expect(screen.getByRole("columnheader", { name: "Začetni saldo" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Ni začetnega datuma" })).not.toBeInTheDocument();
  });

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

  it.each(["balance-sheet", "income-statement"] as const)(
    "%s: pravi gumb izvozi razdelke, konte, vsote in primerjavo za prikazano obdobje",
    async (reportType) => {
      const section = (balance: string) => ({
        sections: [{
          class: "0", label: "Preizkusni razdelek",
          items: [{ accountId: "a", accountCode: "0010000", accountName: "=Naziv čšž", balance }],
          subtotal: balance,
        }],
        total: balance,
      });
      state.useGetBalanceSheet.mockReturnValue({
        ...praznaPoizvedba,
        data: { current: { aktiva: section("1234.56"), pasiva: section("1234.56") },
          compare: { aktiva: section("1000"), pasiva: section("1000") } },
      });
      state.useGetIncomeStatement.mockReturnValue({
        ...praznaPoizvedba,
        data: { current: { revenue: section("1234.56"), expenses: section("1300"), netResult: "-65.44" },
          compare: { revenue: section("1000"), expenses: section("900"), netResult: "100" } },
      });
      state.useGetTrialBalance.mockReturnValue(praznaPoizvedba);
      const { container } = render(<Porocila />);
      if (reportType === "income-statement") {
        const tab = screen.getByRole("tab", { name: "Izkaz poslovnega izida" });
        fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
        fireEvent.click(tab);
      }
      expect(screen.queryByRole("button", { name: "Izvozi XLSX" })).not.toBeInTheDocument();
      fireEvent.click(screen.getByRole("checkbox"));
      const dates = container.querySelectorAll('input[type="date"]');
      const isBalance = reportType === "balance-sheet";
      const values = isBalance ? ["2026-06-30", "2025-12-31"] : ["2026-01-01", "2026-06-30", "2025-01-01", "2025-06-30"];
      values.forEach((value, i) => fireEvent.change(dates[i], { target: { value } }));
      fireEvent.click(screen.getByRole("button", { name: "Prikaži poročilo" }));
      // Editing a filter does not change the already displayed/exported report.
      fireEvent.change(dates[0], { target: { value: "2024-01-01" } });
      fireEvent.click(screen.getByRole("button", { name: "Izvozi XLSX" }));
      await waitFor(() => expect(downloadState.blob).not.toBeNull());
      expect(downloadState.filename).toBe(isBalance ? "bilanca-stanja-2026-06-30.xlsx" : "izkaz-poslovnega-izida-2026-01-01-2026-06-30.xlsx");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await downloadState.blob!.arrayBuffer() as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0]);
      const sheet = workbook.worksheets[0];
      expect(sheet.name).toBe(isBalance ? "Bilanca stanja" : "Izkaz poslovnega izida");
      expect(sheet.getCell("A1").value).toBe(state.activeCompany.naziv);
      const findRow = (label: string) => {
        let number = 0;
        sheet.eachRow((row) => { if (row.getCell(2).value === label) number = row.number; });
        expect(number).toBeGreaterThan(0);
        return sheet.getRow(number);
      };
      expect(findRow(isBalance ? "AKTIVA" : "PRIHODKI").font.bold).toBe(true);
      expect(findRow("Preizkusni razdelek").font.bold).toBe(true);
      expect(findRow("=Naziv čšž").getCell(1).value).toBe("0010000");
      expect(findRow(isBalance ? "SKUPAJ AKTIVA" : "SKUPAJ PRIHODKI").getCell(3).value).toBe(1234.56);
      const total = findRow(isBalance ? "SKUPAJ PASIVA" : "POSLOVNI IZID OBDOBJA");
      expect(total.getCell(3).value).toBe(isBalance ? 1234.56 : -65.44);
      expect(total.getCell(4).value).toBe(isBalance ? 1000 : 100);
      expect(total.getCell(3).numFmt).toBe("#,##0.00");
      expect(URL.revokeObjectURL).toHaveBeenCalled();
    },
  );

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

    const brutoBilancaTab = screen.getByRole("tab", { name: "Bilanca kontov / zaključni račun" });
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
        { length: 10 },
        (_unused, columnIndex) => sheet.getCell(rowNumber, columnIndex + 1).value ?? "",
      );
    const rows = Array.from({ length: 9 }, (_unused, rowIndex) => rowValues(rowIndex + 1));

    expect(rows[0]).toEqual(["Karakterizacija d.o.o.", "", "", "", "", "", "", "", "", ""]);
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
      "Skupaj breme",
      "Skupaj dobro",
      "Neto saldo (breme − dobro)",
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
      125.5,
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
      -155.5,
    ]);
    expect(rows[7]).toEqual(["", "", "", "", "", "", "", "", "", ""]);
    expect(rows[8]).toEqual(["", "SKUPAJ", "", 100, 25, 30.5, 130.5, 125.5, 155.5, -30]);
    expect(sheet.getCell("D6").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("I9").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("J6").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("J9").numFmt).toBe("#,##0.00");
  });

  it("ohrani bruto zneske in pokaže ločen neto saldo, ničlo ter skupni saldo filtriranih kontov", async () => {
    state.useGetBalanceSheet.mockReturnValue(praznaPoizvedba);
    state.useGetIncomeStatement.mockReturnValue(praznaPoizvedba);
    const makeRow = (id: string, name: string, debit: string, credit: string) => ({
      accountId: id, accountCode: id, accountName: name, accountType: "asset",
      openingBalanceDebit: "0", openingBalanceCredit: "0",
      turnoverDebit: debit, turnoverCredit: credit, balanceDebit: debit, balanceCredit: credit,
    });
    const rows = [
      { ...makeRow("1100000", "Glavni transakcijski račun", "23948.52", "21081.77"),
        openingBalanceDebit: "1410.37", turnoverDebit: "22538.15" },
      makeRow("2200000", "Dobavitelj", "0", "3000.00"),
      makeRow("1200000", "Poravnan konto", "500.00", "500.00"),
    ];
    state.useGetTrialBalance.mockReturnValue({
      data: { dateFrom: "2025-01-01", dateTo: "2025-12-31", rows,
        totalTurnoverDebit: "23038.15", totalTurnoverCredit: "24581.77" },
      isFetching: false, isError: false, error: null,
    });
    render(<Porocila />);
    const tab = screen.getByRole("tab", { name: "Bilanca kontov / zaključni račun" });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    fireEvent.click(await screen.findByRole("button", { name: "Prikaži" }));
    expect(screen.getByRole("columnheader", { name: "Skupaj — breme/dobro" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Neto saldo" })).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Zaključni saldo" })).not.toBeInTheDocument();
    const bankRow = screen.getByText("1100000").closest("tr")!;
    const bankCells = within(bankRow).getAllByRole("cell");
    expect(bankCells).toHaveLength(9);
    expect(bankCells[6].textContent?.replace(/\s/g, "")).toBe("23.948,52");
    expect(bankCells[7].textContent?.replace(/\s/g, "")).toBe("21.081,77");
    expect(bankCells[8].textContent?.replace(/[.\s]/g, "")).toBe("2866,75");
    const creditCells = within(screen.getByText("2200000").closest("tr")!).getAllByRole("cell");
    expect(creditCells[8].textContent?.replace(/[.\s]/g, "").replace(/−/g, "-")).toBe("-3000,00");
    const zeroCells = within(screen.getByText("1200000").closest("tr")!).getAllByRole("cell");
    expect(zeroCells[8]).toHaveTextContent("0,00");
    const totalCells = within(screen.getByText("Skupaj", { selector: "td" }).closest("tr")!).getAllByRole("cell");
    expect(totalCells.at(-1)?.textContent?.replace(/−/g, "-")).toBe("-133,25");

    fireEvent.change(screen.getByPlaceholderText("Šifra ali naziv…"), { target: { value: "1100000" } });
    const filteredTotals = within(screen.getByText("Skupaj", { selector: "td" }).closest("tr")!).getAllByRole("cell");
    expect(filteredTotals.at(-1)?.textContent?.replace(/[.\s]/g, "")).toBe("2866,75");
    fireEvent.click(screen.getByRole("button", { name: "Izvozi XLSX" }));
    await waitFor(() => expect(downloadState.blob).not.toBeNull());
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      await downloadState.blob!.arrayBuffer() as unknown as Parameters<ExcelJS.Workbook["xlsx"]["load"]>[0],
    );
    const sheet = workbook.getWorksheet("Bruto bilanca")!;
    expect(sheet.getCell("H6").value).toBe(23948.52);
    expect(sheet.getCell("I6").value).toBe(21081.77);
    expect(sheet.getCell("J6").value).toBe(2866.75);
    expect(sheet.getCell("J8").value).toBe(2866.75);
    expect(sheet.getCell("J6").numFmt).toBe("#,##0.00");
    expect(rows[0].balanceDebit).toBe("23948.52");
    expect(rows[0].balanceCredit).toBe("21081.77");
  });
});
