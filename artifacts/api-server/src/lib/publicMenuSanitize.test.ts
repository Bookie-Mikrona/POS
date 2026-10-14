import { describe, expect, it } from "vitest";
import { PUBLIC_LOW_STOCK_THRESHOLD, publicStockStatus, sanitizePublicDescription } from "./publicMenuSanitize";

describe("javni meni: opisi in zaloga", () => {
  it("odstrani interne oznake v oglatih oklepajih", () => {
    expect(sanitizePublicDescription("[Normativ uporabnika — sestavine dopolnjene]\nVir: interno")).toBeNull();
    expect(sanitizePublicDescription("Juha [interno] s kruhom")).toBe("Juha s kruhom");
    expect(sanitizePublicDescription("  Dober opis ")).toBe("Dober opis");
    expect(sanitizePublicDescription(null)).toBeNull();
  });

  it("pretvori količine v status brez točne številke", () => {
    expect(publicStockStatus(null)).toBe("na_voljo");
    expect(publicStockStatus(24)).toBe("na_voljo");
    expect(publicStockStatus(PUBLIC_LOW_STOCK_THRESHOLD + 1)).toBe("na_voljo");
    expect(publicStockStatus(PUBLIC_LOW_STOCK_THRESHOLD)).toBe("se_malo");
    expect(publicStockStatus(1)).toBe("se_malo");
    expect(publicStockStatus(0)).toBe("ni_na_voljo");
  });
});
