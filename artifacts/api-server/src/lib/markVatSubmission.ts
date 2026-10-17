import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { XMLParser } from "fast-xml-parser";
import { db, vatLedgerTable, vatSubmissionsTable } from "@workspace/db";
import { generateKirKprXml } from "./vatXmlGenerator";
import { vatSubmissionPeriodBounds } from "./vatSubmissionPreflight";

export class VatSubmissionConflict extends Error {}

/** The archived header, not a current company setting, owns the submission range. */
export function archivedSubmissionHeader(xml: string, year: number, period: string) {
  const header = new XMLParser({ parseTagValue: false }).parse(xml)?.DDV_KIR_KPR?.Glava;
  for (const mode of ["mesecno", "trimesecno"] as const) {
    const bounds = vatSubmissionPeriodBounds(year, period, mode);
    if (bounds && header?.OBDOBJE_OD === bounds.from && header?.OBDOBJE_DO === bounds.to) {
      return { header, bounds };
    }
  }
  throw new VatSubmissionConflict("Arhivirani XML nima veljavnega obdobja. Pripravite nov izvoz.");
}

export async function markVatSubmission(
  companyId: string,
  submissionId: string,
  preflight: (executor: Pick<typeof db, "execute">, bounds: { from: string; to: string }) => Promise<{ rows: unknown[] }>,
) {
  return db.transaction(async (tx) => {
    // Row locks do not exclude phantom inserts. All ledger INSERT/UPDATE/DELETE
    // writers already acquire ROW EXCLUSIVE, which conflicts with this lock.
    // Take it before reading the submission or period, and use READ COMMITTED
    // so a writer that committed while we waited is included in validation.
    // Manual submission is rare; the short global write pause avoids requiring
    // every current and future VAT writer to implement an advisory-lock protocol.
    await tx.execute(sql`LOCK TABLE vat_ledger IN SHARE ROW EXCLUSIVE MODE`);
    const [submission] = await tx.select().from(vatSubmissionsTable)
      .where(and(eq(vatSubmissionsTable.id, submissionId), eq(vatSubmissionsTable.companyId, companyId)))
      .for("update");
    if (!submission) return null;
    // Do not touch protected ledger rows on replay, or downgrade an accepted submission.
    if ((submission.status === "submitted" || submission.status === "accepted") && submission.submittedAt) {
      return { id: submission.id, status: submission.status, submittedAt: submission.submittedAt };
    }
    if (submission.status !== "draft" || !submission.xmlInline) {
      throw new VatSubmissionConflict("Te oddaje ni mogoče označiti kot oddane. Pripravite nov izvoz.");
    }
    const { header, bounds } = archivedSubmissionHeader(
      submission.xmlInline, submission.periodYear, submission.period,
    );
    // Lock the exact tenant-scoped set used by the XML generator. Keep the IDs:
    // a later insert must never be marked as part of this archived export.
    const ledger = await tx.execute<{ id: string; createdAt: Date }>(sql`
      SELECT vl.id, vl.created_at AS "createdAt"
      FROM vat_ledger vl
      LEFT JOIN journal_entries je ON je.id = vl.journal_entry_id
      LEFT JOIN invoices iv ON iv.id = vl.invoice_id
      LEFT JOIN documents dc ON dc.id = vl.document_id
      WHERE vl.tax_point_date >= ${bounds.from} AND vl.tax_point_date <= ${bounds.to}
        AND (je.company_id = ${companyId} OR iv.company_id = ${companyId} OR dc.company_id = ${companyId})
        AND (je.company_id IS NULL OR je.company_id = ${companyId})
        AND (iv.company_id IS NULL OR iv.company_id = ${companyId})
        AND (dc.company_id IS NULL OR dc.company_id = ${companyId})
        AND vl.reversed_by_id IS NULL
      ORDER BY vl.id
      FOR UPDATE OF vl
    `);
    if ((await preflight(tx, bounds)).rows.length) {
      throw new VatSubmissionConflict("Pred potrditvijo oddaje odpravite napake v evidenci KIR/KPR in pripravite nov izvoz.");
    }
    const regenerated = await generateKirKprXml(
      companyId, header.TaxPayerID, submission.periodYear, submission.period,
      bounds.from, bounds.to, {
        vracilo: header.VRACILO === "true",
        odbdelez: header.ODBDELEZ === "true",
        nacin: header.NACIN == null ? undefined : Number(header.NACIN) as 1 | 2 | 3,
        inspos: header.INSPOS === "true",
        opomba: header.OPOMBA,
        tujec1: header.TUJEC1,
        tujec2: header.TUJEC2,
      }, tx,
    );
    if (regenerated.xml !== submission.xmlInline ||
        ledger.rows.some(row => new Date(row.createdAt) > submission.createdAt)) {
      throw new VatSubmissionConflict("Evidenca se je po izvozu spremenila. Pripravite in prenesite nov XML.");
    }
    const submittedAt = new Date();
    const ids = ledger.rows.map(row => row.id);
    if (ids.length) {
      await tx.update(vatLedgerTable).set({
        reportedAt: submittedAt,
        reportedPeriod: `${submission.periodYear}${submission.period.slice(2)}`,
      }).where(and(inArray(vatLedgerTable.id, ids), isNull(vatLedgerTable.reportedAt)));
    }
    await tx.update(vatSubmissionsTable).set({ status: "submitted", submittedAt })
      .where(eq(vatSubmissionsTable.id, submission.id));
    return { id: submission.id, status: "submitted" as const, submittedAt };
  }, { isolationLevel: "read committed" });
}
