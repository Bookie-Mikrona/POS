import { Router, type Request, type Response, type IRouter } from "express";
import { sql, eq, and } from "drizzle-orm";
import { db, accountingRolesTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

export function absNumber(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.abs(n) : 0;
}
export function rankPackagingCandidate(input: { articleMatch: boolean; unitValueMatch: boolean; depositMatch: boolean }): number {
  if (!input.articleMatch) return 0;
  if (input.unitValueMatch && input.depositMatch) return 100;
  if (input.unitValueMatch) return 85;
  if (input.depositMatch) return 75;
  return 50;
}
export function remainingAllocationQuantity(total: unknown, allocated: unknown): number {
  return Math.max(0, absNumber(total) - Number(allocated || 0));
}
export function isSameConfirmReplay(existing: {
  sourceDocumentId: unknown;
  prejemnicaPostavkaId: unknown;
  embalazniPrometId: unknown;
  quantitySnapshot: unknown;
  status: unknown;
}, requested: {
  sourceDocumentId: unknown;
  prejemnicaPostavkaId: unknown;
  embalazniPrometId: unknown;
  quantity: unknown;
}): boolean {
  return String(existing.sourceDocumentId) === String(requested.sourceDocumentId)
    && String(existing.prejemnicaPostavkaId) === String(requested.prejemnicaPostavkaId)
    && String(existing.embalazniPrometId) === String(requested.embalazniPrometId)
    && Math.abs(Number(existing.quantitySnapshot) - Number(requested.quantity)) < 0.00005
    && existing.status === "confirmed";
}
export function buildAllocationSnapshots(input: {
  movementUnitDeposit: unknown;
  lineNet: unknown;
  lineGross: unknown;
  lineQuantity: unknown;
  allocatedQuantity: unknown;
}) {
  const quantity = Number(input.allocatedQuantity);
  const lineQuantity = absNumber(input.lineQuantity);
  if (!(quantity > 0) || !(lineQuantity > 0)) throw new Error("ALLOCATIONS_NOT_AVAILABLE");
  const cents = (value: number) => (Math.round((value + Number.EPSILON) * 100) / 100).toFixed(2);
  return {
    depositSnapshot: cents(absNumber(input.movementUnitDeposit) * quantity),
    netSnapshot: cents(absNumber(input.lineNet) * quantity / lineQuantity),
    grossSnapshot: cents(absNumber(input.lineGross) * quantity / lineQuantity),
  };
}
function allocationResponse(row: any) {
  return {
    id: row.id,
    companyId: row.company_id ?? row.companyId,
    sourceDocumentId: row.source_document_id ?? row.sourceDocumentId,
    invoiceLineId: row.invoice_line_id ?? row.invoiceLineId ?? null,
    prejemnicaPostavkaId: row.prejemnica_postavka_id ?? row.prejemnicaPostavkaId,
    embalazniPrometId: row.embalazni_promet_id ?? row.embalazniPrometId,
    status: row.status,
    reversedAllocationId: row.reversed_allocation_id ?? row.reversedAllocationId ?? null,
    operationKey: row.operation_key ?? row.operationKey,
    actorSnapshot: row.actor_snapshot ?? row.actorSnapshot ?? null,
    quantitySnapshot: row.quantity_snapshot ?? row.quantitySnapshot,
    depositSnapshot: row.deposit_snapshot ?? row.depositSnapshot,
    netSnapshot: row.net_snapshot ?? row.netSnapshot,
    grossSnapshot: row.gross_snapshot ?? row.grossSnapshot,
    createdAt: row.created_at ?? row.createdAt,
  };
}
const uuid = (v: unknown) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(v);
const positive = (v: unknown) => typeof v === "number" || (typeof v === "string" && v.trim() !== "") ? Number.isFinite(Number(v)) && Number(v) > 0 : false;
const param = (v: string | string[]) => Array.isArray(v) ? v[0] : v;
const router: IRouter = Router();

async function access(req: Request, companyId: string, res: Response) {
  const [role] = await db.select({ id: accountingRolesTable.id, role: accountingRolesTable.role }).from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.companyId, companyId), eq(accountingRolesTable.clerkUserId, (req as AuthenticatedRequest).clerkUserId))).limit(1);
  if (!role) { res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" }); return false; }
  return role.role;
}

async function writeAccess(req: Request, companyId: string, res: Response) {
  const role = await access(req, companyId, res);
  if (!role) return false;
  if (role !== "owner" && role !== "accountant") { res.status(403).json({ error: "Za potrjevanje je potrebna vloga lastnika ali računovodje" }); return false; }
  return true;
}

router.get("/companies/:companyId/credit-note-packaging-documents", requireAuth, async (req, res) => {
  const companyId = param(req.params.companyId); if (!await access(req, companyId, res)) return;
  const result = await db.execute(sql`
    SELECT p.id, p.stevilka AS number, p.datum::text AS date, p.dobavitelj_naziv AS "supplierName",
      p.source_document_id AS "sourceDocumentId", COUNT(ar.id)::int AS "packagingLineCount",
       GREATEST(0, COALESCE(SUM(CASE WHEN ar.id IS NOT NULL THEN ABS(l.kolicina) ELSE 0 END),0) - COALESCE((SELECT SUM(a.quantity_snapshot)
         FROM pos_credit_note_allocations a WHERE a.source_document_id=p.source_document_id),0)) AS "remainingQuantity"
    FROM prejemnice p JOIN enote e ON e.id=p.enota_id
      LEFT JOIN prejemnice_postavke l ON l.prejemnica_id=p.id
      LEFT JOIN artikli ar ON ar.id=l.artikel_id AND ar.povratna_embalaza=true
    WHERE e.company_id=${companyId} AND p.vrsta_dokumenta='DOBROPIS' AND p.source_document_id IS NOT NULL
    GROUP BY p.id, e.company_id
    HAVING COUNT(ar.id) > 0
    ORDER BY p.datum DESC`);
  res.json({ documents: result.rows });
});

router.get("/companies/:companyId/prejemnice/:receiptId/credit-note-packaging", requireAuth, async (req, res) => {
  const companyId = param(req.params.companyId); if (!await access(req, companyId, res)) return;
  const receiptId = Number(param(req.params.receiptId));
  const docResult = await db.execute(sql`
    SELECT p.id, p.vrsta_dokumenta AS "documentType", p.dobavitelj_id AS "supplierId",
      p.source_document_id AS "sourceDocumentId", p.enota_id AS "enotaId",
      d.kind AS "sourceKind"
    FROM prejemnice p JOIN enote e ON e.id=p.enota_id
    LEFT JOIN purchase_source_documents d ON d.id=p.source_document_id
    WHERE p.id=${receiptId} AND e.company_id=${companyId}`);
  const doc = docResult.rows[0] as any;
  if (!doc) { res.status(404).json({ error: "Prejemnica ni najdena" }); return; }
  if (doc.documentType !== "DOBROPIS" || doc.sourceKind !== "credit_note" || !doc.sourceDocumentId) {
    res.status(409).json({ error: "Povezovanje zahteva dobropis s kanonično identiteto listine" });
    return;
  }
  const [lines, candidates, history] = await Promise.all([
    db.execute(sql`
      SELECT l.id, l.artikel_id AS "articleId", a.ime AS "articleName",
        ABS(l.kolicina) AS quantity, ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj)) AS "netValue",
        ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj))/NULLIF(ABS(l.kolicina),0) AS "expectedUnitValue",
        COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x
          WHERE x.prejemnica_postavka_id=l.id),0) AS "allocatedQuantity"
      FROM prejemnice_postavke l JOIN artikli a ON a.id=l.artikel_id
      WHERE l.prejemnica_id=${receiptId} AND a.povratna_embalaza=true`),
    db.execute(sql`
      SELECT m.id, l.id AS "lineId", m.artikel_id AS "articleId", a.ime AS "articleName",
        ABS(m.kolicina) AS quantity, ABS(COALESCE(m.depozitna_vrednost,0)) AS "depositValue",
        ROUND(ABS(COALESCE(m.depozitna_vrednost,0)),2) AS "movementUnitDeposit",
        ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj))/NULLIF(ABS(l.kolicina),0) AS "expectedUnitValue",
        ABS(ROUND(ABS(COALESCE(m.depozitna_vrednost,0)),2) -
          ROUND(ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj))/NULLIF(ABS(l.kolicina),0),2)) AS "valueDifference",
        CASE WHEN ABS(ROUND(ABS(COALESCE(m.depozitna_vrednost,0)),2) -
          ROUND(ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj))/NULLIF(ABS(l.kolicina),0),2)) <= 0.01 THEN 100 ELSE 50 END AS rank,
        ABS(l.kolicina)-COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x
          WHERE x.prejemnica_postavka_id=l.id),0) AS "lineRemainingQuantity",
        COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x
          WHERE x.embalazni_promet_id=m.id),0) AS "allocatedQuantity",
        ABS(m.kolicina)-COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x
          WHERE x.embalazni_promet_id=m.id),0) AS "returnRemainingQuantity"
      FROM embalazni_prometi m JOIN prejemnice_postavke l ON l.prejemnica_id=${receiptId}
        AND l.artikel_id=m.artikel_id JOIN artikli a ON a.id=m.artikel_id
      WHERE m.enota_id=${doc.enotaId} AND m.dobavitelj_id=${doc.supplierId} AND m.vrsta='vracilo'
        AND m.journal_entry_id IS NOT NULL AND m.reversal_of_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM embalazni_prometi mr WHERE mr.reversal_of_id=m.id)
        AND a.povratna_embalaza=true
      ORDER BY rank DESC, "valueDifference" ASC, m.datum DESC`),
    db.execute(sql`
      SELECT id, source_document_id AS "sourceDocumentId", prejemnica_postavka_id AS "prejemnicaPostavkaId",
        embalazni_promet_id AS "embalazniPrometId", status, quantity_snapshot AS "quantitySnapshot",
        deposit_snapshot AS "depositSnapshot", net_snapshot AS "netSnapshot", gross_snapshot AS "grossSnapshot",
        operation_key AS "operationKey", reversed_allocation_id AS "reversedAllocationId", actor_snapshot AS "actorSnapshot", created_at AS "createdAt"
      FROM pos_credit_note_allocations WHERE company_id=${companyId} AND source_document_id=${doc.sourceDocumentId}
      ORDER BY created_at DESC`),
  ]);
  res.json({
    document: doc,
    lines: lines.rows.map((l: any) => ({
      ...l,
      lineRemainingQuantity: remainingAllocationQuantity(l.quantity, l.allocatedQuantity),
    })),
    candidates: candidates.rows.map((candidate: any) => ({
      ...candidate,
      lineRemainingQuantity: Math.max(0, Number(candidate.lineRemainingQuantity)),
      returnRemainingQuantity: Math.max(0, Number(candidate.returnRemainingQuantity)),
    })),
    history: history.rows,
  });
});

router.post("/companies/:companyId/prejemnice/:receiptId/credit-note-packaging/confirm", requireAuth, async (req, res) => {
  const companyId = param(req.params.companyId), receiptId = Number(param(req.params.receiptId));
  if (!await writeAccess(req, companyId, res)) return;
  const { operationKey, prejemnicaPostavkaId, embalazniPrometId, quantity } = req.body ?? {};
  if (!uuid(operationKey) || !Number.isInteger(receiptId) || !Number.isInteger(Number(prejemnicaPostavkaId)) ||
      !Number.isInteger(Number(embalazniPrometId)) || !positive(quantity)) {
    res.status(400).json({ error: "Manjkajoči ali neveljavni podatki dodelitve" }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      const receiptSource = await tx.execute(sql`SELECT source_document_id AS "sourceDocumentId"
        FROM prejemnice p JOIN enote e ON e.id=p.enota_id
        WHERE p.id=${receiptId} AND e.company_id=${companyId}`);
      const sourceDocumentId = (receiptSource.rows[0] as any)?.sourceDocumentId;
      if (!sourceDocumentId) throw Object.assign(new Error("CREDIT_NOTE_SOURCE_REQUIRED"), { status: 409 });
      const lockKeys = [
        `credit-note:${companyId}:operation:${operationKey}`,
        `credit-note:${companyId}:line:${Number(prejemnicaPostavkaId)}`,
        `credit-note:${companyId}:movement:${Number(embalazniPrometId)}`,
      ].sort();
      for (const key of lockKeys) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
      const replay = await tx.execute(sql`SELECT *
        FROM pos_credit_note_allocations WHERE company_id=${companyId} AND operation_key=${operationKey}`);
      const existing = replay.rows[0] as any;
      if (existing) {
        if (!isSameConfirmReplay({
          sourceDocumentId: existing.source_document_id,
          prejemnicaPostavkaId: existing.prejemnica_postavka_id,
          embalazniPrometId: existing.embalazni_promet_id,
          quantitySnapshot: existing.quantity_snapshot,
          status: existing.status,
        }, { sourceDocumentId, prejemnicaPostavkaId, embalazniPrometId, quantity })) {
          throw Object.assign(new Error("IDEMPOTENCY_MISMATCH"), { status: 409 });
        }
        return allocationResponse(existing);
      }
      const rowResult = await tx.execute(sql`
        SELECT p.vrsta_dokumenta, p.enota_id, p.dobavitelj_id, p.source_document_id,
          d.kind AS source_kind, l.artikel_id AS line_article, a.povratna_embalaza,
          ABS(l.kolicina) AS line_quantity, ABS(m.kolicina) AS movement_quantity,
          ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj)) AS line_net,
          ABS(COALESCE(l.ddv_osnova,l.neto_znesek,l.skupaj,0)) + ABS(COALESCE(l.ddv_znesek,0)) AS line_gross,
          ABS(COALESCE(m.depozitna_vrednost,0)) AS movement_deposit,
          COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x WHERE x.prejemnica_postavka_id=l.id),0) AS line_allocated,
          COALESCE((SELECT SUM(x.quantity_snapshot) FROM pos_credit_note_allocations x WHERE x.embalazni_promet_id=m.id),0) AS movement_allocated
        FROM prejemnice p JOIN enote e ON e.id=p.enota_id
        JOIN purchase_source_documents d ON d.id=p.source_document_id AND d.company_id=e.company_id AND d.counterparty_id=p.dobavitelj_id
        JOIN prejemnice_postavke l ON l.id=${Number(prejemnicaPostavkaId)} AND l.prejemnica_id=p.id
        JOIN artikli a ON a.id=l.artikel_id AND a.povratna_embalaza=true
        JOIN embalazni_prometi m ON m.id=${Number(embalazniPrometId)}
          AND m.enota_id=p.enota_id AND m.dobavitelj_id=p.dobavitelj_id
          AND m.artikel_id=l.artikel_id AND m.vrsta='vracilo'
          AND m.journal_entry_id IS NOT NULL AND m.reversal_of_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM embalazni_prometi mr WHERE mr.reversal_of_id=m.id)
        WHERE p.id=${receiptId} AND e.company_id=${companyId} AND p.vrsta_dokumenta='DOBROPIS' AND d.kind='credit_note'
        FOR UPDATE`);
       const row = rowResult.rows[0] as any, qty = Number(quantity);
       if (!row || row.source_kind!=="credit_note"
           || qty > remainingAllocationQuantity(row.line_quantity, row.line_allocated)
           || qty > remainingAllocationQuantity(row.movement_quantity, row.movement_allocated)) {
         throw Object.assign(new Error("ALLOCATIONS_NOT_AVAILABLE"), { status: 409 });
       }
       const unsafeBooking = await tx.execute(sql`
         SELECT 1 FROM pos_receipt_booking_sources
         WHERE prejemnica_id=${receiptId}
           AND packaging_reconciliation_safe=false
         LIMIT 1
       `);
       if (unsafeBooking.rows.length) {
         throw Object.assign(new Error("CREDIT_NOTE_REQUIRES_RECONCILIATION"), { status: 409 });
       }
       const snapshots = buildAllocationSnapshots({
         movementUnitDeposit: row.movement_deposit,
         lineNet: row.line_net,
         lineGross: row.line_gross,
         lineQuantity: row.line_quantity,
         allocatedQuantity: qty,
       });
      const inserted = await tx.execute(sql`INSERT INTO pos_credit_note_allocations
        (company_id,source_document_id,invoice_line_id,prejemnica_postavka_id,embalazni_promet_id,operation_key,actor_snapshot,quantity_snapshot,deposit_snapshot,net_snapshot,gross_snapshot)
         VALUES (${companyId},${row.source_document_id},NULL,${prejemnicaPostavkaId},${embalazniPrometId},${operationKey},${(req as AuthenticatedRequest).clerkUserId},${qty},
           ${snapshots.depositSnapshot},${snapshots.netSnapshot},${snapshots.grossSnapshot}) RETURNING *`);
       return allocationResponse(inserted.rows[0]);
    }); res.json(result);
  } catch (error: any) { res.status(error.status ?? 400).json({ error: error.message }); }
});

router.post("/companies/:companyId/prejemnice/:receiptId/credit-note-packaging/:allocationId/reverse", requireAuth, async (req, res) => {
  const companyId=param(req.params.companyId), receiptId=Number(param(req.params.receiptId)), allocationId=param(req.params.allocationId);
  if (!await writeAccess(req, companyId, res)) return;
  const { operationKey }=req.body??{};
  if (!uuid(operationKey) || !uuid(allocationId)) { res.status(400).json({ error:"operationKey in allocationId morata biti UUID" }); return; }
  try { const result=await db.transaction(async tx=>{
    const lockKeys = [
      `credit-note:${companyId}:allocation:${allocationId}`,
      `credit-note:${companyId}:operation:${operationKey}`,
    ].sort();
    for (const key of lockKeys) await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${key}))`);
    const originalResult=await tx.execute(sql`SELECT a.* FROM pos_credit_note_allocations a JOIN prejemnice p ON p.source_document_id=a.source_document_id
      WHERE a.id=${allocationId} AND a.company_id=${companyId} AND p.id=${receiptId} AND a.status='confirmed' FOR UPDATE`);
    const original=originalResult.rows[0] as any; if(!original) throw Object.assign(new Error("ALLOCATON_NOT_ACTIVE"),{status:409});
    const replay=await tx.execute(sql`SELECT * FROM pos_credit_note_allocations WHERE company_id=${companyId} AND operation_key=${operationKey}`);
     if(replay.rows[0]) {
       if(replay.rows[0].reversed_allocation_id!==allocationId || replay.rows[0].status !== "reversed") {
         throw Object.assign(new Error("IDEMPOTENCY_MISMATCH"),{status:409});
       }
       return allocationResponse(replay.rows[0]);
     }
    const prior=await tx.execute(sql`SELECT 1 FROM pos_credit_note_allocations WHERE reversed_allocation_id=${allocationId}`);
    if(prior.rows.length) throw Object.assign(new Error("ALREADY_REVERSED"),{status:409});
    const inserted=await tx.execute(sql`INSERT INTO pos_credit_note_allocations
      (company_id,source_document_id,invoice_line_id,prejemnica_postavka_id,embalazni_promet_id,status,reversed_allocation_id,operation_key,actor_snapshot,quantity_snapshot,deposit_snapshot,net_snapshot,gross_snapshot)
      VALUES (${companyId},${original.source_document_id},${original.invoice_line_id},${original.prejemnica_postavka_id},${original.embalazni_promet_id},'reversed',${allocationId},${operationKey},${(req as AuthenticatedRequest).clerkUserId},${-Number(original.quantity_snapshot)},${original.deposit_snapshot},${original.net_snapshot},${original.gross_snapshot}) RETURNING *`);
     return allocationResponse(inserted.rows[0]);
  }); res.json(result); } catch(error:any){res.status(error.status??400).json({error:error.message});}
});
export default router;