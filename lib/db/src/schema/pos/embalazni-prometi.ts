import { sql } from "drizzle-orm";
import { check, index, integer, numeric, pgTable, serial, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";
import { counterpartiesTable } from "../counterparties";
import { journalEntriesTable } from "../journal-entries";

/** Append-only ledger of returnable packaging, independent of merchandise stock. */
export const embalazniPrometiTable = pgTable("embalazni_prometi", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  dobaviteljId: uuid("dobavitelj_id").references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  kolicina: numeric("kolicina", { precision: 12, scale: 4 }).notNull(),
  depozitnaVrednost: numeric("depozitna_vrednost", { precision: 12, scale: 2 }),
  prejemnicaPostavkaId: integer("prejemnica_postavka_id"),
  vrsta: text("vrsta").notNull().default("prejem"),
  opomba: text("opomba"),
  datum: timestamp("datum", { withTimezone: true }).notNull().defaultNow(),
  actorSnapshot: text("actor_snapshot"),
  operationKey: uuid("operation_key"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  reversalOfId: integer("reversal_of_id"),
}, (t) => [
  check("embalazni_prometi_kolicina_nonzero", sql`${t.kolicina} <> 0`),
  check("embalazni_prometi_vrsta_check", sql`${t.vrsta} IN ('prejem', 'vracilo')`),
  uniqueIndex("embalazni_prometi_receipt_line_unique").on(t.prejemnicaPostavkaId)
    .where(sql`${t.prejemnicaPostavkaId} IS NOT NULL AND ${t.reversalOfId} IS NULL`),
  index("embalazni_prometi_scope_idx").on(t.enotaId, t.artikelId, t.dobaviteljId),
  uniqueIndex("embalazni_prometi_operation_key_unique").on(t.enotaId, t.operationKey).where(sql`${t.operationKey} IS NOT NULL`),
  uniqueIndex("embalazni_prometi_journal_entry_unique").on(t.journalEntryId).where(sql`${t.journalEntryId} IS NOT NULL`),
  uniqueIndex("embalazni_prometi_reversal_of_id_unique").on(t.reversalOfId).where(sql`${t.reversalOfId} IS NOT NULL`),
]);
export type EmbalazniPromet = typeof embalazniPrometiTable.$inferSelect;