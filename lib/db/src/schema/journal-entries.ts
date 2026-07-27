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
import { vatCodeTable } from "./vat-code";

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
  /**
   * §72 — Datum listine (datum na dokumentu, npr. računu).
   * Ločen od datuma knjiženja! Obvezno za pravilno periodizacijo po SRS.
   */
  documentDate: date("document_date", { mode: "string" }),
  /**
   * §72 — Datum knjiženja = datum, na katerega se knjižba upošteva v GK.
   * Določa fiskalno obdobje skupaj s periodId.
   */
  entryDate: date("entry_date", { mode: "string" }).notNull(),
  /**
   * §72 — Davčni datum za DDV evidence.
   * Privzeto enak datumu listine, a lahko različen (npr. intrastat).
   */
  taxDate: date("tax_date", { mode: "string" }),
  description: text("description").notNull(),
  /** Zunanji sklic (npr. številka računa) */
  reference: text("reference"),
  status: journalEntryStatusEnum("status").notNull().default("draft"),
  /** §94 — Kdaj je bila knjižba dejansko potrjena/knjižena */
  postedAt: timestamp("posted_at", { withTimezone: true }),
  /** Kateri vnos ta vnos stornira (samo za storno temeljnice) */
  reversalOf: uuid("reversal_of"),
  /**
   * Izvor knjižbe — za revizijsko sled.
   * manual: ročno vnesen | bank_import: uvoz bančnega izpiska
   * document: potrjen dokument (AI OCR) | ai_suggestion: AI predlog
   */
  sourceType: text("source_type")
    .$type<"manual" | "bank_import" | "document" | "ai_suggestion">()
    .notNull()
    .default("manual"),
  /** Clerk user ID ki je potrdil/knjižil vnos */
  approvedBy: text("approved_by"),
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
  /**
   * FURS DDV koda (FK na vat_code.id, globalni šifrant).
   * Ko je nastavljeno, vrstica nosi DDV informacijo za KIR/KPR evidenco.
   * amount = osnova brez DDV; vatAmount = znesek DDV.
   */
  vatCodeId: uuid("vat_code_id").references(() => vatCodeTable.id),
  /** Znesek DDV za to vrstico — 0 pri oproščenih */
  vatAmount: numeric("vat_amount", { precision: 18, scale: 2 }).default("0"),
  /** Odbitni delež v % (0–100); 100 = polna pravica do odbitka */
  vatDeductionPercent: numeric("vat_deduction_percent", { precision: 5, scale: 2 }).default("100.00"),
});

export type JournalEntry = typeof journalEntriesTable.$inferSelect;
export type JournalEntryLine = typeof journalEntryLinesTable.$inferSelect;
