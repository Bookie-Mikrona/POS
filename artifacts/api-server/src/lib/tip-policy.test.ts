import { describe, expect, it } from "vitest";
import { calculateTipTreatment, toLjubljanaDate } from "./tip-policy";
import type { TipPolicy } from "@workspace/db";

const policy = (overrides: Partial<TipPolicy>): TipPolicy => ({
  id: "00000000-0000-0000-0000-000000000001",
  companyId: "00000000-0000-0000-0000-000000000002",
  enotaId: null,
  effectiveFrom: "2026-01-01",
  effectiveTo: null,
  mode: "direct_employee",
  evidenceType: "employment_contract",
  evidenceReference: "Pogodba-1",
  agreementConfirmed: true,
  cardFeeTreatment: "employer_expense",
  cardFeeKind: "percentage",
  cardFeePercent: "2.0000",
  cardFeeFlatAmount: null,
  notes: null,
  createdBy: "test",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
  ...overrides,
});

describe("davčna obravnava napitnin", () => {
  it("ohrani celotno obveznost, če provizijo nosi delodajalec", () => {
    expect(calculateTipTreatment(10, policy({}))).toMatchObject({
      vatAmount: 0,
      feeAmount: 0.2,
      feeTaxTreatment: "private_nondeductible",
      employeeLiability: 10,
    });
  });

  it("zmanjša obveznost, če odstotno provizijo nosi zaposleni", () => {
    expect(calculateTipTreatment(10, policy({ cardFeeTreatment: "deduct_from_tip" }))).toMatchObject({
      vatAmount: 0,
      feeAmount: 0.2,
      feeTaxTreatment: "withheld_from_employee",
      employeeLiability: 9.8,
    });
  });

  it("pri nadzoru delodajalca iz bruto napitnine izračuna 22 % DDV", () => {
    expect(calculateTipTreatment(12.2, policy({ mode: "employer_controlled" }))).toMatchObject({
      vatAmount: 2.2,
      feeTaxTreatment: "business_deductible",
      employeeLiability: 0,
    });
  });

  it("pavšalne provizije nikoli ne pripiše napitnini", () => {
    expect(calculateTipTreatment(10, policy({
      cardFeeKind: "flat",
      cardFeePercent: null,
      cardFeeFlatAmount: "0.15",
    }))).toMatchObject({
      feeAmount: 0,
      flatFeeAmount: 0.15,
      employeeLiability: 10,
      feeTaxTreatment: "business_deductible",
    });
  });

  it("zavrne režim za tuj račun brez potrjenega dokazila", () => {
    expect(() => calculateTipTreatment(5, policy({ agreementConfirmed: false })))
      .toThrow("TIP_POLICY_EVIDENCE_REQUIRED");
  });

  it("datum politike določi v časovnem pasu Europe/Ljubljana", () => {
    expect(toLjubljanaDate(new Date("2026-03-28T23:30:00Z"))).toBe("2026-03-29");
  });
});