import {
  pgTable,
  uuid,
  integer,
  numeric,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { invoicesTable } from "./invoices";
import { journalEntriesTable } from "./journal-entries";
import { racuniTable } from "./pos/racuni";

/**
 * Nespremenljiva specifikacija dnevnih POS računov v mesečnem pogodbenem
 * A-računu. En POS račun sme pripadati največ enemu zbirnemu računu.
 */
export const posContractInvoiceReceiptsTable = pgTable(
  "pos_contract_invoice_receipts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "cascade" }),
    receiptId: integer("receipt_id")
      .notNull()
      .references(() => racuniTable.id, { onDelete: "restrict" }),
    dailyEntryId: uuid("daily_entry_id")
      .notNull()
      .references(() => journalEntriesTable.id, { onDelete: "restrict" }),
    grossAmount: numeric("gross_amount", { precision: 18, scale: 2 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pos_contract_invoice_receipts_receipt_unique").on(table.receiptId),
    uniqueIndex("pos_contract_invoice_receipts_invoice_receipt_unique").on(table.invoiceId, table.receiptId),
    index("pos_contract_invoice_receipts_company_invoice_idx").on(table.companyId, table.invoiceId),
  ],
);

export type PosContractInvoiceReceipt = typeof posContractInvoiceReceiptsTable.$inferSelect;