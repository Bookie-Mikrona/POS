import { pgTable, text, serial, integer, smallint, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { mizeTable } from "./mize";
import { artikliTable } from "./artikli";

export const narocilaTable = pgTable("narocila", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  mizaId: integer("miza_id").references(() => mizeTable.id),
  status: text("status", { enum: ["odprto", "zakljuceno", "preklicano"] }).notNull().default("odprto"),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull().default("0"),
  opomba: text("opomba"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const postavkeTable = pgTable("postavke", {
  id: serial("id").primaryKey(),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").references(() => artikliTable.id),
  modifikatorId: integer("modifikator_id"),
  ime: text("ime").notNull(),
  kolicina: integer("kolicina").notNull().default(1),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 2 }).notNull(),
  cenaKosOriginalna: numeric("cena_kos_originalna", { precision: 10, scale: 2 }),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull(),
  davek: numeric("davek", { precision: 5, scale: 2 }).notNull(),
  opomba: text("opomba"),
  racunId: integer("racun_id"),
  gostStevilka: smallint("gost_stevilka"),
  parentPostavkaId: integer("parent_postavka_id"),
  toGo: boolean("to_go").notNull().default(false),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  pripravljeno: timestamp("pripravljeno", { withTimezone: true }),
  napravaId: text("naprava_id"),
});

export const prenosiNarocilTable = pgTable("prenosi_narocil", {
  id: serial("id").primaryKey(),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  staraMizaId: integer("stara_miza_id").references(() => mizeTable.id),
  novaMizaId: integer("nova_miza_id").references(() => mizeTable.id),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export const narocilaRelations = relations(narocilaTable, ({ one, many }) => ({
  miza: one(mizeTable, { fields: [narocilaTable.mizaId], references: [mizeTable.id] }),
  postavke: many(postavkeTable),
  prenosi: many(prenosiNarocilTable),
}));

export const postavkeRelations = relations(postavkeTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [postavkeTable.narociloId], references: [narocilaTable.id] }),
  artikel: one(artikliTable, { fields: [postavkeTable.artikelId], references: [artikliTable.id] }),
}));

export const prenosiNarocilRelations = relations(prenosiNarocilTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [prenosiNarocilTable.narociloId], references: [narocilaTable.id] }),
  staraMiza: one(mizeTable, { fields: [prenosiNarocilTable.staraMizaId], references: [mizeTable.id], relationName: "prenosStaraMiza" }),
  novaMiza: one(mizeTable, { fields: [prenosiNarocilTable.novaMizaId], references: [mizeTable.id], relationName: "prenosNovaMiza" }),
}));

export type Narocilo = typeof narocilaTable.$inferSelect;
export type Postavka = typeof postavkeTable.$inferSelect;
export type PrenosNarocila = typeof prenosiNarocilTable.$inferSelect;
