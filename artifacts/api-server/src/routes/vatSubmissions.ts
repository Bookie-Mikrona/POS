/**
 * §135 — KIR/KPR XML izvoz za FURS
 *
 * POST /companies/:companyId/vat-submissions  — generiraj XML, shrani, vrni download URL
 * GET  /companies/:companyId/vat-submissions  — seznam preteklih oddaj
 * GET  /companies/:companyId/vat-submissions/:id/download — (re)prenesi XML
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { and, eq, desc, sql } from "drizzle-orm";
import {
  db,
  accountingRolesTable,
  companiesTable,
  vatSubmissionsTable,
  vatLedgerTable,
  vatCodeTable,
  journalEntriesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { generateKirKprXml } from "../lib/vatXmlGenerator";
import { vatSubmissionPeriodBounds } from "../lib/vatSubmissionPreflight";
import { buildKirKprZip } from "../lib/vatZip";
import { ObjectStorageService } from "../lib/objectStorage";
import { objectStorageClient } from "../lib/objectStorage";

const router: IRouter = Router();
const objectStorage = new ObjectStorageService();

// ─── Pomočniki ────────────────────────────────────────────────────────────────

function extractParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

async function resolveAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
  minRole: "accountant" | "viewer" = "accountant",
): Promise<{ role: "owner" | "accountant" | "viewer" } | null> {
  const [row] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
    return null;
  }
  if (minRole === "accountant" && row.role === "viewer") {
    res.status(403).json({ error: "Za to dejanje potrebujete vlogo računovodje" });
    return null;
  }
  return { role: row.role };
}

/**
 * Shrani XML v object storage (private dir) ali vrne null če OS ni konfiguriran.
 * Vrne pot `/objects/vat-xml/...`.
 */
async function saveXmlToStorage(
  xml: string,
  companyId: string,
  period: string,
  year: number,
  submissionId: string,
): Promise<string | null> {
  try {
    const privateDir = objectStorage.getPrivateObjectDir();
    const path = `${privateDir}/vat-xml/${companyId}/${year}-${period}/${submissionId}.xml`;
    const { bucketName, objectName } = parseObjectPath(path);
    const bucket = objectStorageClient.bucket(bucketName);
    const file = bucket.file(objectName);
    await file.save(xml, {
      contentType: "application/xml",
      metadata: { contentDisposition: `attachment; filename="KIR_KPR_${year}_${period}.xml"` },
    });
    // Vrni normalized pot
    return `/objects/vat-xml/${companyId}/${year}-${period}/${submissionId}.xml`;
  } catch {
    return null; // object storage ni konfiguriran ali je druga napaka
  }
}

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) path = `/${path}`;
  const parts = path.split("/");
  return { bucketName: parts[1], objectName: parts.slice(2).join("/") };
}

// ─── POST /companies/:companyId/vat-submissions ───────────────────────────────

interface CreateSubmissionBody {
  year: unknown;
  period: unknown;
  periodMode?: unknown;
  odbdelez?: unknown;
  vracilo?: unknown;
  nacin?: unknown;
  opomba?: unknown;
}

function validateCreateBody(body: CreateSubmissionBody): {
  year: number; period: string;
  periodMode: "mesecno" | "trimesecno";
  odbdelez?: boolean; vracilo?: boolean;
  nacin?: 1 | 2 | 3; opomba?: string;
} | { error: string } {
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2025 || year > 2100)
    return { error: "Leto mora biti med 2025 in 2100" };

  const period = String(body.period ?? "");
  const periodMode = body.periodMode === "trimesecno" ? "trimesecno" : "mesecno";

  if (!/^07(0[1-9]|1[0-2])$/.test(period))
    return { error: "Neveljavna koda obdobja (pričakovano MMMM, npr. 0707)" };

  const nacin = body.nacin != null ? Number(body.nacin) : undefined;
  if (nacin != null && ![1, 2, 3].includes(nacin))
    return { error: "NACIN mora biti 1, 2 ali 3" };

  const opomba = body.opomba != null ? String(body.opomba).slice(0, 250) : undefined;

  return {
    year,
    period,
    periodMode,
    odbdelez: body.odbdelez === true,
    vracilo: body.vracilo === true,
    nacin: nacin as 1 | 2 | 3 | undefined,
    opomba,
  };
}

router.post(
  "/companies/:companyId/vat-submissions",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "accountant");
    if (!access) return;

    // Validiraj body
    const parsed = validateCreateBody(req.body as CreateSubmissionBody);
    if ("error" in parsed) {
      res.status(400).json({ error: parsed.error });
      return;
    }
    const { year, period, periodMode, odbdelez, vracilo, nacin, opomba } = parsed;

    // Pridobi davčno številko podjetja
    const [company] = await db
      .select({ podjetjeDavcna: companiesTable.podjetjeDavcna })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId))
      .limit(1);

    if (!company) {
      res.status(404).json({ error: "Podjetje ni najdeno" });
      return;
    }

    const bounds = vatSubmissionPeriodBounds(year, period, periodMode);
    if (!bounds) {
      res.status(400).json({ error: "Neveljavno obdobje" });
      return;
    }

    // Pred oddajo preveri tako formalne D4 kontrole kot popolnost preslikave.
    // Brez tega bi generator manjkajoče P-polje tiho izpustil iz XML.
    const errorsResult = await db.execute<{
      documentNo: string | null;
      recordId: string | null;
      direction: string | null;
      vatCode: string | null;
      reason: string;
    }>(sql`
      WITH scoped AS (
        SELECT
          vl.id::text AS "recordId",
          vl.document_no AS "documentNo",
          vl.direction,
          vc.code AS "vatCode",
          vl.receipt_date,
          vl.pair_id,
          vl.treatment,
          vl.correction_period,
          vl.base_amount::numeric AS base_amount,
          vl.vat_amount::numeric AS vat_amount,
          vl.non_deductible_vat::numeric AS non_deductible_vat,
          vc.is_reverse_charge,
          vc.is_import,
          vc.kir_base_field,
          vc.kir_vat_field,
          vc.kpr_base_field,
          vc.kpr_vat_field,
          (
            paired.id IS NOT NULL
            AND paired.reversed_by_id IS NULL
            AND paired.vat_code_id = vl.vat_code_id
            AND paired.direction <> vl.direction
            AND paired.journal_entry_id IS NOT DISTINCT FROM vl.journal_entry_id
            AND paired.invoice_id IS NOT DISTINCT FROM vl.invoice_id
            AND paired.document_id IS NOT DISTINCT FROM vl.document_id
            AND paired.tax_point_date >= ${bounds.from}
            AND paired.tax_point_date <= ${bounds.to}
          ) AS pair_valid
        FROM vat_ledger vl
        JOIN vat_code vc ON vc.id = vl.vat_code_id
        LEFT JOIN vat_ledger paired ON paired.id = vl.pair_id
        LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
        LEFT JOIN invoices iv ON iv.id = vl.invoice_id
        LEFT JOIN documents dc ON dc.id = vl.document_id
        WHERE vl.tax_point_date >= ${bounds.from}
          AND vl.tax_point_date <= ${bounds.to}
          AND (je.company_id = ${companyId} OR iv.company_id = ${companyId} OR dc.company_id = ${companyId})
          AND (je.company_id IS NULL OR je.company_id = ${companyId})
          AND (iv.company_id IS NULL OR iv.company_id = ${companyId})
          AND (dc.company_id IS NULL OR dc.company_id = ${companyId})
          AND vl.reversed_by_id IS NULL
      ),
      ledger_errors AS (
        SELECT "documentNo", "recordId", direction, "vatCode",
          CASE
            WHEN direction = 'IN' AND receipt_date IS NULL THEN 'KPR: manjka datum prejema računa (D4.2).'
            WHEN (is_reverse_charge = TRUE OR is_import = TRUE) AND NOT pair_valid THEN 'Manjka veljavna povezava samoobdavčitve ali uvoza (D4.3).'
            WHEN treatment IN (2, 3) AND correction_period IS NULL THEN 'Manjka obdobje popravka (D4.6).'
            WHEN direction = 'OUT' AND ABS(base_amount) > 0.005 AND kir_base_field IS NULL THEN 'KIR: manjka preslikava osnove.'
            WHEN direction = 'OUT' AND ABS(vat_amount) > 0.005 AND kir_vat_field IS NULL THEN 'KIR: manjka preslikava DDV.'
            WHEN direction = 'IN' AND ABS(base_amount) > 0.005 AND kpr_base_field IS NULL THEN 'KPR: manjka preslikava osnove.'
            WHEN direction = 'IN' AND ABS(vat_amount) > 0.005 AND kpr_vat_field IS NULL THEN 'KPR: manjka preslikava odbitnega DDV.'
            ELSE 'DDV vrstica nima popolne preslikave za KIR/KPR.'
          END AS reason
        FROM scoped
        WHERE (direction = 'IN' AND receipt_date IS NULL)
           OR ((is_reverse_charge = TRUE OR is_import = TRUE) AND NOT pair_valid)
           OR (treatment IN (2, 3) AND correction_period IS NULL)
           OR (direction = 'OUT' AND (
                (ABS(base_amount) > 0.005 AND kir_base_field IS NULL)
                OR (ABS(vat_amount) > 0.005 AND kir_vat_field IS NULL)))
           OR (direction = 'IN' AND (
                (ABS(base_amount) > 0.005 AND kpr_base_field IS NULL)
                OR (ABS(vat_amount) > 0.005 AND kpr_vat_field IS NULL)))
      ),
      missing_code_errors AS (
        SELECT
          je.reference AS "documentNo",
          jel.id::text AS "recordId",
          NULL::text AS direction,
          NULL::text AS "vatCode",
          'DDV vrstica nima DDV-kode; KIR/KPR zapisa ni mogoče varno ustvariti.' AS reason
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        WHERE je.company_id = ${companyId}
          AND je.status = 'posted'
          AND COALESCE(je.document_date, je.entry_date) >= ${bounds.from}
          AND COALESCE(je.document_date, je.entry_date) <= ${bounds.to}
          AND (
            ABS(jel.amount::numeric) > 0.005
            OR ABS(COALESCE(jel.vat_amount, '0')::numeric) > 0.005
          )
          AND jel.vat_code_id IS NULL
      ),
      coded_line_groups AS (
        SELECT
          je.id AS entry_id,
          je.reference AS "documentNo",
          jel.vat_code_id,
          vc.code AS "vatCode",
          vc.is_reverse_charge,
          vc.is_import,
          COUNT(*)::integer AS line_count,
          SUM(jel.amount::numeric) AS line_amount,
          SUM(COALESCE(jel.vat_amount, '0')::numeric) AS line_vat_amount
        FROM journal_entry_lines jel
        JOIN journal_entries je ON je.id = jel.entry_id
        JOIN vat_code vc ON vc.id = jel.vat_code_id
        WHERE je.company_id = ${companyId}
          AND je.status = 'posted'
          AND (
            CASE
              WHEN vc.code LIKE 'EUB%' THEN LEAST(
                COALESCE(je.document_date, je.entry_date),
                (date_trunc('month', je.entry_date::date) + interval '1 month 14 days')::date
              )
              ELSE COALESCE(je.document_date, je.entry_date)
            END
          ) >= ${bounds.from}
          AND (
            CASE
              WHEN vc.code LIKE 'EUB%' THEN LEAST(
                COALESCE(je.document_date, je.entry_date),
                (date_trunc('month', je.entry_date::date) + interval '1 month 14 days')::date
              )
              ELSE COALESCE(je.document_date, je.entry_date)
            END
          ) <= ${bounds.to}
          AND (
            ABS(jel.amount::numeric) > 0.005
            OR ABS(COALESCE(jel.vat_amount, '0')::numeric) > 0.005
          )
        GROUP BY je.id, je.reference, jel.vat_code_id, vc.code, vc.is_reverse_charge, vc.is_import
      ),
      ledger_groups AS (
        SELECT
          vl.journal_entry_id AS entry_id,
          vl.vat_code_id,
          COUNT(*)::integer AS ledger_count,
          SUM(vl.base_amount::numeric) AS ledger_base_amount,
          SUM(vl.vat_amount::numeric + vl.non_deductible_vat::numeric) AS ledger_total_vat
        FROM vat_ledger vl
        WHERE vl.reversed_by_id IS NULL
          AND vl.tax_point_date >= ${bounds.from}
          AND vl.tax_point_date <= ${bounds.to}
        GROUP BY vl.journal_entry_id, vl.vat_code_id
      ),
      coded_line_errors AS (
        SELECT
          cl."documentNo",
          cl.entry_id::text AS "recordId",
          NULL::text AS direction,
          cl."vatCode",
          'Knjižene DDV vrstice nimajo popolnoma usklajenih aktivnih vrstic v evidenci KIR/KPR.' AS reason
        FROM coded_line_groups cl
        LEFT JOIN ledger_groups lg
          ON lg.entry_id = cl.entry_id
         AND lg.vat_code_id = cl.vat_code_id
        WHERE COALESCE(lg.ledger_count, 0) <>
                cl.line_count * CASE WHEN cl.is_reverse_charge OR cl.is_import THEN 2 ELSE 1 END
           OR ABS(
                COALESCE(lg.ledger_base_amount, 0)
                - cl.line_amount * CASE WHEN cl.is_reverse_charge OR cl.is_import THEN 2 ELSE 1 END
              ) > 0.005
           OR ABS(
                COALESCE(lg.ledger_total_vat, 0)
                - cl.line_vat_amount * CASE WHEN cl.is_reverse_charge OR cl.is_import THEN 2 ELSE 1 END
              ) > 0.005
      )
      SELECT * FROM ledger_errors
      UNION ALL
      SELECT * FROM missing_code_errors
      UNION ALL
      SELECT * FROM coded_line_errors
    `);

    const errorCount = errorsResult.rows.length;
    if (errorCount > 0) {
      res.status(422).json({
        error: `Pred izvozom odpravite ${errorCount} napako/-e v evidenci KIR/KPR. Preverite podrobnosti napak.`,
        errorCount,
        errors: errorsResult.rows.slice(0, 100),
      });
      return;
    }

    // Generiraj XML
    const taxPayerId = company.podjetjeDavcna.replace(/^SI/, ""); // brez SI predpone
    let xmlResult;
    try {
      xmlResult = await generateKirKprXml(
        companyId,
        taxPayerId,
        year,
        period,
        bounds.from,
        bounds.to,
        { odbdelez, vracilo, nacin, opomba },
      );
    } catch (err) {
      req.log.error({ err }, "XML generator napaka");
      res.status(500).json({ error: "Napaka pri generiranju XML" });
      return;
    }

    // Določi kind
    const kind: "KIR" | "KPR" | "BOTH" =
      xmlResult.hasKir && xmlResult.hasKpr
        ? "BOTH"
        : xmlResult.hasKir
        ? "KIR"
        : "KPR";

    // Ustvari submission zapis v DB (id dobimo iz .returning())
    const [submission] = await db
      .insert(vatSubmissionsTable)
      .values({
        companyId,
        periodYear: year,
        period,
        kind,
        status: "draft",
        schemaVersion: "DDV_KIR_KPR_1.xsd",
        kirCount: xmlResult.kirCount,
        kprCount: xmlResult.kprCount,
        createdBy: auth.clerkUserId,
        xmlInline: xmlResult.xml, // vedno shrani inline kot fallback
      })
      .returning();

    // Poskusi shraniti v object storage
    const storagePath = await saveXmlToStorage(
      xmlResult.xml,
      companyId,
      period,
      year,
      submission.id,
    );

    if (storagePath) {
      await db
        .update(vatSubmissionsTable)
        .set({ xmlStoragePath: storagePath })
        .where(eq(vatSubmissionsTable.id, submission.id));
    }

    res.status(201).json({
      ...submission,
      xmlStoragePath: storagePath,
      downloadUrl: `/api/companies/${companyId}/vat-submissions/${submission.id}/download`,
    });
  },
);

// ─── GET /companies/:companyId/vat-submissions ────────────────────────────────

router.get(
  "/companies/:companyId/vat-submissions",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "viewer");
    if (!access) return;

    const submissions = await db
      .select({
        id: vatSubmissionsTable.id,
        companyId: vatSubmissionsTable.companyId,
        periodYear: vatSubmissionsTable.periodYear,
        period: vatSubmissionsTable.period,
        kind: vatSubmissionsTable.kind,
        status: vatSubmissionsTable.status,
        schemaVersion: vatSubmissionsTable.schemaVersion,
        kirCount: vatSubmissionsTable.kirCount,
        kprCount: vatSubmissionsTable.kprCount,
        createdAt: vatSubmissionsTable.createdAt,
        submittedAt: vatSubmissionsTable.submittedAt,
        resolvedAt: vatSubmissionsTable.resolvedAt,
        rejectionReason: vatSubmissionsTable.rejectionReason,
        createdBy: vatSubmissionsTable.createdBy,
      })
      .from(vatSubmissionsTable)
      .where(eq(vatSubmissionsTable.companyId, companyId))
      .orderBy(
        desc(vatSubmissionsTable.periodYear),
        desc(vatSubmissionsTable.period),
        desc(vatSubmissionsTable.createdAt),
      )
      .limit(100);

    res.json({ submissions });
  },
);

// ─── GET /companies/:companyId/vat-submissions/:id/download ──────────────────

router.get(
  "/companies/:companyId/vat-submissions/:submissionId/download",
  requireAuth,
  async (req: Request, res: Response) => {
    const auth = req as AuthenticatedRequest;
    const companyId = extractParam(req.params.companyId);
    const submissionId = extractParam(req.params.submissionId);

    const access = await resolveAccess(auth.clerkUserId, companyId, res, "viewer");
    if (!access) return;

    const [submission] = await db
      .select()
      .from(vatSubmissionsTable)
      .where(
        and(
          eq(vatSubmissionsTable.id, submissionId),
          eq(vatSubmissionsTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!submission) {
      res.status(404).json({ error: "Oddaja ni najdena" });
      return;
    }

    const filename = `KIR_KPR_${submission.periodYear}_${submission.period}_${submission.kind}.xml`;
    const format = req.query.format ?? "zip";
    if (format !== "zip" && format !== "xml") {
      res.status(400).json({ error: "Format mora biti zip ali xml." });
      return;
    }
    const sendArchived = async (xml: string) => {
      res.setHeader("Cache-Control", "no-store");
      if (format === "xml") {
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
        res.send(xml);
      } else {
        const zip = await buildKirKprZip(xml, filename);
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${filename.replace(/\.xml$/, ".zip")}"`);
        res.send(zip);
      }
    };

    // Najprej poskusi object storage, potem fallback na inline
    if (submission.xmlStoragePath) {
      try {
        const { bucketName, objectName } = parseObjectPath(
          submission.xmlStoragePath.replace("/objects/", "/"),
        );
        const bucket = objectStorageClient.bucket(bucketName);
        const file = bucket.file(objectName);
        const [exists] = await file.exists();
        if (exists) {
          const [bytes] = await file.download();
          await sendArchived(bytes.toString("utf8"));
          return;
        }
      } catch {
        // pademo na inline
      }
    }

    // Fallback: inline XML
    if (submission.xmlInline) {
      await sendArchived(submission.xmlInline);
      return;
    }

    res.status(404).json({ error: "XML datoteka ni najdena" });
  },
);

export default router;
