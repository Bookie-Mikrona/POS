import { describe, expect, it } from "vitest";
import {
  normalizePreparedFoodUnit,
  preparedFoodUnitLabel,
  preparedFoodUnitRoleError,
  preparedFoodUnitSemantic,
  isSupportedPreparedFoodUnit,
} from "./prepared-food-units";

describe("prepared-food unit semantics", () => {
  it("canonicalizes mass, volume and portion aliases while retaining legacy units", () => {
    expect(normalizePreparedFoodUnit(" kg ")).toBe("KGM");
    expect(normalizePreparedFoodUnit("KGM")).toBe("KGM");
    expect(normalizePreparedFoodUnit("l")).toBe("LTR");
    expect(normalizePreparedFoodUnit("LTR")).toBe("LTR");
    expect(normalizePreparedFoodUnit("porcija")).toBe("H87");
    expect(normalizePreparedFoodUnit("kos")).toBe("kos");
    expect(preparedFoodUnitSemantic("kom")).toBe("portion");
    expect(preparedFoodUnitSemantic("pce")).toBe("portion");
    expect(preparedFoodUnitSemantic("ea")).toBe("portion");
    expect(normalizePreparedFoodUnit(null)).toBeNull();
    expect(isSupportedPreparedFoodUnit("kos")).toBe(true);
    expect(isSupportedPreparedFoodUnit("GRM")).toBe(false);
    expect(preparedFoodUnitLabel("KGM")).toBe("kg");
    expect(preparedFoodUnitLabel("LTR")).toBe("l");
    expect(preparedFoodUnitLabel("H87")).toBe("porcija");
  });

  it("rejects prepared bulk units sold or purchased, without changing portion semantics", () => {
    expect(preparedFoodUnitSemantic("porcija")).toBe("portion");
    expect(preparedFoodUnitSemantic("kos")).toBe("portion");
    expect(preparedFoodUnitRoleError({
      mealType: "prepared", unit: "kg", purchaseArticle: false, salesArticle: true,
    })).toContain("neprodajni");
    expect(preparedFoodUnitRoleError({
      mealType: "prepared", unit: "l", purchaseArticle: true, salesArticle: false,
    })).toContain("nenabavni");
    expect(preparedFoodUnitRoleError({
      mealType: "prepared", unit: "H87", purchaseArticle: false, salesArticle: true,
    })).toBeNull();
    expect(preparedFoodUnitRoleError({
      mealType: "prepared", unit: "GRM", purchaseArticle: false, salesArticle: false,
    })).toContain("enoto porcija");
  });
});