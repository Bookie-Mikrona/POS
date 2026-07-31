import { pgTable, serial, text, timestamp, numeric, integer, date, uuid } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";
import { shranjeniKupciTable } from "./shranjeni-kupci";

export const prejemniceTable = pgTable("prejemnice", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  dobaviteljId: integer("dobavitelj_id").references(() => shranjeniKupciTable.id, { onDelete: "set null" }),
  stevilka: text("stevilka"),
  datum: timestamp("datum").notNull().defaultNow(),
  opomba: text("opomba"),
  vrstaCen: text("vrsta_cen").notNull().default("neto"),
  skupajVrednost: numeric("skupaj_vrednost", { precision: 10, scale: 2 }).notNull().default("0"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
  // --- uvozna polja (dodata z migracijo 0009) ---
  /** Številka dobaviteljevega dokumenta */
  stDokumenta: text("st_dokumenta"),
  /** Datum dobaviteljevega dokumenta */
  datumDokumenta: date("datum_dokumenta"),
  /** Sklic na uvozno sejo, ki je ustvarila to prejemnico */
  uvozSejaId: uuid("uvoz_seja_id"),
});

export const prejemnicePostavkeTable = pgTable("prejemnice_postavke", {
  id: serial("id").primaryKey(),
  prejemnicaId: integer("prejemnica_id").notNull().references(() => prejemniceTable.id, { onDelete: "cascade" }),
  // artikel_id je NULL pri uvoznih osnutkih (DROP NOT NULL v migraciji 0009)
  artikelId: integer("artikel_id").references(() => artikliTable.id),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull().default("0"),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 4 }).notNull().default("0"),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull().default("0"),
  enotVPaketu: numeric("enot_v_paketu", { precision: 10, scale: 4 }).notNull().default("1"),
  // --- uvozna polja (dodana z migracijo 0009) ---
  izvGtin:            text("izv_gtin"),
  izvSifra:           text("izv_sifra"),
  izvNaziv:           text("izv_naziv"),
  izvEnota:           text("izv_enota"),
  izvKolicina:        numeric("izv_kolicina", { precision: 18, scale: 6 }),
  izvCena:            numeric("izv_cena", { precision: 15, scale: 6 }),
  uparjanje:          text("uparjanje"),
  uparjanjeZaupanje:  numeric("uparjanje_zaupanje", { precision: 5, scale: 2 }),
  uparjanjeKandidati: text("uparjanje_kandidati"), // JSONB, preberemo kot text
  rabat1Odst:         numeric("rabat_1_odst", { precision: 7, scale: 4 }).default("0"),
  rabat2Odst:         numeric("rabat_2_odst", { precision: 7, scale: 4 }).default("0"),
  opozorila:          text("opozorila"), // JSONB, preberemo kot text
});

export const prejemniceRelations = relations(prejemniceTable, ({ many }) => ({
  postavke: many(prejemnicePostavkeTable),
}));

export const prejemnicePostavkeRelations = relations(prejemnicePostavkeTable, ({ one }) => ({
  prejemnica: one(prejemniceTable, { fields: [prejemnicePostavkeTable.prejemnicaId], references: [prejemniceTable.id] }),
}));

export type Prejemnica = typeof prejemniceTable.$inferSelect;
export type PrejemnicaPostavka = typeof prejemnicePostavkeTable.$inferSelect;
