import type { DimensionReportExcelOptions } from "./dimensionReportExcel";

// Conservative budgets for ExcelJS's in-memory XML/ZIP representation, not XLSX file size.
export const MAX_DIMENSION_EXCEL_ROWS = 20_000;
export const MAX_DIMENSION_EXCEL_TEXT = 4_000_000;
export const DIMENSION_EXCEL_LIMIT_MESSAGE =
  "Poročilo je preveliko za varen izvoz v Excel (največ 20.000 vrstic in 4 milijone znakov). Skrajšajte obdobje ali izberite konto.";
export const DIMENSION_EXCEL_FAILURE_MESSAGE =
  "Izvoz v Excel ni uspel. Poskusite znova s krajšim obdobjem ali izbranim kontom.";

export function validateDimensionExcelSize(options: DimensionReportExcelOptions) {
  if (options.rows.length > MAX_DIMENSION_EXCEL_ROWS) {
    throw new Error(DIMENSION_EXCEL_LIMIT_MESSAGE);
  }
  let characters = 0;
  const check = (value: string) => {
    // Excel silently truncates cells exceeding 32,767 UTF-16 code units.
    if (value.length > 32_767) {
      throw new Error("Besedilo v poročilu presega Excelovo omejitev 32.767 znakov na celico. Izvoz ni bil ustvarjen.");
    }
    characters += value.length;
    if (characters > MAX_DIMENSION_EXCEL_TEXT) throw new Error(DIMENSION_EXCEL_LIMIT_MESSAGE);
  };
  for (const value of [
    options.companyName ?? "", options.dimensionLabel, options.accountLabel ?? "",
    options.dateFrom, options.dateTo,
    options.grandTotalDebit, options.grandTotalCredit, options.grandTotalBalance,
  ]) check(value);
  if (options.untagged) {
    for (const value of [options.untagged.debit, options.untagged.credit, options.untagged.balance]) check(value);
  }
  for (const row of options.rows) {
    for (const value of [row.code, row.name, row.totalDebit, row.totalCredit, row.balance]) check(value);
  }
}
