import { describe, expect, it } from "vitest";
import { assessAjpesProfile, type AjpesAnnualProfile } from "./annual-profile";
import { assessAjpesPublication, type AjpesAnnualNarrative } from "./annual-publication";
import type { AjpesAnnualSettings } from "./annual-model";

function profile(change: Partial<AjpesAnnualProfile> = {}): AjpesAnnualProfile {
  return {
    legalForm: "doo", framework: "SRS", size: "small",
    periodStart: "2025-01-01", periodEnd: "2025-12-31",
    currentCriteria: { assets: "0", revenue: "0", employees: "0" },
    previousCriteria: { assets: "0", revenue: "0", employees: "0" },
    sizeBasis: "Dokumentirana presoja dveh let.", previousYearException: "",
    microRegime: "no", auditRequired: "no", groupMember: "no",
    consolidationRequired: "no", simplifiedSubmission: "no", foreignOperations: "no",
    sfrRequired: "no", cppsRequired: "no", listed: "no", specialRegime: "no",
    confirmationBasis: "Pregledane podlage profila.", confirmed: true, ...change,
  };
}
function narrative(change: Partial<AjpesAnnualNarrative> = {}): AjpesAnnualNarrative {
  return {
    accountingPolicies: "Usmeritve, sprejete za poročano leto.",
    explanations: "Pojasnila vseh za družbo relevantnih postavk in razkritij.",
    disclosure4: "Ni pogojnih obveznosti zunaj bilance, tudi pokojninskih ali do skupine.",
    disclosure5: "Ni obveznosti, zavarovanih s stvarnim jamstvom.",
    disclosure6: "Ni predujmov, posojil ali poroštev osebam iz 6. točke.",
    disclosure10: "Družba nima in med letom ni imela lastnih deležev.",
    historicalCostConfirmed: true,
    profitProposal: {
      text: "Predlog: ni bilančnega dobička ali izgube.",
      preparedBy: "Poslovodstvo", preparedDate: "2026-02-28",
    },
    profitDecision: {
      text: "Sprejeti sklep: ni bilančnega dobička ali izgube.",
      adoptedBy: "Družbeniki", adoptedDate: "2026-03-10",
      reference: "Zapisnik redne skupščine", adopted: true,
    },
    simplifiedStatement: { text: "", signatory: "", date: "", confirmed: false },
    ...change,
  };
}
function settings(p = profile(), n: AjpesAnnualNarrative | undefined = narrative()): AjpesAnnualSettings {
  return {
    mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {},
    excludedEntryIds: [], metadata: {}, profile: p, narrative: n,
  };
}
const fp = "exact-reviewed-snapshot";
function assess(s = settings(), options: Partial<Parameters<typeof assessAjpesPublication>[0]> = {}) {
  return assessAjpesPublication({
    year: 2025, settings: s, profileAssessment: assessAjpesProfile(s.profile, 2025),
    sourceFingerprint: fp, numericReviewed: true, numericBlocked: false,
    today: "2026-10-02", ...options,
  });
}

describe("prepared AJPES publication package", () => {
  it("does not turn a profile or numerical zero into confirmed narrative content", () => {
    const s = settings(); delete s.narrative;
    const r = assess(s);
    expect(r.ready).toBe(false);
    expect(r.reviewed).toBe(false);
    expect(r.canExport).toBe(false);
    expect(r.documents.filter(d => d.status === "missing").map(d => d.code))
      .toEqual(["notes", "profit_proposal", "profit_adopted"]);
    expect(r.sections).toEqual([]);
  });
  it("requires a server approval of the exact content and a numerical review", () => {
    const s = settings();
    expect(assess(s)).toMatchObject({ ready: true, reviewed: false, canExport: false });
    s.publicationReview = { fingerprint: fp, reviewedBy: "test-accountant", reviewedAt: "2026-03-11T09:00:00Z" };
    expect(assess(s)).toMatchObject({ ready: true, reviewed: true, canExport: true });
    expect(assess(s, { numericReviewed: false }).canExport).toBe(false);
    expect(assess(s, { numericBlocked: true }).canExport).toBe(false);
    expect(assess(s, { sourceFingerprint: "changed-ledger-or-text" }))
      .toMatchObject({ ready: true, reviewed: false, canExport: false });
  });
  it("keeps a micro-sized company in ordinary notes unless it selects the special regime", () => {
    const r = assess(settings(profile({ size: "micro" })));
    expect(r).toMatchObject({ mode: "notes", ready: true });
    expect(r.sections.map(s => s.code))
      .toEqual(["accounting_policies", "explanations", "profit_proposal", "profit_adopted"]);
    expect(r.documents.find(d => d.code === "micro")?.status).toBe("not_required");
  });
  it("requires the exact four micro disclosures and historical-cost attestation, not ordinary notes", () => {
    const s = settings(profile({ size: "micro", microRegime: "yes" }),
      narrative({ accountingPolicies: "", explanations: "" }));
    expect(assess(s)).toMatchObject({ mode: "micro", ready: true });
    expect(assess(s).sections.map(s => s.code))
      .toEqual(["disclosure4", "disclosure5", "disclosure6", "disclosure10", "profit_proposal", "profit_adopted"]);
    s.narrative!.historicalCostConfirmed = false;
    expect(assess(s).issues.map(i => i.code)).toContain("publication_historical_cost");
  });
  it.each(["disclosure4", "disclosure5", "disclosure6", "disclosure10"] as const)(
    "does not silently default missing %s to none", key => {
      const s = settings(profile({ size: "micro", microRegime: "yes" }), narrative({ [key]: "  \n" }));
      const r = assess(s);
      expect(r.ready).toBe(false);
      expect(r.issues.map(i => i.code)).toContain(`publication_missing_${key}`);
    },
  );
  it.each(["accountingPolicies", "explanations"] as const)("requires ordinary %s", key => {
    expect(assess(settings(profile(), narrative({ [key]: "\t\n" }))).ready).toBe(false);
  });
  it("does not convert a draft decision into an adopted decision, even when its text is filled", () => {
    const n = narrative();
    n.profitDecision.adopted = false;
    const r = assess(settings(profile(), n));
    expect(r.ready).toBe(false);
    expect(r.sections.some(s => s.code === "profit_adopted")).toBe(false);
    expect(r.documents.find(d => d.code === "profit_adopted")?.status).toBe("missing");
    expect(r.sections.find(s => s.code === "profit_proposal")?.text).toContain("Predlog:");
  });
  it.each(["text", "adoptedBy", "adoptedDate", "reference"] as const)("requires decision %s", key => {
    const n = narrative();
    n.profitDecision[key] = "";
    expect(assess(settings(profile(), n)).ready).toBe(false);
  });
  it("does not use the proposal as the decision or the decision as the proposal", () => {
    const n = narrative(); n.profitProposal.text = "";
    const r = assess(settings(profile(), n));
    expect(r.ready).toBe(false);
    expect(r.documents.find(d => d.code === "profit_proposal")?.status).toBe("missing");
    expect(r.documents.find(d => d.code === "profit_adopted")?.status).toBe("present");
  });
  it.each(["2026-02-30", "2025-01-10", "2026-10-03"])("rejects invalid/premature/future decision date %s", adoptedDate => {
    const n = narrative(); n.profitDecision.adoptedDate = adoptedDate;
    expect(assess(settings(profile(), n)).ready).toBe(false);
  });
  it("requires a decision date consistent with the related proposal", () => {
    const n = narrative(); n.profitDecision.adoptedDate = "2026-01-31";
    expect(assess(settings(profile(), n)).issues.map(i => i.code)).toContain("publication_decision_order");
  });
  it("requires the simplified declaration only for an explicitly selected eligible profile", () => {
    const s = settings(profile({ simplifiedSubmission: "yes" }));
    expect(assess(s).ready).toBe(false);
    s.narrative!.simplifiedStatement = {
      text: "Besedilo soglasja za uporabo podatkov tudi za javno objavo.",
      signatory: "Pooblaščeni zastopnik", date: "2026-03-11", confirmed: false,
    };
    expect(assess(s).ready).toBe(false);
    expect(assess(s).sections.some(v => v.code === "statement")).toBe(false);
    s.narrative!.simplifiedStatement.confirmed = true;
    const r = assess(s);
    expect(r.ready).toBe(true);
    expect(r.sections.find(v => v.code === "statement")?.text).toContain("ni elektronski podpis");
    s.profile!.simplifiedSubmission = "no";
    expect(assess(s).sections.some(v => v.code === "statement")).toBe(false);
    expect(assess(s).documents.find(v => v.code === "statement")?.status).toBe("not_required");
  });
  it.each([
    { auditRequired: "yes", simplifiedSubmission: "no" },
    { groupMember: "yes" },
    { groupMember: "yes", consolidationRequired: "yes" },
    { legalForm: "sp" },
    { framework: "IFRS" },
    { size: "medium" },
  ] as Partial<AjpesAnnualProfile>[])("never calls an unsupported package complete: %j", change => {
    expect(assess(settings(profile(change)))).toMatchObject({ supported: false, ready: false, canExport: false });
  });
  it("does not extend full publication support to an unverified year", () => {
    const s = settings(profile({ periodStart: "2026-01-01", periodEnd: "2026-12-31" }));
    expect(assess(s, { year: 2026, profileAssessment: assessAjpesProfile(s.profile, 2026) }).supported).toBe(false);
  });
  it("requires a genuinely confirmed profile and preserves plaintext without executing markup", () => {
    const s = settings(profile({ confirmed: false }), narrative({ explanations: "<script>alert(1)</script>\nČ š ž" }));
    const r = assess(s);
    expect(r.ready).toBe(false);
    expect(r.issues.map(i => i.code)).toContain("publication_profile");
    expect(r.sections.find(v => v.code === "explanations")?.text).toBe("<script>alert(1)</script>\nČ š ž");
  });
});