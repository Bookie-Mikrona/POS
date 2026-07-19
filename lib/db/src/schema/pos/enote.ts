import { pgTable, text, serial, boolean, timestamp, uuid } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";

/**
 * Poslovne enote (lokacije) — podenota podjetja v POS sistemu.
 * Primer: veriga restavracij ima eno podjetje (company) z več enotami (enote).
 * companyId veže enoto na ERP podjetje.
 */
export const enoteTable = pgTable("enote", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  opis: text("opis"),
  aktiven: boolean("aktiven").notNull().default(true),
  zacetekDnevaUra: text("zacetek_dneva_ura").notNull().default("04:00"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type Enota = typeof enoteTable.$inferSelect;
export type InsertEnota = typeof enoteTable.$inferInsert;
