import type {
  AjpesAnnualSettings,
  AjpesReportIssue,
} from "./annual-model";
import type { AjpesProfileAssessment } from "./annual-profile";

export interface AjpesProfitProposal {
  text: string;
  preparedBy: string;
  preparedDate: string;
}
export interface AjpesProfitDecision {
  text: string;
  adoptedBy: string;
  adoptedDate: string;
  reference: string;
  adopted: boolean;
}
export interface AjpesSimplifiedStatement {
  text: string;
  signatory: string;
  date: string;
  confirmed: boolean;
}
export interface AjpesAnnualNarrative {
  accountingPolicies: string;
  explanations: string;
  disclosure4: string;
  disclosure5: string;
  disclosure6: string;
  disclosure10: string;
  historicalCostConfirmed: boolean;
  profitProposal: AjpesProfitProposal;
  profitDecision: AjpesProfitDecision;
  simplifiedStatement: AjpesSimplifiedStatement;
}
/** Only the save route may create this proof after validating a fresh snapshot. */
export interface AjpesPublicationReview {
  fingerprint: string;
  reviewedBy: string;
  reviewedAt: string;
}
export interface AjpesPublicationDocument {
  code: string;
  label: string;
  status: "present" | "missing" | "not_required";
}
export interface AjpesPublicationSection {
  code: string;
  label: string;
  text: string;
}
export interface AjpesPublicationAssessment {
  rulesVersion: string;
  supported: boolean;
  mode: "notes" | "micro" | "unknown";
  /** Content completeness; numerical review is a separate prerequisite. */
  ready: boolean;
  reviewed: boolean;
  canExport: boolean;
  contentFingerprint: string;
  documents: AjpesPublicationDocument[];
  sections: AjpesPublicationSection[];
  issues: AjpesReportIssue[];
}

export const AJPES_PUBLICATION_RULES_VERSION = "gd-publication-2026-10-02";

export const MICRO_DISCLOSURES = [
  ["disclosure4", "Pogojne finančne obveznosti zunaj bilance (69/2, 4. točka)"],
  ["disclosure5", "Obveznosti, zavarovane s stvarnim jamstvom (69/2, 5. točka)"],
  ["disclosure6", "Predujmi, posojila in poroštva določenim osebam (69/2, 6. točka)"],
  ["disclosure10", "Lastni deleži (69/2, 10. točka)"],
] as const;

function filled(value: string | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}
function realDate(value: string | undefined): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * NAVO1119 and ZGD-1 58, 69, 70.a: content is authored and attested by a
 * responsible human, never inferred from AOP zeros. These checks establish
 * completeness of the prepared package, not a legal opinion or a signature.
 * Publication issues must not be merged into numerical/statistical blockers.
 */
export function assessAjpesPublication(input: {
  year: number;
  settings: AjpesAnnualSettings;
  profileAssessment: AjpesProfileAssessment;
  sourceFingerprint: string;
  numericReviewed: boolean;
  numericBlocked: boolean;
  today?: string;
}): AjpesPublicationAssessment {
  const { year, settings, profileAssessment, sourceFingerprint } = input;
  const p = settings.profile;
  const n = settings.narrative;
  const issues: AjpesReportIssue[] = [];
  const documents: AjpesPublicationDocument[] = [];
  const sections: AjpesPublicationSection[] = [];
  const issue = (code: string, message: string) =>
    issues.push({ code: `publication_${code}`, message, blocking: true });
  const section = (code: string, label: string, text: string | undefined) => {
    if (filled(text)) sections.push({ code, label, text: text!.trim() });
  };
  const document = (code: string, label: string, required: boolean, present: boolean) => {
    documents.push({ code, label, status: !required ? "not_required" : present ? "present" : "missing" });
    if (required && !present) issue(`missing_${code}`, `Dopolnite: ${label}. Prazna predloga ni dokument.`);
  };
  const today = input.today ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
  const date = (code: string, label: string, value: string | undefined): boolean => {
    if (!realDate(value)) {
      issue(`${code}_date`, `Vnesite veljaven datum: ${label}.`);
      return false;
    }
    if (p?.periodEnd && value! < p.periodEnd) {
      issue(`${code}_date_before_period`, `${label} ne sme biti pred koncem obdobja poročila.`);
      return false;
    }
    if (value! > today) {
      issue(`${code}_future_date`, `${label} ne sme biti v prihodnosti; program ne potrjuje prihodnjih dejanj.`);
      return false;
    }
    return true;
  };
  const mode = p?.microRegime === "yes" ? "micro"
    : p?.microRegime === "no" ? "notes" : "unknown";
  const supported = profileAssessment.supported && year === 2025 &&
    p?.auditRequired === "no" && p.consolidationRequired === "no" && p.groupMember === "no";
  if (!supported) {
    issue("unsupported", "Besedilni paket za predajo podpira letnik 2025 ter običajne samostojne nerevidirane mikro/majhne družbe. Revizijska poročila, skupine in konsolidacija zahtevajo ločen paket; osnutek lahko shranite.");
  }
  if (!profileAssessment.confirmed) {
    issue("profile", "Pred potrditvijo besedilnega paketa dopolnite in potrdite veljaven letni profil.");
  }
  if (mode === "unknown") issue("mode", "Najprej določite uporabo posebnega mikro režima.");

  const notesPresent = filled(n?.accountingPolicies) && filled(n?.explanations);
  document("notes", "Računovodske usmeritve in pojasnila k izkazom", mode !== "micro", notesPresent);
  if (mode === "notes") {
    section("accounting_policies", "Sprejete računovodske usmeritve", n?.accountingPolicies);
    section("explanations", "Pojasnila k izkazom", n?.explanations);
  }
  const microPresent = !!n?.historicalCostConfirmed &&
    MICRO_DISCLOSURES.every(([key]) => filled(n?.[key]));
  document("micro", "Štiri mikro razkritja in potrditev izvirne vrednosti", mode === "micro", microPresent);
  if (mode === "micro") {
    if (!n?.historicalCostConfirmed) issue("historical_cost", "Za posebni mikro režim potrdite vrednotenje po izvirni vrednosti; 70.a člen ne dovoljuje poštene vrednosti.");
    for (const [key, label] of MICRO_DISCLOSURES) {
      if (!filled(n?.[key])) issue(`missing_${key}`, `Vnesite ${label}; tudi odsotnost takih postavk mora biti izrecno navedena.`);
      section(key, label, n?.[key]);
    }
  }

  const proposal = n?.profitProposal;
  const proposalDate = date("proposal", "Datum predloga", proposal?.preparedDate);
  document("profit_proposal", "Predlog razporeditve dobička oziroma obravnavanja izgube",
    true, filled(proposal?.text) && filled(proposal?.preparedBy) && proposalDate);
  if (filled(proposal?.text)) section("profit_proposal",
    "Predlog razporeditve dobička oziroma obravnavanja izgube",
    `Pripravljavec: ${proposal?.preparedBy ?? ""}\nDatum predloga: ${proposal?.preparedDate ?? ""}\n\n${proposal!.text}`);

  const decision = n?.profitDecision;
  const decisionDate = date("decision", "Datum sprejetega sklepa", decision?.adoptedDate);
  const decisionPresent = filled(decision?.text) && filled(decision?.adoptedBy) &&
    filled(decision?.reference) && !!decision?.adopted && decisionDate;
  document("profit_adopted", "Dejansko sprejeti sklep pristojnega organa", true, decisionPresent);
  if (realDate(proposal?.preparedDate) && realDate(decision?.adoptedDate) &&
    decision!.adoptedDate < proposal!.preparedDate) {
    issue("decision_order", "Datum sprejetega sklepa ne sme biti pred datumom pripadajočega predloga. Preverite, da gre za isti postopek.");
  }
  // A draft is visible in the editor but is never rendered as an adopted act.
  if (decisionPresent) section("profit_adopted", "Sprejeti sklep o dobičku oziroma izgubi",
    `Pristojni organ: ${decision!.adoptedBy}\nDatum sprejetja: ${decision!.adoptedDate}\nOznaka sklepa / zapisnika: ${decision!.reference}\n\n${decision!.text}`);

  const statement = n?.simplifiedStatement;
  const statementRequired = p?.simplifiedSubmission === "yes";
  let statementPresent = false;
  if (statementRequired) {
    const statementDate = date("statement", "Datum izjave", statement?.date);
    statementPresent = filled(statement?.text) && filled(statement?.signatory) &&
      !!statement?.confirmed && statementDate;
  }
  document("statement", "Potrjena izjava za poenostavljeno predložitev", statementRequired, statementPresent);
  if (statementRequired && statementPresent) section("statement", "Izjava za poenostavljeno predložitev",
    `Naveden podpisnik: ${statement!.signatory}\nDatum izjave: ${statement!.date}\n\n${statement!.text}\n\nPotrditev besedila v Bookie ni elektronski podpis ali dokazilo predložitve AJPES. Podpis in predložitev se opravita ločeno.`);

  const ready = supported && !issues.some(i => i.blocking);
  const reviewed = ready && !!sourceFingerprint &&
    settings.publicationReview?.fingerprint === sourceFingerprint;
  return {
    rulesVersion: AJPES_PUBLICATION_RULES_VERSION, supported, mode,
    ready, reviewed,
    canExport: reviewed && input.numericReviewed && !input.numericBlocked,
    contentFingerprint: sourceFingerprint, documents, sections, issues,
  };
}