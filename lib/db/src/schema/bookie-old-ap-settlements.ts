import { date, jsonb, numeric, pgTable, primaryKey, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { companiesTable } from "./companies";
import { invoicesTable } from "./invoices";

/** Historical Bookie Old supplier settlement evidence; not a payment or posting. */
export const bookieOldApSettlementsTable = pgTable("bookie_old_ap_settlements", {
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  invoiceId: uuid("invoice_id").notNull().references(() => invoicesTable.id, { onDelete: "restrict" }),
  sourceLineId: text("source_line_id").notNull(),
  originalAmount: numeric("original_amount", { precision: 18, scale: 2 }).notNull(),
  closedAmount: numeric("closed_amount", { precision: 18, scale: 2 }).notNull(),
  remainingAmount: numeric("remaining_amount", { precision: 18, scale: 2 }).notNull(),
  sourceAsOf: date("source_as_of", { mode: "string" }).notNull(),
  evidence: jsonb("evidence").$type<Array<{
    closingId: string;
    otherLineId: string;
    amount: string;
    recordedDate: string;
    counterpartReference?: string;
  }>>().notNull(),
  sourceSha256: text("source_sha256").notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.invoiceId] }),
  unique("bookie_old_ap_settlements_source_unique").on(t.companyId, t.sourceLineId),
]);

export const insertBookieOldApSettlementSchema = createInsertSchema(bookieOldApSettlementsTable).omit({ importedAt: true });
export type InsertBookieOldApSettlement = z.infer<typeof insertBookieOldApSettlementSchema>;
export type BookieOldApSettlement = typeof bookieOldApSettlementsTable.$inferSelect;