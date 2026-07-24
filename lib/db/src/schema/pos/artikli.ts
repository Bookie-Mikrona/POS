import { pgTable, text, serial, integer, numeric, boolean, json } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { kategorijeTable } from "./kategorije";

export const artikliTable = pgTable("artikli", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  opis: text("opis"),
  cena: numeric("cena", { precision: 10, scale: 2 }).notNull(),
  davek: numeric("davek", { precision: 5, scale: 2 }).notNull().default("9.5"),
  aktiven: boolean("aktiven").notNull().default(true),
  kategorijaId: integer("kategorija_id").references(() => kategorijeTable.id),
  barva: text("barva"),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  nabavniArtikel: boolean("nabavni_artikel").notNull().default(false),
  prodajniArtikel: boolean("prodajni_artikel").notNull().default(true),
  imeZaNabavo: text("ime_za_nabavo"),
  enotaMere: text("enota_mere"),
  jePica: boolean("je_pica").notNull().default(false),
  jeDodatekZaPico: boolean("je_dodatek_za_pico").notNull().default(false),
  privzetiDodatki: json("privzeti_dodatki").$type<number[]>().notNull().default([]),
  jeModifikator: boolean("je_modifikator").notNull().default(false),
  privzetiModifikatorji: json("privzeti_modifikatorji").$type<number[]>().notNull().default([]),
  toGoArtikli: json("to_go_artikli").$type<number[]>().notNull().default([]),
  toGo: boolean("to_go").notNull().default(false),
  vrstaArtikla: text("vrsta_artikla").notNull().default("material"),
});

export const artikliRelations = relations(artikliTable, ({ one }) => ({
  kategorija: one(kategorijeTable, {
    fields: [artikliTable.kategorijaId],
    references: [kategorijeTable.id],
  }),
}));

export type Artikel = typeof artikliTable.$inferSelect;
export type InsertArtikel = typeof artikliTable.$inferInsert;
