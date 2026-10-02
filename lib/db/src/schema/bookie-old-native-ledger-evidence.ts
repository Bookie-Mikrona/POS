import { date, jsonb, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { journalEntryLinesTable } from "./journal-entries";

export type BookieOldNativeClosingProof = {
  closingId: string;
  sourceLineId: string;
  otherSourceLineId: string;
  amount: string;
  recordedDate: string;
  anchorSide: "source" | "counterpart";
  sourceProof: {
    sourceLineId: string;
    year: string; type: string; voucherNumber: string; documentNumber: string;
    ledgerCode: string; accountCode: string; partnerCode: string | null; partnerName: string | null;
    sides: Array<{ side: "debit" | "credit"; amount: string }>; documentDate: string | null;
    postingDate: string | null; durDate: string | null;
  };
  counterpartProof: {
    sourceLineId: string;
    year: string; type: string; voucherNumber: string; documentNumber: string;
    ledgerCode: string; accountCode: string; partnerCode: string | null; partnerName: string | null;
    sides: Array<{ side: "debit" | "credit"; amount: string }>; documentDate: string | null;
    postingDate: string | null; durDate: string | null;
  };
};

export const bookieOldNativeLedgerEvidenceTable = pgTable("bookie_old_native_ledger_evidence", {
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  nativeLineId: uuid("native_line_id").notNull().references(() => journalEntryLinesTable.id, { onDelete: "restrict" }),
  sourceLineId: text("source_line_id").notNull(),
  durDate: date("dur_date", { mode: "string" }),
  originalDocumentNumber: text("original_document_number"),
  originalGlMetadata: jsonb("original_gl_metadata").$type<Record<string, unknown>>().notNull(),
  originalClosings: jsonb("original_closings").$type<BookieOldNativeClosingProof[]>().notNull(),
  sourceDigest: text("source_digest").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.companyId, table.nativeLineId] }),
  unique("bookie_old_native_ledger_source_native_unique").on(
    table.companyId, table.sourceLineId, table.nativeLineId,
  ),
]);

export type BookieOldNativeLedgerEvidence = typeof bookieOldNativeLedgerEvidenceTable.$inferSelect;