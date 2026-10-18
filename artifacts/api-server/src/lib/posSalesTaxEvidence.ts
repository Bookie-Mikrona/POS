import { and, eq, notExists, sql, type SQL } from "drizzle-orm";
import { db, enoteTable, invoicesTable, journalEntriesTable, postavkeTable, racuniTable } from "@workspace/db";
import { bookingReceiptStatus } from "./pos-receipt-tax";

export const MISSING_POS_SALES_TAX_EVIDENCE =
  "POS prodaje ni mogoče potrditi: manjka zanesljiv davčni razrez izdanih računov za popolno KIR evidenco. Obnovite izvorne postavke in ponovno pripravite temeljnico. Stopnje DDV in davčne osnove ni dovoljeno ugibati iz bruto zneska.";

/** Check individual receipts, not a net total which can hide a sale/refund pair.
 * A stored zero-rate line IS evidence; a receipt-level zero VAT total is not.
 * Voucher issuance is an advance and has no sales tax evidence requirement.
 */
export async function hasMissingPosSalesTaxEvidence(where: SQL): Promise<boolean> {
  const [missing] = await db.select({ id: racuniTable.id }).from(racuniTable).where(and(
    where,
    eq(racuniTable.jeDarilniBonIzdaja, false),
    sql`${racuniTable.placilnaNacin} NOT IN ('lastna_poraba', 'reprezentanca')`,
    sql`(ABS(${racuniTable.skupaj}::numeric) > 0.005 OR ABS(${racuniTable.ddv}::numeric) > 0.005)`,
    notExists(db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.racunId, racuniTable.id))),
  )).limit(1);
  return !!missing;
}

/** Recheck the source when posting an already saved daily/monthly draft.
 * Legacy references without a unit cover all units of this company.
 */
export async function hasMissingPosSalesTaxEvidenceForEntry(
  companyId: string,
  reference: string | null,
  lines: { description: string | null }[],
): Promise<boolean> {
  if (!reference?.startsWith("POS:PRODAJA:")) return false;
  // Old fallback lines have no trustworthy rate even if the source was repaired.
  // Rebuilding the draft is required to attach the actual tax metadata.
  if (lines.some(line => /prihodki.*fallback/i.test(line.description ?? ""))) return true;
  const match = /^POS:PRODAJA:(\d{4}-\d{2}(?:-\d{2})?)(?::E(\d+))?$/.exec(reference);
  if (!match) return true;
  const date = match[1]!;
  const monthly = date.length === 7;
  const start = monthly ? `${date}-01` : date;
  return hasMissingPosSalesTaxEvidence(and(
    sql`${racuniTable.enotaId} IN (SELECT ${enoteTable.id} FROM ${enoteTable} WHERE ${enoteTable.companyId} = ${companyId})`,
    match[2] ? eq(racuniTable.enotaId, Number(match[2])) : undefined,
    bookingReceiptStatus(),
    sql`NOT EXISTS (
      SELECT 1 FROM ${invoicesTable}
      WHERE ${invoicesTable.companyId} = ${companyId}
        AND ${invoicesTable.createdBy} = 'pos-sync'
        AND ${invoicesTable.invoiceNumber} = ('POS-' || ${racuniTable.stevilkaRacuna})
        AND ${invoicesTable.linkedEntryId} IS NOT NULL
        AND ${invoicesTable.status} IN ('posted', 'paid')
    )`,
    sql`NOT EXISTS (
      SELECT 1 FROM ${journalEntriesTable}
      WHERE ${journalEntriesTable.companyId} = ${companyId}
        AND ${journalEntriesTable.reference} = ('POS:B2B:' || ${racuniTable.stevilkaRacuna})
        AND ${journalEntriesTable.createdBy} = 'pos-sync'
        AND ${journalEntriesTable.status} IN ('draft', 'posted')
    )`,
    sql`${racuniTable.datumCas} >= (
      ${start}::date + COALESCE((SELECT e.zacetek_dneva_ura::time FROM enote e
        WHERE e.id = ${racuniTable.enotaId}), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'`,
    sql`${racuniTable.datumCas} < (
      ${start}::date + ${monthly ? sql`INTERVAL '1 month'` : sql`INTERVAL '1 day'`}
      + COALESCE((SELECT e.zacetek_dneva_ura::time FROM enote e
        WHERE e.id = ${racuniTable.enotaId}), '04:00'::time)
    ) AT TIME ZONE 'Europe/Ljubljana'`,
  )!);
}
