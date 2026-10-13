import { describe, expect, it } from "vitest";
import { allocateReceiptTax, sumReceiptTaxGroups } from "./pos-receipt-tax";

describe("Davčni razrez ohrani izdani DDV", () => {
  it.each([
    ["15.90", "2.86", "13.04"],
    ["5.40", "0.98", "4.42"],
    ["-1.70", "-0.31", "-1.39"],
  ])("uporabi glavo %s / %s namesto novega obračuna", (bruto, ddv, neto) => {
    expect(allocateReceiptTax([{ bruto, davek: "22" }], ddv, bruto))
      .toEqual([{ bruto, davek: "22", ddv, neto }]);
  });
  it("centno uskladitev pripiše obdavčeni osnovi in ne ničelni stopnji", () => {
    const rows = allocateReceiptTax([
      { bruto: "100.00", davek: "0" }, { bruto: "5.40", davek: "22" },
    ], "0.98", "105.40");
    expect(rows[0]!.ddv).toBe("0.00");
    expect(rows[1]!.ddv).toBe("0.98");
    expect(rows[1]!.neto).toBe("4.42");
  });
  it("ne prikrije nepopolnih postavk", () => {
    expect(() => allocateReceiptTax([{ bruto: "2.70", davek: "22" }], "0.98", "5.40")).toThrow();
    expect(() => allocateReceiptTax([{ bruto: "2.70", davek: "0" }], "0.49")).toThrow();
  });
  it("izvirnik in storno iste kategorije izničita prihodke in DDV", () => {
    const rows = sumReceiptTaxGroups([
      { kategorijaId: 1, vrstaArtikla: "storitev", davek: "22", bruto: "1.70", neto: "1.39", ddv: "0.31" },
      { kategorijaId: 1, vrstaArtikla: "storitev", davek: "22", bruto: "-1.70", neto: "-1.39", ddv: "-0.31" },
    ]);
    expect(rows[0]).toMatchObject({ bruto: "0.00", neto: "0.00", ddv: "0.00" });
  });
});
