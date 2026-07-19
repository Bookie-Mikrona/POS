import { pgTable, serial, text, timestamp, numeric, integer, unique } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

export const zacetneZalogeTable = pgTable("zacetne_zaloge", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  leto: integer("leto").notNull(),
  datum: timestamp("datum").notNull().defaultNow(),
  stevilka: text("stevilka"),
  opomba: text("opomba"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
}, (t) => [unique("zacetne_zaloge_enota_leto_unique").on(t.enotaId, t.leto)]);

export const zacetneZalogePostavkeTable = pgTable("zacetne_zaloge_postavke", {
  id: serial("id").primaryKey(),
  zacetnaZalogaId: integer("zacetna_zaloga_id").notNull().references(() => zacetneZalogeTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull().default("0"),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 4 }).notNull().default("0"),
  steviloPrejsnje: numeric("stevilo_prejsnje", { precision: 10, scale: 4 }).notNull().default("0"),
});

export const zacetneZalogeRelations = relations(zacetneZalogeTable, ({ many }) => ({
  postavke: many(zacetneZalogePostavkeTable),
}));

export const zacetneZalogePostavkeRelations = relations(zacetneZalogePostavkeTable, ({ one }) => ({
  zacetnaZaloga: one(zacetneZalogeTable, { fields: [zacetneZalogePostavkeTable.zacetnaZalogaId], references: [zacetneZalogeTable.id] }),
}));

export type ZacetnaZaloga = typeof zacetneZalogeTable.$inferSelect;
export type ZacetnaZalogaPostavka = typeof zacetneZalogePostavkeTable.$inferSelect;
