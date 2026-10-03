import { create } from "xmlbuilder2";
import Decimal from "decimal.js";
import type { posMonthlyInvoicesTable, MonthlyInvoiceSnapshot } from "@workspace/db";
import { MonthlyInvoiceError, validDate } from "./posMonthlyInvoice";

type Invoice = typeof posMonthlyInvoicesTable.$inferSelect;
type Node = ReturnType<typeof create>;
const D = (n: string) => new Decimal(n);
const money = (n: Decimal | string) => new Decimal(n).toFixed(2);
function value(parent: Node, name: string, text: string) { parent.ele(name).txt(text); }
function date(parent: Node, qualifier: string, iso: string) {
  const c = parent.ele("S_DTM").ele("C_C507");
  value(c, "D_2005", qualifier); value(c, "D_2380", iso);
}
function amount(parent: Node, qualifier: string, total: string) {
  const c = parent.ele("S_MOA").ele("C_C516");
  value(c, "D_5025", qualifier); value(c, "D_5004", total);
}
function reference(parent: Node, qualifier: string, id: string) {
  const c = parent.ele("S_RFF").ele("C_C506");
  value(c, "D_1153", qualifier); value(c, "D_1154", id);
}
function note(parent: Node, text: string) {
  const f = parent.ele("S_FTX"); value(f, "D_4451", "GEN");
  value(f.ele("C_C108"), "D_4440", text);
}
function party(parent: Node, p: MonthlyInvoiceSnapshot["recipient"], qualifier: string, bank?: { iban: string; bic: string }) {
  // Legacy issued documents retain their own combined address; never read today's partner.
  const legacy = p.address.match(/^(.*?)[,\s]+(\d{4})\s+([^,]+)$/);
  const street = p.street || legacy?.[1] || p.address;
  const city = p.city || legacy?.[3];
  const postal = p.postalCode || legacy?.[2];
  if (!p.name || !street || !p.taxId) throw new MonthlyInvoiceError(422, "Izdani račun nima popolnih podatkov za e-SLOG.");
  const g = parent.ele("G_SG2"), nad = g.ele("S_NAD");
  value(nad, "D_3035", qualifier);
  value(nad.ele("C_C080"), "D_3036", p.name);
  value(nad.ele("C_C059"), "D_3042", street);
  if (city) value(nad, "D_3164", city);
  if (postal) value(nad, "D_3251", postal);
  value(nad, "D_3207", p.countryCode || "SI");
  if (bank?.iban) {
    const fii = g.ele("S_FII"); value(fii, "D_3035", "RB");
    value(fii.ele("C_C078"), "D_3194", bank.iban.replace(/\s/g, ""));
    if (bank.bic) value(fii.ele("C_C088"), "D_3433", bank.bic);
  }
  if (p.registrationNumber) reference(g.ele("G_SG3"), "0199", p.registrationNumber);
  const vatId = p.vatId === undefined ? (p.taxId.startsWith("SI") ? p.taxId : null) : p.vatId;
  if (vatId) reference(g.ele("G_SG3"), "VA", vatId);
  reference(g.ele("G_SG3"), "AHP", p.taxId.replace(/^SI/i, ""));
}
function tax(parent: Node, rate: string, vatRegistered: boolean) {
  const t = parent.ele("S_TAX");
  value(t, "D_5283", "7"); value(t.ele("C_C241"), "D_5153", "VAT");
  value(t.ele("C_C243"), "D_5278", rate);
  value(t, "D_5305", D(rate).gt(0) ? "S" : vatRegistered ? "Z" : "O");
}

/**
 * Native e-SLOG 2.0, not UBL disguised with an ESLOG envelope.
 * Mapping: EPOS e-SLOG-2.0-08-2020-SL.zip, official sample + INVOIC v200 XSD.
 * The immutable daily VAT allocation is retained, including accumulated daily rounding.
 */
export function monthlyInvoiceEslog(i: Invoice): string {
  const s = i.snapshot;
  if (!validDate(i.invoiceDate) || !validDate(i.dueDate) || !/^\d{4}-\d{2}$/.test(i.month)
      || !s.lines.length || !s.vatBuckets.length || !s.receipts.length) {
    throw new MonthlyInvoiceError(422, "Podatki izdanega računa niso popolni za e-SLOG.");
  }
  const sum = (key: "net" | "vat" | "gross") => s.vatBuckets.reduce((a, b) => a.plus(b[key]), D("0"));
  if (!sum("net").eq(s.totalNet) || !sum("vat").eq(s.totalVat) || !sum("gross").eq(s.totalGross)
      || !D(s.totalNet).plus(s.totalVat).eq(s.totalGross) || !D(i.grossAmount).eq(s.totalGross)) {
    throw new MonthlyInvoiceError(422, "Zneski izdanega računa niso usklajeni.");
  }
  const lines = s.lines.map(l => {
    if (D(l.quantity).lte(0) || D(l.gross).lt(0) || D(l.rate).lt(0)) throw new MonthlyInvoiceError(422, "Neveljavna e-SLOG postavka.");
    return { ...l, net: D(l.gross).div(D("1").plus(D(l.rate).div(100))).toDecimalPlaces(2) };
  });
  // Allocate the original daily-rounding delta within each tax group, never across rates.
  for (const b of s.vatBuckets) {
    const group = lines.filter(l => D(l.rate).eq(b.rate));
    if (!group.length || !group.reduce((a, l) => a.plus(l.gross), D("0")).eq(b.gross)) {
      throw new MonthlyInvoiceError(422, "DDV skupina se ne ujema s specifikacijo.");
    }
    const largest = [...group].sort((a, z) => z.net.comparedTo(a.net))[0];
    largest.net = largest.net.plus(D(b.net).minus(group.reduce((a, l) => a.plus(l.net), D("0"))));
    if (largest.net.lt(0)) throw new MonthlyInvoiceError(422, "DDV osnove ni mogoče varno razporediti.");
  }
  if (!lines.reduce((a, l) => a.plus(l.net), D("0")).eq(s.totalNet)) throw new MonthlyInvoiceError(422, "Osnove postavk niso usklajene.");
  const doc = create({ version: "1.0", encoding: "UTF-8" }).ele("Invoice", { xmlns: "urn:eslog:2.00" });
  const m = doc.ele("M_INVOIC", { Id: "data" });
  // UNH's message reference is capped at 14 characters by the official XSD.
  // The legal invoice number remains unchanged in BGM/BT-1.
  const unh = m.ele("S_UNH"); value(unh, "D_0062", i.id.replace(/-/g, "").slice(0, 14));
  const msg = unh.ele("C_S009");
  for (const [k, v] of [["D_0065", "INVOIC"], ["D_0052", "D"], ["D_0054", "01B"], ["D_0051", "UN"]]) value(msg, k, v);
  const bgm = m.ele("S_BGM"); value(bgm.ele("C_C002"), "D_1001", "380");
  value(bgm.ele("C_C106"), "D_1004", i.invoiceNumber);
  date(m, "137", i.invoiceDate); date(m, "167", `${i.month}-01`);
  const end = new Date(Date.UTC(Number(i.month.slice(0, 4)), Number(i.month.slice(5)), 0)).toISOString().slice(0, 10);
  date(m, "168", end);
  note(m, `Pogodbene malice ${i.month}. DDV je že obračunan na izvornih dnevnih računih; mesečni dokument ne predstavlja dodatne prodaje.`);
  note(m, "Zneski DDV ohranjajo seštevek zaokrožitev izvornih dnevnih računov.");
  if (s.isTest) note(m, "TESTNI DOKUMENT - NI ZA PLAČILO");
  const f = m.ele("S_FTX"); value(f, "D_4451", "DOC");
  value(f.ele("C_C108"), "D_4440", "urn:cen.eu:en16931:2017");
  for (const receipt of s.receipts) {
    const ref = m.ele("G_SG1"); reference(ref, "OI", receipt.number); date(ref, "171", receipt.date);
  }
  party(m, s.recipient, "BY"); party(m, s.issuer, "SE", s.issuer);
  const currency = m.ele("G_SG7").ele("S_CUX").ele("C_C504");
  value(currency, "D_6347", "2"); value(currency, "D_6345", "EUR");
  const payment = m.ele("G_SG8"); value(payment.ele("S_PAT"), "D_4279", "1");
  date(payment, "13", i.dueDate); value(payment.ele("S_PAI").ele("C_C534"), "D_4461", "30");
  const registered = !!(s.issuer.vatId === undefined ? s.issuer.taxId.startsWith("SI") : s.issuer.vatId);
  lines.forEach((l, index) => {
    const line = m.ele("G_SG26"); value(line.ele("S_LIN"), "D_1082", String(index + 1));
    const imd = line.ele("S_IMD"); value(imd, "D_7077", "F"); value(imd.ele("C_C273"), "D_7008", l.label);
    const qty = line.ele("S_QTY").ele("C_C186");
    value(qty, "D_6063", "47"); value(qty, "D_6060", D(l.quantity).toString()); value(qty, "D_6411", "C62");
    amount(line.ele("G_SG27"), "203", money(l.net));
    const price = line.ele("G_SG29").ele("S_PRI").ele("C_C509");
    value(price, "D_5125", "AAA"); value(price, "D_5118", l.net.div(l.quantity).toFixed(12));
    value(price, "D_5284", "1"); value(price, "D_6411", "C62");
    tax(line.ele("G_SG34"), l.rate, registered);
  });
  value(m.ele("S_UNS"), "D_0081", "S");
  for (const [q, total] of [["79", s.totalNet], ["389", s.totalNet], ["388", s.totalGross], ["9", s.totalGross], ["176", s.totalVat]]) {
    amount(m.ele("G_SG50"), q, money(total));
  }
  for (const b of s.vatBuckets) {
    const g = m.ele("G_SG52"); tax(g, b.rate, registered);
    amount(g, "125", money(b.net)); amount(g, "124", money(b.vat));
  }
  return doc.end({ prettyPrint: true });
}