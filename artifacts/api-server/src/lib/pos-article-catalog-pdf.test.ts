import { execFileSync, spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildArticleCatalogPdf,
  selectArticleCatalogScope,
  type ArticleCatalogRow,
} from "./pos-article-catalog-pdf";

const hasPdfToText = spawnSync("pdftotext", ["-v"], { encoding: "utf8" }).status === 0;

const rows: ArticleCatalogRow[] = [
  { id: 1, name: "Kava", active: true, category: "Pijače", unit: "kos", articleType: "storitev", salesOnly: true, price: 2.5 },
  { id: 2, name: "Moka", active: false, category: "Sestavine", unit: "kg", articleType: "material", purchaseOnly: true },
  // Accounting type and meal preparation classification are not the semi-finished marker.
  { id: 3, name: "Testo", active: true, category: null, unit: "kg", articleType: null, purchaseOnly: false, salesOnly: false },
  { id: 4, name: "Kozarec", active: true, category: "Inventar", unit: "kos", articleType: "material", purchaseOnly: true, smallEquipment: true, stockQuantity: 12 },
  { id: 5, name: "Steklenica", active: false, category: "Embalaža", unit: "kos", articleType: "blago", returnablePackaging: true, packagingType: "steklenica", depositValue: 0.1 },
  { id: 6, name: "Dodatni polizdelek", active: true, category: null, unit: "kg", articleType: "storitev", purchaseOnly: false, salesOnly: false, returnablePackaging: false },
];

describe("POS article catalog PDF", () => {
  it("selects catalogs by business flags, independently of accounting type", () => {
    expect(selectArticleCatalogScope(rows, "nabavni").map(row => row.id)).toEqual([2]);
    expect(selectArticleCatalogScope(rows, "prodajni").map(row => row.id)).toEqual([1]);
    expect(selectArticleCatalogScope(rows, "polizdelki").map(row => row.id)).toEqual([3, 6]);
    expect(selectArticleCatalogScope(rows, "drobni").map(row => row.id)).toEqual([4]);
    expect(selectArticleCatalogScope(rows, "embalaza").map(row => row.id)).toEqual([5]);
  });

  it.skipIf(!hasPdfToText)("prints complete recipes, inactive status, and page counts across multiple pages", async () => {
    const articles: ArticleCatalogRow[] = Array.from({ length: 68 }, (_, index) => ({
      id: index + 100,
      name: `Jed ${String(index).padStart(3, "0")}`,
      active: index !== 0,
      category: index < 34 ? "Hrana" : "Pijača",
      unit: "porcija",
      articleType: "storitev",
      salesOnly: true,
      price: 8.5,
      taxRate: 9.5,
      preparationType: index % 2 === 0 ? "hrana" : "pijača",
      preparationMinutes: 4,
      ingredients: index === 1
        ? [{ name: "Sestavina z dolgim imenom", quantity: 0.25, unit: "kg" }]
        : [],
    }));
    const pdf = await buildArticleCatalogPdf({
      scope: "prodajni",
      unitName: "Enota Šiška",
      generatedAt: new Date("2025-06-17T12:00:00.000Z"),
      articles,
    });
    const extracted = execFileSync("pdftotext", ["-layout", "-", "-"], { input: pdf, encoding: "utf8" });
    const pages = extracted.split("\f").map(page => page.trim()).filter(Boolean);

    expect(pages.length).toBeGreaterThan(1);
    expect(pages).toHaveLength((extracted.match(/Stran \d+ \/ \d+/g) ?? []).length);
    expect(extracted).toContain("KATALOG PRODAJNIH ARTIKLOV");
    expect(extracted).toContain("NEAKTIVEN");
    expect(extracted).toContain("Sestavina z dolgim imenom");
    expect(extracted).toContain("Normativ: ni vnesen.");
    expect(extracted).toContain("Hrana");
    expect(extracted).toContain("Pijača");
    expect(extracted).toContain("Enota mere:");
    expect(extracted).toContain("Kategorija:");
    expect(extracted).toContain("Vrsta artikla:");
    expect(articles.every(article => extracted.includes(article.name))).toBe(true);
    pages.forEach((page, index) => expect(page).toContain(`Stran ${index + 1} / ${pages.length}`));
  });

  it.skipIf(!hasPdfToText)("includes inventory quantity and packaging properties without supplier balances", async () => {
    const small = await buildArticleCatalogPdf({
      scope: "drobni",
      unitName: "Enota",
      generatedAt: new Date("2025-06-17T12:00:00.000Z"),
      articles: rows,
    });
    const packaging = await buildArticleCatalogPdf({
      scope: "embalaza",
      unitName: "Enota",
      generatedAt: new Date("2025-06-17T12:00:00.000Z"),
      articles: rows,
    });
    const smallText = execFileSync("pdftotext", ["-", "-"], { input: small, encoding: "utf8" });
    const packagingText = execFileSync("pdftotext", ["-", "-"], { input: packaging, encoding: "utf8" });
    expect(smallText).toContain("Stanje zaloge: 12");
    expect(packagingText).toContain("Vrsta embalaže: steklenica");
    expect(packagingText).toContain("Depozitna vrednost: 0,10 €");
    expect(packagingText).not.toContain("dobavitelj");
  });
});