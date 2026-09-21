import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { purchaseSourceDocumentsTable } from "./purchase-source-documents";
import { invoiceLinesTable } from "./invoices";
import { prejemnicePostavkeTable } from "./pos/prejemnice";
import { embalazniPrometiTable } from "./pos/embalazni-prometi";

/** Immutable evidence linking a credit-note line to physical returnable packaging. */
export const posCreditNoteAllocationsTable = pgTable("pos_credit_note_allocations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  sourceDocumentId: uuid("source_document_id").notNull().references(() => purchaseSourceDocumentsTable.id, { onDelete: "restrict" }),
  invoiceLineId: uuid("invoice_line_id").references(() => invoiceLinesTable.id, { onDelete: "restrict" }),
  prejemnicaPostavkaId: integer("prejemnica_postavka_id").notNull().references(() => prejemnicePostavkeTable.id, { onDelete: "restrict" }),
  embalazniPrometId: integer("embalazni_promet_id").notNull().references(() => embalazniPrometiTable.id, { onDelete: "restrict" }),
  status: text("status").notNull().default("confirmed"),
  reversedAllocationId: uuid("reversed_allocation_id"),
  operationKey: uuid("operation_key").notNull(),
  actorSnapshot: text("actor_snapshot"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  quantitySnapshot: numeric("quantity_snapshot", { precision: 12, scale: 4 }).notNull(),
  depositSnapshot: numeric("deposit_snapshot", { precision: 14, scale: 2 }).notNull().default("0"),
  netSnapshot: numeric("net_snapshot", { precision: 14, scale: 2 }).notNull().default("0"),
  grossSnapshot: numeric("gross_snapshot", { precision: 14, scale: 2 }).notNull().default("0"),
}, (t) => [
  check("pos_credit_note_allocations_status_check", sql`${t.status} IN ('confirmed', 'reversed')`),
  check("pos_credit_note_allocations_quantity_nonzero", sql`${t.quantitySnapshot} <> 0`),
  check("pos_credit_note_allocations_status_sign_check", sql`(${t.status} = 'confirmed' AND ${t.quantitySnapshot} > 0 AND ${t.reversedAllocationId} IS NULL) OR (${t.status} = 'reversed' AND ${t.quantitySnapshot} < 0 AND ${t.reversedAllocationId} IS NOT NULL)`),
  check("pos_credit_note_allocations_value_nonnegative", sql`${t.depositSnapshot} >= 0 AND ${t.netSnapshot} >= 0 AND ${t.grossSnapshot} >= 0`),
  uniqueIndex("pos_credit_note_allocations_operation_key_unique").on(t.companyId, t.operationKey),
  uniqueIndex("pos_credit_note_allocations_reversal_unique").on(t.reversedAllocationId).where(sql`${t.reversedAllocationId} IS NOT NULL`),
  index("pos_credit_note_allocations_source_idx").on(t.companyId, t.sourceDocumentId, t.status),
  index("pos_credit_note_allocations_return_idx").on(t.companyId, t.embalazniPrometId, t.status),
]);
export type PosCreditNoteAllocation = typeof posCreditNoteAllocationsTable.$inferSelect;