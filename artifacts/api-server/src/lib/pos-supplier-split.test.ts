import { describe, expect, it } from "vitest";
import {
  buildSupplierSplit,
  type SplitArticle,
  type SplitMapping,
  type SplitTerms,
} from "./pos-supplier-split";

function mapping(overrides: Partial<SplitMapping> & Pick<SplitMapping, "id" | "supplierId">): SplitMapping {
  return {
    supplierName: overrides.supplierId.toUpperCase(),
    supplierItemName: null,
    packageName: "pak.",
    packageFactor: 1,
    lastPackagePrice: null,
    lastUnitPrice: null,
    minPackageQuantity: null,
    ...overrides,
  };
}

function article(id: number, needed: number | null, mappings: SplitMapping[], preferred: number | null = null): SplitArticle {
  return {
    articleId: id,
    articleName: `Artikel ${id}`,
    baseUnit: "kg",
    suggestedBaseQuantity: needed,
    preferredMappingId: preferred,
    mappings,
  };
}

const noTerms = new Map<string, SplitTerms>();

describe("buildSupplierSplit", () => {
  it("assigns every article to its cheapest supplier by price per base unit", () => {
    const articles = [
      article(1, 10, [
        mapping({ id: 11, supplierId: "a", packageFactor: 10, lastPackagePrice: 12, lastUnitPrice: 1.2 }),
        mapping({ id: 12, supplierId: "b", packageFactor: 5, lastPackagePrice: 5.5, lastUnitPrice: 1.1 }),
      ]),
      article(2, 3, [mapping({ id: 21, supplierId: "a", lastPackagePrice: 2, lastUnitPrice: 2 })]),
    ];
    const result = buildSupplierSplit(articles, noTerms, "cheapest");
    expect(result.groups.map(group => group.supplierId)).toEqual(["a", "b"]);
    const b = result.groups.find(group => group.supplierId === "b")!;
    expect(b.lines[0]).toMatchObject({ supplierMappingId: 12, packageQuantity: 2, lineTotal: 11 });
    const a = result.groups.find(group => group.supplierId === "a")!;
    expect(a.lines[0]).toMatchObject({ supplierMappingId: 21, packageQuantity: 3, lineTotal: 6 });
    expect(result.unassigned).toEqual([]);
  });

  it("raises the quantity to the supplier minimum and flags it", () => {
    const result = buildSupplierSplit(
      [article(1, 2, [mapping({ id: 11, supplierId: "a", lastPackagePrice: 4, lastUnitPrice: 4, minPackageQuantity: 5 })])],
      noTerms,
      "cheapest",
    );
    expect(result.groups[0]!.lines[0]).toMatchObject({ packageQuantity: 5, moqRaised: true, lineTotal: 20 });
  });

  it("reports a shortfall below the minimum order amount and no shortfall above it", () => {
    const terms = new Map<string, SplitTerms>([
      ["a", { minOrderAmount: 50, leadTimeDays: 2 }],
      ["b", { minOrderAmount: 5, leadTimeDays: null }],
    ]);
    const result = buildSupplierSplit(
      [
        article(1, 4, [mapping({ id: 11, supplierId: "a", lastPackagePrice: 3, lastUnitPrice: 3 })]),
        article(2, 4, [mapping({ id: 21, supplierId: "b", lastPackagePrice: 3, lastUnitPrice: 3 })]),
      ],
      terms,
      "cheapest",
    );
    const a = result.groups.find(group => group.supplierId === "a")!;
    expect(a).toMatchObject({ total: 12, meetsMinimum: false, shortfall: 38, leadTimeDays: 2 });
    const b = result.groups.find(group => group.supplierId === "b")!;
    expect(b).toMatchObject({ meetsMinimum: true, shortfall: 0 });
  });

  it("does not claim a shortfall when some prices are unknown", () => {
    const terms = new Map<string, SplitTerms>([["a", { minOrderAmount: 100, leadTimeDays: null }]]);
    const result = buildSupplierSplit(
      [article(1, 4, [mapping({ id: 11, supplierId: "a", lastPackagePrice: null, lastUnitPrice: null })], 11)],
      terms,
      "fewest_suppliers",
    );
    expect(result.groups[0]).toMatchObject({ totalComplete: false, meetsMinimum: null, shortfall: null });
  });

  it("lists articles without usable suppliers or prices instead of dropping them", () => {
    const result = buildSupplierSplit(
      [
        article(1, 4, []),
        article(2, 4, [mapping({ id: 21, supplierId: "a" })]),
        article(3, 0, [mapping({ id: 31, supplierId: "a", lastPackagePrice: 1, lastUnitPrice: 1 })]),
      ],
      noTerms,
      "cheapest",
    );
    expect(result.unassigned).toEqual([
      { articleId: 1, articleName: "Artikel 1", reason: "no_supplier" },
      { articleId: 2, articleName: "Artikel 2", reason: "no_price" },
    ]);
    expect(result.groups).toEqual([]);
  });

  it("uses fewer suppliers when one supplier covers every article", () => {
    const articles = [
      article(1, 1, [
        mapping({ id: 11, supplierId: "a", lastPackagePrice: 2, lastUnitPrice: 2 }),
        mapping({ id: 12, supplierId: "b", lastPackagePrice: 1.5, lastUnitPrice: 1.5 }),
      ]),
      article(2, 1, [mapping({ id: 21, supplierId: "a", lastPackagePrice: 2, lastUnitPrice: 2 })]),
    ];
    const cheapest = buildSupplierSplit(articles, noTerms, "cheapest");
    expect(cheapest.groups).toHaveLength(2);
    const fewest = buildSupplierSplit(articles, noTerms, "fewest_suppliers");
    expect(fewest.groups.map(group => group.supplierId)).toEqual(["a"]);
    expect(fewest.groups[0]!.lines.map(line => line.articleId).sort()).toEqual([1, 2]);
  });
});
