import { boolean, index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { narocnikiTable } from "./narocniki";

/**
 * Kratkotrajna čakalna vrsta dohodnih telefonskih klicev iz MacroDroid CTI.
 * Klic je vedno vezan na poslovno enoto, zato POS ne more prikazati klica
 * napačne lokacije.
 */
export const ctiDohodniKliciTable = pgTable("cti_dohodni_klici", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  telefon: text("telefon").notNull(),
  telefonNormaliziran: text("telefon_normaliziran").notNull(),
  prejeto: timestamp("prejeto", { withTimezone: true }).notNull().defaultNow(),
  obravnavano: boolean("obravnavano").notNull().default(false),
  narocnikId: integer("narocnik_id").references(() => narocnikiTable.id, { onDelete: "set null" }),
}, (t) => [
  index("ix_cti_dohodni_klici_enota_prejeto").on(t.enotaId, t.prejeto),
]);

export type CtiDohodniKlic = typeof ctiDohodniKliciTable.$inferSelect;
export type InsertCtiDohodniKlic = typeof ctiDohodniKliciTable.$inferInsert;