import { describe, expect, it } from "vitest";

import { faktorNormativaModifikatorja, faktorNormativaPodModifikatorja } from "./pica-poraba";

describe("faktorNormativaModifikatorja", () => {
  it("plačljiv dodatek vedno obračuna celoten normativ", () => {
    expect(faktorNormativaModifikatorja(0.765625, "1.50")).toBe(1);
    expect(faktorNormativaModifikatorja(1, 2)).toBe(1);
    expect(faktorNormativaModifikatorja(1.265625, 4.25)).toBe(1);
  });

  it("brezplačen dodatek ohrani faktor velikosti pice", () => {
    expect(faktorNormativaModifikatorja(0.765625, 0)).toBe(0.765625);
    expect(faktorNormativaModifikatorja(1, "0.00")).toBe(1);
    expect(faktorNormativaModifikatorja(1.265625, null)).toBe(1.265625);
  });

  it("gnezdena poraba vedno ohrani ulomljeni faktor izvora in velikosti, ne glede na ceno", () => {
    const factor = faktorNormativaPodModifikatorja(0.375, 0.75);
    expect(factor).toBe(0.28125);
    expect(faktorNormativaModifikatorja(factor, "1.50", true)).toBe(0.28125);
    expect(faktorNormativaModifikatorja(factor, 0, true)).toBe(0.28125);
  });
});