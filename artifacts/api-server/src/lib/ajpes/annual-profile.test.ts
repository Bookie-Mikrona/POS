import { describe, expect, it } from "vitest";
import { assessAjpesProfile, type AjpesAnnualProfile } from "./annual-profile";

function validProfile(overrides: Partial<AjpesAnnualProfile> = {}): AjpesAnnualProfile {
  return {
    legalForm: "doo", framework: "SRS", size: "small",
    periodStart: "2025-01-01", periodEnd: "2025-12-31",
    currentCriteria: { assets: "0", revenue: "0", employees: "0" },
    previousCriteria: { assets: "0", revenue: "0", employees: "0" },
    sizeBasis: "Presoja obeh poslovnih let in pogojev ZGD-1.",
    previousYearException: "",
    microRegime: "no", auditRequired: "no", groupMember: "no",
    consolidationRequired: "no", simplifiedSubmission: "yes", foreignOperations: "no",
    sfrRequired: "no", cppsRequired: "no", listed: "no", specialRegime: "no",
    confirmationBasis: "Računovodski pregled letnih podatkov in zavezanosti.",
    confirmed: true, ...overrides,
  };
}
const blocking = (p: AjpesAnnualProfile | undefined, year = 2025) =>
  assessAjpesProfile(p, year).issues.filter(i => i.blocking).map(i => i.code);

describe("AJPES annual company profile", () => {
  it("does not infer a profile or confirmation from legacy metadata", () => {
    const result = assessAjpesProfile(undefined, 2025, { size: "4", accountingMethod: "2" });
    expect(result.confirmed).toBe(false);
    expect(result.supported).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "profile_missing", blocking: true }));
    expect(result.obligations.find(o => o.code === "sfr")?.status).toBe("conditional");
  });
  it("accepts explicit zeros and a documented accountant size conclusion", () => {
    const result = assessAjpesProfile(validProfile(), 2025);
    expect(result.issues).toEqual([]);
    expect(result.confirmed).toBe(true);
    expect(result.supported).toBe(true);
    expect(result.catalogYear).toBe(2025);
    expect(result.obligations.find(o => o.code === "bs")).toMatchObject({ status: "required", available: true, purpose: "statistics" });
  });
  it("keeps missing data different from explicit zero", () => {
    expect(blocking(validProfile({ currentCriteria: { assets: "", revenue: "0", employees: "0" } })))
      .toContain("profile_current_criteria");
  });
  it("requires multi-year evidence or an explicit documented exception", () => {
    const previousCriteria = { assets: "", revenue: "", employees: "" };
    expect(blocking(validProfile({ previousCriteria }))).toContain("profile_previous_criteria");
    expect(blocking(validProfile({ previousCriteria, previousYearException: "Novo ustanovljena družba; prvo poslovno leto." }))).toEqual([]);
    expect(blocking(validProfile({ sizeBasis: "   " }))).toContain("profile_size_basis");
  });
  it("does not hide invalid prior-year evidence behind an exception", () => {
    expect(blocking(validProfile({
      previousCriteria: { assets: "-1", revenue: "", employees: "" },
      previousYearException: "Dokumentirana izjema",
    }))).toContain("profile_previous_invalid");
  });
  it.each(["auditRequired", "groupMember", "consolidationRequired", "sfrRequired", "cppsRequired"] as const)(
    "keeps %s unknown distinct from no", key => {
      expect(blocking(validProfile({ [key]: "unknown" }))).toContain(`profile_missing_${key}`);
      expect(blocking(validProfile({ [key]: "no" }))).not.toContain(`profile_missing_${key}`);
    },
  );
  it("requires an explicit confirmation and a basis", () => {
    expect(blocking(validProfile({ confirmed: false }))).toContain("profile_unconfirmed");
    expect(blocking(validProfile({ confirmationBasis: " " }))).toContain("profile_basis");
  });
  it.each(["sp", "cooperative", "other"] as const)("does not use GD forms for %s", legalForm => {
    const result = assessAjpesProfile(validProfile({ legalForm }), 2025);
    expect(result.supported).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "profile_unsupported", blocking: true }));
    expect(result.obligations.find(o => o.code === "bs")?.available).toBe(false);
  });
  it("supports actual micro disclosures, not a blanket exemption", () => {
    const result = assessAjpesProfile(validProfile({ size: "micro", microRegime: "yes" }), 2025);
    expect(result.confirmed).toBe(true);
    expect(result.obligations.find(o => o.code === "micro")?.status).toBe("required");
    expect(result.obligations.find(o => o.code === "notes")?.status).toBe("not_required");
    expect(result.obligations.find(o => o.code === "profit_proposal")?.status).toBe("required");
    expect(result.obligations.find(o => o.code === "profit_adopted")?.status).toBe("required");
    expect(blocking(validProfile({ microRegime: "yes" }))).toContain("profile_micro_ineligible");
  });
  it("rejects contradictory public-market/special/micro/simplification profiles", () => {
    expect(blocking(validProfile({ listed: "yes" }))).toContain("profile_simplified_ineligible");
    expect(blocking(validProfile({ auditRequired: "yes" }))).toContain("profile_simplified_ineligible");
    expect(blocking(validProfile({ framework: "IFRS" }))).toContain("profile_unsupported");
    expect(blocking(validProfile({ size: "micro", microRegime: "yes", specialRegime: "yes" })))
      .toContain("profile_micro_ineligible");
  });
  it("shows periodic and consolidation requirements without inventing implemented reports", () => {
    const result = assessAjpesProfile(validProfile({
      groupMember: "yes", consolidationRequired: "yes", sfrRequired: "yes", cppsRequired: "yes",
    }), 2025);
    for (const code of ["consolidation", "sfr", "cpps"]) {
      expect(result.obligations.find(o => o.code === code)).toMatchObject({ status: "required", available: false });
    }
    expect(blocking(validProfile({ consolidationRequired: "yes" }))).toContain("profile_group_conflict");
  });
  it("requires a separate medium/large-company package and audit", () => {
    const result = assessAjpesProfile(validProfile({ size: "medium", simplifiedSubmission: "no" }), 2025);
    expect(result.issues.some(i => i.code === "profile_audit_conflict")).toBe(true);
    expect(result.obligations.find(o => o.code === "cash_flow")).toMatchObject({ status: "required", available: false });
  });
  it("requires actual dates, not rolled-over dates, and matching reporting year", () => {
    expect(blocking(validProfile({ periodStart: "2025-02-30" }))).toContain("profile_period");
    expect(blocking(validProfile({ periodEnd: "2024-12-31" }))).toContain("profile_period");
    expect(blocking(validProfile({ periodStart: "2025-04-01", periodEnd: "2025-03-31" })))
      .toContain("profile_period");
  });
  it("does not extend verified catalog/XML support to another year", () => {
    const result = assessAjpesProfile(validProfile({ periodStart: "2026-01-01", periodEnd: "2026-12-31" }), 2026);
    expect(result.catalogYear).toBe(2025);
    expect(result.obligations.find(o => o.code === "bs")?.available).toBe(false);
    expect(result.issues).toContainEqual(expect.objectContaining({ code: "profile_catalog_year", blocking: false }));
  });
  it("rejects profile versus legacy numerical setting conflicts", () => {
    expect(assessAjpesProfile(validProfile(), 2025, { size: "4" }).issues)
      .toContainEqual(expect.objectContaining({ code: "profile_metadata_conflict", blocking: true }));
    expect(assessAjpesProfile(validProfile(), 2025, { size: "3", accountingMethod: "2" }).issues).toEqual([]);
  });
  it("exposes separate publication content preparation, not submission or signature", () => {
    const result = assessAjpesProfile(validProfile(), 2025);
    expect(result.obligations.find(o => o.code === "public_report")).toMatchObject({
      purpose: "publication", status: "required", available: true,
    });
    expect(result.obligations.find(o => o.code === "statement")).toMatchObject({ status: "required", available: true });
    expect(result.obligations.find(o => o.code === "statement")?.explanation).toContain("ni elektronski podpis");
    expect(assessAjpesProfile(validProfile({ auditRequired: "yes", simplifiedSubmission: "no" }), 2025)
      .obligations.find(o => o.code === "public_report")?.available).toBe(false);
  });
});