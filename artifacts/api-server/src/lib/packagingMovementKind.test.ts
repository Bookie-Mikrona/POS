import { describe, expect, it } from "vitest";
import {
  oppositePackagingMovementKind,
  packagingMovementKindForQuantity,
} from "./packagingMovementKind";

describe("vrsta prometa povratne embalaže", () => {
  it("negativno količino označi kot vračilo", () => {
    expect(packagingMovementKindForQuantity("-20")).toBe("vracilo");
    expect(packagingMovementKindForQuantity("20")).toBe("prejem");
  });

  it("storno obrne obe vrsti prometa", () => {
    expect(oppositePackagingMovementKind("prejem")).toBe("vracilo");
    expect(oppositePackagingMovementKind("vracilo")).toBe("prejem");
  });
});