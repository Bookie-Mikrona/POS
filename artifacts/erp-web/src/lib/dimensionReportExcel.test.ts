import ExcelJS from "exceljs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildDimensionReportWorkbook, exportDimensionReportExcel, type DimensionReportExcelOptions } from "./dimensionReportExcel";

const options: DimensionReportExcelOptions = {
  companyName: "Podjetje d.o.o.",
  dimensionLabel: "Stroškovna mesta",
  dateFrom: "2026-01-01",
  dateTo: "2026-01-31",
  accountLabel: "004000",
  rows: [
    { id: "1", code: "001", name: "Kuhinja čšž", totalDebit: "1234.56", totalCredit: "2000.10", balance: "-765.54" },
    { id: "2", code: "=1+1", name: "+Besedilo", totalDebit: "0", totalCredit: "0", balance: "0" },
  ],
  grandTotalDebit: "1234.56",
  grandTotalCredit: "2000.10",
  grandTotalBalance: "-765.54",
};

describe("Excel analitičnega poročila", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("prenese datoteko s pravilnim imenom in sprosti začasni URL", async () => {
    const createObjectURL = vi.fn((_blob: Blob) => "blob:excel-report");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
    let filename = "";
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      filename = this.download;
      expect(this.href).toBe("blob:excel-report");
    });
    await exportDimensionReportExcel(options);
    expect(filename).toBe("porocilo_dimenzije_Stroškovna_mesta_2026-01-01_2026-01-31.xlsx");
    expect(createObjectURL.mock.calls[0][0]).toBeInstanceOf(Blob);
    expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:excel-report");
  });

  it("ohrani metapodatke, številke, besedilne kode in sloge v pravi .xlsx datoteki", async () => {
    const buffer = await buildDimensionReportWorkbook(options).xlsx.writeBuffer();
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer);
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("A1").value).toBe("Analitično računovodstvo");
    expect(sheet.getCell("B2").value).toBe(options.companyName);
    expect(sheet.getCell("B3").value).toBe(options.dimensionLabel);
    expect(sheet.getCell("B4").value).toBe("01.01.2026 – 31.01.2026");
    expect(sheet.getCell("B5").value).toBe("004000");
    expect(sheet.getCell("A7").value).toBe("Koda");
    expect(sheet.getCell("A7").font.bold).toBe(true);
    expect(sheet.getCell("A7").fill.type).toBe("pattern");
    expect(sheet.getCell("A8").value).toBe("001");
    expect(sheet.getCell("B8").value).toBe("Kuhinja čšž");
    expect(sheet.getCell("C8").value).toBe(1234.56);
    expect(sheet.getCell("D8").value).toBe(2000.1);
    expect(sheet.getCell("E8").value).toBe(-765.54);
    expect(sheet.getCell("C8").numFmt).toBe("#,##0.00");
    expect(sheet.getCell("C8").alignment.horizontal).toBe("right");
    expect(sheet.getCell("A9").value).toBe("=1+1");
    expect(sheet.getCell("B9").value).toBe("+Besedilo");
    expect(sheet.getCell("C9").value).toBe(0);
    expect(sheet.getCell("A10").value).toBe("SKUPAJ");
    for (const column of ["A", "C", "D", "E"]) {
      expect(sheet.getCell(`${column}10`).font.bold).toBe(true);
    }
    expect(sheet.getCell("E10").value).toBe(-765.54);
  });

  it("izvozi tudi prazno poročilo z ničelnimi vsotami", () => {
    const sheet = buildDimensionReportWorkbook({
      ...options, rows: [], accountLabel: undefined,
      grandTotalDebit: "0", grandTotalCredit: "0", grandTotalBalance: "0",
    }).worksheets[0];
    expect(sheet.getCell("B5").value).toBe("Vsi konti");
    expect(sheet.getCell("A8").value).toBe("SKUPAJ");
    expect(sheet.getCell("C8").value).toBe(0);
    expect(sheet.getCell("E8").font.bold).toBe(true);
  });

  it.each([
    { debit: "25.50", credit: "40.75", balance: "-15.25" },
    { debit: "0", credit: "40.75", balance: "-40.75" },
    { debit: "25.50", credit: "0", balance: "25.50" },
    { debit: "25.50", credit: "25.50", balance: "0" },
    { debit: "0", credit: "0", balance: "0" },
  ])("ločeno ohrani opozorilo z zneski %j, ne da bi spremenil glavno tabelo", async (untagged) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildDimensionReportWorkbook({ ...options, untagged }).xlsx.writeBuffer());
    const sheet = workbook.worksheets[0];
    const baseline = buildDimensionReportWorkbook(options).worksheets[0];
    for (let row = 1; row <= baseline.rowCount; row++) {
      expect(sheet.getRow(row).values).toEqual(baseline.getRow(row).values);
    }
    expect(sheet.rowCount).toBe(12);
    expect(sheet.getRow(11).hasValues).toBe(false);
    expect(sheet.getCell("A12").value).toBe(
      "OPOZORILO: Knjižbe brez dimenzije niso vključene v poročilo in vsoto SKUPAJ.",
    );
    expect(sheet.getCell("B12").isMerged).toBe(true);
    for (const [column, value] of [["C", untagged.debit], ["D", untagged.credit], ["E", untagged.balance]]) {
      expect(sheet.getCell(`${column}12`).value).toBe(Number(value));
      expect(sheet.getCell(`${column}12`).type).toBe(ExcelJS.ValueType.Number);
      expect(sheet.getCell(`${column}12`).numFmt).toBe("#,##0.00");
    }
    expect(sheet.getCell("A12").fill).toMatchObject({ fgColor: { argb: "FFFEF3C7" } });
  });

  it("brez neoznačenih knjižb ne doda opozorilne vrstice", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildDimensionReportWorkbook(options).xlsx.writeBuffer());
    expect(workbook.worksheets[0].rowCount).toBe(10);
  });

  it("opozori tudi, če poročilo nima označenih knjižb", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await buildDimensionReportWorkbook({
      ...options, rows: [], grandTotalDebit: "0", grandTotalCredit: "0", grandTotalBalance: "0",
      untagged: { debit: "10", credit: "3", balance: "7" },
    }).xlsx.writeBuffer());
    const sheet = workbook.worksheets[0];
    expect(sheet.getCell("A8").value).toBe("SKUPAJ");
    expect(sheet.getCell("C8").value).toBe(0);
    expect(sheet.getCell("D8").value).toBe(0);
    expect(sheet.getCell("E8").value).toBe(0);
    expect(sheet.getCell("A10").text).toContain("OPOZORILO");
    expect(sheet.getCell("E10").value).toBe(7);
  });

  it.each(["", "NaN", "Infinity", "12x"])("ne pretvori neveljavnega zneska %j v zavajajočo ničlo", (value) => {
    expect(() => buildDimensionReportWorkbook({ ...options, grandTotalDebit: value })).toThrow("neveljaven znesek");
  });
});
