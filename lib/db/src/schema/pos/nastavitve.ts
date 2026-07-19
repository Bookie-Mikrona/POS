import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const nastavitveTable = pgTable("nastavitve", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  kljuc: text("kljuc").notNull(),
  vrednost: text("vrednost").notNull(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [unique("nastavitve_enota_kljuc_unique").on(t.enotaId, t.kljuc)]);

export type Nastavitev = typeof nastavitveTable.$inferSelect;
export type InsertNastavitev = typeof nastavitveTable.$inferInsert;
