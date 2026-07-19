import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const poslovniProstoriTable = pgTable("poslovni_prostori", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  prostorId: text("prostor_id").notNull(),
  naziv: text("naziv"),
  tipProstora: text("tip_prostora").notNull().default("nepremicnina"),
  aktiven: boolean("aktiven").notNull().default(true),
  zaprt: boolean("zaprt").notNull().default(false),
  ulica: text("ulica"),
  hisnaStevilka: text("hisna_stevilka"),
  hisnaStevilkaDodatek: text("hisna_stevilka_dodatek"),
  skupnost: text("skupnost"),
  kraj: text("kraj"),
  postnaStevilka: text("postna_stevilka"),
  katastrskaStevilka: text("katastrska_stevilka"),
  stevilkaStavbe: text("stevilka_stavbe"),
  stevilkaDelaStavbe: text("stevika_dela_stavbe"),
  registrskaTablica: text("registrska_tablica"),
  vin: text("vin"),
  premicninaTip: text("premicnina_tip"),
  veljavnostOd: text("veljavnost_od"),
  /** FURS certifikat — shranjen šifriran v DB */
  certifikatPot: text("certifikat_pot"),
  certifikatGeslo: text("certifikat_geslo"),
  zadnjaRegistracija: timestamp("zadnja_registracija", { withTimezone: true }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type PoslovniProstor = typeof poslovniProstoriTable.$inferSelect;
export type InsertPoslovniProstor = typeof poslovniProstoriTable.$inferInsert;
