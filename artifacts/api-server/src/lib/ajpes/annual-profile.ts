import type { AjpesReportIssue } from "./annual-model";

export type ProfileDecision = "unknown" | "yes" | "no";
export interface AjpesSizeCriteria { assets: string; revenue: string; employees: string }
export interface AjpesAnnualProfile {
  legalForm: "unknown" | "doo" | "dd" | "sp" | "cooperative" | "other";
  framework: "unknown" | "SRS" | "IFRS";
  size: "unknown" | "micro" | "small" | "medium" | "large";
  periodStart: string;
  periodEnd: string;
  currentCriteria: AjpesSizeCriteria;
  previousCriteria: AjpesSizeCriteria;
  sizeBasis: string;
  previousYearException: string;
  microRegime: ProfileDecision;
  auditRequired: ProfileDecision;
  groupMember: ProfileDecision;
  consolidationRequired: ProfileDecision;
  simplifiedSubmission: ProfileDecision;
  foreignOperations: ProfileDecision;
  sfrRequired: ProfileDecision;
  cppsRequired: ProfileDecision;
  listed: ProfileDecision;
  specialRegime: ProfileDecision;
  confirmationBasis: string;
  confirmed: boolean;
}
export interface AjpesReportingObligation {
  code: string; label: string;
  purpose: "statistics" | "publication" | "periodic";
  status: "required" | "conditional" | "not_required";
  available: boolean;
  explanation: string;
}
export interface AjpesProfileAssessment {
  rulesVersion: string;
  catalogYear: number;
  supported: boolean;
  confirmed: boolean;
  obligations: AjpesReportingObligation[];
  issues: AjpesReportIssue[];
  sources: string[];
}

// Size is an accountant's documented conclusion, not a one-year heuristic.
// This phase supports the existing GD catalog; it does not manufacture other forms.
export const AJPES_PROFILE_RULES_VERSION = "gd-profile-2026-10-02";
export function assessAjpesProfile(
  profile: AjpesAnnualProfile | undefined, year: number,
  metadata: Record<string, string> = {},
): AjpesProfileAssessment {
  const issues: AjpesReportIssue[] = [];
  const issue = (code: string, message: string, blocking = true) =>
    issues.push({ code: `profile_${code}`, message, blocking });
  const p = profile;
  if (!p) issue("missing", "Dopolnite in potrdite letni profil podjetja; stari podatki niso samodejno potrjen profil.");
  if (p) {
    for (const [key, label] of [
      ["legalForm", "pravno obliko"], ["framework", "računovodski okvir"], ["size", "velikost družbe"],
      ["microRegime", "uporabo posebnega mikro režima"], ["auditRequired", "revizijo ali preiskavo"],
      ["groupMember", "članstvo v skupini"], ["consolidationRequired", "konsolidacijsko obveznost"],
      ["simplifiedSubmission", "poenostavljeno predložitev"], ["foreignOperations", "poslovanje s tujino"],
      ["sfrRequired", "zavezanost za SFR"], ["cppsRequired", "zavezanost za ČPPS"],
      ["listed", "trgovanje z vrednostnimi papirji na organiziranem trgu"],
      ["specialRegime", "poseben status (npr. javni interes, finančna ali investicijska družba)"],
    ] as const) {
      if (!p[key] || p[key] === "unknown") issue(`missing_${key}`, `Opredelite ${label}.`);
    }
    const dateValid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
      Number.isFinite(Date.parse(`${value}T00:00:00Z`)) &&
      new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
    if (!dateValid(p.periodStart) || !dateValid(p.periodEnd) ||
      p.periodStart > p.periodEnd || Number(p.periodEnd.slice(0, 4)) !== year) {
      issue("period", "Vnesite veljavno poslovno obdobje, ki se konča v izbranem letu.");
    }
    const criteriaValid = (criteria: AjpesSizeCriteria | undefined) =>
      !!criteria && [criteria.assets, criteria.revenue, criteria.employees]
        .every(value => /^\d{1,13}(?:\.\d{1,2})?$/.test(value));
    if (!criteriaValid(p.currentCriteria)) issue("current_criteria", "Vnesite sredstva, čiste prihodke od prodaje in povprečno število zaposlenih za tekoče leto; ničla je veljaven podatek.");
    if (Object.values(p.previousCriteria ?? {}).some(value =>
      value !== "" && !/^\d{1,13}(?:\.\d{1,2})?$/.test(value)))
      issue("previous_invalid", "Vnesena merila prejšnjega leta morajo biti nenegativna decimalna števila; izjema ne opravičuje neveljavnih vrednosti.");
    if (!criteriaValid(p.previousCriteria) && !p.previousYearException.trim())
      issue("previous_criteria", "Vnesite merila prejšnjega leta ali dokumentirano izjemo (npr. novo ustanovljena družba).");
    if (!p.sizeBasis.trim()) issue("size_basis", "Navedite podlago za velikost, presojo več let in morebitne posebnosti; program velikosti ne določa iz enega leta.");
    if (!p.confirmationBasis.trim()) issue("basis", "Navedite podlago za potrditev profila, izjem in periodičnih obveznosti.");
    if (!p.confirmed) issue("unconfirmed", "Računovodja mora izrecno potrditi letni profil.");
    if (p.microRegime === "yes" && (p.size !== "micro" || !["doo", "dd"].includes(p.legalForm) ||
      p.framework !== "SRS" || p.listed !== "no" || p.specialRegime !== "no"))
      issue("micro_ineligible", "Posebni mikro režim ni dovoljen za izbrani profil. Preverite pogoje 70.a člena ZGD-1.");
    if (p.simplifiedSubmission === "yes" && (p.auditRequired !== "no" || p.listed !== "no" ||
      p.specialRegime !== "no" || !["micro", "small"].includes(p.size) ||
      p.periodStart !== `${year}-01-01` || p.periodEnd !== `${year}-12-31`))
      issue("simplified_ineligible", "Poenostavljena predložitev zahteva ustrezen nerevidiran profil in koledarsko poslovno leto; preverite Navodilo NAVO1119.");
    if (p.consolidationRequired === "yes" && p.groupMember === "no")
      issue("group_conflict", "Konsolidacijska obveznost ni skladna z navedbo, da družba ni članica skupine.");
    if (["medium", "large"].includes(p.size) && p.auditRequired === "no")
      issue("audit_conflict", "Za srednjo ali veliko kapitalsko družbo preverite obvezno revizijo.");
    const sizeCode = { micro: "4", small: "3", medium: "2", large: "1", unknown: "" }[p.size];
    const methodCode = p.framework === "SRS" ? "2" : p.framework === "IFRS" ? "1" : "";
    if ((metadata.size && metadata.size !== sizeCode) ||
      (metadata.accountingMethod && metadata.accountingMethod !== methodCode))
      issue("metadata_conflict", "Velikost ali računovodski okvir v številčnih nastavitvah se ne ujema z letnim profilom.");
  }
  const supported = !!p && ["doo", "dd"].includes(p.legalForm) &&
    ["micro", "small"].includes(p.size) && p.framework === "SRS" &&
    p.listed === "no" && p.specialRegime === "no" &&
    p.periodStart === `${year}-01-01` && p.periodEnd === `${year}-12-31`;
  if (p && !supported) issue("unsupported", "Prva faza podpira običajne mikro in majhne d.o.o./d.d. po SRS s koledarskim letom. Za druge profile ni dovoljen samodejen izvoz obrazca gospodarskih družb.");
  const obligations: AjpesReportingObligation[] = [];
  const add = (code: string, label: string, purpose: AjpesReportingObligation["purpose"],
    status: AjpesReportingObligation["status"], available: boolean, explanation: string) =>
    obligations.push({ code, label, purpose, status, available, explanation });
  const required = p && ["doo", "dd"].includes(p.legalForm) ? "required" : "conditional";
  const decision = (value?: ProfileDecision) => value === "yes" ? "required" : value === "no" ? "not_required" : "conditional";
  const numericAvailable = supported && year === 2025;
  for (const [code, label] of [
    ["bs", "Bilanca stanja s primerjalnim letom"], ["ipi", "Izkaz poslovnega izida s primerjalnim letom"],
    ["profit", "Podatki bilančnega dobička / izgube"], ["definition", "Opredelitev družbe in podatki o zaposlenih"],
  ]) add(code, label, "statistics", required, numericAvailable, "Obstoječi številčni katalog GD 2025; obvezne vrednosti in kontrole so v predogledu AOP.");
  add("foreign", "Dodatni podatki o poslovanju s tujino", "statistics", decision(p?.foreignOperations), numericAvailable, "NAVO1119, 4. točka; obseg določa dejansko poslovanje z nerezidenti.");
  add("public_report", "Letno poročilo za javno objavo", "publication", required, false, "Številčni PDF/XLSX je pregled izkazov, ne celovit dokument za javno objavo (faza B).");
  add("notes", "Pojasnila k izkazom", "publication", p?.microRegime === "yes" ? "not_required" : p?.microRegime === "no" ? required : "conditional", false, "Za običajni režim se pripravi v fazi B; poseben mikro režim zahteva druga razkritja.");
  add("micro", "Predpisana mikro razkritja ob bilanci", "publication", decision(p?.microRegime), false, "Mikro režim ni oprostitev vseh razkritij; ZGD-1, 70.a člen (faza B).");
  add("profit_proposal", "Predlog razporeditve dobička / obravnavanja izgube", "publication", required, false, "Ločen dokument; številčni izkaz bilančnega dobička ga ne nadomesti (faza B).");
  add("profit_adopted", "Sprejeta razporeditev dobička / obravnavanje izgube", "publication", required, false, "Dejanski sklep pristojnega organa, brez vnaprejšnje potrditve (faza B).");
  add("statement", "Izjava za poenostavljeno predložitev", "publication", decision(p?.simplifiedSubmission), false, "Izbira profila ni podpis izjave in ne dokazuje predložitve AJPES (faza B/C).");
  add("audit", "Revizija / preiskava in pripadajoče poročilo", "publication", decision(p?.auditRequired), false, "Priloži se dejansko revizorjevo poročilo; obveznost presodi računovodja.");
  const extended = !p || p.size === "unknown" || p.specialRegime !== "no" || p.listed !== "no"
    ? "conditional" : ["medium", "large"].includes(p.size) ? "required" : "not_required";
  for (const [code, label] of [["cash_flow", "Izkaz denarnih tokov"], ["equity", "Izkaz gibanja kapitala"], ["business", "Poslovno poročilo"]])
    add(code, label, "publication", extended, false, "NAVO1119, 9. točka; posebni zavezanci zahtevajo ločen profil (faza D).");
  add("consolidation", "Konsolidirano letno poročilo", "publication", decision(p?.consolidationRequired), false, "Ločen paket z izločitvami in primerjalnimi podatki; vsota družb ni konsolidacija (faza D).");
  add("sfr", "Statistika finančnih računov (SFR)", "periodic", decision(p?.sfrRequired), false, "Samostojen periodični obrazec; obveznost temelji na veljavnih pravilih in obvestilu AJPES (faza D).");
  add("cpps", "Četrtletno poročanje (ČPPS)", "periodic", decision(p?.cppsRequired), false, "Samostojen periodični obrazec; preverite izbiro oziroma obvestilo AJPES (faza D).");
  if (year !== 2025) issue("catalog_year", "Za to leto uradni katalog in XML še nista preverjena; na voljo je le informativni številčni pregled.", false);
  return {
    rulesVersion: AJPES_PROFILE_RULES_VERSION, catalogYear: 2025,
    supported, confirmed: !!p?.confirmed && !issues.some(i => i.blocking),
    obligations, issues,
    sources: ["https://pisrs.si/pregledPredpisa?id=NAVO1119",
      "https://pisrs.si/pregledPredpisa?id=ZAKO4291",
      "https://www.ajpes.si/Letna_porocila/Predlozitev/Druzbe_in_zadruge/Pogosta_vprasanja"],
  };
}