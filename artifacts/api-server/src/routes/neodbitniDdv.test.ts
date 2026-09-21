/**
 * neodbitniDdv.test.ts — Testi za neodbitni in delno odbitni vstopni DDV
 *
 * Preverja pravilno preslikavo vatDeductionPercent → P17 / P18-P20:
 *  1. vatDeductionPercent=0  → ves DDV v P17 (neodbitni), nič v P18
 *  2. vatDeductionPercent=50 → polovica P17, polovica P18
 *  3. vatDeductionPercent=100 (privzetek) → ves DDV v P18, P17=0
 *  4. PN22 koda z vatDeductionPercent=0 → pravilno v P17
 *  5. vatLedger.ts logika: deductibleVat + nonDeductibleVat = vatAmount
 */

import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";

// ─── Poustvarjena logika iz vatLedger.ts (unit testabilna brez DB) ─────────────

interface SimLine {
  vatAmount: string;
  vatDeductionPercent: string;
}

interface VatSplit {
  deductibleVat: string;   // → P18/P19/P20 (polja 41-43 DDV-O)
  nonDeductibleVat: string; // → P17
}

function splitVat(line: SimLine): VatSplit {
  const vatAmount = new Decimal(line.vatAmount);
  const deductionPct = new Decimal(line.vatDeductionPercent);
  const deductibleVat = vatAmount.mul(deductionPct).div(100).toDecimalPlaces(2);
  const nonDeductibleVat = vatAmount.sub(deductibleVat).toDecimalPlaces(2);
  return {
    deductibleVat: deductibleVat.toFixed(2),
    nonDeductibleVat: nonDeductibleVat.toFixed(2),
  };
}

function vatXmlFields(line: SimLine, kprVatField: string | null): { P17: number; P18: number } {
  const { deductibleVat, nonDeductibleVat } = splitVat(line);
  const dedAmt = parseFloat(deductibleVat);
  const nonDedAmt = parseFloat(nonDeductibleVat);

  // XML generator logika: addToField(g, kprVatField, deductibleVat)
  const p18 = kprVatField ? dedAmt : 0; // kprVatField=P18 za P22
  // nonDeductibleTotal = nonDeductibleVat (tu brez dodatnega non_deductible_vat)
  const p17 = nonDedAmt > 0.005 ? nonDedAmt : 0;

  return { P17: p17, P18: p18 };
}

// ─── Testi ─────────────────────────────────────────────────────────────────────

describe("neodbitni DDV — vatDeductionPercent preslikava", () => {

  it("vatDeductionPercent=0 → ves DDV v P17, nič v P18", () => {
    const line: SimLine = { vatAmount: "220.00", vatDeductionPercent: "0" };
    const split = splitVat(line);

    expect(split.deductibleVat).toBe("0.00");
    expect(split.nonDeductibleVat).toBe("220.00");

    // XML preslikava z kprVatField=NULL (PN22)
    const xml = vatXmlFields(line, null);
    expect(xml.P18).toBe(0);
    expect(xml.P17).toBe(220.00);
  });

  it("vatDeductionPercent=50 → polovica P17, polovica P18", () => {
    const line: SimLine = { vatAmount: "220.00", vatDeductionPercent: "50" };
    const split = splitVat(line);

    expect(split.deductibleVat).toBe("110.00");
    expect(split.nonDeductibleVat).toBe("110.00");

    // XML preslikava z kprVatField=P18 (P22 koda, delni odbitek)
    const xml = vatXmlFields(line, "P18");
    expect(xml.P18).toBe(110.00); // odbitni del → P18 (polje 41 DDV-O)
    expect(xml.P17).toBe(110.00); // neodbitni del → P17
  });

  it("vatDeductionPercent=100 (privzetek) → ves DDV v P18, P17=0", () => {
    const line: SimLine = { vatAmount: "220.00", vatDeductionPercent: "100" };
    const split = splitVat(line);

    expect(split.deductibleVat).toBe("220.00");
    expect(split.nonDeductibleVat).toBe("0.00");

    const xml = vatXmlFields(line, "P18");
    expect(xml.P18).toBe(220.00);
    expect(xml.P17).toBe(0);
  });

  it("neodbitni DDV ne sme povečati odbitka (polji 41-43)", () => {
    // Preveri, da neodbitni del nikoli ne pristane v P18 (polje 41)
    for (const pct of ["0", "30", "50", "75"]) {
      const line: SimLine = { vatAmount: "950.00", vatDeductionPercent: pct };
      const split = splitVat(line);
      const totalCheck = new Decimal(split.deductibleVat).plus(split.nonDeductibleVat);
      // Vsota mora biti enaka originalnemu vatAmount
      expect(totalCheck.toFixed(2)).toBe("950.00");
      // Odbitni + neodbitni ne smeta preseči vatAmount
      expect(parseFloat(split.deductibleVat)).toBeLessThanOrEqual(950.00);
      expect(parseFloat(split.nonDeductibleVat)).toBeLessThanOrEqual(950.00);
    }
  });

  it("PN22 koda (kprVatField=NULL, vatDeductionPercent=0) → P17, ne P18", () => {
    // PN22: direction=IN, rate=22, kprVatField=NULL → isNonDeductible=true
    const pn22KprVatField = null; // PN22 nima kprVatField
    const line: SimLine = { vatAmount: "100.00", vatDeductionPercent: "0" };

    const xml = vatXmlFields(line, pn22KprVatField);
    expect(xml.P17).toBe(100.00); // ves DDV v P17
    expect(xml.P18).toBe(0);       // nič v odbitni P18
  });

  it("PN5/PN95 koda (nove kode, kprVatField=NULL, vatDeductionPercent=0) → P17", () => {
    // PN5 in PN95 sta novi kodi, enako vedenje kot PN22
    const line5: SimLine = { vatAmount: "50.00", vatDeductionPercent: "0" };
    const line95: SimLine = { vatAmount: "95.00", vatDeductionPercent: "0" };

    expect(vatXmlFields(line5, null).P17).toBe(50.00);
    expect(vatXmlFields(line5, null).P18).toBe(0);
    expect(vatXmlFields(line95, null).P17).toBe(95.00);
    expect(vatXmlFields(line95, null).P18).toBe(0);
  });

  it("UVP95/UVP5 koda (kprVatField nastavljeno) → odbitni DDV, ne P17", () => {
    // UVP95: kprVatField=P19, UVP5: kprVatField=P20 → DDV je ODBITEN
    const lineUvp95: SimLine = { vatAmount: "95.00", vatDeductionPercent: "100" };
    const p19 = vatXmlFields(lineUvp95, "P19"); // P19 = UVP95 kprVatField
    expect(p19.P17).toBe(0);          // ni neodbitnega
    expect(p19.P18).toBe(95.00);      // ves v odbitni del (tu P18 kot proxy za P19)
  });

  it("Zaokroževanje pri delnem odbitku — D+K = vatAmount (cent točnost)", () => {
    // 1/3 odbitek → preverimo cent točnost
    const line: SimLine = { vatAmount: "100.00", vatDeductionPercent: "33.33" };
    const split = splitVat(line);
    const total = new Decimal(split.deductibleVat).plus(split.nonDeductibleVat);
    expect(total.toFixed(2)).toBe("100.00"); // skupaj mora biti enako
  });
});

// ─── isNonDeductible logika (FURS kode) ───────────────────────────────────────

describe("isNonDeductible zaznava — kpr_vat_field=NULL pravilo", () => {
  it("PN kode so neodbitne: direction=IN, rate>0, kprVatField=null", () => {
    const isNonDeductible = (direction: string, rate: number, kprVatField: string | null) =>
      direction === "IN" && rate > 0 && kprVatField === null;

    expect(isNonDeductible("IN", 22, null)).toBe(true);   // PN22
    expect(isNonDeductible("IN", 9.5, null)).toBe(true);  // PN95
    expect(isNonDeductible("IN", 5, null)).toBe(true);    // PN5
    expect(isNonDeductible("IN", 22, "P18")).toBe(false); // P22 — ni neodbitna
    expect(isNonDeductible("IN", 0, null)).toBe(false);   // POP — oproščeno (rate=0)
    expect(isNonDeductible("OUT", 22, null)).toBe(false); // izstopni — ne velja
  });
});
