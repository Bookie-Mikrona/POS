import type { AjpesAnnualProfile, AjpesAnnualSettings } from "@workspace/api-client-react";
import { normalizeAmount } from "./ajpes-annual-report-model";

export const DECISIONS = [
  ["microRegime", "Posebni mikro režim (70.a člen)"], ["auditRequired", "Revizija ali preiskava obvezna"], ["groupMember", "Članica skupine"],
  ["consolidationRequired", "Konsolidacija obvezna"], ["simplifiedSubmission", "Poenostavljena oddaja"],
  ["foreignOperations", "Tuje poslovanje"], ["sfrRequired", "Obveznost SFR"], ["cppsRequired", "Obveznost ČPPS"],
  ["listed", "Kotirana družba"], ["specialRegime", "Poseben režim"],
] as const;
export type DecisionKey = typeof DECISIONS[number][0];

export const LEGAL_FORMS: [string, string][] = [["doo", "d.o.o."], ["dd", "d.d."], ["sp", "s.p."], ["cooperative", "Zadruga"], ["other", "Drugo"]];
export const FRAMEWORKS: [string, string][] = [["SRS", "SRS"], ["IFRS", "MSRP (IFRS)"]];
export const PROFILE_SIZES: [string, string][] = [["micro", "Mikro"], ["small", "Majhna"], ["medium", "Srednja"], ["large", "Velika"]];
const SIZE_CODE: Record<string, string> = { micro: "4", small: "3", medium: "2", large: "1" };
const METHOD_CODE: Record<string, string> = { SRS: "2", IFRS: "1" };

const crit = () => ({ assets: "", revenue: "", employees: "" });
export function defaultProfile(): AjpesAnnualProfile {
  return {
    legalForm: "unknown", framework: "unknown", size: "unknown", periodStart: "", periodEnd: "",
    currentCriteria: crit(), previousCriteria: crit(), sizeBasis: "", previousYearException: "",
    microRegime: "unknown", auditRequired: "unknown", groupMember: "unknown", consolidationRequired: "unknown",
    simplifiedSubmission: "unknown", foreignOperations: "unknown", sfrRequired: "unknown", cppsRequired: "unknown",
    listed: "unknown", specialRegime: "unknown", confirmationBasis: "", confirmed: false,
  };
}

function syncLegacy(p: AjpesAnnualProfile, md: Record<string, string>): Record<string, string> {
  const m = { ...md };
  if (SIZE_CODE[p.size]) m.size = SIZE_CODE[p.size]; else delete m.size;
  if (METHOD_CODE[p.framework]) m.accountingMethod = METHOD_CODE[p.framework]; else delete m.accountingMethod;
  return m;
}

/** Any profile field change clears confirmation and syncs legacy metadata. */
export function changeProfile(s: AjpesAnnualSettings, change: Partial<AjpesAnnualProfile>): AjpesAnnualSettings {
  const p = { ...(s.profile ?? defaultProfile()), ...change, confirmed: false };
  return { ...s, profile: p, metadata: syncLegacy(p, s.metadata) };
}

export function confirmProfile(s: AjpesAnnualSettings): AjpesAnnualSettings {
  const p = { ...(s.profile ?? defaultProfile()), confirmed: true };
  return { ...s, profile: p, metadata: syncLegacy(p, s.metadata) };
}

export function validCriterion(v: string): boolean {
  const n = normalizeAmount(v);
  return n !== null && /^\d{1,13}(\.\d{1,2})?$/.test(n);
}
function realDate(v: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : d;
}
const CK = ["assets", "revenue", "employees"] as const;

export function badCriteria(p: AjpesAnnualProfile): string[] {
  const bad: string[] = [];
  for (const g of ["currentCriteria", "previousCriteria"] as const)
    for (const k of CK) {
      const v = p[g][k];
      if (v.trim() !== "" && !validCriterion(v)) bad.push(`${g}.${k}`);
    }
  return bad;
}

export function profileIncomplete(p: AjpesAnnualProfile, year?: number): string[] {
  const r: string[] = [];
  if (p.legalForm === "unknown") r.push("pravnoorganizacijska oblika");
  if (p.framework === "unknown") r.push("računovodski okvir");
  if (p.size === "unknown") r.push("velikost");
  const a = realDate(p.periodStart), b = realDate(p.periodEnd);
  if (!a || !b || b < a) r.push("veljavno obdobje");
  else if (year !== undefined && b.getUTCFullYear() !== year) r.push(`obdobje mora skleniti v letu ${year}`);
  if (CK.some((k) => p.currentCriteria[k].trim() === "")) r.push("merila tekočega leta");
  if (CK.some((k) => p.previousCriteria[k].trim() === "") && !p.previousYearException.trim()) r.push("merila prejšnjega leta ali izjema");
  if (!p.sizeBasis.trim()) r.push("podlaga za velikost");
  if (DECISIONS.some(([k]) => p[k] === "unknown")) r.push("ocena vseh odločitev");
  if (!p.confirmationBasis.trim()) r.push("podlaga potrditve");
  if (badCriteria(p).length) r.push("neveljavna merila");
  return r;
}
