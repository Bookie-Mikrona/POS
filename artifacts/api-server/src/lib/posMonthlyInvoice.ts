import Decimal from "decimal.js";
import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { companiesTable, counterpartiesTable, db, enoteTable, partnerCenikiTable,
  posContractInvoiceReceiptsTable, posMonthlyInvoiceReceiptsTable, postavkeTable, racuniTable,
  type MonthlyInvoiceSnapshot } from "@workspace/db";
import { businessDateForInstant } from "./pos-business-day";

export class MonthlyInvoiceError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const validUuid = (value: string) => /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
export function validDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
}
export function localToday() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  return `${p.find(v => v.type === "year")!.value}-${p.find(v => v.type === "month")!.value}-${p.find(v => v.type === "day")!.value}`;
}
export async function assertReceiptNotMonthlyBilled(receiptId: number, q: Pick<typeof db, "execute"> = db) {
  const claims = await q.execute(sql`SELECT receipt_id FROM pos_monthly_invoice_receipts WHERE receipt_id = ${receiptId} LIMIT 1`);
  if (claims.rows.length) throw new MonthlyInvoiceError(409, "Dnevni račun je že v izdanem mesečnem računu. Popravek zahteva dobropis mesečnega računa; običajni storno bi pustil napačen znesek za plačilo.");
}

export async function monthlyInvoiceFacts(companyId: string, enotaId: number, counterpartyId: string, month: string, q: Pick<typeof db, "select"> = db) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !validUuid(counterpartyId)) {
    throw new MonthlyInvoiceError(400, "Izberite veljaven mesec in pogodbenega partnerja.");
  }
  const [unit] = await q.select().from(enoteTable).where(and(eq(enoteTable.id, enotaId), eq(enoteTable.companyId, companyId)));
  if (!unit) throw new MonthlyInvoiceError(404, "Enota ni najdena.");
  const currentBusinessMonth = businessDateForInstant(new Date(), unit.zacetekDnevaUra).slice(0, 7);
  if (month >= currentBusinessMonth) throw new MonthlyInvoiceError(409, "Mesečni račun lahko izdate šele po zaključku poslovnega meseca.");
  const [partner] = await q.select().from(counterpartiesTable).where(and(
    eq(counterpartiesTable.id, counterpartyId), eq(counterpartiesTable.companyId, companyId),
    eq(counterpartiesTable.isActive, true), inArray(counterpartiesTable.type, ["customer", "both"]),
    sql`EXISTS (SELECT 1 FROM ${partnerCenikiTable} WHERE ${partnerCenikiTable.kupecId} = ${counterpartiesTable.id} AND ${partnerCenikiTable.enotaId} = ${enotaId})`,
  ));
  if (!partner) throw new MonthlyInvoiceError(404, "Partner nima pogodbenega cenika v tej enoti.");
  const [company] = await q.select({
    name: companiesTable.naziv, address: companiesTable.naslov, street: companiesTable.ulica,
    postal: companiesTable.postnaStevika, city: companiesTable.kraj, tax: companiesTable.podjetjeDavcna,
    vat: companiesTable.idZaDdv, trr: companiesTable.trr, registration: companiesTable.maticnaStevilka,
  }).from(companiesTable).where(eq(companiesTable.id, companyId));
  const businessDate = sql<string>`DATE((${racuniTable.datumCas} AT TIME ZONE 'Europe/Ljubljana') - (${enoteTable.zacetekDnevaUra}::time - TIME '00:00'))::text`;
  const end = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5)), 0)).toISOString().slice(0, 10);
  const receipts = await q.select({
    id: racuniTable.id, number: racuniTable.stevilkaRacuna, date: businessDate,
    gross: racuniTable.skupaj, vat: racuniTable.ddv, status: racuniTable.status,
  }).from(racuniTable).innerJoin(enoteTable, eq(enoteTable.id, racuniTable.enotaId))
    .leftJoin(posContractInvoiceReceiptsTable, eq(posContractInvoiceReceiptsTable.receiptId, racuniTable.id))
    .leftJoin(posMonthlyInvoiceReceiptsTable, eq(posMonthlyInvoiceReceiptsTable.receiptId, racuniTable.id))
    .where(and(eq(racuniTable.enotaId, enotaId), eq(racuniTable.kupecCpId, counterpartyId),
      eq(racuniTable.placilnaNacin, "negotovinsko"), sql`${racuniTable.status} <> 'storniran'`,
      eq(racuniTable.jeStorno, false),
      sql`NOT EXISTS (SELECT 1 FROM racuni s WHERE s.izvorni_racun_id = ${racuniTable.id} AND s.je_storno = true)`,
      sql`${businessDate} >= ${`${month}-01`} AND ${businessDate} <= ${end}`,
      isNull(posContractInvoiceReceiptsTable.id), isNull(posMonthlyInvoiceReceiptsTable.receiptId)))
    .orderBy(asc(racuniTable.id));
  if (receipts.some(r => !["poslan", "testni"].includes(r.status))) {
    throw new MonthlyInvoiceError(409, "Nekateri dnevni računi še niso uspešno davčno potrjeni. Najprej uredite njihovo pošiljanje.");
  }
  if (receipts.some(r => r.status === "testni") && receipts.some(r => r.status !== "testni")) {
    throw new MonthlyInvoiceError(409, "Testnih in dejanskih računov ni dovoljeno združiti v isti mesečni račun.");
  }
  const ids: number[] = receipts.map(r => r.id);
  const items = ids.length ? await q.select({
    receiptId: postavkeTable.racunId, label: postavkeTable.ime, quantity: postavkeTable.kolicina,
    gross: postavkeTable.skupaj, rate: postavkeTable.davek,
  }).from(postavkeTable).where(and(inArray(postavkeTable.racunId, ids), isNull(postavkeTable.parentPostavkaId))) : [];
  const buckets = new Map<string, { gross: Decimal; vat: Decimal }>();
  const lines = new Map<string, { label: string; quantity: Decimal; gross: Decimal; rate: string }>();
  let gross = new Decimal(0), vat = new Decimal(0);
  for (const r of receipts) {
    const rg = new Decimal(r.gross), rv = new Decimal(r.vat);
    if (rg.lte(0) || rv.lt(0) || rv.gt(rg)) throw new MonthlyInvoiceError(409, `Račun ${r.number} ima neveljavne zneske.`);
    gross = gross.plus(rg); vat = vat.plus(rv);
    const rb = new Map<string, { gross: Decimal; vat: Decimal }>();
    let itemGross = new Decimal(0);
    for (const item of items.filter(i => i.receiptId === r.id)) {
      const rate = rv.isZero() ? "0" : new Decimal(item.rate ?? 0).toString();
      const ig = new Decimal(item.gross), quantity = new Decimal(item.quantity);
      if (quantity.lte(0) || ig.lt(0)) throw new MonthlyInvoiceError(409, `Preverite postavke računa ${r.number}.`);
      itemGross = itemGross.plus(ig);
      const key = JSON.stringify([item.label, rate, ig.div(quantity).toFixed(6)]);
      const line = lines.get(key) ?? { label: item.label, quantity: new Decimal(0), gross: new Decimal(0), rate };
      line.quantity = line.quantity.plus(quantity); line.gross = line.gross.plus(ig); lines.set(key, line);
      const b = rb.get(rate) ?? { gross: new Decimal(0), vat: new Decimal(0) };
      b.gross = b.gross.plus(ig); rb.set(rate, b);
    }
    if (!itemGross.eq(rg) || !rb.size) throw new MonthlyInvoiceError(409, `Specifikacija računa ${r.number} se ne ujema z njegovim zneskom.`);
    for (const [rate, b] of rb) b.vat = b.gross.minus(b.gross.mul(100).div(new Decimal(rate).plus(100)).toDecimalPlaces(2));
    const calculated = [...rb.values()].reduce((s, b) => s.plus(b.vat), new Decimal(0));
    const adjustment = rv.minus(calculated);
    if (adjustment.abs().gt("0.02")) throw new MonthlyInvoiceError(409, `DDV specifikacija računa ${r.number} ni usklajena.`);
    const largest = [...rb.values()].sort((a, b) => b.gross.comparedTo(a.gross))[0];
    largest.vat = largest.vat.plus(adjustment);
    for (const [rate, b] of rb) {
      const target = buckets.get(rate) ?? { gross: new Decimal(0), vat: new Decimal(0) };
      target.gross = target.gross.plus(b.gross); target.vat = target.vat.plus(b.vat); buckets.set(rate, target);
    }
  }
  const snapshot: MonthlyInvoiceSnapshot = {
    issuer: { name: company.name, address: company.address || [company.street, [company.postal, company.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
      taxId: company.vat || company.tax, iban: company.trr?.[0]?.iban ?? "", bic: company.trr?.[0]?.bic ?? "",
      street: company.street, postalCode: company.postal, city: company.city, countryCode: "SI",
      vatId: company.vat, registrationNumber: company.registration },
    recipient: { name: partner.name, address: [partner.address || partner.ulica, [partner.postCode, partner.city].filter(Boolean).join(" ")].filter(Boolean).join(", "), taxId: partner.idZaDdv || partner.taxId || "",
      street: partner.ulica || partner.address, postalCode: partner.postCode, city: partner.city,
      vatId: partner.idZaDdv, endpointId: partner.eRacunNaslov, countryCode: partner.country,
      registrationNumber: partner.registrationNumber },
    unitName: unit.ime, isTest: receipts.length > 0 && receipts.every(r => r.status === "testni"),
    totalGross: gross.toFixed(2), totalVat: vat.toFixed(2), totalNet: gross.minus(vat).toFixed(2),
    receipts: receipts.map(r => ({ id: r.id, number: r.number, date: r.date, gross: new Decimal(r.gross).toFixed(2) })),
    vatBuckets: [...buckets].sort(([a], [b]) => Number(a) - Number(b)).map(([rate, b]) => ({ rate, gross: b.gross.toFixed(2), vat: b.vat.toFixed(2), net: b.gross.minus(b.vat).toFixed(2) })),
    lines: [...lines.values()].map(l => ({ label: l.label, quantity: l.quantity.toString(), gross: l.gross.toFixed(2), rate: l.rate })),
  };
  return { snapshot, paymentTermsDays: Math.max(0, Number(partner.paymentTermsDays ?? 0)), end };
}