import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";

export const izdajniceTable = pgTable("izdajnice", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  stevilka: text("stevilka"),
  datum: timestamp("datum").notNull().defaultNow(),
  opomba: text("opomba"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
});

export const izdajnicePostavkeTable = pgTable("izdajnice_postavke", {
  id: serial("id").primaryKey(),
  izdajnicaId: integer("izdajnica_id").notNull().references(() => izdajniceTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
});

export const izdajniceRelations = relations(izdajniceTable, ({ many }) => ({
  postavke: many(izdajnicePostavkeTable),
}));

export const izdajnicePostavkeRelations = relations(izdajnicePostavkeTable, ({ one }) => ({
  izdajnica: one(izdajniceTable, { fields: [izdajnicePostavkeTable.izdajnicaId], references: [izdajniceTable.id] }),
}));

export type Izdajnica = typeof izdajniceTable.$inferSelect;
export type IzdajnicaPostavka = typeof izdajnicePostavkeTable.$inferSelect;
