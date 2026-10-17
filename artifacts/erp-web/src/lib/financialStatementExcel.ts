import ExcelJS from "exceljs";
import type { BalanceSheetData, IncomeStatementData, ReportSection } from "@workspace/api-client-react";
import { formatDatum } from "./utils";

type Diagnostics = {
  unclassifiedAccounts?: { code: string; name: string; net: number; debit: number; credit: number; reason: string }[];
  typeWarnings?: { code: string; name: string; storedType: string; effectiveType: string }[];
};

export type FinancialStatementExcelOptions = {
  companyName: string;
  period: string;
  comparePeriod?: string;
} & (
  | { reportType: "balance_sheet"; current: BalanceSheetData & Diagnostics; compare?: (BalanceSheetData & Diagnostics) | null }
  | { reportType: "income_statement"; current: IncomeStatementData & Diagnostics; compare?: (IncomeStatementData & Diagnostics) | null }
);

function amount(value: string | number): number {
  const number = Number(value);
  if ((typeof value === "string" && !value.trim()) || !Number.isFinite(number)) {
    throw new Error("Poročilo vsebuje neveljaven znesek.");
  }
  return number;
}

export function financialStatementFilename(options: FinancialStatementExcelOptions) {
  const prefix = options.reportType === "balance_sheet" ? "bilanca-stanja" : "izkaz-poslovnega-izida";
  return `${prefix}-${options.period.replace("_", "-")}.xlsx`;
}

export function buildFinancialStatementWorkbook(options: FinancialStatementExcelOptions) {
  const workbook = new ExcelJS.Workbook();
  const title = options.reportType === "balance_sheet" ? "Bilanca stanja" : "Izkaz poslovnega izida";
  const sheet = workbook.addWorksheet(title);
  const showCompare = !!options.compare;
  sheet.columns = [{ width: 16 }, { width: 64 }, { width: 30 }, ...(showCompare ? [{ width: 30 }] : [])];
  const displayPeriod = (period: string) => period.split("_").map(formatDatum).join(" – ");
  sheet.addRow([options.companyName]).font = { bold: true, size: 14 };
  sheet.addRow([title]).font = { bold: true };
  sheet.addRow([options.reportType === "balance_sheet" ? "Stanje na dan" : "Obdobje", displayPeriod(options.period)]);
  if (showCompare && options.comparePeriod) sheet.addRow(["Primerjava", displayPeriod(options.comparePeriod)]);
  sheet.addRow([]);
  const header = sheet.addRow([
    "Šifra konta", "Naziv konta / razdelek", `${displayPeriod(options.period)} (EUR)`,
    ...(showCompare ? [`${options.comparePeriod ? displayPeriod(options.comparePeriod) : "Primerjava"} (EUR)`] : []),
  ]);
  header.font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: header.number }];

  function valueRow(code: string, label: string, value: string | number, comparison?: string | number, bold = false) {
    const row = sheet.addRow([code, label, amount(value), ...(showCompare ? [comparison == null ? null : amount(comparison)] : [])]);
    if (bold) row.font = { bold: true };
  }

  function side(label: string, current: { sections: ReportSection[]; total: string }, compare?: { sections: ReportSection[]; total: string }) {
    sheet.addRow(["", label]).font = { bold: true };
    for (const section of current.sections) {
      const comparison = compare?.sections.find((s) => s.class === section.class);
      valueRow("", section.label, section.subtotal, comparison?.subtotal, true);
      for (const item of section.items) {
        valueRow(item.accountCode, item.accountName, item.balance, comparison?.items.find((i) => i.accountId === item.accountId)?.balance);
      }
    }
    valueRow("", `SKUPAJ ${label}`, current.total, compare?.total, true);
    sheet.addRow([]);
  }

  if (options.reportType === "balance_sheet") {
    side("AKTIVA", options.current.aktiva, options.compare?.aktiva);
    side("PASIVA", options.current.pasiva, options.compare?.pasiva);
  } else {
    side("PRIHODKI", options.current.revenue, options.compare?.revenue);
    side("ODHODKI", options.current.expenses, options.compare?.expenses);
    valueRow("", "POSLOVNI IZID OBDOBJA", options.current.netResult, options.compare?.netResult, true);
  }

  // Keep exceptional accounts visible in the spreadsheet as well as on screen.
  for (const [data, label] of [[options.current, "Tekoče obdobje"], [options.compare, "Primerjava"]] as const) {
    if (!data) continue;
    if (data.unclassifiedAccounts?.length) {
      sheet.addRow(["", `NERAZVRŠČENO — ${label} (ni vključeno v seštevke)`]).font = { bold: true };
      sheet.addRow(["Šifra konta", "Naziv / razlog", "Breme (EUR)", "Dobro (EUR)", "Neto (EUR)"]);
      for (const account of data.unclassifiedAccounts) {
        const row = sheet.addRow([account.code, `${account.name} — ${account.reason}`, amount(account.debit), amount(account.credit), amount(account.net)]);
        row.getCell(5).numFmt = "#,##0.00";
      }
    }
    if (data.typeWarnings?.length) {
      sheet.addRow(["", `OPOZORILA SRS — ${label}`]).font = { bold: true };
      for (const warning of data.typeWarnings) {
        sheet.addRow([warning.code, `${warning.name}: shranjeni tip ${warning.storedType} → uvrščen kot ${warning.effectiveType}`]);
      }
    }
  }
  sheet.eachRow((row) => {
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    for (const column of [3, 4, 5]) {
      const cell = row.getCell(column);
      if (typeof cell.value === "number") {
        cell.numFmt = "#,##0.00";
        cell.alignment = { horizontal: "right" };
      }
    }
  });
  return workbook;
}

export async function exportFinancialStatementExcel(options: FinancialStatementExcelOptions) {
  const buffer = await buildFinancialStatementWorkbook(options).xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer as unknown as BlobPart], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  }));
  try {
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = financialStatementFilename(options);
    anchor.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
