import { sql } from "drizzle-orm";
import { check, index, numeric, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { journalEntryLinesTable } from "./journal-entries";
import { paymentsTable } from "./payments";

/**
 * Real payment allocations to partner GL lines without invoice records.
 * Keeping this separate preserves the invoice-only allocation contract.
 * A draft reserves capacity; accounting openness changes only on posting.
 */
export const paymentLedgerAllocationsTable = pgTable("payment_ledger_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().references(() => paymentsTable.id, { onDelete: "cascade" }),
  journalLineId: uuid("journal_line_id").notNull().references(() => journalEntryLinesTable.id, { onDelete: "restrict" }),
  allocatedAmount: numeric("allocated_amount", { precision: 18, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({
  positiveAmount: check("payment_ledger_allocations_amount_ck", sql`${table.allocatedAmount} > 0`),
  paymentLineUnique: uniqueIndex("payment_ledger_allocations_payment_line_uq").on(table.paymentId, table.journalLineId),
  sourceLineIndex: index("payment_ledger_allocations_source_idx").on(table.journalLineId),
}));

export const insertPaymentLedgerAllocationSchema = createInsertSchema(paymentLedgerAllocationsTable)
  .omit({ id: true, createdAt: true });
export type PaymentLedgerAllocation = typeof paymentLedgerAllocationsTable.$inferSelect;
export type InsertPaymentLedgerAllocation = typeof paymentLedgerAllocationsTable.$inferInsert;