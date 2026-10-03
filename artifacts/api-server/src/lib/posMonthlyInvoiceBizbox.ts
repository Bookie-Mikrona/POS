import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db, bizboxNastavitveTable, posMonthlyInvoiceDeliveriesTable as deliveries,
  posMonthlyInvoicesTable, type MonthlyBizboxState } from "@workspace/db";
import { desifrirajBizboxGeslo } from "./kripto-bizbox";
import { buildEnvelope, getBizboxHost, getBizboxDocMetadata, loginBizbox, parseBizboxDocId, posljiBizbox, sestaviEddress } from "./eracun/bizbox";
import { MonthlyInvoiceError } from "./posMonthlyInvoice";
import { monthlyInvoiceEslog } from "./posMonthlyInvoiceEslog";

type Invoice = typeof posMonthlyInvoicesTable.$inferSelect;
type Delivery = typeof deliveries.$inferSelect;
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export function monthlyBizboxDto(d?: Delivery) {
  return { state: d?.state ?? "not_sent", documentId: d?.documentId ?? null,
    environment: d?.environment ?? null, externalId: d?.externalId ?? null,
    message: d?.message ?? null, updatedAt: d?.updatedAt.toISOString() ?? null,
    attemptCount: d?.attemptCount ?? 0 };
}
async function config(companyId: string) {
  const [c] = await db.select().from(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId));
  if (!c) throw new MonthlyInvoiceError(422, "V Nastavitve → bizBox nastavite povezavo za to podjetje. Skupnih platformskih poverilnic ne uporabljamo.");
  if (!["test", "prod"].includes(c.bizboxOkolje)) throw new MonthlyInvoiceError(422, "Neveljavno okolje bizBox v nastavitvah podjetja.");
  try {
    return { ...c, pass: desifrirajBizboxGeslo(c.bizboxPassEnc), environment: c.bizboxOkolje === "prod" ? "produkcija" as const : "test" as const };
  } catch { throw new MonthlyInvoiceError(422, "Povezave bizBox ni mogoče prebrati. Ponovno shranite poverilnice v nastavitvah podjetja."); }
}
export async function monthlyBizboxState(i: Invoice) {
  await db.update(deliveries).set({
    state: "unknown", message: "Izid oddaje ni znan. Preverite dokument v bizBoxu po zunanji referenci; ne pošiljajte ponovno.", updatedAt: new Date(),
  }).where(and(eq(deliveries.invoiceId, i.id), eq(deliveries.state, "sending"), sql`${deliveries.updatedAt} < NOW() - INTERVAL '5 minutes'`));
  const [d] = await db.select().from(deliveries).where(eq(deliveries.invoiceId, i.id));
  return d;
}
export async function verifiedMonthlyXml(i: Invoice) {
  const xml = monthlyInvoiceEslog(i);
  const [d] = await db.select().from(deliveries).where(eq(deliveries.invoiceId, i.id));
  if (d && d.xmlHash !== hash(xml)) throw new MonthlyInvoiceError(409, "XML se ne ujema z že rezervirano oddajo. Potrebna je ročna uskladitev, ne nov izvoz.");
  return xml;
}
export async function sendMonthlyBizbox(i: Invoice, actorId: string) {
  const prior = await monthlyBizboxState(i);
  if (prior && prior.state !== "failed") return monthlyBizboxDto(prior);
  const c = await config(i.companyId);
  if (i.snapshot.isTest && c.environment === "produkcija") throw new MonthlyInvoiceError(422, "TESTNI račun lahko pošljete samo v testni bizBox, nikoli v produkcijo.");
  const xml = await verifiedMonthlyXml(i);
  const from = sestaviEddress(c.posiljateljDavcna || i.snapshot.issuer.taxId);
  const to = sestaviEddress(i.snapshot.recipient.taxId, i.snapshot.recipient.endpointId);
  if (!from || !to) throw new MonthlyInvoiceError(422, "Manjka naslov pošiljatelja ali prejemnika e-računa.");
  const attemptId = randomUUID();
  // Commit the reservation BEFORE calling any provider. Only the winning attempt sends.
  const d = await db.transaction(async tx => {
    await tx.execute(sql`SELECT id FROM pos_monthly_invoices WHERE id=${i.id} FOR UPDATE`);
    const [existing] = await tx.select().from(deliveries).where(eq(deliveries.invoiceId, i.id));
    if (existing && existing.state !== "failed") return existing;
    const values = { state: "sending" as const, attemptId, environment: c.environment,
      accountHash: hash(c.bizboxUser), fromAddress: from, toAddress: to,
      externalId: `POS-MONTHLY-${i.id}`, xmlHash: hash(xml), actorId, message: null, updatedAt: new Date() };
    if (existing) {
      const [row] = await tx.update(deliveries).set({ ...values, attemptCount: existing.attemptCount + 1 })
        .where(eq(deliveries.invoiceId, i.id)).returning();
      return row;
    }
    const [row] = await tx.insert(deliveries).values({ invoiceId: i.id, ...values }).returning();
    return row;
  });
  if (d.attemptId !== attemptId) return monthlyBizboxDto(d);
  const finish = async (state: MonthlyBizboxState, message: string | null, documentId?: string) => {
    const [row] = await db.update(deliveries).set({ state, message, documentId, updatedAt: new Date() })
      .where(and(eq(deliveries.invoiceId, i.id), eq(deliveries.attemptId, attemptId), inArray(deliveries.state, ["sending", "unknown"]))).returning();
    return monthlyBizboxDto(row ?? await monthlyBizboxState(i));
  };
  const host = getBizboxHost(c.bizboxOkolje);
  let token: string;
  try { token = await loginBizbox(host, c.bizboxUser, c.pass, 60000); }
  catch { return finish("failed", "Prijava v bizBox ni uspela. Dokument ni bil poslan. Preverite nastavitve in nato ponovite oddajo."); }
  const filename = `eracun-${i.invoiceNumber.replace(/[^a-zA-Z0-9_.-]/g, "_")}.xml`;
  try {
    const result = await posljiBizbox(host, token, buildEnvelope(from, to, filename, d.externalId), filename, xml, false, 120000);
    const id = parseBizboxDocId(result.body);
    if (!id) return finish("unknown", "bizBox je sprejel zahtevek, vendar ni vrnil prepoznavnega ID-ja. Preverite zunanjo referenco v portalu; ne pošiljajte ponovno.");
    return finish("submitted", null, id);
  } catch {
    // A timeout or HTTP failure after POST is NOT proof that the provider did not accept it.
    return finish("unknown", "Izid oddaje ni znan. Preverite dokument v bizBoxu po zunanji referenci; ne pošiljajte ponovno.");
  }
}
export async function checkMonthlyBizbox(i: Invoice) {
  const d = await monthlyBizboxState(i);
  if (!d || !d.documentId || ["delivered", "rejected"].includes(d.state)) return monthlyBizboxDto(d);
  const c = await config(i.companyId);
  if (c.environment !== d.environment || hash(c.bizboxUser) !== d.accountHash) {
    throw new MonthlyInvoiceError(422, "Ta dokument je bil oddan prek drugega okolja ali računa bizBox. Za preverjanje uporabite prvotno povezavo.");
  }
  try {
    const host = getBizboxHost(c.bizboxOkolje), token = await loginBizbox(host, c.bizboxUser, c.pass, 60000);
    const status = await getBizboxDocMetadata(host, token, d.documentId, 60000);
    // Generic API 'ok', 'not_delivered' and substring matches are NOT delivery confirmations.
    let providerState = "";
    try {
      const body = JSON.parse(status.raw);
      providerState = String(body.status ?? body.deliveryStatus ?? body.state ?? body.dostava ?? "").trim().toLowerCase();
    } catch { /* Missing/unrecognised provider metadata never proves delivery. */ }
    const state = ["delivered", "dostavljeno"].includes(providerState) ? "delivered" as const
      : ["rejected", "zavrnjeno", "failed", "error", "napaka"].includes(providerState) ? "rejected" as const : "processing" as const;
    const [updated] = await db.update(deliveries).set({ state, updatedAt: new Date(),
      message: state === "rejected" ? "bizBox je dokument zavrnil. Razlog preverite v portalu. Ponovno samodejno pošiljanje ni dovoljeno." : null })
      .where(and(eq(deliveries.invoiceId, i.id), eq(deliveries.attemptId, d.attemptId), inArray(deliveries.state, ["submitted", "processing"]))).returning();
    return monthlyBizboxDto(updated ?? await monthlyBizboxState(i));
  } catch { throw new MonthlyInvoiceError(502, "Statusa bizBox trenutno ni mogoče preveriti. Zadnje shranjeno stanje ostane nespremenjeno."); }
}