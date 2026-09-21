import { pgTable, serial, integer, text, boolean, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { naseljaTable } from "./naselja";

/**
 * Fizične osebe/občani za telefonsko in dostavno prodajo.
 *
 * To je namerno ločeno od counterparties in shranjeni_kupci:
 * naročnik ni poslovni partner, ključ pa je telefon znotraj enote.
 */
export const narocnikiTable = pgTable("narocniki", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  telefon: text("telefon").notNull(),
  telefonNormaliziran: text("telefon_normaliziran").notNull(),
  email: text("email"),
  opombe: text("opombe"),
  steviloNarocil: integer("stevilo_narocil").notNull().default(0),
  zadnjeNarocilo: timestamp("zadnje_narocilo", { withTimezone: true }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("ux_narocniki_enota_telefon_normaliziran").on(t.enotaId, t.telefonNormaliziran),
  index("ix_narocniki_enota_telefon_normaliziran").on(t.enotaId, t.telefonNormaliziran),
]);

export const narocnikNasloviTable = pgTable("narocnik_naslovi", {
  id: serial("id").primaryKey(),
  narocnikId: integer("narocnik_id").notNull().references(() => narocnikiTable.id, { onDelete: "cascade" }),
  ulica: text("ulica").notNull(),
  hisnaStevilka: text("hisna_stevilka").notNull(),
  vhod: text("vhod"),
  nadstropje: text("nadstropje"),
  naseljeId: integer("naselje_id").notNull().references(() => naseljaTable.id, { onDelete: "restrict" }),
  navodilo: text("navodilo"),
  privzet: boolean("privzet").notNull().default(false),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  index("ix_narocnik_naslovi_narocnik_id").on(t.narocnikId),
  index("ix_narocnik_naslovi_naselje_id").on(t.naseljeId),
]);

export type Narocnik = typeof narocnikiTable.$inferSelect;
export type InsertNarocnik = typeof narocnikiTable.$inferInsert;
export type NarocnikNaslov = typeof narocnikNasloviTable.$inferSelect;
export type InsertNarocnikNaslov = typeof narocnikNasloviTable.$inferInsert;