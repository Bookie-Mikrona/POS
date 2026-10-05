import Decimal from "decimal.js";
import { and, eq, inArray, lte, gte, sql } from "drizzle-orm";
import {
  db, accountsTable, accountingPeriodsTable, auditLogTable, companyModulesTable,
  journalEntriesTable, journalEntryLinesTable, posBookingDraftsTable, posBookingDraftLinesTable,
} from "@workspace/db";

export const posTransferReference = (reference: string) => `POS:PRENOS:${reference}`;

/** Izrecen uporabnikov prenos; nikoli se ne kliče iz POS synca ali aktivacije GK. */
export async function transferPosDrafts(companyId: string, ids: string[], actor: string) {
  return db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`pos-draft-transfer:${companyId}`}, 0))`);
    const [erp] = await tx.select({ id: companyModulesTable.id }).from(companyModulesTable)
      .where(and(eq(companyModulesTable.companyId, companyId), eq(companyModulesTable.module, "erp")));
    if (!erp) throw new Error("Podjetje nima vključene Bookie glavne knjige.");
    const sources = await tx.select().from(posBookingDraftsTable)
      .where(and(eq(posBookingDraftsTable.companyId, companyId), inArray(posBookingDraftsTable.id, ids)))
      .for("update");
    if (sources.length !== new Set(ids).size) throw new Error("Izbrane POS temeljnice niso najdene v aktivnem podjetju.");
    const created: string[] = [];
    const alreadyTransferred: string[] = [];
    for (const source of sources) {
      if (!source.reference) throw new Error("POS temeljnica nima izvorne reference.");
      const reference = posTransferReference(source.reference);
      const [existing] = await tx.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
        .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, reference)));
      if (existing) { alreadyTransferred.push(existing.id); continue; }
      const [period] = await tx.select({ id: accountingPeriodsTable.id }).from(accountingPeriodsTable)
        .where(and(eq(accountingPeriodsTable.companyId, companyId),
          eq(accountingPeriodsTable.status, "open"),
          lte(accountingPeriodsTable.startDate, source.entryDate), gte(accountingPeriodsTable.endDate, source.entryDate)))
        .for("update");
      if (!period) throw new Error(`Za ${source.entryDate} ni odprtega obdobja GK. Prenos ni izveden.`);
      const lines = await tx.select({ line: posBookingDraftLinesTable, accountCompany: accountsTable.companyId })
        .from(posBookingDraftLinesTable)
        .innerJoin(accountsTable, eq(accountsTable.id, posBookingDraftLinesTable.accountId))
        .where(eq(posBookingDraftLinesTable.entryId, source.id));
      const balance = lines.reduce((sum, { line }) => sum.plus(new Decimal(line.amount).times(line.side === "debit" ? 1 : -1)), new Decimal(0));
      if (!lines.length || !balance.isZero() || lines.some(row => row.accountCompany !== companyId)) {
        throw new Error("POS temeljnica ni uravnotežena ali vsebuje konto drugega podjetja.");
      }
      const [entry] = await tx.insert(journalEntriesTable).values({
        companyId, periodId: period.id, entryDate: source.entryDate, documentDate: source.documentDate,
        taxDate: source.taxDate, receiptDate: source.receiptDate,
        description: source.description, reference, status: "draft", sourceType: "document", createdBy: actor,
      }).returning({ id: journalEntriesTable.id });
      await tx.insert(journalEntryLinesTable).values(lines.map(({ line }) => ({
        entryId: entry.id, accountId: line.accountId, side: line.side, amount: line.amount,
        description: line.description, sequence: line.sequence, partnerId: line.partnerId,
        costCenterId: line.costCenterId, vatCodeId: line.vatCodeId, vatAmount: line.vatAmount,
      })));
      await tx.insert(auditLogTable).values({
        companyId, entityType: "journal_entry", entityId: entry.id, action: "create", changedBy: actor,
        payload: { source: "explicit_pos_transfer", posDraftId: source.id, reference: source.reference },
      });
      created.push(entry.id);
    }
    return { created, alreadyTransferred };
  });
}
