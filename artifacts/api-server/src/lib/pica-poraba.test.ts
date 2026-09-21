import { describe, expect, it } from "vitest";

import { faktorNormativaModifikatorja } from "./pica-poraba";

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
});