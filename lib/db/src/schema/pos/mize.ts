import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { prostoriTable } from "./prostori";

export const mizeTable = pgTable("mize", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  stevilka: integer("stevilka").notNull(),
  ime: text("ime"),
  kapaciteta: integer("kapaciteta").notNull().default(4),
  status: text("status", { enum: ["prosta", "zasedena", "rezervirana"] }).notNull().default("prosta"),
  prostorId: integer("prostor_id").references(() => prostoriTable.id),
  /** Pozicija mize na tlorisu (x os, px). NULL = ni nastavljeno. */
  posX: integer("pos_x"),
  /** Pozicija mize na tlorisu (y os, px). NULL = ni nastavljeno. */
  posY: integer("pos_y"),
});

export type Miza = typeof mizeTable.$inferSelect;
export type InsertMiza = typeof mizeTable.$inferInsert;
