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
 * Izračuna datumske meje za FURS kodo obdobja.
 */
function periodBounds(year: number, period: string): { from: string; to: string } | null {
  const mm = parseInt(period.slice(2), 10);
  if (isNaN(mm) || mm < 1 || mm > 12) return null;
  const isQuarterly = [3, 6, 9, 12].includes(mm);
  const startMonth = isQuarterly ? mm - 2 : mm;
  const lastDay = new Date(year, mm, 0).getDate();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(mm)}-${pad(lastDay)}`,
  };
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
  odbdelez?: unknown;
  vracilo?: unknown;
  nacin?: unknown;
  opomba?: unknown;
}

function validateCreateBody(body: CreateSubmissionBody): {
  year: number; period: string;
  odbdelez?: boolean; vracilo?: boolean;
  nacin?: 1 | 2 | 3; opomba?: string;
} | { error: string } {
  const year = Number(body.year);
  if (!Number.isInteger(year) || year < 2025 || year > 2100)
    return { error: "Leto mora biti med 2025 in 2100" };

  const period = String(body.period ?? "");
  if (!/^07(0[1-9]|1[0-2])$/.test(period))
    return { error: "Neveljavna koda obdobja (pričakovano MMMM, npr. 0707)" };

  const nacin = body.nacin != null ? Number(body.nacin) : undefined;
  if (nacin != null && ![1, 2, 3].includes(nacin))
    return { error: "NACIN mora biti 1, 2 ali 3" };

  const opomba = body.opomba != null ? String(body.opomba).slice(0, 250) : undefined;

  return {
    year,
    period,
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
    const { year, period, odbdelez, vracilo, nacin, opomba } = parsed;

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

    const bounds = periodBounds(year, period);
    if (!bounds) {
      res.status(400).json({ error: "Neveljavno obdobje" });
      return;
    }

    // Preveri predoddajne napake (D.4.2 in D.4.3 blokirajo izvoz)
    const errorsResult = await db.execute<{ cnt: string }>(sql`
      SELECT COUNT(*) AS cnt
      FROM vat_ledger vl
      JOIN vat_code vc ON vc.id = vl.vat_code_id
      LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
      LEFT JOIN invoices iv ON iv.id = vl.invoice_id
      LEFT JOIN documents dc ON dc.id = vl.document_id
      WHERE vl.vat_period_year = ${year}
        AND vl.vat_period = ${period}
        AND (
          je.company_id = ${companyId}
          OR iv.company_id = ${companyId}
          OR dc.company_id = ${companyId}
        )
        AND vl.reversed_by_id IS NULL
        AND (
          -- D4.2: KPR brez receipt_date
          (vl.direction = 'IN' AND vl.receipt_date IS NULL)
          OR
          -- D4.3: reverse charge brez pair_id
          (vc.is_reverse_charge = TRUE AND vl.pair_id IS NULL)
          OR
          -- D4.6: samoprijava brez correction_period
          (vl.treatment IN (2, 3) AND vl.correction_period IS NULL)
        )
    `);

    const errorCount = parseInt(errorsResult.rows[0]?.cnt ?? "0", 10);
    if (errorCount > 0) {
      res.status(422).json({
        error: `Pred izvozom odpravite ${errorCount} napako/-e v evidenci (D.4.2, D.4.3, D.4.6). Preverite KIR/KPR evidence zavihek.`,
        errorCount,
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
      console.error("XML generator napaka:", err);
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
          res.setHeader("Content-Type", "application/xml; charset=utf-8");
          res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
          file.createReadStream().pipe(res);
          return;
        }
      } catch {
        // pademo na inline
      }
    }

    // Fallback: inline XML
    if (submission.xmlInline) {
      res.setHeader("Content-Type", "application/xml; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(submission.xmlInline);
      return;
    }

    res.status(404).json({ error: "XML datoteka ni najdena" });
  },
);

export default router;
