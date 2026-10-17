import { describe, expect, it } from "vitest";
import { buildFinancialStatementWorkbook, financialStatementFilename, type FinancialStatementExcelOptions } from "./financialStatementExcel";

const empty = { sections: [], total: "0.00" };
const options: FinancialStatementExcelOptions = {
  reportType: "balance_sheet", companyName: "Podjetje", period: "2026-10-17",
  current: { aktiva: empty, pasiva: empty },
};

describe("Finančna poročila XLSX", () => {
  it("izvozi prazno bilanco z ničelnimi vsotami brez primerjave", () => {
    const sheet = buildFinancialStatementWorkbook(options).worksheets[0];
    expect(financialStatementFilename(options)).toBe("bilanca-stanja-2026-10-17.xlsx");
    const totals: unknown[] = [];
    sheet.eachRow((row) => {
      if (String(row.getCell(2).value).startsWith("SKUPAJ")) totals.push(row.getCell(3).value);
      expect(row.getCell(4).value).toBeNull();
    });
    expect(totals).toEqual([0, 0]);
  });

  it("ohrani ničlo in prazno primerjavo ločeno ter številčne seštevke", () => {
    const sheet = buildFinancialStatementWorkbook({
      ...options,
      current: { aktiva: {
        total: "0",
        sections: [{ class: "0", label: "Sredstva", subtotal: "0", items: [
          { accountId: "a", accountCode: "001", accountName: "+Besedilo", balance: "0" },
        ] }],
      }, pasiva: empty },
      compare: { aktiva: empty, pasiva: empty }, comparePeriod: "2025-12-31",
    }).worksheets[0];
    let found = false;
    sheet.eachRow((row) => {
      if (row.getCell(1).value === "001") {
        found = true;
        expect(row.getCell(2).value).toBe("+Besedilo");
        expect(row.getCell(3).value).toBe(0);
        expect(row.getCell(4).value).toBeNull();
      }
    });
    expect(found).toBe(true);
  });

  it.each(["", "NaN", "Infinity", "12x"])("zavrne neveljaven znesek %j", (total) => {
    expect(() => buildFinancialStatementWorkbook({
      ...options, current: { aktiva: { ...empty, total }, pasiva: empty },
    })).toThrow("neveljaven znesek");
  });

  it("ne izpusti nerazvrščenih kontov in opozoril SRS", () => {
    const sheet = buildFinancialStatementWorkbook({
      ...options,
      current: { ...options.current, unclassifiedAccounts: [
        { code: "999", name: "Nerazvrščen", debit: 12, credit: 20, net: -8, reason: "Neznan tip" },
      ], typeWarnings: [{ code: "001", name: "Sredstvo", storedType: "expense", effectiveType: "asset" }] },
    }).worksheets[0];
    const rows: unknown[][] = [];
    sheet.eachRow((row) => rows.push([row.getCell(1).value, row.getCell(2).value, row.getCell(3).value, row.getCell(4).value, row.getCell(5).value]));
    expect(rows).toContainEqual(["999", "Nerazvrščen — Neznan tip", 12, 20, -8]);
    expect(rows.some((row) => String(row[1]).includes("OPOZORILA SRS"))).toBe(true);
  });
});
