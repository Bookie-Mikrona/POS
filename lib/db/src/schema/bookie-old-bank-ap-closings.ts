import { date, index, numeric, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { bankStatementsTable } from "./bank-statements";
import { invoicesTable } from "./invoices";

/** Historical Bookie Old AP closing evidence; never a new payment or posting. */
export const bookieOldBankApClosingsTable = pgTable("bookie_old_bank_ap_closings", {
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  closingId: text("closing_id").notNull(),
  statementId: uuid("statement_id").notNull().references(() => bankStatementsTable.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "restrict" }),
  sourceBankLineId: text("source_bank_line_id").notNull(),
  sourceInvoiceLineId: text("source_invoice_line_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  recordedDate: date("recorded_date", { mode: "string" }).notNull(),
  sourceSha256: text("source_sha256").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.closingId] }),
  index("bookie_old_bank_ap_closings_statement_idx").on(t.companyId, t.statementId),
]);

export const insertBookieOldBankApClosingSchema = createInsertSchema(bookieOldBankApClosingsTable).omit({ importedAt: true });
export type InsertBookieOldBankApClosing = z.infer<typeof insertBookieOldBankApClosingSchema>;
export type BookieOldBankApClosing = typeof bookieOldBankApClosingsTable.$inferSelect;