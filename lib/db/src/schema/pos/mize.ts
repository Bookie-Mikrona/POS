import { boolean, index, pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { prostoriTable } from "./prostori";
import { narocnikiTable } from "./narocniki";

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
  /** Oblika mize na tlorisu: kvadrat | pravokotnik_h | pravokotnik_v */
  oblika: text("oblika").default("pravokotnik_h"),
  /** Canonical table dimensions and rotation, mirrored from its floor-plan item. */
  tlorisSirina: integer("tloris_sirina"),
  tlorisVisina: integer("tloris_visina"),
  tlorisRotacija: integer("tloris_rotacija"),
  /** Naključen javni žeton za QR meni; NULL pomeni, da QR še ni generiran. */
  qrToken: text("qr_token"),
  /** Archived tables remain only to preserve reservation/order audit history. */
  arhivirana: boolean("arhivirana").notNull().default(false),
  arhiviranaOb: timestamp("arhivirana_ob", { withTimezone: true }),
  /** Telefonski naročnik, povezan s trenutno aktivno rezervacijo. */
  rezervacijaNarocnikId: integer("rezervacija_narocnik_id").references(() => narocnikiTable.id, { onDelete: "set null" }),
  /** Ime oziroma naziv stranke za trenutno aktivno rezervacijo. */
  rezervacijaStrankaIme: text("rezervacija_stranka_ime"),
  /** Telefonska številka stranke za trenutno aktivno rezervacijo. */
  rezervacijaTelefon: text("rezervacija_telefon"),
  /** Neobvezna opomba trenutne rezervacije. */
  rezervacijaOpomba: text("rezervacija_opomba"),
  /** Absolutni trenutek, do katerega rezervacija velja. */
  rezervacijaVeljaDo: timestamp("rezervacija_velja_do", { withTimezone: true }),
}, (t) => [
  uniqueIndex("ux_mize_qr_token").on(t.qrToken),
  index("ix_mize_rezervacija_velja_do").on(t.rezervacijaVeljaDo),
]);

export type Miza = typeof mizeTable.$inferSelect;
export type InsertMiza = typeof mizeTable.$inferInsert;
