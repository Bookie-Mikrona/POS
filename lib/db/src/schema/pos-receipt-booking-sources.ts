import { boolean, numeric, pgTable, uuid, integer, uniqueIndex } from "drizzle-orm/pg-core";
import { journalEntriesTable } from "./journal-entries";
import { prejemniceTable } from "./pos/prejemnice";

/**
 * Nespremenljiv posnetek posamezne prejemnice, vključene v POS dnevno
 * temeljnico. Brez njega zbirna temeljnica ne more dokazati, kateri prevzem
 * in kateri znesek se sme zapreti na kontu 109.
 */
export const posReceiptBookingSourcesTable = pgTable(
  "pos_receipt_booking_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    prejemnicaId: integer("prejemnica_id").notNull()
      .references(() => prejemniceTable.id, { onDelete: "restrict" }),
    journalEntryId: uuid("journal_entry_id").notNull()
      .references(() => journalEntriesTable.id, { onDelete: "cascade" }),
    netAmount: numeric("net_amount", { precision: 14, scale: 2 }).notNull(),
    packagingReconciliationSafe: boolean("packaging_reconciliation_safe").notNull().default(false),
  },
  (table) => [
    uniqueIndex("pos_receipt_booking_sources_prejemnica_unique").on(table.prejemnicaId),
  ],
);