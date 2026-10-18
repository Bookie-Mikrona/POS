import ExcelJS from "exceljs";
import type { DimensionReportExcelOptions } from "./dimensionReportExcel";
import { validateDimensionExcelSize } from "./dimensionReportExcelLimits";
import { formatDatum } from "./utils";

function amount(value: string): number {
  const numeric = Number(value);
  if (!value.trim() || !Number.isFinite(numeric)) {
    throw new Error("Poročilo vsebuje neveljaven znesek.");
  }
  return numeric;
}

export function buildDimensionReportWorkbook(options: DimensionReportExcelOptions) {
  validateDimensionExcelSize(options);
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Analitično poročilo");
  sheet.columns = [
    { width: 18 }, { width: 48 }, { width: 20 }, { width: 20 }, { width: 20 },
  ];
  sheet.addRow(["Analitično računovodstvo"]).font = { bold: true, size: 16 };
  sheet.mergeCells("A1:E1");
  sheet.addRow(["Podjetje", options.companyName ?? ""]);
  sheet.addRow(["Dimenzija", options.dimensionLabel]);
  sheet.addRow(["Obdobje", `${formatDatum(options.dateFrom)} – ${formatDatum(options.dateTo)}`]);
  sheet.addRow(["Konto", options.accountLabel ?? "Vsi konti"]);
  sheet.addRow([]);
  const header = sheet.addRow(["Koda", "Naziv", "Debet (EUR)", "Kredit (EUR)", "Saldo (EUR)"]);
  header.eachCell((cell, column) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF334155" } };
    cell.alignment = { horizontal: column >= 3 ? "right" : "left", vertical: "middle" };
  });
  header.height = 24;
  for (const row of options.rows) {
    sheet.addRow([row.code, row.name, amount(row.totalDebit), amount(row.totalCredit), amount(row.balance)]);
  }
  const total = sheet.addRow([
    "SKUPAJ", "", amount(options.grandTotalDebit),
    amount(options.grandTotalCredit), amount(options.grandTotalBalance),
  ]);
  total.eachCell({ includeEmpty: true }, (cell) => {
    cell.font = { bold: true };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE2E8F0" } };
    cell.border = { top: { style: "thin", color: { argb: "FF94A3B8" } } };
  });
  for (let row = header.number + 1; row <= total.number; row++) {
    for (let column = 3; column <= 5; column++) {
      const cell = sheet.getCell(row, column);
      cell.numFmt = "#,##0.00";
      cell.alignment = { horizontal: "right" };
    }
    sheet.getCell(row, 2).alignment = { wrapText: true, vertical: "top" };
  }
  if (options.untagged) {
    sheet.addRow([]);
    const warning = sheet.addRow([
      "OPOZORILO: Knjižbe brez dimenzije niso vključene v poročilo in vsoto SKUPAJ.",
      "",
      amount(options.untagged.debit),
      amount(options.untagged.credit),
      amount(options.untagged.balance),
    ]);
    sheet.mergeCells(warning.number, 1, warning.number, 2);
    warning.height = 45;
    warning.eachCell({ includeEmpty: true }, (cell, column) => {
      cell.font = { bold: true, color: { argb: "FF92400E" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEF3C7" } };
      cell.alignment = { horizontal: column >= 3 ? "right" : "left", vertical: "middle", wrapText: true };
      if (column >= 3) cell.numFmt = "#,##0.00";
    });
  }
  sheet.views = [{ state: "frozen", ySplit: header.number }];
  return workbook;
}
