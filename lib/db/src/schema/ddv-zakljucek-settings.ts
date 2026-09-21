import { pgTable, uuid, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { accountsTable } from "./accounts";

/**
 * Nastavitve zaključne DDV temeljnice (ERP DDV zaključek).
 * En zapis na podjetje; ob prvem ustvarjanju se samodejno naredi zapis.
 *
 * netoObveznostAccountId — konto za neto DDV obveznost (privzeto 2699)
 * netoTerjatevAccountId  — konto za neto DDV terjatev/presežek (privzeto 1699)
 */
export const ddvZakljucekSettingsTable = pgTable("ddv_zakljucek_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .unique()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Neto DDV obveznost → kredit (npr. 2699 Obveznosti za DDV do FURS) */
  netoObveznostAccountId: uuid("neto_obveznost_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  /** Neto DDV terjatev/presežek → debet (npr. 1699 Terjatve za DDV od FURS) */
  netoTerjatevAccountId: uuid("neto_terjatev_account_id")
    .references(() => accountsTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type DdvZakljucekSettings = typeof ddvZakljucekSettingsTable.$inferSelect;
