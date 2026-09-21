import { and, eq, isNotNull } from "drizzle-orm";
import {
  auditLogTable,
  db,
  journalEntriesTable,
  vatLedgerTable,
} from "@workspace/db";

export class JournalEntryDeletionError extends Error {
  constructor(public readonly code: "NOT_DELETABLE" | "REPORTED_VAT") {
    super(code);
  }
}

export async function deleteDraftJournalEntry(
  companyId: string,
  entryId: string,
  changedBy: string,
) {
  return db.transaction(async (tx) => {
    const [entry] = await tx
      .select({
        id: journalEntriesTable.id,
        status: journalEntriesTable.status,
        reversalOf: journalEntriesTable.reversalOf,
        reference: journalEntriesTable.reference,
        description: journalEntriesTable.description,
        sourceType: journalEntriesTable.sourceType,
        createdBy: journalEntriesTable.createdBy,
      })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.id, entryId),
        eq(journalEntriesTable.companyId, companyId),
      ))
      .limit(1)
      .for("update");

    if (!entry) return null;
    if (entry.status !== "draft" || entry.reversalOf) {
      throw new JournalEntryDeletionError("NOT_DELETABLE");
    }

    const [reportedVatRow] = await tx
      .select({ id: vatLedgerTable.id })
      .from(vatLedgerTable)
      .where(and(
        eq(vatLedgerTable.journalEntryId, entryId),
        isNotNull(vatLedgerTable.reportedAt),
      ))
      .limit(1);
    if (reportedVatRow) throw new JournalEntryDeletionError("REPORTED_VAT");

    await tx.delete(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, entryId));
    await tx.delete(journalEntriesTable).where(eq(journalEntriesTable.id, entryId));
    await tx.insert(auditLogTable).values({
      companyId,
      entityType: "journal_entry",
      entityId: entryId,
      action: "delete_draft",
      changedBy,
      payload: {
        reference: entry.reference,
        description: entry.description,
        sourceType: entry.sourceType,
        createdBy: entry.createdBy,
      },
    });
    return entry;
  });
}