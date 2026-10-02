import type { AjpesAnnualSettings } from "@workspace/api-client-react";

const NUM_RE = /^-?\d+([.,]\d+)?$/;
export function defaultAjpesYear(now = new Date()): number {
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric" }).format(now);
  return Number(y) - 1;
}
export function normalizeAmount(raw: string): string | null {
  const t = raw.trim().replace(/\s/g, "");
  if (!NUM_RE.test(t)) return null;
  return t.replace(",", ".");
}
export function fmtAmount(v: string | undefined | null): string {
  if (v === undefined || v === null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return v;
  return n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export const emptyAjpesSettings: AjpesAnnualSettings = {
  mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {}, excludedEntryIds: [], metadata: {},
};
export const SIZES = [["1", "Velika"], ["2", "Srednja"], ["3", "Majhna"], ["4", "Mikro"]];
export const METHODS = [["1", "MSRP"], ["2", "SRS"]];
export const META: [string, string][] = [
  ["accountablePerson", "Odgovorna oseba"], ["phone", "Telefon"], ["contactEmail", "Kontaktni e-naslov"],
  ["portalEmail", "E-naslov za AJPES portal"], ["manager", "Zakoniti zastopnik"],
];

export function errMsg(e: unknown): string {
  const x = e as { data?: { error?: string; message?: string }; message?: string };
  return x?.data?.error ?? x?.data?.message ?? x?.message ?? "Napaka";
}


export const PREVIOUS_MODES: [string, string][] = [
  ["ledger", "Knjige prejšnjega leta (privzeto)"],
  ["manual", "Ročni primerjalni AOP"],
  ["no-activity", "Potrjujem: prejšnje leto brez poslovanja"],
];

export function cleanSettings(draft: AjpesAnnualSettings): AjpesAnnualSettings {
  const clean = (m: Record<string, string>) => {
    const o: Record<string, string> = {};
    for (const [k, v] of Object.entries(m)) { const n = normalizeAmount(v); if (n !== null) o[k] = n; }
    return o;
  };
  const mappings: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.mappings)) if (v) mappings[k] = v;
  const metadata: Record<string, string> = {};
  for (const [k, v] of Object.entries(draft.metadata)) if (v !== "") metadata[k] = v;
  const out: AjpesAnnualSettings = { ...draft, mappings, currentValues: clean(draft.currentValues), previousValues: clean(draft.previousValues), metadata };
  if (draft.profile) {
    const c = (x: { assets: string; revenue: string; employees: string }) => ({
      assets: normalizeAmount(x.assets) ?? "", revenue: normalizeAmount(x.revenue) ?? "", employees: normalizeAmount(x.employees) ?? "",
    });
    out.profile = { ...draft.profile, currentCriteria: c(draft.profile.currentCriteria), previousCriteria: c(draft.profile.previousCriteria) };
  }
  return out;
}

export function invalidInputs(draft: AjpesAnnualSettings): string[] {
  const bad: string[] = [];
  for (const k of ["currentValues", "previousValues"] as const)
    for (const [code, v] of Object.entries(draft[k])) if (v.trim() !== "" && normalizeAmount(v) === null) bad.push(`${k}:${code}`);
  for (const [id, c] of Object.entries(draft.mappings)) if (c === "ignore" && !(draft.mappingReasons[id] ?? "").trim()) bad.push(`reason:${id}`);
  if (draft.profile)
    for (const g of ["currentCriteria", "previousCriteria"] as const)
      for (const [k, v] of Object.entries(draft.profile[g])) if (String(v).trim() !== "" && !/^\d{1,13}(\.\d{1,2})?$/.test(normalizeAmount(String(v)) ?? "x")) bad.push(`profile:${g}.${k}`);
  return bad;
}
