import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  auditLogTable,
  db,
  journalEntriesTable,
  invoicesTable,
  paymentAllocationsTable,
  vatLedgerTable,
} from "@workspace/db";

export class JournalEntryDeletionError extends Error {
  constructor(public readonly code: "NOT_DELETABLE" | "REPORTED_VAT" | "LINKED_INVOICE" | "LINKED_PAYMENT") {
    super(code);
  }
}

export function getJournalEntryDeletionFailure(error: unknown) {
  if (error instanceof JournalEntryDeletionError) {
    switch (error.code) {
      case "NOT_DELETABLE":
        return { status: 400, message: "Izbrisati je mogoče samo osnutek temeljnice" };
      case "REPORTED_VAT":
        return { status: 409, message: "Osnutka ni mogoče izbrisati, ker vsebuje DDV podatke, vključene v poročilo" };
      case "LINKED_INVOICE":
        return { status: 409, message: "Osnutka ni mogoče izbrisati, ker je povezan z računom, ki ni osnutek" };
      case "LINKED_PAYMENT":
        return { status: 409, message: "Osnutka ni mogoče izbrisati, ker ima povezani račun evidentirano plačilo" };
    }
  }
  const seen = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const cause = current as { code?: unknown; cause?: unknown };
    if (cause.code === "23503") {
      return { status: 409, message: "Osnutka ni mogoče izbrisati, ker je povezan z drugim zaščitenim poslovnim zapisom" };
    }
    current = cause.cause;
  }
  return { status: 500, message: "Osnutka trenutno ni bilo mogoče izbrisati. Podatki so ostali nespremenjeni. Poskusite znova pozneje." };
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

    // Draft source invoices survive; only their draft journal link is removed.
    // Never detach a posted/paid invoice, a foreign tenant, or a settlement.
    const linkedInvoices = await tx.select({
      id: invoicesTable.id,
      companyId: invoicesTable.companyId,
      status: invoicesTable.status,
      invoiceNumber: invoicesTable.invoiceNumber,
    }).from(invoicesTable)
      .where(eq(invoicesTable.linkedEntryId, entryId))
      .for("update");
    if (linkedInvoices.some(invoice => invoice.companyId !== companyId || invoice.status !== "draft")) {
      throw new JournalEntryDeletionError("LINKED_INVOICE");
    }
    if (linkedInvoices.length > 0) {
      const [allocation] = await tx.select({ id: paymentAllocationsTable.id })
        .from(paymentAllocationsTable)
        .where(inArray(paymentAllocationsTable.invoiceId, linkedInvoices.map(invoice => invoice.id)))
        .limit(1);
      if (allocation) throw new JournalEntryDeletionError("LINKED_PAYMENT");
      await tx.update(invoicesTable).set({ linkedEntryId: null })
        .where(and(
          eq(invoicesTable.companyId, companyId),
          eq(invoicesTable.status, "draft"),
          eq(invoicesTable.linkedEntryId, entryId),
        ));
    }
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
        detachedDraftInvoices: linkedInvoices.map(invoice => ({
          id: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
        })),
      },
    });
    return entry;
  });
}