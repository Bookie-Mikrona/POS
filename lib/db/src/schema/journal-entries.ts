import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  date,
  integer,
  numeric,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { accountingPeriodsTable } from "./accounting-periods";
import { accountsTable } from "./accounts";
import { counterpartiesTable } from "./counterparties";
import { costCentersTable, projectsTable, departmentsTable } from "./dimensions";

export const journalEntryStatusEnum = pgEnum("journal_entry_status", [
  "draft",
  "posted",
  "reversed",
]);

export const journalEntrySideEnum = pgEnum("journal_entry_side", [
  "debit",
  "credit",
]);

/**
 * Glava temeljnice (journal entry header).
 * Ko je status "posted", vnos ni mogoče urejati — samo storno je dovoljen.
 */
export const journalEntriesTable = pgTable("journal_entries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  periodId: uuid("period_id")
    .notNull()
    .references(() => accountingPeriodsTable.id),
  /** Datum knjiženja (YYYY-MM-DD) */
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  description: text("description").notNull(),
  /** Zunanji sklic (npr. številka računa) */
  reference: text("reference"),
  status: journalEntryStatusEnum("status").notNull().default("draft"),
  /** Kateri vnos ta vnos stornira (samo za storno temeljnice) */
  reversalOf: uuid("reversal_of"),
  /** Clerk user ID ki je ustvaril vnos */
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
 * Vrstice temeljnice (debit / kredit knjižbe).
 * Vsota debetnih = vsota kreditnih je zahteva aplikacijske plasti.
 * Znesek je vedno pozitiven; stran (debit/kredit) pove smer.
 * Dimenzije (partner, stroškovno mesto, projekt, oddelek) so analitične oznake.
 */
export const journalEntryLinesTable = pgTable("journal_entry_lines", {
  id: uuid("id").primaryKey().defaultRandom(),
  entryId: uuid("entry_id")
    .notNull()
    .references(() => journalEntriesTable.id, { onDelete: "cascade" }),
  accountId: uuid("account_id")
    .notNull()
    .references(() => accountsTable.id),
  side: journalEntrySideEnum("side").notNull(),
  /** Znesek v EUR — vedno pozitiven, NUMERIC(18,2) */
  amount: numeric("amount", { precision: 18, scale: 2 }).notNull(),
  description: text("description"),
  /** Vrstni red za prikaz */
  sequence: integer("sequence").notNull().default(0),
  /** Poslovni partner (FK na counterparties) — zahtevano, če konto zahteva partnerja */
  partnerId: uuid("partner_id").references(() => counterpartiesTable.id, { onDelete: "set null" }),
  /** Stroškovno mesto — zahtevano, če konto zahteva stroškovno mesto */
  costCenterId: uuid("cost_center_id").references(() => costCentersTable.id, { onDelete: "set null" }),
  /** Projekt — zahtevano, če konto zahteva projekt */
  projectId: uuid("project_id").references(() => projectsTable.id, { onDelete: "set null" }),
  /** Oddelek */
  departmentId: uuid("department_id").references(() => departmentsTable.id, { onDelete: "set null" }),
});

export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type JournalEntryLine = typeof journalEntryLinesTable.$inferSelect;
