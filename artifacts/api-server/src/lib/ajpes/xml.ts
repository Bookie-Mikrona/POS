import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";

/**
 * AJPES annual report XML (GD / gospodarske družbe).
 *
 * The published LP XSD leaves the applicable AOP catalogue to the report
 * form. This exporter enforces the complete official LP2025 GD catalogue and
 * never fills absent rows with invented zeroes.
 */
export interface AjpesXmlInput {
  /** This first implementation deliberately supports LP2025 only. */
  year: 2025;
  company: {
    registrationNumber: string;
    taxNumber?: string;
    name?: string;
    registeredOffice?: string;
    accountablePerson?: string;
    phone?: string;
    contactEmail?: string;
    portalEmail?: string;
    manager?: string;
    periodStart?: string;
    periodEnd?: string;
    accountingMethod?: 1 | 2;
    size?: 1 | 2 | 3 | 4;
  };
  /** Optional workbook text attachments; AJPES decides if any are required. */
  notes?: {
    explanations?: string;
    disclosure4?: string;
    disclosure5?: string;
    disclosure6?: string;
    disclosure10?: string;
    profitAllocationProposal?: string;
  };
  /** AOP identifier -> amount in EUR for the reporting year. */
  current: Record<string, string | number>;
  /** AOP identifier -> amount in EUR for the previous year. */
  previous: Record<string, string | number>;
  /** Optional clock override, primarily useful for deterministic exports. */
  generatedAt?: Date;
}

export class AjpesXmlInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AjpesXmlInputError";
  }
}

const SCHEMA_URL = "https://www.ajpes.si/xml_sheme/LP_V1_3.xsd";
const REQUIRED_AOP_IDS = AJPES_GD_AOP_CATALOG_2025.aops.map(({ id }) => id);
const REQUIRED_AOP_ID_SET = new Set<string>(REQUIRED_AOP_IDS);

function escapeXml(value: string): string {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint === 0 ||
      (codePoint >= 0x01 && codePoint <= 0x08) ||
      codePoint === 0x0b ||
      codePoint === 0x0c ||
      (codePoint >= 0x0e && codePoint <= 0x1f) ||
      (codePoint >= 0xd800 && codePoint <= 0xdfff) ||
      codePoint === 0xfffe ||
      codePoint === 0xffff
    ) {
      throw new AjpesXmlInputError("Text contains a character not permitted in XML 1.0.");
    }
  }
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AjpesXmlInputError(`${field} is required.`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  return requiredText(value, field);
}

function xmlElement(tag: string, value: string | undefined): string {
  return value === undefined ? "" : `<${tag}>${escapeXml(value)}</${tag}>`;
}

function formatAmount(value: string | number, field: string): string {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new AjpesXmlInputError(`${field} must be a decimal EUR amount.`);
  }
  const lexical = typeof value === "number" ? String(value) : value.trim();
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(lexical);
  if (!match) {
    throw new AjpesXmlInputError(`${field} must be a finite decimal amount using a dot as decimal separator.`);
  }

  const negative = match[1] === "-";
  const whole = BigInt(match[2]);
  const fraction = match[3] ?? "";
  let cents = whole * 100n + BigInt((fraction + "00").slice(0, 2));
  if (fraction.length > 2 && fraction[2] >= "5") cents += 1n;

  const sign = negative && cents !== 0n ? "-" : "";
  return `${sign}${cents / 100n}.${String(cents % 100n).padStart(2, "0")}`;
}

function isoDate(value: unknown, field: string): string {
  const date = requiredText(value, field);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new AjpesXmlInputError(`${field} must use YYYY-MM-DD.`);
  }
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new AjpesXmlInputError(`${field} is not a valid calendar date.`);
  }
  return date;
}

function recordKeys(value: unknown, field: string): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new AjpesXmlInputError(`${field} must be an AOP-to-amount object.`);
  }
  const keys = Object.keys(value);
  if (keys.length === 0) {
    throw new AjpesXmlInputError(`${field} must contain at least one AOP amount.`);
  }
  for (const id of keys) {
    if (!/^\d{3,4}$/.test(id)) {
      throw new AjpesXmlInputError(`${field} contains invalid AOP ID "${id}"; AJPES requires 3–4 digits.`);
    }
  }
  return keys;
}

function amountAt(record: Record<string, string | number>, id: string, field: string): string {
  if (!Object.prototype.hasOwnProperty.call(record, id)) {
    throw new AjpesXmlInputError(`${field} is missing AOP ${id}; missing values are not replaced with zero.`);
  }
  return formatAmount(record[id], `${field} AOP ${id}`);
}

function optionalCode(value: unknown, field: string, min: number, max: number): string | undefined {
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || (value as number) < min || (value as number) > max) {
    throw new AjpesXmlInputError(`${field} must be an integer from ${min} to ${max}.`);
  }
  return String(value);
}

export function generateAjpesXml(input: AjpesXmlInput): string {
  if (!input || typeof input !== "object") {
    throw new AjpesXmlInputError("Annual report input is required.");
  }
  if (input.year !== 2025) {
    throw new AjpesXmlInputError("AJPES XML export currently supports reporting year 2025 only.");
  }
  if (!input.company || typeof input.company !== "object") {
    throw new AjpesXmlInputError("Company data is required.");
  }
  const company = input.company;
  const registrationNumber = requiredText(company.registrationNumber, "company.registrationNumber");
  if (!/^\d{7,10}$/.test(registrationNumber)) {
    throw new AjpesXmlInputError("company.registrationNumber must contain 7–10 digits (AJPES registration number).");
  }
  const taxNumber = optionalText(company.taxNumber, "company.taxNumber");
  if (taxNumber !== undefined && !/^\d{8}$/.test(taxNumber)) {
    throw new AjpesXmlInputError("company.taxNumber must contain exactly 8 digits.");
  }
  const phone = optionalText(company.phone, "company.phone");
  if (phone !== undefined && (phone.length < 7 || phone.length > 30)) {
    throw new AjpesXmlInputError("company.phone must contain 7–30 characters.");
  }

  const periodStart = optionalText(company.periodStart, "company.periodStart");
  const periodEnd = optionalText(company.periodEnd, "company.periodEnd");
  if ((periodStart === undefined) !== (periodEnd === undefined)) {
    throw new AjpesXmlInputError("company.periodStart and company.periodEnd must be supplied together.");
  }
  let periodElements = "";
  if (periodStart !== undefined && periodEnd !== undefined) {
    const start = isoDate(periodStart, "company.periodStart");
    const end = isoDate(periodEnd, "company.periodEnd");
    if (start > end || start.slice(0, 4) !== "2025" || end.slice(0, 4) !== "2025") {
      throw new AjpesXmlInputError("Company reporting period must be ordered and fall within 2025.");
    }
    periodElements = `${xmlElement("OSN_Datum_posl_zacetek", start)}${xmlElement("OSN_Datum_posl_konec", end)}`;
  }

  const generatedAt = input.generatedAt ?? new Date();
  if (!(generatedAt instanceof Date) || Number.isNaN(generatedAt.getTime())) {
    throw new AjpesXmlInputError("generatedAt must be a valid Date.");
  }
  const generatedIso = generatedAt.toISOString();
  const identification = `<Ident Vrsta="LP"><Datum>${generatedIso.slice(0, 10)}</Datum><Ura>${generatedIso.slice(11, 19)}</Ura><Nacin_predlozitve>XML datoteka</Nacin_predlozitve></Ident>`;

  const companyElements = [
    xmlElement("OSN_Maticna_stevilka", registrationNumber),
    xmlElement("OSN_Davcna_stevilka", taxNumber),
    xmlElement("OSN_Ime", optionalText(company.name, "company.name")),
    xmlElement("OSN_Sedez", optionalText(company.registeredOffice, "company.registeredOffice")),
    xmlElement("OSN_Odgovorna_oseba_za_bilanco", optionalText(company.accountablePerson, "company.accountablePerson")),
    xmlElement("OSN_Telefonska_stevilka", phone),
    xmlElement("OSN_Enaslov_kontaktne_osebe", optionalText(company.contactEmail, "company.contactEmail")),
    xmlElement("OSN_Enaslov_uporabnika_portala", optionalText(company.portalEmail, "company.portalEmail")),
    xmlElement("OSN_Vodja_podjetja", optionalText(company.manager, "company.manager")),
    periodElements,
    xmlElement("OSN_Racunovodimo", optionalCode(company.accountingMethod, "company.accountingMethod", 1, 2)),
    xmlElement("OSN_Velikost", optionalCode(company.size, "company.size", 1, 4)),
  ].join("");

  const current = input.current as Record<string, string | number>;
  const previous = input.previous as Record<string, string | number>;
  const currentIds = recordKeys(current, "current");
  const previousIds = recordKeys(previous, "previous");
  const missingPrevious = currentIds.filter((id) => !Object.prototype.hasOwnProperty.call(previous, id));
  const missingCurrent = previousIds.filter((id) => !Object.prototype.hasOwnProperty.call(current, id));
  if (missingPrevious.length || missingCurrent.length) {
    const details = [
      missingPrevious.length ? `previous is missing AOPs ${missingPrevious.join(", ")}` : "",
      missingCurrent.length ? `current is missing AOPs ${missingCurrent.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new AjpesXmlInputError(`Current and previous AOP sets must match exactly: ${details}.`);
  }
  const missingCatalogIds = REQUIRED_AOP_IDS.filter(
    (id) => !Object.prototype.hasOwnProperty.call(current, id),
  );
  const unexpectedIds = currentIds.filter((id) => !REQUIRED_AOP_ID_SET.has(id));
  if (missingCatalogIds.length || unexpectedIds.length) {
    const details = [
      missingCatalogIds.length ? `missing official 2025 AOPs ${missingCatalogIds.join(", ")}` : "",
      unexpectedIds.length ? `unexpected AOPs ${unexpectedIds.join(", ")}` : "",
    ].filter(Boolean).join("; ");
    throw new AjpesXmlInputError(`AOP set must match the official 2025 GD catalogue: ${details}.`);
  }

  const data = currentIds
    .sort((a, b) => Number(a) - Number(b))
    .map((id) => {
      const currentAmount = amountAt(current, id, "current");
      const previousAmount = amountAt(previous, id, "previous");
      return `<AOP ID="${id}"><PODATEK TIP="T">${currentAmount}</PODATEK><PODATEK TIP="P">${previousAmount}</PODATEK></AOP>`;
    })
    .join("");

  if (input.notes !== undefined && (!input.notes || typeof input.notes !== "object" || Array.isArray(input.notes))) {
    throw new AjpesXmlInputError("notes must be an object of optional text fields.");
  }
  const notesElements = input.notes
    ? [
        xmlElement("Pojasnila", optionalText(input.notes.explanations, "notes.explanations")),
        xmlElement("Razkritje_informacij_iz_4_tocke", optionalText(input.notes.disclosure4, "notes.disclosure4")),
        xmlElement("Razkritje_informacij_iz_5_tocke", optionalText(input.notes.disclosure5, "notes.disclosure5")),
        xmlElement("Razkritje_informacij_iz_6_tocke", optionalText(input.notes.disclosure6, "notes.disclosure6")),
        xmlElement("Razkritje_informacij_iz_10_tocke", optionalText(input.notes.disclosure10, "notes.disclosure10")),
        xmlElement("Predlog_razporeditve_dobicka", optionalText(input.notes.profitAllocationProposal, "notes.profitAllocationProposal")),
      ].join("")
    : "";

  return `<?xml version="1.0" encoding="UTF-8"?>\n<AjpesDokument xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="${SCHEMA_URL}">${identification}<Osnovni_podatki vrstaPoslovnegaSubjekta="GD">${companyElements}</Osnovni_podatki><Podatki>${data}</Podatki>${notesElements}</AjpesDokument>`;
}