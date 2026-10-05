import { check, date, index, integer, numeric, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "../companies";
import { accountsTable } from "../accounts";
import { counterpartiesTable } from "../counterparties";
import { costCentersTable } from "../dimensions";
import { journalEntrySideEnum, journalEntryStatusEnum } from "../journal-entries";
import { vatCodeTable } from "../vat-code";

/** Operativne POS temeljnice. Nikoli niso del interne glavne knjige. */
export const posBookingDraftsTable = pgTable("pos_booking_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  // Vedno NULL; ohranjen skupni format generatorja, brez FK na ERP obdobja.
  periodId: uuid("period_id"),
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  documentDate: date("document_date", { mode: "string" }),
  taxDate: date("tax_date", { mode: "string" }),
  receiptDate: date("receipt_date", { mode: "string" }),
  description: text("description").notNull(),
  reference: text("reference"),
  status: journalEntryStatusEnum("status").notNull().default("draft"),
  sourceType: text("source_type").$type<"document">().notNull().default("document"),
  createdBy: text("created_by").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, t => [
  check("pos_booking_drafts_period_id_check", sql`${t.periodId} IS NULL`),
  check("pos_booking_drafts_status_check", sql`${t.status} = 'draft'`),
  check("pos_booking_drafts_posted_at_check", sql`${t.postedAt} IS NULL`),
  index("pos_booking_drafts_company_date").on(t.companyId, t.entryDate),
  uniqueIndex("pos_booking_drafts_company_reference").on(t.companyId, t.reference),
]);

export const posBookingDraftLinesTable = pgTable("pos_booking_draft_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id").notNull().references(() => posBookingDraftsTable.id, { onDelete: "cascade" }),
  accountId: uuid("account_id").notNull().references(() => accountsTable.id),
  side: journalEntrySideEnum("side").notNull(),
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  sequence: integer("sequence").notNull().default(0),
  partnerId: uuid("partner_id").references(() => counterpartiesTable.id, { onDelete: "set null" }),
  costCenterId: uuid("cost_center_id").references(() => costCentersTable.id, { onDelete: "set null" }),
  vatCodeId: uuid("vat_code_id").references(() => vatCodeTable.id),
  vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).default("0"),
}, t => [index("pos_booking_draft_lines_entry").on(t.entryId)]);
