import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod/v4";
import { createHash, randomUUID } from "node:crypto";
import { accountingRolesTable, auditLogTable, companiesTable, db } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { buildVatFormPreview, generateVatFormXml, vatFormBounds, type VatFormOptions, type VatFormSource } from "../lib/vatForms";

const router: IRouter = Router();
const periodSchema = z.object({
  form: z.enum(["DDV-O", "RP-O", "PD-O"]), year: z.coerce.number().int().min(2020).max(2099),
  period: z.string().regex(/^07(0[1-9]|1[0-2])$/), periodMode: z.enum(["mesecno", "trimesecno"]),
});
const exportSchema = periodSchema.extend({
  previewHash: z.string().regex(/^[a-f0-9]{64}$/), confirmed: z.literal(true),
  refund: z.boolean().optional(), deductionProportion: z.boolean().optional(),
  contactName: z.string().max(250).optional(), contactPhone: z.string().max(100).optional(),
  corrections: z.array(z.object({
    year: z.number().int().min(2020).max(2099), month: z.number().int().min(1).max(12),
    countryCode: z.string().max(2), vatId: z.string().max(16),
    values: z.record(z.string(), z.string().max(18)),
  }).strict()).max(200).optional(),
}).strict();
async function access(req: Request, res: Response, writing: boolean) {
  const companyId = String(req.params.companyId);
  if (!z.uuid().safeParse(companyId).success) { res.status(400).json({ error: "Neveljaven ID podjetja." }); return null; }
  const [role] = await db.select({ role: accountingRolesTable.role }).from(accountingRolesTable).where(and(
    eq(accountingRolesTable.companyId, companyId), eq(accountingRolesTable.clerkUserId, (req as AuthenticatedRequest).clerkUserId),
  )).limit(1);
  if (!role || (writing && !["owner", "accountant"].includes(role.role))) {
    res.status(403).json({ error: "Za izvoz potrebujete računovodski dostop do izbranega podjetja." }); return null;
  }
  return companyId;
}
/** One read-only consistent snapshot, including all three tenant-bearing source relations. */
async function load(companyId: string, options: VatFormOptions) {
  const bounds = vatFormBounds(options);
  return db.transaction(async tx => {
    const [company] = await tx.select({ id: companiesTable.id, naziv: companiesTable.naziv,
      podjetjeDavcna: companiesTable.podjetjeDavcna, idZaDdv: companiesTable.idZaDdv,
    }).from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (!company) return null;
    const result = await tx.execute<VatFormSource & Record<string, unknown>>(sql`
      SELECT vl.id, vl.direction, vl.document_no AS "documentNo", vc.direction AS "codeDirection",
        vl.base_amount::text AS "baseAmount", vl.vat_amount::text AS "vatAmount",
        vl.non_deductible_vat::text AS "nonDeductibleVat", vl.deduction_percent::text AS "deductionPercent",
        vc.kir_base_field AS "kirBaseField", vc.kir_vat_field AS "kirVatField",
        vc.kpr_base_field AS "kprBaseField", vc.kpr_vat_field AS "kprVatField", vc.code,
        vc.triggers_rp_o AS "triggersRpO", vc.triggers_pd_o AS "triggersPdO", vc.rp_o_column AS "rpOColumn",
        vl.partner_country_code AS "partnerCountryCode", vl.partner_vat_id AS "partnerVatId",
        vl.partner_name AS "partnerName", vl.receipt_date::text AS "receiptDate",
        vl.asset_type AS "assetType", vl.treatment, vl.correction_period AS "correctionPeriod",
        vl.reversed_by_id AS "reversedById", je.status AS "sourceStatus",
        vc.is_reverse_charge AS "isReverseCharge", vc.is_import AS "isImport",
        (paired.id IS NOT NULL AND paired.reversed_by_id IS NULL AND paired.vat_code_id = vl.vat_code_id
          AND paired.direction <> vl.direction
          AND paired.journal_entry_id IS NOT DISTINCT FROM vl.journal_entry_id
          AND paired.invoice_id IS NOT DISTINCT FROM vl.invoice_id
          AND paired.document_id IS NOT DISTINCT FROM vl.document_id
          AND paired.tax_point_date >= ${bounds.from} AND paired.tax_point_date <= ${bounds.to}) AS "pairValid"
      FROM vat_ledger vl
      LEFT JOIN vat_code vc ON vc.id = vl.vat_code_id
      LEFT JOIN vat_ledger paired ON paired.id = vl.pair_id
      LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
      LEFT JOIN invoices iv ON iv.id = vl.invoice_id
      LEFT JOIN documents dc ON dc.id = vl.document_id
      WHERE vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to}
        AND (je.company_id = ${companyId} OR iv.company_id = ${companyId} OR dc.company_id = ${companyId})
        AND (je.company_id IS NULL OR je.company_id = ${companyId})
        AND (iv.company_id IS NULL OR iv.company_id = ${companyId})
        AND (dc.company_id IS NULL OR dc.company_id = ${companyId})
      ORDER BY vl.id
    `);
    const preview = buildVatFormPreview(company, options, result.rows);
    // Compare grouped, posted source lines with active ledger lines: an existing but partial ledger is not enough.
    const missing = await tx.execute<{ documentNo: string; reason: string }>(sql`
      WITH consistency_errors AS (
      SELECT je.reference AS "documentNo", 'Knjižene DDV vrstice niso v celoti usklajene z davčno evidenco.' AS reason
      FROM journal_entry_lines jel
      JOIN journal_entries je ON je.id = jel.entry_id
      JOIN vat_code vc ON vc.id = jel.vat_code_id
      WHERE je.company_id = ${companyId} AND je.status = 'posted'
        AND (CASE WHEN vc.code LIKE 'EUB%' THEN LEAST(COALESCE(je.document_date, je.entry_date),
          (date_trunc('month', je.entry_date::date) + interval '1 month 14 days')::date)
          ELSE COALESCE(je.document_date, je.entry_date) END) >= ${bounds.from}
        AND (CASE WHEN vc.code LIKE 'EUB%' THEN LEAST(COALESCE(je.document_date, je.entry_date),
          (date_trunc('month', je.entry_date::date) + interval '1 month 14 days')::date)
          ELSE COALESCE(je.document_date, je.entry_date) END) <= ${bounds.to}
        AND (ABS(jel.amount::numeric) > 0.005 OR ABS(COALESCE(jel.vat_amount,'0')::numeric) > 0.005)
        AND (${options.form} = 'DDV-O' OR (vc.direction = 'OUT' AND (
          (${options.form} = 'RP-O' AND (vc.triggers_rp_o OR vc.kir_base_field IN ('P10','P11') OR vc.code = 'SEU-S')) OR
          (${options.form} = 'PD-O' AND (vc.triggers_pd_o OR vc.kir_base_field = 'P8')))))
      GROUP BY je.id, je.reference, vc.id, vc.is_reverse_charge, vc.is_import
      HAVING COUNT(*) * CASE WHEN vc.is_reverse_charge OR vc.is_import THEN 2 ELSE 1 END <>
        (SELECT COUNT(*) FROM vat_ledger vl WHERE vl.journal_entry_id = je.id AND vl.vat_code_id = vc.id
          AND vl.reversed_by_id IS NULL AND vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to})
        OR ABS(SUM(jel.amount::numeric) * CASE WHEN vc.is_reverse_charge OR vc.is_import THEN 2 ELSE 1 END -
          COALESCE((SELECT SUM(vl.base_amount::numeric) FROM vat_ledger vl WHERE vl.journal_entry_id = je.id AND vl.vat_code_id = vc.id
            AND vl.reversed_by_id IS NULL AND vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to}),0)) > 0.005
        OR ABS(SUM(COALESCE(jel.vat_amount,'0')::numeric) * CASE WHEN vc.is_reverse_charge OR vc.is_import THEN 2 ELSE 1 END -
          COALESCE((SELECT SUM(vl.vat_amount::numeric + vl.non_deductible_vat::numeric) FROM vat_ledger vl
            WHERE vl.journal_entry_id = je.id AND vl.vat_code_id = vc.id AND vl.reversed_by_id IS NULL
              AND vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to}),0)) > 0.005
      ), missing_codes AS (
        SELECT je.reference AS "documentNo", 'Knjižena vrstica z DDV nima globalne FURS kode.' AS reason
        FROM journal_entry_lines jel JOIN journal_entries je ON je.id = jel.entry_id
        WHERE je.company_id = ${companyId} AND je.status = 'posted' AND jel.vat_code_id IS NULL
          AND ABS(COALESCE(jel.vat_amount,'0')::numeric) > 0.005
          AND COALESCE(je.document_date, je.entry_date) >= ${bounds.from}
          AND COALESCE(je.document_date, je.entry_date) <= ${bounds.to}
      ), mixed_tenants AS (
        SELECT NULL::text AS "documentNo", 'Davčna vrstica povezuje dokumente različnih podjetij; pred izvozom jo uskladite.' AS reason
        FROM vat_ledger vl
        LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
        LEFT JOIN invoices iv ON iv.id = vl.invoice_id
        LEFT JOIN documents dc ON dc.id = vl.document_id
        WHERE vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to}
          AND (je.company_id = ${companyId} OR iv.company_id = ${companyId} OR dc.company_id = ${companyId})
          AND ((je.company_id IS NOT NULL AND je.company_id <> ${companyId})
            OR (iv.company_id IS NOT NULL AND iv.company_id <> ${companyId})
            OR (dc.company_id IS NOT NULL AND dc.company_id <> ${companyId}))
      )
      SELECT * FROM consistency_errors UNION ALL SELECT * FROM missing_codes UNION ALL SELECT * FROM mixed_tenants LIMIT 100
    `);
    preview.issues.push(...missing.rows.map(r => ({severity: "ERROR" as const, message: r.reason, documentNo: r.documentNo})));
    preview.canExport = !preview.issues.some(i => i.severity === "ERROR");
    // Missing-line controls are part of what the accountant confirms too.
    preview.snapshotHash = createHash("sha256").update(preview.snapshotHash + JSON.stringify(missing.rows)).digest("hex");
    return { company, preview };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}
router.get("/companies/:companyId/vat-form-preview", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const companyId = await access(req, res, false); if (!companyId) return;
    const parsed = periodSchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({error:"Izberite obrazec in veljavno davčno obdobje."}); return; }
    try { vatFormBounds(parsed.data); } catch (err) { res.status(400).json({error:(err as Error).message}); return; }
    const snapshot = await load(companyId, parsed.data);
    if (!snapshot) { res.status(404).json({error:"Podjetje ni najdeno."}); return; }
    res.json(snapshot.preview);
  } catch (err) { req.log.error({err}, "VAT form preview failed"); res.status(500).json({error:"Predogleda ni mogoče pripraviti."}); }
});
router.post("/companies/:companyId/vat-form-export", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const companyId = await access(req, res, true); if (!companyId) return;
    const parsed = exportSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({error:"Izvoz zahteva potrjen predogled in veljavne podatke."}); return; }
    const {form, year, period, periodMode, previewHash, ...exportOptions} = parsed.data;
    try { vatFormBounds({form,year,period,periodMode}); } catch (err) { res.status(400).json({error:(err as Error).message}); return; }
    const snapshot = await load(companyId, {form,year,period,periodMode});
    if (!snapshot) { res.status(404).json({error:"Podjetje ni najdeno."}); return; }
    if (snapshot.preview.snapshotHash !== previewHash) {
      res.status(409).json({error:"Podatki so se spremenili. Osvežite in znova potrdite predogled."}); return;
    }
    let xml: string;
    try { xml = generateVatFormXml(snapshot.company, snapshot.preview, exportOptions); }
    catch (err) { res.status(400).json({error:(err as Error).message, issues:snapshot.preview.issues}); return; }
    const sha256 = createHash("sha256").update(xml).digest("hex");
    const filename = `${form.replaceAll("-","_")}_${year}_${period}.xml`;
    await db.insert(auditLogTable).values({
      companyId, entityType:"vat_form_export", entityId:randomUUID(), action:"export",
      changedBy:(req as AuthenticatedRequest).clerkUserId,
      payload:{form,year,period,periodMode,previewHash,sha256,filename,xml, options:exportOptions, notice:"Izvoz ni davčna oddaja."},
    });
    res.json({xml,filename,sha256});
  } catch (err) { req.log.error({err}, "VAT form export failed"); res.status(500).json({error:"Izvoza ni mogoče pripraviti ali evidentirati."}); }
});
export default router;
