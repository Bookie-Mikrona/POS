import { pgTable, text, serial, integer, boolean } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const kategorijeTable = pgTable("kategorije", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  barva: text("barva").notNull().default("#6366f1"),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  tip: text("tip"),
  dnevnoFiltriranje: boolean("dnevno_filtriranje").notNull().default(false),
});

export type Kategorija = typeof kategorijeTable.$inferSelect;
export type InsertKategorija = typeof kategorijeTable.$inferInsert;
