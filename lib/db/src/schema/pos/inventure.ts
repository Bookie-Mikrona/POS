import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

export const inventureTable = pgTable("inventure", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  stevilka: text("stevilka"),
  datum: timestamp("datum").notNull().defaultNow(),
  opomba: text("opomba"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
});

export const inventurePostavkeTable = pgTable("inventure_postavke", {
  id: serial("id").primaryKey(),
  inventuraId: integer("inventura_id").notNull().references(() => inventureTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id),
  steviloNajdeno: numeric("stevilo_najdeno", { precision: 10, scale: 4 }).notNull(),
  steviloPrejsnje: numeric("stevilo_prejsnje", { precision: 10, scale: 4 }).notNull().default("0"),
  razlika: numeric("razlika", { precision: 10, scale: 4 }).notNull().default("0"),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 4 }).notNull().default("0"),
});

export const inventureRelations = relations(inventureTable, ({ many }) => ({
  postavke: many(inventurePostavkeTable),
}));

export const inventurePostavkeRelations = relations(inventurePostavkeTable, ({ one }) => ({
  inventura: one(inventureTable, { fields: [inventurePostavkeTable.inventuraId], references: [inventureTable.id] }),
}));

export type Inventura = typeof inventureTable.$inferSelect;
export type InventuraPostavka = typeof inventurePostavkeTable.$inferSelect;
