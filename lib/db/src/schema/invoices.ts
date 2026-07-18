import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  integer,
  numeric,
  date,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { counterpartiesTable } from "./counterparties";
import { accountingPeriodsTable } from "./accounting-periods";
import { accountsTable } from "./accounts";
import { journalEntriesTable } from "./journal-entries";

export const invoiceTypeEnum = pgEnum("invoice_type", ["issued", "received"]);

export const invoiceStatusEnum = pgEnum("invoice_status", [
  "draft",
  "posted",
  "paid",
  "void",
]);

/**
 * Glava računa (izdanega ali prejetega).
 * - issued = izdani račun (kupcu) → ustvari terjatev (120xxx)
 * - received = prejeti račun (od dobavitelja) → ustvari obveznost (220xxx)
 *
 * arApAccountId: konto terjatev (izdani) ali obveznosti (prejeti).
 * linkedEntryId: avtomatično ustvarjena temeljnica ob knjiženju.
 */
export const invoicesTable = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  type: invoiceTypeEnum("type").notNull(),
  counterpartyId: uuid("counterparty_id")
    .notNull()
    .references(() => counterpartiesTable.id),
  periodId: uuid("period_id")
    .notNull()
    .references(() => accountingPeriodsTable.id),
  invoiceNumber: text("invoice_number").notNull(),
  invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
  dueDate: date("due_date", { mode: "string" }),
  status: invoiceStatusEnum("status").notNull().default("draft"),
  /** Konto terjatev (izdani) ali obveznosti (prejeti) */
  arApAccountId: uuid("ar_ap_account_id")
    .notNull()
    .references(() => accountsTable.id),
  /** Konto za DDV (izstopni za izdane, vstopni za prejete) — opcijsko */
  vatAccountId: uuid("vat_account_id").references(() => accountsTable.id),
  /** Avtomatično ustvarjena temeljnica ob knjiženju */
  linkedEntryId: uuid("linked_entry_id").references(
    () => journalEntriesTable.id,
  ),
  notes: text("notes"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Vrstice računa.
 * Znesek = quantity × unitPrice (brez DDV).
 * DDV = znesek × vatRate / 100.
 */
export const invoiceLinesTable = pgTable("invoice_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  invoiceId: uuid("invoice_id")
    .notNull()
    .references(() => invoicesTable.id, { onDelete: "cascade" }),
  description: text("description").notNull(),
  /** Količina — NUMERIC(10,3) za decimalke */
  quantity: numeric("quantity", { precision: 10, scale: 3 }).notNull(),
  /** Cena na enoto brez DDV — NUMERIC(18,4) za natančnost */
  unitPrice: numeric("unit_price", { precision: 18, scale: 4 }).notNull(),
  /** Stopnja DDV v % (0, 9.50, 22.00) */
  vatRate: numeric("vat_rate", { precision: 5, scale: 2 }).notNull().default("22.00"),
  /** Konto prihodkov (izdani) ali stroškov (prejeti) */
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id),
  sequence: integer("sequence").notNull().default(0),
});

export type Invoice = typeof invoicesTable.$inferSelect;
export type InvoiceLine = typeof invoiceLinesTable.$inferSelect;
