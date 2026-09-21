import { sql } from "drizzle-orm";
import { check, foreignKey, pgTable, serial, integer, numeric, timestamp, text, uniqueIndex } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { posStockTransfersTable } from "./events";

export const POS_EVENT_STOCK_MOVEMENT_TYPES = [
  "event_transfer_out",
  "event_transfer_in",
  "event_return_out",
  "event_return_in",
] as const;
const POS_EVENT_STOCK_MOVEMENT_TYPES_SQL = sql.raw(
  POS_EVENT_STOCK_MOVEMENT_TYPES.map(type => `'${type}'`).join(", "),
);

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
  /** Neposredni uporabnik ali sistemski akter ob nastanku; null pri legacy vrsticah brez dokaza. */
  actorSnapshot: text("actor_snapshot"),
  /** Nespremenljiv tip poslovnega procesa oziroma dokumenta, ki je ustvaril premik. */
  sourceSnapshot: text("source_snapshot"),
  /** Izvorna nespremenljiva vrstica, ki jo ta izravnalni gib stornira. */
  reversalOfId: integer("reversal_of_id"),
  /** Nespremenljiv poslovni datum, po katerem se gib vključi v WAC. */
  effectiveAtSnapshot: timestamp("effective_at_snapshot").notNull().defaultNow(),
  eventTransferId: integer("event_transfer_id")
    .references(() => posStockTransfersTable.id, { onDelete: "restrict" }),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
}, (t) => [
  check(
    "zaloga_gibi_event_transfer_link_check",
    sql`(
      (
        ${t.tip} IN (${POS_EVENT_STOCK_MOVEMENT_TYPES_SQL})
        AND ${t.eventTransferId} IS NOT NULL
        AND ${t.referencaId} = ${t.eventTransferId}
      )
      OR (
        ${t.tip} NOT IN (${POS_EVENT_STOCK_MOVEMENT_TYPES_SQL})
        AND ${t.eventTransferId} IS NULL
      )
    )`,
  ),
  foreignKey({
    columns: [t.reversalOfId],
    foreignColumns: [t.id],
    name: "zaloga_gibi_reversal_of_id_fkey",
  }).onDelete("restrict"),
  uniqueIndex("zaloga_gibi_reversal_of_id_unique")
    .on(t.reversalOfId)
    .where(sql`${t.reversalOfId} IS NOT NULL`),
]);

export type Zaloga = typeof zalogeTable.$inferSelect;
export type ZalogaGib = typeof zalogaGibiTable.$inferSelect;
