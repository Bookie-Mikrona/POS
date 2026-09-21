import { describe, expect, it } from "vitest";
import {
  formatPosBookingVatCode,
  getPosBookingVatCodesEndpoint,
  type PosBookingVatCodeOption,
} from "./nastavitve";

describe("POS knjiženje – FURS DDV kode", () => {
  it("uporablja isti company-scoped vir kot POS stran", () => {
    expect(
      getPosBookingVatCodesEndpoint("company-mojca"),
    ).toBe("/api/companies/company-mojca/pos-booking-settings/vat-codes");
  });

  it("prikaže kodo in naziv iz globalnega FURS šifranta", () => {
    const option: PosBookingVatCodeOption = {
      id: "vat-code-s22",
      code: "S22",
      description: "Domača prodaja 22 %",
      rate: "22.00",
    };

    expect(formatPosBookingVatCode(option)).toBe("S22 — Domača prodaja 22 %");
  });
});