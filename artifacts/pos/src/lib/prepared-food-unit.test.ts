import { describe, expect, it } from "vitest";
import {
  formatPreparedFoodQuantity,
  normalizePreparedFoodUnit,
  preparedFoodQuantityLargeStep,
  preparedFoodQuantityStep,
  preparedFoodUnitCode,
} from "./prepared-food-unit";

describe("prepared-food units", () => {
  it("normalizes legacy and e-SLOG portion units without changing their basis", () => {
    for (const unit of [null, undefined, "H87", "kos", "KOS", "porcija"]) {
      expect(normalizePreparedFoodUnit(unit)).toBe("porcija");
    }
    expect(preparedFoodUnitCode("porcija")).toBe("porcija");
  });

  it("supports kg/l storage codes and quantity increments", () => {
    expect(normalizePreparedFoodUnit("KGM")).toBe("kg");
    expect(normalizePreparedFoodUnit("LTR")).toBe("l");
    expect(preparedFoodUnitCode("kg")).toBe("KGM");
    expect(preparedFoodUnitCode("l")).toBe("LTR");
    expect(preparedFoodQuantityStep("kg")).toBe(0.1);
    expect(preparedFoodQuantityStep("l")).toBe(0.1);
    expect(preparedFoodQuantityLargeStep("l")).toBe(1);
    expect(preparedFoodQuantityStep("porcija")).toBe(1);
    expect(preparedFoodQuantityLargeStep(null)).toBe(10);
  });

  it("formats decimal quantities to at most four places", () => {
    expect(formatPreparedFoodQuantity(0.35456)).toBe("0,3546");
    expect(formatPreparedFoodQuantity(2)).toBe("2");
  });
});