import { index, integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { mizeTable } from "./mize";
import { narocnikiTable } from "./narocniki";

/**
 * Reservation history is deliberately independent from `mize`: a table can
 * have many future bookings and terminal rows are retained for audit.
 */
export const rezervacijeMizTable = pgTable("rezervacije_miz", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  mizaId: integer("miza_id").notNull().references(() => mizeTable.id, { onDelete: "cascade" }),
  /** Immutable labels retained even when the table/room is renamed or archived. */
  mizaStevilkaSnapshot: integer("miza_stevilka_snapshot"),
  mizaImeSnapshot: text("miza_ime_snapshot"),
  prostorImeSnapshot: text("prostor_ime_snapshot"),
  narocnikId: integer("narocnik_id").references(() => narocnikiTable.id, { onDelete: "set null" }),
  strankaIme: text("stranka_ime").notNull(),
  telefon: text("telefon").notNull(),
  opomba: text("opomba"),
  /** The booked arrival instant, not a display/scheduler deadline. */
  zacetek: timestamp("zacetek", { withTimezone: true }).notNull(),
  status: text("status", { enum: ["aktivna", "porabljena", "sprostena", "potekla"] }).notNull().default("aktivna"),
  // SQL migration declares this FK. Keeping this scalar avoids a circular
  // Drizzle table initializer (`narocila` also points at reservations).
  narociloId: integer("narocilo_id"),
  porabljena: timestamp("porabljena", { withTimezone: true }),
  sproscena: timestamp("sproscena", { withTimezone: true }),
  potekla: timestamp("potekla", { withTimezone: true }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ix_rezervacije_miz_enota_miza_zacetek").on(t.enotaId, t.mizaId, t.zacetek),
  index("ix_rezervacije_miz_aktivne").on(t.mizaId, t.status, t.zacetek),
  index("ix_rezervacije_miz_narocilo").on(t.narociloId),
]);

export type RezervacijaMize = typeof rezervacijeMizTable.$inferSelect;
export type InsertRezervacijaMize = typeof rezervacijeMizTable.$inferInsert;