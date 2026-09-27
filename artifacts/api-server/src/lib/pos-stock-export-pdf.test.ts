import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { buildStockExportPdf } from "./pos-stock-export-pdf";

const hasPdfToText = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

describe("buildStockExportPdf", () => {
  it.skipIf(!hasPdfToText)("has the expected printable popis pages, content, and footer count", async () => {
    const rows = [
      { id: 2024, name: "Artikel 9,5 B", unit: "KG", quantity: 4, averageCost: 2.5, totalValue: 10, vatRate: 9.5 },
      { id: 2025, name: "Artikel 5 Ž", unit: "KOS", quantity: 2, averageCost: 0, totalValue: 0, vatRate: 5 },
      ...Array.from({ length: 78 }, (_, order) => {
        const index = 77 - order;
        return {
          id: index + 300,
          name: `Artikel ${String(index).padStart(3, "0")}`,
          unit: "KOS",
          quantity: index + 1,
          averageCost: index === 0 ? null : 1.25,
          totalValue: null,
          vatRate: 22,
        };
      }),
    ];
    const pdf = await buildStockExportPdf({
      kind: "popis",
      scope: "material",
      unitName: "Testna enota",
      generatedAt: new Date("2025-06-17T12:00:00.000Z"),
      includeBookQuantity: true,
      rows,
    });
    const extracted = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, encoding: "utf8" });
    const pages = extracted.split("\f").map(page => page.trim()).filter(Boolean);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages).toHaveLength((extracted.match(/Stran \d+ \/ \d+/g) ?? []).length);
    pages.forEach((page, index) => {
      expect(page).toContain(`Stran ${index + 1} / ${pages.length}`);
      expect(page).toContain("Popis");
      expect(page).toContain("Datum inventure:");
      expect(rows.some(row => page.includes(row.name))).toBe(true);
    });
    expect(extracted).toContain("Natisnjeno:");
    expect(extracted).toContain("Knjižno");
    expect(extracted).toContain("Prešteto");
    expect(extracted).toContain("Nabavna cena");
    expect(extracted).toContain("2024");
    expect(extracted).toContain("2025");
    expect(extracted).toContain("ID");
    expect(extracted).toContain("2,50 €");
    expect(extracted).not.toContain("0,00 €");
    expect(extracted.indexOf("Artikel 5 Ž")).toBeLessThan(extracted.indexOf("Artikel 9,5 B"));
    expect(extracted.indexOf("Artikel 000")).toBeLessThan(extracted.indexOf("Artikel 077"));
    expect(rows.every(row => extracted.includes(row.name))).toBe(true);
    expect(rows.every(row => extracted.includes(String(row.id)))).toBe(true);
  });
});