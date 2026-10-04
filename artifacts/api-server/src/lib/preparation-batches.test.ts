import { describe, expect, it } from "vitest";
import { productionTotals } from "./preparation-batches";

describe("dessert batch yields", () => {
  it("changes pieces, not the ingredient quantity for a tray", () => {
    expect(productionTotals([{ batchCount: 1, piecesPerBatch: 15 }], 12, 15))
      .toEqual({ pieces: 15, recipeQuantity: 12 });
  });
  it("supports different cuts for successive preparations", () => {
    expect(productionTotals([
      { batchCount: 1, piecesPerBatch: 12 }, { batchCount: 2, piecesPerBatch: 15 },
    ], 12, 42)).toEqual({ pieces: 42, recipeQuantity: 36 });
  });
  it("preserves historical legacy portion records", () => {
    expect(productionTotals(null, null, 3.5)).toEqual({ pieces: 3.5, recipeQuantity: 3.5 });
    expect(productionTotals([], 12, 0)).toEqual({ pieces: 0, recipeQuantity: 0 });
  });
  it.each([0, -1, 1.5, Infinity, 10001])("rejects invalid yield %s", piecesPerBatch => {
    expect(() => productionTotals([{ batchCount: 1, piecesPerBatch }], 12, 0)).toThrow();
  });
  it("rejects missing normative and oversized totals", () => {
    expect(() => productionTotals([{ batchCount: 1, piecesPerBatch: 12 }], null, 12)).toThrow();
    expect(() => productionTotals([{ batchCount: 10000, piecesPerBatch: 10000 }], 12, 0)).toThrow();
  });
});