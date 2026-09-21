import { pgTable, serial, integer, numeric, text, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

/**
 * Dostavna naselja so POS šifrant na ravni enote.
 * Namenoma niso del šifranta poslovnih partnerjev ali starih shranjenih kupcev.
 */
export const naseljaTable = pgTable("naselja", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  naziv: text("naziv").notNull(),
  oddaljenostKm: numeric("oddaljenost_km", { precision: 8, scale: 2 }),
  cenaDostave: numeric("cena_dostave", { precision: 10, scale: 2 }).notNull().default("0"),
  casDostaveMin: integer("cas_dostave_min").notNull().default(0),
  aktivno: boolean("aktivno").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
}, (t) => [
  index("ix_naselja_enota_aktivno").on(t.enotaId, t.aktivno),
]);

export type Naselje = typeof naseljaTable.$inferSelect;
export type InsertNaselje = typeof naseljaTable.$inferInsert;