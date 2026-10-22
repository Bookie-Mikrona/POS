import { Router, type Response } from "express";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { db, counterpartiesTable, partnerCenikiTable, malicaPartnerGroupPricesTable, posMonthlyInvoicesTable, posMonthlyInvoiceReceiptsTable, racuniTable } from "@workspace/db";
import { IssuePosMonthlyInvoiceBody } from "@workspace/api-zod";
import type { PosRequest } from "../../middlewares/pos";
import { localToday, validDate, validUuid, monthlyInvoiceFacts, MonthlyInvoiceError } from "../../lib/posMonthlyInvoice";
import { monthlyInvoicePdf } from "../../lib/posMonthlyInvoicePdf";
import { lockPosBusinessDay } from "../../lib/pos-z-helpers";
import { checkMonthlyBizbox, monthlyBizboxDto, monthlyBizboxState, sendMonthlyBizbox, verifiedMonthlyXml } from "../../lib/posMonthlyInvoiceBizbox";

const router = Router();
router.use("/pos-monthly-invoices", (req, res, next) => {
  if (!["admin", "admin_enote", "superadmin"].includes((req as PosRequest).vloga)) {
    res.status(403).json({ error: "Mesečne račune izdaja vodja enote ali administrator." }); return;
  }
  next();
});
function summary(i: typeof posMonthlyInvoicesTable.$inferSelect) {
  return { id: i.id, invoiceNumber: i.invoiceNumber, month: i.month, invoiceDate: i.invoiceDate, dueDate: i.dueDate,
    counterpartyName: i.snapshot.recipient.name, receiptCount: i.snapshot.receipts.length, totalGross: i.grossAmount, isTest: i.snapshot.isTest };
}
function fail(error: unknown, res: Response) {
  if (error instanceof MonthlyInvoiceError) { res.status(error.status).json({ error: error.message }); return; }
  if ((error as any)?.code === "23505" || (error as any)?.cause?.code === "23505") {
    res.status(409).json({ error: "Mesečni ali dnevni račun je že obračunan. Osvežite seznam." }); return;
  }
  throw error;
}
router.get("/pos-monthly-invoices/partners", async (req, res) => {
  const c = req as PosRequest;
  const rows = await db.select({ id: counterpartiesTable.id, name: counterpartiesTable.name, paymentTermsDays: counterpartiesTable.paymentTermsDays })
    .from(counterpartiesTable)
    .where(and(eq(counterpartiesTable.companyId, c.companyId), eq(counterpartiesTable.isActive, true),
      inArray(counterpartiesTable.type, ["customer", "both"]),
      sql`(EXISTS (SELECT 1 FROM ${partnerCenikiTable} WHERE ${partnerCenikiTable.kupecId} = ${counterpartiesTable.id} AND ${partnerCenikiTable.enotaId} = ${c.enotaId}) OR EXISTS (SELECT 1 FROM ${malicaPartnerGroupPricesTable} WHERE ${malicaPartnerGroupPricesTable.kupecId} = ${counterpartiesTable.id} AND ${malicaPartnerGroupPricesTable.enotaId} = ${c.enotaId} AND ${malicaPartnerGroupPricesTable.active}))`));
  res.json(rows.map(p => ({ ...p, paymentTermsDays: p.paymentTermsDays ?? 0 })).sort((a, b) => a.name.localeCompare(b.name, "sl")));
});
router.get("/pos-monthly-invoices/preview", async (req, res) => {
  try {
    const c = req as PosRequest, month = String(req.query.month ?? ""), counterpartyId = String(req.query.counterpartyId ?? "");
    const f = await monthlyInvoiceFacts(c.companyId, c.enotaId, counterpartyId, month);
    res.json({ month, counterpartyId, recipientName: f.snapshot.recipient.name, paymentTermsDays: f.paymentTermsDays,
      receiptCount: f.snapshot.receipts.length, ...f.snapshot, issuer: undefined, recipient: undefined, unitName: undefined });
  } catch (e) { fail(e, res); }
});
router.get("/pos-monthly-invoices", async (req, res) => {
  const c = req as PosRequest;
  const rows = await db.select().from(posMonthlyInvoicesTable)
    .where(and(eq(posMonthlyInvoicesTable.companyId, c.companyId), eq(posMonthlyInvoicesTable.enotaId, c.enotaId)))
    .orderBy(desc(posMonthlyInvoicesTable.issuedAt));
  res.json(rows.map(summary));
});
router.post("/pos-monthly-invoices", async (req, res) => {
  try {
    const parsed = IssuePosMonthlyInvoiceBody.safeParse(req.body);
    if (!parsed.success) throw new MonthlyInvoiceError(400, "Preverite obvezna polja mesečnega računa.");
    const b = parsed.data, c = req as PosRequest;
    if (!validDate(b.invoiceDate) || !validDate(b.dueDate) || b.invoiceDate > localToday() || b.dueDate < b.invoiceDate
      || !validUuid(b.idempotencyKey) || !b.expectedReceiptIds.length || b.expectedReceiptIds.length > 10000
      || b.expectedReceiptIds.some(id => !Number.isSafeInteger(id) || id <= 0)) {
      throw new MonthlyInvoiceError(400, "Neveljavni datumi ali specifikacija. Rok plačila ne sme biti pred datumom izdaje.");
    }
    const hash = createHash("sha256").update(JSON.stringify({ unit: c.enotaId, ...b, expectedReceiptIds: [...b.expectedReceiptIds].sort((a, z) => a - z) })).digest("hex");
    const invoice = await db.transaction(async tx => {
      await lockPosBusinessDay(tx, c.enotaId);
      // Same lock as the ERP collector, so claims cannot race across the two apps.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${c.companyId}:${b.counterpartyId}:${b.month}:contract-summary`}))`);
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${c.companyId}:pos-monthly-numbering`}))`);
      const [replay] = await tx.select().from(posMonthlyInvoicesTable).where(and(eq(posMonthlyInvoicesTable.companyId, c.companyId), eq(posMonthlyInvoicesTable.idempotencyKey, b.idempotencyKey)));
      if (replay) {
        if (replay.requestHash !== hash) throw new MonthlyInvoiceError(409, "Ključ ponovitve pripada drugačnemu zahtevku.");
        return replay;
      }
      await tx.execute(sql`SELECT id FROM racuni WHERE id IN (${sql.join(b.expectedReceiptIds.map(id => sql`${id}`), sql`,`)}) AND enota_id = ${c.enotaId} FOR UPDATE`);
      const f = await monthlyInvoiceFacts(c.companyId, c.enotaId, b.counterpartyId, b.month, tx);
      if (b.invoiceDate < f.end) throw new MonthlyInvoiceError(400, "Datum izdaje ne sme biti pred koncem obračunskega meseca.");
      if (JSON.stringify(f.snapshot.receipts.map(r => r.id)) !== JSON.stringify([...b.expectedReceiptIds].sort((a, z) => a - z))) {
        throw new MonthlyInvoiceError(409, "Dnevni računi so se spremenili ali so že obračunani. Ponovno pripravite predogled.");
      }
      if (!f.snapshot.issuer.address || !f.snapshot.recipient.address || !f.snapshot.recipient.taxId) {
        throw new MonthlyInvoiceError(409, "Pred izdajo dopolnite naslov izdajatelja ter naslov in davčno številko partnerja.");
      }
      const year = Number(b.invoiceDate.slice(0, 4));
      const result = await tx.select({ max: sql<number>`COALESCE(MAX(${posMonthlyInvoicesTable.sequence}), 0)` }).from(posMonthlyInvoicesTable)
        .where(and(eq(posMonthlyInvoicesTable.companyId, c.companyId), eq(posMonthlyInvoicesTable.year, year)));
      const sequence = Number(result[0].max) + 1;
      const [created] = await tx.insert(posMonthlyInvoicesTable).values({
        companyId: c.companyId, enotaId: c.enotaId, counterpartyId: b.counterpartyId, month: b.month,
        invoiceNumber: `M-POS-${year}-${String(sequence).padStart(6, "0")}`, year, sequence,
        invoiceDate: b.invoiceDate, dueDate: b.dueDate, grossAmount: f.snapshot.totalGross, snapshot: f.snapshot,
        idempotencyKey: b.idempotencyKey, requestHash: hash, issuedBy: c.clerkUserId,
      }).returning();
      await tx.insert(posMonthlyInvoiceReceiptsTable).values(f.snapshot.receipts.map(r => ({ invoiceId: created.id, receiptId: r.id })));
      return created;
    });
    res.status(201).json(summary(invoice));
  } catch (e) { fail(e, res); }
});
router.get("/pos-monthly-invoices/:id/pdf", async (req, res) => {
  const c = req as unknown as PosRequest, id = String(req.params.id);
  if (!validUuid(id)) { res.status(404).json({ error: "Račun ni najden." }); return; }
  const [i] = await db.select().from(posMonthlyInvoicesTable).where(and(eq(posMonthlyInvoicesTable.id, id),
    eq(posMonthlyInvoicesTable.companyId, c.companyId), eq(posMonthlyInvoicesTable.enotaId, c.enotaId)));
  if (!i) { res.status(404).json({ error: "Račun ni najden." }); return; }
  const pdf = await monthlyInvoicePdf(i);
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${i.invoiceNumber}.pdf"`);
  res.send(pdf);
});
async function issuedInvoice(req: PosRequest) {
  const id = String(req.params.id);
  if (!validUuid(id)) throw new MonthlyInvoiceError(404, "Račun ni najden.");
  const [i] = await db.select().from(posMonthlyInvoicesTable).where(and(eq(posMonthlyInvoicesTable.id, id),
    eq(posMonthlyInvoicesTable.companyId, req.companyId), eq(posMonthlyInvoicesTable.enotaId, req.enotaId)));
  if (!i) throw new MonthlyInvoiceError(404, "Račun ni najden.");
  return i;
}
router.get("/pos-monthly-invoices/:id/eslog", async (req, res) => {
  try {
    const i = await issuedInvoice(req as unknown as PosRequest), xml = await verifiedMonthlyXml(i);
    res.setHeader("Cache-Control", "no-store"); res.type("application/xml");
    res.setHeader("Content-Disposition", `attachment; filename="eracun-${i.invoiceNumber}.xml"`); res.send(xml);
  } catch (e) { fail(e, res); }
});
router.get("/pos-monthly-invoices/:id/bizbox", async (req, res) => {
  try { res.setHeader("Cache-Control", "no-store"); res.json(monthlyBizboxDto(await monthlyBizboxState(await issuedInvoice(req as unknown as PosRequest)))); }
  catch (e) { fail(e, res); }
});
router.post("/pos-monthly-invoices/:id/bizbox", async (req, res) => {
  try { res.json(await sendMonthlyBizbox(await issuedInvoice(req as unknown as PosRequest), (req as unknown as PosRequest).clerkUserId)); }
  catch (e) { fail(e, res); }
});
router.post("/pos-monthly-invoices/:id/bizbox/check", async (req, res) => {
  try { res.json(await checkMonthlyBizbox(await issuedInvoice(req as unknown as PosRequest))); }
  catch (e) { fail(e, res); }
});
export default router;