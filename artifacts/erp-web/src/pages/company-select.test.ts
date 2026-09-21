import { describe, expect, it } from "vitest";
import {
  MODULE_ICONS,
  MODULE_LABELS,
  normalizeCompanyTaxNumber,
} from "./company-select";

describe("poenoten prikaz modulskih kartic", () => {
  it("ima enotna imena in ikone za vse tri module", () => {
    expect(MODULE_LABELS).toEqual({
      erp: "Glavna knjiga",
      pos: "POS gostinstvo",
      osnovna_sredstva: "Osnovna sredstva",
    });
    expect(MODULE_ICONS.erp).toBeDefined();
    expect(MODULE_ICONS.pos).toBeDefined();
    expect(MODULE_ICONS.osnovna_sredstva).toBeDefined();
  });

  it("v vseh karticah prikaže davčno številko brez predpone SI", () => {
    for (const davcna of ["11928174", "SI11928174", "si11928174"]) {
      expect(normalizeCompanyTaxNumber(davcna)).toBe("11928174");
    }
  });
});