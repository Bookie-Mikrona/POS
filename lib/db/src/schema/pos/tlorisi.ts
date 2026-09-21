import { boolean, index, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { prostoriTable } from "./prostori";
import { mizeTable } from "./mize";

/** Canonical, versioned drawing metadata for a POS room. */
export const tlorisiTable = pgTable("tlorisi", {
  id: serial("id").primaryKey(),
  prostorId: integer("prostor_id").notNull().references(() => prostoriTable.id, { onDelete: "cascade" }),
  version: integer("version").notNull().default(0),
  sirina: integer("sirina").notNull().default(1200),
  visina: integer("visina").notNull().default(800),
  mreza: integer("mreza").notNull().default(20),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("ux_tlorisi_prostor").on(t.prostorId)]);

/** An object on a room drawing. Table objects are tied to a live POS table. */
export const tlorisPostavkeTable = pgTable("tloris_postavke", {
  id: text("id").primaryKey(),
  tlorisId: integer("tloris_id").notNull().references(() => tlorisiTable.id, { onDelete: "cascade" }),
  vrsta: text("vrsta", { enum: ["table", "wall", "door", "opening", "label", "zone", "decoration"] }).notNull(),
  mizaId: integer("miza_id").references(() => mizeTable.id, { onDelete: "restrict" }),
  x: integer("x").notNull(),
  y: integer("y").notNull(),
  sirina: integer("sirina").notNull(),
  visina: integer("visina").notNull(),
  rotacija: integer("rotacija").notNull().default(0),
  zIndex: integer("z_index").notNull().default(0),
  zaklenjena: boolean("zaklenjena").notNull().default(false),
  vidna: boolean("vidna").notNull().default(true),
  slog: jsonb("slog").notNull().default({}),
  podatki: jsonb("podatki").notNull().default({}),
}, (t) => [
  index("ix_tloris_postavke_tloris").on(t.tlorisId),
  uniqueIndex("ux_tloris_postavke_miza").on(t.mizaId),
]);

export type Tloris = typeof tlorisiTable.$inferSelect;
export type TlorisPostavka = typeof tlorisPostavkeTable.$inferSelect;