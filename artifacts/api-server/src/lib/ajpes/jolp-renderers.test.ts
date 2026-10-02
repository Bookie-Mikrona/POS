import { execFileSync, spawnSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import {
  generateJolpPdf,
  generateJolpXlsx,
  type JolpRenderInput,
} from "./jolp-renderers.js";

const TEMPLATE_PATH = path.join(
  import.meta.dirname,
  "..",
  "..",
  "assets",
  "ajpes",
  "jolp-template.xlsx",
);

async function fixtureReport(
  companyName = "Primer podjetje d.o.o.",
): Promise<JolpRenderInput> {
  const template = new ExcelJS.Workbook();
  await template.xlsx.readFile(TEMPLATE_PATH);
  const rows = (sheetName: string) => {
    const sheet = template.getWorksheet(sheetName)!;
    return Array.from({ length: sheet.rowCount - 13 }, (_, index) => {
      const cell = sheet.getCell(index + 14, 1);
      return {
        code: String(index + 1).padStart(3, "0"),
        label: String(cell.value),
        bold: Boolean(cell.font?.bold),
        current: index === 0 ? 0 : index === 1 ? -12345.67 : index + 0.125,
        previous: index === 0 ? 0 : index === 1 ? 9876.54 : index + 10.875,
      };
    });
  };

  return {
    year: 2026,
    company: {
      name: companyName,
      street: "Dolg naslov ulice 123",
      postalCode: "1000",
      city: "Ljubljana",
      registrationNumber: "01234567",
    },
    balanceSheet: rows("Bilanca stanja"),
    incomeStatement: rows("Izkaz poslovnega izida"),
  };
}

describe("JOLP renderers", () => {
  it("round-trips the exact template structure, labels, years and numeric cells", async () => {
    const report = await fixtureReport();
    const buffer = await generateJolpXlsx(report);
    const result = new ExcelJS.Workbook();
    await result.xlsx.load(
      buffer as unknown as Parameters<typeof result.xlsx.load>[0],
    );

    expect(result.worksheets.map((sheet) => sheet.name)).toEqual([
      "Bilanca stanja",
      "Izkaz poslovnega izida",
    ]);
    expect(result.getWorksheet("Bilanca stanja")!.rowCount).toBe(59);
    expect(result.getWorksheet("Izkaz poslovnega izida")!.rowCount).toBe(56);

    for (const [sheetName, entries] of [
      ["Bilanca stanja", report.balanceSheet],
      ["Izkaz poslovnega izida", report.incomeStatement],
    ] as const) {
      const sheet = result.getWorksheet(sheetName)!;
      expect(sheet.getCell("A5").value).toBe(report.company.name);
      expect(sheet.getCell("A7").value).toBe(report.company.street);
      expect(sheet.getCell("A8").value).toBe("1000 Ljubljana");
      expect(sheet.getCell("A9").value).toBe("Matična številka: 01234567");
      expect(sheet.getCell("B13").value).toBe(2026);
      expect(sheet.getCell("C13").value).toBe(2025);
      for (const [index, entry] of entries.entries()) {
        const rowNumber = index + 14;
        expect(sheet.getCell(rowNumber, 1).value).toBe(entry.label);
        expect(Boolean(sheet.getCell(rowNumber, 1).font?.bold)).toBe(entry.bold);
        expect(sheet.getCell(rowNumber, 2).value).toBe(entry.current);
        expect(sheet.getCell(rowNumber, 3).value).toBe(entry.previous);
        expect(sheet.getCell(rowNumber, 2).numFmt).toBe("#,##0.00");
      }
    }
    expect(result.getWorksheet("Bilanca stanja")!.getImages()).toHaveLength(1);
    expect(result.getWorksheet("Bilanca stanja")!.getCell("B14").value).toBe(0);
    expect(result.getWorksheet("Bilanca stanja")!.getCell("B15").value).toBe(-12345.67);
  });

  it("rejects missing, reordered, or renamed template rows instead of silently shifting data", async () => {
    const report = await fixtureReport();
    await expect(
      generateJolpXlsx({ ...report, balanceSheet: report.balanceSheet.slice(1) }),
    ).rejects.toThrow("Bilanca stanja must contain exactly 46 rows");

    const mismatched = await fixtureReport();
    mismatched.incomeStatement[0] = {
      ...mismatched.incomeStatement[0],
      label: "Incorrect template label",
    };
    await expect(generateJolpXlsx(mismatched)).rejects.toThrow(
      "Izkaz poslovnega izida row 14 label does not match",
    );
  });

  const pdftotextAvailable =
    spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

  it.skipIf(!pdftotextAvailable)(
    "renders all template rows, negative values, both years and page footers in a readable PDF",
    async () => {
      const longCompanyName =
        "Primer podjetje za računovodske, svetovalne, informacijske, tehnične in druge poslovne storitve v Sloveniji d.o.o.";
      const report = await fixtureReport(longCompanyName);
      const pdf = await generateJolpPdf(report);
      const text = execFileSync("pdftotext", ["-layout", "-", "-"], {
        input: pdf,
        encoding: "utf8",
      });
      const normalizedText = text.replace(/\s+/g, " ");
      const labelText = normalizedText
        .replace(/[−-]?\d[\d.]*,\d{2}/g, " ")
        .replace(/\s+/g, " ");
      const pageCount = (pdf.toString("latin1").match(/\/Type\s*\/Page\b/g) ?? []).length;

      expect(pdf.subarray(0, 5).toString("ascii")).toBe("%PDF-");
      expect(normalizedText).toContain(longCompanyName);
      expect(normalizedText).toContain("2026");
      expect(normalizedText).toContain("2025");
      expect(normalizedText).toContain("−12.345,67");
      expect(normalizedText).toContain("0,00");
      for (const entry of [...report.balanceSheet, ...report.incomeStatement]) {
        expect(labelText).toContain(entry.label);
      }
      expect(pageCount).toBeGreaterThanOrEqual(2);
      expect((normalizedText.match(/Stran \d+ \/ \d+/g) ?? []).length).toBe(pageCount);
      expect(normalizedText).toContain(`Stran ${pageCount} / ${pageCount}`);
    },
  );
});