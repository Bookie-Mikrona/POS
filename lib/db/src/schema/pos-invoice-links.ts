import { pgTable, text, timestamp, uniqueIndex, uuid, integer } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { invoicesTable } from "./invoices";
import { prejemniceTable } from "./pos/prejemnice";
import { enoteTable } from "./pos/enote";

/**
 * Trajna povezava prejetega ERP računa z eno POS prejemnico.
 *
 * Prejemnica se lahko zapre samo z enim računom. En račun pa lahko zapre
 * prejemnice iz več enot istega podjetja.
 */
export const posInvoiceLinkModeEnum = ["delivery_note_invoice", "invoice_with_delivery_notes"] as const;
export type PosInvoiceLinkMode = (typeof posInvoiceLinkModeEnum)[number];

export const posInvoiceMatchMethodEnum = ["manual", "suggested", "exact"] as const;
export type PosInvoiceMatchMethod = (typeof posInvoiceMatchMethodEnum)[number];

export const posInvoiceLinksTable = pgTable(
  "pos_invoice_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    invoiceId: uuid("invoice_id")
      .notNull()
      .references(() => invoicesTable.id, { onDelete: "restrict" }),
    prejemnicaId: integer("prejemnica_id")
      .notNull()
      .references(() => prejemniceTable.id, { onDelete: "restrict" }),
    enotaId: integer("enota_id")
      .notNull()
      .references(() => enoteTable.id, { onDelete: "restrict" }),
    mode: text("mode").$type<PosInvoiceLinkMode>().notNull(),
    matchMethod: text("match_method").$type<PosInvoiceMatchMethod>().notNull(),
    matchedBy: text("matched_by").notNull(),
    matchedAt: timestamp("matched_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // En prevzem se ne sme dvakrat zapreti, tudi če uporabnik klikne dvakrat.
    uniqueIndex("pos_invoice_links_prejemnica_unique").on(table.prejemnicaId),
    uniqueIndex("pos_invoice_links_invoice_prejemnica_unique").on(table.invoiceId, table.prejemnicaId),
    uniqueIndex("pos_invoice_links_company_invoice_prejemnica_unique").on(
      table.companyId,
      table.invoiceId,
      table.prejemnicaId,
    ),
  ],
);

export type PosInvoiceLink = typeof posInvoiceLinksTable.$inferSelect;