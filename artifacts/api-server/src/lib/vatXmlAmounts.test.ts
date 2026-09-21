import { describe, expect, it } from "vitest";
import { getKprExportVatAmounts } from "./vatXmlAmounts";

describe("getKprExportVatAmounts", () => {
  it("does not apply a partial deduction percentage twice", () => {
    expect(getKprExportVatAmounts(11, 11)).toEqual({
      deductibleVat: 11,
      nonDeductibleVat: 11,
    });
  });

  it("keeps fully deductible VAT unchanged", () => {
    expect(getKprExportVatAmounts(22, 0)).toEqual({
      deductibleVat: 22,
      nonDeductibleVat: 0,
    });
  });
});