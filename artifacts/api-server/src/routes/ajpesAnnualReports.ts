import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { db, accountingRolesTable, annualReportsTable, auditLogTable } from "@workspace/db";
import {
  GetAjpesAnnualReportParams, GetAjpesAnnualReportResponse,
  SaveAjpesAnnualReportBody, ExportAjpesAnnualReportBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { buildAjpesAnnualReport, type AjpesAnnualReport } from "../lib/ajpes/annual-model";
import { loadAjpesAnnualReport, loadAjpesSource, AjpesReportError } from "../lib/ajpes/load-annual-report";
import { generateJolpPdf, generateJolpXlsx } from "../lib/ajpes/jolp-renderers";
import { generateAjpesXml } from "../lib/ajpes/xml";

const router: IRouter = Router();
const base = "/companies/:companyId/reports/ajpes/:year";

function renderInput(report: AjpesAnnualReport) {
  const amount = (value: string) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric.toFixed(2) !== value) {
      throw new AjpesReportError(422, "Znesek presega natančnost številčne celice v izvozu.");
    }
    return numeric;
  };
  const rows = (items: AjpesAnnualReport["balanceSheet"]) => items.map(row => ({
    ...row, current: amount(row.current), previous: amount(row.previous),
  }));
  return { ...report, balanceSheet: rows(report.balanceSheet), incomeStatement: rows(report.incomeStatement) };
}

async function access(req: Request, res: Response, write = false) {
  const p = GetAjpesAnnualReportParams.safeParse(req.params);
  if (!p.success || !Number.isInteger(p.data.year) ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(p.data.companyId)) {
    res.status(400).json({ error: "Neveljavno podjetje ali leto." }); return null;
  }
  const actor = (req as AuthenticatedRequest).clerkUserId;
  const [role] = await db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.companyId, p.data.companyId), eq(accountingRolesTable.clerkUserId, actor)));
  if (!role || (write && role.role === "viewer")) {
    res.status(403).json({ error: write ? "Poročilo lahko pripravi računovodja ali lastnik." : "Dostop do podjetja ni dovoljen." });
    return null;
  }
  return { ...p.data, actor };
}
function fail(req: Request, res: Response, err: unknown) {
  if (err instanceof AjpesReportError) { res.status(err.status).json({ error: err.message }); return; }
  // PostgreSQL repeatable-read conflicts must not silently overwrite another draft.
  // Drizzle wraps pg errors in `cause`; inspect that chain as well.
  let cause: unknown = err;
  for (let depth = 0; depth < 5 && cause && typeof cause === "object"; depth++) {
    if ("code" in cause && (cause.code === "40001" || cause.code === "40P01" ||
      (cause.code === "23505" && "constraint" in cause && cause.constraint === "annual_reports_company_year_unique"))) {
      res.status(409).json({ error: "Podatki so se med pripravo spremenili. Osvežite poročilo." }); return;
    }
    cause = "cause" in cause ? cause.cause : null;
  }
  req.log.error({ err }, "AJPES letno poročilo: napaka");
  res.status(500).json({ error: "Letnega poročila ni bilo mogoče pripraviti." });
}

router.get(base, requireAuth, async (req, res): Promise<void> => {
  const scope = await access(req, res); if (!scope) return;
  try {
    const report = await db.transaction(tx => loadAjpesAnnualReport(tx, scope.companyId, scope.year),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    res.setHeader("Cache-Control", "no-store");
    res.json(GetAjpesAnnualReportResponse.parse(report));
  } catch (err) { fail(req, res, err); }
});

router.put(base, requireAuth, async (req, res): Promise<void> => {
  const scope = await access(req, res, true); if (!scope) return;
  const parsed = SaveAjpesAnnualReportBody.safeParse(req.body);
  if (!parsed.success || !Number.isInteger(parsed.data.revision)) {
    res.status(400).json({ error: "Neveljaven osnutek letnega poročila." }); return;
  }
  const body = parsed.data;
  const strings = [...Object.values(body.settings.currentValues), ...Object.values(body.settings.previousValues)];
  if (strings.some(v => !/^-?\d{1,13}(?:\.\d{1,2})?$/.test(v)) ||
    Object.keys(body.settings.mappings).length > 10000 ||
    body.settings.excludedEntryIds.length > 10000 ||
    Object.values(body.settings.metadata).some(v => v.length > 4096)) {
    res.status(400).json({ error: "Zneski morajo biti veljavna decimalna števila z največ dvema decimalkama." }); return;
  }
  const metadata = body.settings.metadata;
  if ((metadata.accountingMethod && !["1", "2"].includes(metadata.accountingMethod)) ||
    (metadata.size && !["1", "2", "3", "4"].includes(metadata.size)) ||
    (metadata.previousDataMode && !["ledger", "manual", "no-activity"].includes(metadata.previousDataMode))) {
    res.status(400).json({ error: "Neveljavna metoda računovodenja, velikost ali vir primerjalnih podatkov." }); return;
  }
  try {
    const saved = await db.transaction(async tx => {
      const [existing] = await tx.select().from(annualReportsTable)
        .where(and(eq(annualReportsTable.companyId, scope.companyId), eq(annualReportsTable.year, scope.year)));
      if ((existing?.revision ?? 0) !== body.revision) {
        throw new AjpesReportError(409, "Osnutek je medtem spremenil drug uporabnik. Osvežite poročilo.");
      }
      const source = await loadAjpesSource(tx, scope.companyId, scope.year, {
        settings: body.settings, revision: body.revision, reviewedFingerprint: null,
      });
      const fresh = buildAjpesAnnualReport(source);
      if (body.reviewedFingerprint) {
        if (body.reviewedFingerprint !== fresh.sourceFingerprint) {
          throw new AjpesReportError(409, "Glavna knjiga ali podatki poročila so se spremenili. Najprej preglejte nov predogled.");
        }
        if (fresh.issues.some(i => i.blocking)) {
          throw new AjpesReportError(422, "Poročila z blokirajočimi opozorili ni mogoče potrditi.");
        }
      }
      const revision = body.revision + 1;
      const fields = {
        settings: body.settings, revision, updatedBy: scope.actor, updatedAt: new Date(),
        reviewedFingerprint: body.reviewedFingerprint ?? null,
        reviewedBy: body.reviewedFingerprint ? scope.actor : null,
      };
      const [record] = existing
        ? await tx.update(annualReportsTable).set(fields)
          .where(and(eq(annualReportsTable.id, existing.id), eq(annualReportsTable.revision, body.revision))).returning()
        : await tx.insert(annualReportsTable).values({ companyId: scope.companyId, year: scope.year, ...fields })
          .onConflictDoNothing().returning();
      if (!record) throw new AjpesReportError(409, "Osnutek je medtem spremenil drug uporabnik.");
      // Saving financial reporting inputs and their audit is one transaction.
      await tx.insert(auditLogTable).values({
        companyId: scope.companyId, entityType: "annual_report", entityId: record.id,
        action: body.reviewedFingerprint ? "review" : "update", changedBy: scope.actor,
        payload: { year: scope.year, revision, settings: body.settings, sourceFingerprint: fresh.sourceFingerprint },
      });
      return buildAjpesAnnualReport({ ...source, revision, reviewedFingerprint: record.reviewedFingerprint });
    }, { isolationLevel: "repeatable read" });
    res.setHeader("Cache-Control", "no-store");
    res.json(GetAjpesAnnualReportResponse.parse(saved));
  } catch (err) { fail(req, res, err); }
});

router.post(`${base}/export`, requireAuth, async (req, res): Promise<void> => {
  const scope = await access(req, res); if (!scope) return;
  const parsed = ExportAjpesAnnualReportBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Neveljaven format izvoza." }); return; }
  try {
    const report = await db.transaction(tx => loadAjpesAnnualReport(tx, scope.companyId, scope.year),
      { isolationLevel: "repeatable read", accessMode: "read only" });
    if (report.sourceFingerprint !== parsed.data.sourceFingerprint) {
      throw new AjpesReportError(409, "Glavna knjiga ali osnutek se je spremenil. Osvežite in ponovno potrdite pregled.");
    }
    if (!report.canExport) {
      throw new AjpesReportError(422, "Pred izvozom shranite in potrdite pregled ter odpravite blokirajoča opozorila.");
    }
    const format = parsed.data.format;
    let bytes: Buffer;
    let mime: string;
    if (format === "xlsx") {
      bytes = await generateJolpXlsx(renderInput(report));
      mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    } else if (format === "pdf") {
      bytes = await generateJolpPdf(renderInput(report));
      mime = "application/pdf";
    } else {
      if (!report.canExportXml || report.year !== 2025) {
        throw new AjpesReportError(400, "Uradni XML je preverjen za AJPES letno poročilo 2025.");
      }
      const metadata = report.settings.metadata;
      const profile = report.settings.profile;
      const profileAccountingMethod = profile?.framework === "SRS" ? 2
        : profile?.framework === "IFRS" ? 1 : undefined;
      const profileSize = profile?.size === "micro" ? 4
        : profile?.size === "small" ? 3
          : profile?.size === "medium" ? 2
            : profile?.size === "large" ? 1 : undefined;
      const xml = generateAjpesXml({
        year: 2025,
        company: {
          registrationNumber: report.company.registrationNumber, taxNumber: report.company.taxNumber,
          name: report.company.name, registeredOffice: `${report.company.street}, ${report.company.postalCode} ${report.company.city}`.trim(),
          accountablePerson: metadata.accountablePerson, phone: metadata.phone,
          contactEmail: metadata.contactEmail, portalEmail: metadata.portalEmail, manager: metadata.manager,
          accountingMethod: profileAccountingMethod ??
            (metadata.accountingMethod ? Number(metadata.accountingMethod) as 1 | 2 : undefined),
          size: profileSize ??
            (metadata.size ? Number(metadata.size) as 1 | 2 | 3 | 4 : undefined),
          periodStart: "2025-01-01", periodEnd: "2025-12-31",
        },
        current: Object.fromEntries(report.aopRows.map(r => [r.code, r.current])),
        previous: Object.fromEntries(report.aopRows.map(r => [r.code, r.previous])),
      });
      bytes = Buffer.from(xml, "utf8"); mime = "application/xml; charset=utf-8";
    }
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Content-Type", mime);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="ajpes-${scope.year}${format === "xml" ? "" : "-numeric-preview"}.${format}"`,
    );
    if (format !== "xml") {
      res.setHeader(
        "X-AJPES-Export-Notice",
        "Numerical preview only; not a complete annual report for public publication.",
      );
    }
    res.send(bytes);
  } catch (err) { fail(req, res, err); }
});

export default router;