import { describe, expect, it } from "vitest";
import { requiresClassicNormativ, validateMulticourseMenu } from "./multicourse-menu-validation";

describe("requiresClassicNormativ", () => {
  it("ne zahteva klasičnega normativa za konfigurirano večhodno ovojnico", () => {
    expect(requiresClassicNormativ("composite", true)).toBe(false);
  });

  it("ga še vedno zahteva za običajen sestavljeni artikel", () => {
    expect(requiresClassicNormativ("composite", false)).toBe(true);
  });

  it("validira generične hode, izbirni način in opcijsko vino", () => {
    const courses = [
      { courseName: "Predjed", informational: false, wineRequired: true, allowedFoodArtikelIds: [1], allowedWineArtikelIds: [2] },
      { courseName: "Glavna jed", informational: false, wineRequired: false, allowedFoodArtikelIds: [3], allowedWineArtikelIds: [] },
      { courseName: "Pozdrav", informational: true, wineRequired: false, allowedFoodArtikelIds: [4], allowedWineArtikelIds: [] },
    ];
    expect(validateMulticourseMenu("choose", 2, courses)).toBeNull();
    expect(validateMulticourseMenu("choose", 3, courses)).toContain("Število izbranih");
    expect(validateMulticourseMenu("fixed", 0, [{ ...courses[0], allowedWineArtikelIds: [] }, courses[1]!])).toContain("vsaj eno vino");
  });
});