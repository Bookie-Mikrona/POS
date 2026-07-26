import { pgTable, serial, integer, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";

export const zalogeTable = pgTable("zaloge", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().unique().references(() => artikliTable.id, { onDelete: "cascade" }),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull().default("0"),
  /** Drseča tehtana povprečna nabavna cena (WAC) */
  povprecnaCena: numeric("povprecna_cena", { precision: 14, scale: 6 }),
  /** Skupna vrednost zaloge = kolicina * povprecnaCena */
  skupnaVrednost: numeric("skupna_vrednost", { precision: 14, scale: 4 }),
  zadnjaPosodobitev: timestamp("zadnja_posodobitev").notNull().defaultNow(),
});

export const zalogaGibiTable = pgTable("zaloga_gibi", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  tip: text("tip").notNull(), // 'prejemnica' | 'inventura' | 'poraba' | 'storno' | 'izdajnica'
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
  /** Povprečna nabavna cena na enoto v trenutku gibanja */
  cenaKos: numeric("cena_kos", { precision: 14, scale: 6 }),
  /** Vrednost gibanja = kolicina * cenaKos */
  vrednost: numeric("vrednost", { precision: 14, scale: 4 }),
  opomba: text("opomba"),
  referencaId: integer("referenca_id"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
});

export type Zaloga = typeof zalogeTable.$inferSelect;
export type ZalogaGib = typeof zalogaGibiTable.$inferSelect;
