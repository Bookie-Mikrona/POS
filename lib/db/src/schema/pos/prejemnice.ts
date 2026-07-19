import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

export const prejemniceTable = pgTable("prejemnice", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  stevilka: text("stevilka"),
  datum: timestamp("datum").notNull().defaultNow(),
  opomba: text("opomba"),
  skupajVrednost: numeric("skupaj_vrednost", { precision: 10, scale: 2 }).notNull().default("0"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
});

export const prejemnicePostavkeTable = pgTable("prejemnice_postavke", {
  id: serial("id").primaryKey(),
  prejemnicaId: integer("prejemnica_id").notNull().references(() => prejemniceTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 4 }).notNull().default("0"),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull().default("0"),
});

export const prejemniceRelations = relations(prejemniceTable, ({ many }) => ({
  postavke: many(prejemnicePostavkeTable),
}));

export const prejemnicePostavkeRelations = relations(prejemnicePostavkeTable, ({ one }) => ({
  prejemnica: one(prejemniceTable, { fields: [prejemnicePostavkeTable.prejemnicaId], references: [prejemniceTable.id] }),
}));

export type Prejemnica = typeof prejemniceTable.$inferSelect;
export type PrejemnicaPostavka = typeof prejemnicePostavkeTable.$inferSelect;
