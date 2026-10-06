import Decimal from "decimal.js";
import { createHash } from "node:crypto";
import { vatSubmissionPeriodBounds } from "./vatSubmissionPreflight";

export type VatForm = "DDV-O" | "RP-O" | "PD-O";
export interface VatFormOptions {
  form: VatForm; year: number; period: string; periodMode: "mesecno" | "trimesecno";
}
export interface VatFormSource {
  id: string; direction: string; codeDirection: string | null; documentNo: string;
  baseAmount: string; vatAmount: string; nonDeductibleVat: string; deductionPercent: string;
  kirBaseField: string | null; kirVatField: string | null; kprBaseField: string | null; kprVatField: string | null;
  code: string | null; triggersRpO: boolean; triggersPdO: boolean; rpOColumn: string | null;
  partnerCountryCode: string | null; partnerVatId: string | null; partnerName: string | null;
  receiptDate: string | null; assetType: string; treatment: number; correctionPeriod: string | null;
  reversedById: string | null; sourceStatus: string | null;
  isReverseCharge?: boolean; isImport?: boolean; pairValid?: boolean;
}
export interface VatFormCompany { id: string; naziv: string; podjetjeDavcna: string; idZaDdv: string | null }
export interface VatCorrection { year: number; month: number; countryCode: string; vatId: string; values: Record<string, string> }
export interface VatFormExportOptions {
  refund?: boolean; deductionProportion?: boolean; contactName?: string; contactPhone?: string; corrections?: VatCorrection[];
}
export const EDAVKI_SCHEMAS = {
  "DDV-O": "DDV_O_11", "RP-O": "VIES_KP_6", "PD-O": "PD_O_2",
} as const;
const EU = new Set("AT BE BG HR CY CZ DK EE FI FR DE EL HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE XI".split(" "));
const DVO_FIELDS = [
  ["f11", "Dobave blaga in storitev"], ["f11a", "Domače dobave po 76.a členu"],
  ["f12", "Dobave blaga in storitev v EU"], ["f13", "Prodaja na daljavo"], ["f14", "Montaža v EU"],
  ["f15", "Oproščene dobave brez odbitka"], ["f21", "Obračunani DDV 22 %"], ["f22", "Obračunani DDV 9,5 %"],
  ["f22a", "Obračunani DDV 5 %"], ["f23", "Pridobitve EU 22 %"], ["f23a", "Storitve EU 22 %"],
  ["f24", "Pridobitve EU 9,5 %"], ["f24a", "Storitve EU 9,5 %"], ["f24b", "Pridobitve EU 5 %"],
  ["f24c", "Storitve EU 5 %"], ["f25", "Druge samoobdavčitve 22 %"], ["f25a", "Druge samoobdavčitve 9,5 %"],
  ["f25b", "Druge samoobdavčitve 5 %"], ["f26", "DDV od uvoza"], ["f31", "Nabave blaga in storitev"],
  ["f31a", "Domače nabave po 76.a členu"], ["f32", "Pridobitve blaga EU"], ["f32a", "Prejete storitve EU"],
  ["f33", "Oproščene nabave"], ["f34", "Nabave nepremičnin"], ["f35", "Nabave drugih OS"],
  ["f41", "Odbitni DDV 22 %"], ["f42", "Odbitni DDV 9,5 %"], ["f42a", "Odbitni DDV 5 %"],
  ["f43", "Pavšalno nadomestilo"], ["f51", "Obveznost DDV"], ["f52", "Presežek DDV"],
] as const;
const OUT_BASE: Record<string, string> = { P7:"f11", P8:"f11a", P9:"f15", P10:"f12", P11:"f12", P12:"f13", P13:"f14" };
const OUT_VAT: Record<string, string> = { P14:"f21", P15:"f22", P16:"f22a", P17:"f23", P18:"f23a", P19:"f24",
  P20:"f24a", P21:"f24b", P22:"f24c", P23:"f25", P24:"f25a", P25:"f25b", P26:"f26" };
const IN_BASE: Record<string, string> = { P8:"f31", P9:"f31a", P10:"f32", P11:"f32a", P12:"f31", P13:"f31", P14:"f33" };
const IN_VAT: Record<string, string> = { P18:"f41", P19:"f42", P20:"f42a", P21:"f43" };
export function vatFormBounds(options: VatFormOptions) {
  if (!Object.hasOwn(EDAVKI_SCHEMAS, options.form) || !Number.isInteger(options.year) || options.year < 2020 || options.year > 2099 ||
      !/^07(0[1-9]|1[0-2])$/.test(options.period) || !["mesecno", "trimesecno"].includes(options.periodMode))
    throw new Error("Neveljaven obrazec ali davčno obdobje.");
  if (options.form !== "DDV-O" && options.periodMode !== "mesecno") throw new Error("RP-O in PD-O se pripravljata za koledarski mesec.");
  const bounds = vatSubmissionPeriodBounds(options.year, options.period, options.periodMode);
  if (!bounds) throw new Error("Neveljavno trimesečje.");
  return bounds;
}
const integerAmount = (n: Decimal) => n.toFixed(0, Decimal.ROUND_HALF_UP);
function partnerIdentity(country: string | null, rawVat: string | null, domestic: boolean) {
  let cc = (country ?? "").trim().toUpperCase().replace(/^GR$/, "EL");
  let vat = (rawVat ?? "").replace(/\s/g, "").toUpperCase();
  if (domestic) {
    if (vat.startsWith("SI")) vat = vat.slice(2);
    if ((cc !== "SI" && cc !== "") || !/^\d{8}$/.test(vat)) throw new Error("PD-O zahteva slovensko ID za DDV prejemnika (SI in 8 številk).");
    return { countryCode: "SI", vatId: vat };
  }
  const rawPrefix = vat.slice(0,2);
  const normalizedPrefix = rawPrefix === "GR" ? "EL" : rawPrefix;
  if (!cc && EU.has(normalizedPrefix)) cc = normalizedPrefix;
  if (EU.has(normalizedPrefix) && normalizedPrefix !== cc)
    throw new Error("Država prejemnika se ne ujema s predpono njegovega ID za DDV.");
  if (EU.has(normalizedPrefix) && normalizedPrefix === cc) vat = vat.slice(2);
  if (!EU.has(cc) || cc === "SI" || !/^[A-Z0-9+*]{1,12}$/.test(vat)) throw new Error("RP-O zahteva ID za DDV prejemnika iz druge države EU (ali XI za blago).");
  return { countryCode: cc, vatId: vat };
}
export function buildVatFormPreview(company: VatFormCompany, options: VatFormOptions, rows: VatFormSource[]) {
  const bounds = vatFormBounds(options);
  const issues: { severity: "ERROR" | "WARNING"; message: string; documentNo: string | null }[] = [];
  const error = (message: string, documentNo: string | null = null) => issues.push({ severity: "ERROR", message, documentNo });
  if (!/^\d{8}$/.test(company.podjetjeDavcna.replace(/^SI/i, ""))) error("Podjetje nima veljavne 8-mestne davčne številke.");
  if (!/^SI\d{8}$/i.test(company.idZaDdv ?? "")) error("Podjetje nima potrjene slovenske identifikacije za DDV.");
  else if (company.idZaDdv!.slice(2) !== company.podjetjeDavcna.replace(/^SI/i, "")) error("ID za DDV in davčna številka podjetja se ne ujemata.");
  const sums: Record<string, Decimal> = {};
  const add = (field: string, value: Decimal) => sums[field] = (sums[field] ?? new Decimal(0)).plus(value);
  const partners = new Map<string, { countryCode: string; vatId: string; name: string; values: Record<string, Decimal> }>();
  for (const row of rows) {
    // A purchase RC mirror has OUT direction but an IN code; never a supplier-side RP/PD supply.
    const rp = row.direction === "OUT" && row.codeDirection === "OUT" &&
      (row.triggersRpO || ["P10","P11"].includes(row.kirBaseField ?? "") || row.code === "SEU-S");
    const pd = row.direction === "OUT" && row.codeDirection === "OUT" && (row.triggersPdO || row.kirBaseField === "P8");
    const relevant = options.form === "DDV-O" || (options.form === "RP-O" ? rp : pd);
    if (!row.code || !row.codeDirection) { error("Davčna vrstica nima veljavne globalne FURS klasifikacije.", row.documentNo); continue; }
    if (!relevant) continue;
    if (row.sourceStatus && row.sourceStatus !== "posted") error("Izvorna temeljnica je osnutek; uradni izvoz ni dovoljen.", row.documentNo);
    if (options.form === "DDV-O" && (row.isReverseCharge || row.isImport) && !row.pairValid)
      error("Manjka veljaven par samoobdavčitve ali uvoza v istem podjetju in davčnem obdobju.", row.documentNo);
    if (row.treatment !== 1 || row.correctionPeriod) error("Samoprijava/obresti v davčni evidenci zahtevajo ločen pregled; niso samodejni popravek RP-O/PD-O.", row.documentNo);
    if (row.reversedById) {
      error("Stornirana izvorna davčna vrstica zahteva uskladitev izvirnika in storna pred izvozom.", row.documentNo);
      continue;
    }
    try {
      if (![row.baseAmount, row.vatAmount, row.nonDeductibleVat, row.deductionPercent].every(v => v !== null && /^-?\d+(\.\d+)?$/.test(v)))
        throw new Error("Manjka veljaven decimalni davčni znesek.");
      const base = new Decimal(row.baseAmount), vat = new Decimal(row.vatAmount);
      if (options.form === "DDV-O") {
        if (row.direction === "OUT") {
          let baseField = row.kirBaseField ? OUT_BASE[row.kirBaseField] : undefined;
          // P27 is both EU services and transactions outside SI; only the explicit EU service code belongs to f12.
          if (row.kirBaseField === "P27" && row.code === "SEU-S") baseField = "f12";
          if (row.kirBaseField === "P27" && row.code !== "SEU-S" && row.code !== "SOSS")
            error("P27 nima preverjene DDV-O obravnave.", row.documentNo);
          if (baseField) add(baseField, base);
          if (row.kirVatField && OUT_VAT[row.kirVatField]) add(OUT_VAT[row.kirVatField], vat);
          if (!row.kirBaseField && !row.kirVatField) error("Manjka KIR preslikava.", row.documentNo);
          if (row.kirBaseField && row.kirBaseField !== "P27" && !OUT_BASE[row.kirBaseField]) error("Nepodprta KIR osnova.", row.documentNo);
          if (row.kirVatField && !OUT_VAT[row.kirVatField]) error("Nepodprta KIR DDV preslikava.", row.documentNo);
        } else if (row.direction === "IN") {
          if (!row.receiptDate) error("Manjka datum prejema.", row.documentNo);
          if (!row.kprBaseField || !IN_BASE[row.kprBaseField]) error("Manjka preverjena KPR osnova.", row.documentNo);
          else add(IN_BASE[row.kprBaseField], base);
          // vat_amount is already the deductible portion; do not apply the percentage again.
          if (row.kprVatField && IN_VAT[row.kprVatField]) add(IN_VAT[row.kprVatField], vat);
          else if (row.kprVatField) error("Nepodprta KPR odbitna preslikava.", row.documentNo);
          if (row.assetType === "REALESTATE") add("f34", base);
          if (row.assetType === "OTHER_FA") add("f35", base);
        } else error("Neveljavna smer davčne vrstice.", row.documentNo);
        if (options.periodMode === "trimesecno" && rp) error("Dobave za RP-O zahtevajo mesečni DDV-O; preverite davčni režim.", row.documentNo);
      } else {
        const identity = partnerIdentity(row.partnerCountryCode, row.partnerVatId, options.form === "PD-O");
        let column = "A3";
        if (options.form === "RP-O") {
          // Historical rp_o_column='B3' meant services, NOT a past-period correction.
          column = row.code === "SEU-S" ? "A6" : row.code === "SEU-TR" ? "A5" : row.code === "SEU-B" ? "A3" : row.rpOColumn ?? "";
          if (!/^A[3-7]$/.test(column)) throw new Error("RP-O klasifikacija dobave ni podprta.");
          if (column === "A7") throw new Error("Skladiščenje na odpoklic zahteva ločeno transakcijsko evidenco C–G; izvoz je blokiran.");
          if (identity.countryCode === "XI" && column === "A6") throw new Error("XI se uporablja za blago, ne storitve.");
        }
        const key = `${identity.countryCode}:${identity.vatId}`;
        const partner = partners.get(key) ?? { ...identity, name: row.partnerName ?? "", values: {} };
        partner.values[column] = (partner.values[column] ?? new Decimal(0)).plus(base);
        partners.set(key, partner);
      }
    } catch (err) { error(err instanceof Error ? err.message : "Neveljavna davčna vrstica.", row.documentNo); }
  }
  const fields = options.form === "DDV-O" ? DVO_FIELDS.map(([code, label]) => ({code, label, value: integerAmount(sums[code] ?? new Decimal(0))})) : [];
  if (fields.length) {
    const output = fields.filter(f => /^f2/.test(f.code)).reduce((n, f) => n.plus(f.value), new Decimal(0));
    const input = fields.filter(f => /^f4/.test(f.code)).reduce((n, f) => n.plus(f.value), new Decimal(0));
    fields.find(f => f.code === "f51")!.value = Decimal.max(output.minus(input), 0).toFixed(0);
    fields.find(f => f.code === "f52")!.value = Decimal.max(input.minus(output), 0).toFixed(0);
  }
  const formattedPartners = [...partners.values()].sort((a,b) => `${a.countryCode}${a.vatId}`.localeCompare(`${b.countryCode}${b.vatId}`)).map(p => ({
    ...p, values: Object.fromEntries(Object.entries(p.values).map(([k,v]) => [k, integerAmount(v)])),
  }));
  const amountDigits = options.form === "PD-O" ? 17 : 14;
  for (const p of formattedPartners) {
    if (Object.values(p.values).some(v => v.replace("-","").length > amountDigits)) error("Znesek prejemnika presega velikost polja uradne sheme.");
    if (options.form === "RP-O" && Object.values(p.values).some(v => new Decimal(v).isNegative())) error("RP-O ne dopušča negativne nove skupne vrednosti prejemnika. Preglejte dobropise in pretekla obdobja.");
  }
  if (options.form === "RP-O" && ["A3","A4","A5","A6"].some(c =>
    formattedPartners.reduce((n,p) => n.plus(p.values[c] ?? 0),new Decimal(0)).toFixed(0).replace("-","").length > 14))
    error("Skupni znesek RP-O presega velikost polja uradne sheme.");
  if (options.form === "PD-O" && formattedPartners.reduce((n,p) =>
    n.plus(p.values.A3 ?? 0),new Decimal(0)).toFixed(0).replace("-","").length > 17)
    error("Skupni znesek PD-O presega velikost polja uradne sheme.");
  // Include the exact source and company in the hash, not just rounded totals.
  const snapshotHash = createHash("sha256").update(JSON.stringify({ company, options, rows: [...rows].sort((a,b) => a.id.localeCompare(b.id)) })).digest("hex");
  return { ...options, companyId: company.id, periodFrom: bounds.from, periodTo: bounds.to, snapshotHash, fields,
    partners: formattedPartners, issues, canExport: !issues.some(i => i.severity === "ERROR"), rowCount: rows.length,
    notice: "Zneski obrazca so zaokroženi na cele EUR po seštevanju. Izvoz ni oddaja. Samoprijave, posebni zastopani profili in skladiščenje na odpoklic zahtevajo ločeno obravnavo." };
}
const esc = (s: string) => {
  if (/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd\u{10000}-\u{10ffff}]/u.test(s)) throw new Error("Besedilo vsebuje znak, ki ni dovoljen v XML.");
  return s.replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&apos;" })[c]!);
};
const element = (name: string, value: string | number | boolean) => `<${name}>${esc(String(value))}</${name}>`;
export function generateVatFormXml(company: VatFormCompany, preview: ReturnType<typeof buildVatFormPreview>, options: VatFormExportOptions = {}) {
  if (!preview.canExport || preview.companyId !== company.id) throw new Error("Predogled vsebuje blokade ali pripada drugemu podjetju.");
  const corrections = options.corrections ?? [];
  if (preview.form === "DDV-O" && corrections.length) throw new Error("Popravki RP-O/PD-O niso popravki DDV-O.");
  const seen = new Set<string>();
  const validated = corrections.map(c => {
    if (!Number.isInteger(c.year) || c.year < 2020 || !Number.isInteger(c.month) || c.month < 1 || c.month > 12 ||
        c.year * 12 + c.month >= preview.year * 12 + Number(preview.period.slice(2))) throw new Error("Popravek mora biti za pretekli koledarski mesec.");
    const identity = partnerIdentity(c.countryCode, c.vatId, preview.form === "PD-O");
    const key = `${c.year}:${c.month}:${identity.countryCode}:${identity.vatId}`;
    if (seen.has(key)) throw new Error("Podvojen popravek istega prejemnika in obdobja.");
    seen.add(key);
    const allowed = preview.form === "RP-O" ? ["B3","B4","B5","B6","B7"] : ["B3"];
    if (!Object.keys(c.values).length || Object.keys(c.values).some(k => !allowed.includes(k))) throw new Error("Nepodprto ali prazno polje popravka.");
    for (const value of Object.values(c.values)) {
      if (!new RegExp(`^-?\\d{1,${preview.form === "PD-O" ? 17 : 14}}$`).test(value))
        throw new Error("Popravek zahteva novo skupno vrednost v celih EUR znotraj velikosti uradne sheme, ne razliko.");
      if (preview.form === "RP-O" && new Decimal(value).isNegative()) throw new Error("RP-O ne dopušča negativne nove skupne vrednosti popravka.");
    }
    return {...c, ...identity};
  });
  const contact = options.contactName?.trim() ?? "", phone = options.contactPhone?.trim() ?? "";
  if (contact.length > 250 || phone.length > 100) throw new Error("Kontaktni podatki so predolgi.");
  let body = "";
  if (preview.form === "DDV-O") {
    body = `<DDV-O>${element("taxPeriodStart", preview.periodFrom)}${element("taxPeriodEnd", preview.periodTo)}` +
      (contact ? element("contactPersonFullName",contact) : "") + (phone ? element("contactPersonPhoneNumber",phone) : "") +
      element("f03", options.deductionProportion ?? false) + element("f04", options.refund ?? false) +
      preview.fields.map(f => element(f.code, f.value)).join("") + "</DDV-O>";
  } else if (preview.form === "PD-O") {
    body = `<PD_O>${element("PeriodYear",preview.year)}${element("PeriodMonth",Number(preview.period.slice(2)))}` +
      (contact ? element("f18",contact) : "") + (phone ? element("f19",phone) : "") +
      preview.partners.map(p => `<A>${element("A2",p.vatId)}${element("A3",p.values.A3 ?? "0")}</A>`).join("") +
      element("A4", preview.partners.reduce((n,p) => n.plus(p.values.A3 ?? 0),new Decimal(0)).toFixed(0)) +
      validated.map(c => `<B>${element("B1_Year",c.year)}${element("B1_Month",c.month)}${element("B2",c.vatId)}${element("B3",c.values.B3)}</B>`).join("") + "</PD_O>";
  } else {
    const columns = ["A3","A4","A5","A6","A7"];
    body = `<VIES_KP><General>${element("Year",preview.year)}${element("Month",Number(preview.period.slice(2)))}` +
      columns.map((c,i) => element(`A1${i+3}`, preview.partners.reduce((n,p) => n.plus(p.values[c] ?? 0),new Decimal(0)).toFixed(0))).join("") +
      (contact ? element("RPO18",contact) : "") + (phone ? element("RPO19",phone) : "") + "</General><A_Current>" +
      preview.partners.map(p => `<A>${element("A1",p.countryCode)}${element("A2",p.vatId)}${columns.map(c => element(c,p.values[c] ?? "0")).join("")}</A>`).join("") +
      "</A_Current><B_PastCorrections>" +
      validated.map(c => `<B>${element("B0_Y",c.year)}${element("B0_M",c.month)}${element("B1",c.countryCode)}${element("B2",c.vatId)}` +
        ["B3","B4","B5","B6","B7"].map(k => element(k,c.values[k] ?? "0")).join("") + "</B>").join("") +
      "</B_PastCorrections><C_TransferOfGoods/><D_ReturnOfGoods/><E_Customer/><F_GoodsCorrections/><G_CustomerCorrections/></VIES_KP>";
  }
  const ns = `http://edavki.durs.si/Documents/Schemas/${EDAVKI_SCHEMAS[preview.form]}.xsd`;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Envelope xmlns="${ns}" xmlns:edp="http://edavki.durs.si/Documents/Schemas/EDP-Common-1.xsd">` +
    `<edp:Header><edp:taxpayer>${element("edp:taxNumber",company.podjetjeDavcna.replace(/^SI/i,""))}${element("edp:name",company.naziv)}</edp:taxpayer></edp:Header>` +
    `<edp:AttachmentList/><edp:Signatures/><body><edp:bodyContent/>${body}</body></Envelope>`;
}
