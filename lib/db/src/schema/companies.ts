import { pgTable, text, uuid, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ERP register podjetij.
 * `podjetje_davcna` je skupni multi-tenant ključ s FURS POS Web —
 * vsak zapis v FURS POS Web tabelah ima ta stolpec.
 * Ko bo skupni DATABASE_URL nastavljen, se ta tabela sinhronizira z
 * obstoječimi podjetji iz FURS POS Web (unikatni podjetje_davcna iz tabele enote).
 */
export const companiesTable = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Davčna številka — skupni ključ s FURS POS Web (format: SI12345678) */
  podjetjeDavcna: text("podjetje_davcna").notNull().unique(),
  naziv: text("naziv").notNull(),
  kratekNaziv: text("kratek_naziv"),
  naslov: text("naslov"),
  postnaStevika: text("postna_stevilka"),
  kraj: text("kraj"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectCompanySchema = createSelectSchema(companiesTable);
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
