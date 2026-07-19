import { pgTable, text, serial, integer, real, timestamp, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const napraveTable = pgTable("naprave", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull().default(""),
  napravaKljuc: text("naprava_kljuc").notNull(),
  placilniTerminal: text("placilni_terminal"),
  dovoljeneMize: integer("dovoljene_mize").array(),
  glasovniPragZaupanja: real("glasovni_prag_zaupanja"),
  nastavitveJson: text("nastavitve_json"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [unique("naprave_enota_kljuc_unique").on(t.enotaId, t.napravaKljuc)]);

export type Naprava = typeof napraveTable.$inferSelect;
export type InsertNaprava = typeof napraveTable.$inferInsert;
