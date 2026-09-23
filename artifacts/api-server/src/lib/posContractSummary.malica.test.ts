import { describe, expect, it } from "vitest";
import {
  isMalicaAllocationEligibleForClaim,
  stableMalicaAllocationLockOrder,
  validateMalicaAllocationAccounting,
} from "./posContractSummary";

describe("mesečni zbirni račun pogodbenih malic", () => {
  it("sprejme veljavno osnovo in DDV, kjer je bruto partnerjev delež usklajen", () => {
    expect(() => validateMalicaAllocationAccounting({
      allocationId: 1,
      partnerCents: 122,
      guestCents: 378,
      vatBaseCents: 100,
      vatCents: 22,
    })).not.toThrow();
  });

  it("zavrne napačno DDV aritmetiko in negativne deleže", () => {
    expect(() => validateMalicaAllocationAccounting({
      allocationId: 2,
      partnerCents: 122,
      guestCents: 378,
      vatBaseCents: 101,
      vatCents: 22,
    })).toThrow("MALICA_ALLOCATION_RECONCILIATION:2");
    expect(() => validateMalicaAllocationAccounting({
      allocationId: 3,
      partnerCents: 100,
      guestCents: -1,
      vatBaseCents: 100,
      vatCents: 0,
    })).toThrow("MALICA_ALLOCATION_RECONCILIATION:3");
  });

  it("ohrani ločitev partnerjevega in gostovega deleža", () => {
    const facts = { allocationId: 4, partnerCents: 100, guestCents: 250, vatBaseCents: 100, vatCents: 0 };
    expect(facts.partnerCents + facts.guestCents).toBe(350);
    expect(() => validateMalicaAllocationAccounting(facts)).not.toThrow();
  });

  it("v prvo terjatev vključi le nepreklicane in še neprevzete postavke", () => {
    const base = {
      businessDate: "2026-01-15",
      month: "2026-01",
      orderStatus: "zakljuceno",
      packageStatus: "active",
    };
    expect(isMalicaAllocationEligibleForClaim({ ...base, alreadyClaimed: false })).toBe(true);
    expect(isMalicaAllocationEligibleForClaim({ ...base, alreadyClaimed: true })).toBe(false);
    expect(isMalicaAllocationEligibleForClaim({ ...base, orderStatus: "preklicano", alreadyClaimed: false })).toBe(false);
    expect(isMalicaAllocationEligibleForClaim({ ...base, packageStatus: "cancelled", alreadyClaimed: false })).toBe(false);
  });

  it("pozna pozno knjiženo postavko v istem poslovnem mesecu", () => {
    expect(isMalicaAllocationEligibleForClaim({
      businessDate: "2026-01-31",
      month: "2026-01",
      orderStatus: "zakljuceno",
      packageStatus: "active",
      alreadyClaimed: false,
    })).toBe(true);
    expect(isMalicaAllocationEligibleForClaim({
      businessDate: "2026-02-01",
      month: "2026-01",
      orderStatus: "zakljuceno",
      packageStatus: "active",
      alreadyClaimed: false,
    })).toBe(false);
  });

  it("zaklepa alokacije v stabilnem vrstnem redu brez podvajanja", () => {
    expect(stableMalicaAllocationLockOrder([9, 2, 9, 4])).toEqual([2, 4, 9]);
  });
});