import { pgTable, serial, integer, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";

export const zalogeTable = pgTable("zaloge", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().unique().references(() => artikliTable.id, { onDelete: "cascade" }),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull().default("0"),
  zadnjaPosodobitev: timestamp("zadnja_posodobitev").notNull().defaultNow(),
});

export const zalogaGibiTable = pgTable("zaloga_gibi", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  tip: text("tip").notNull(), // 'prejemnica' | 'inventura' | 'poraba' | 'storno'
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
  opomba: text("opomba"),
  referencaId: integer("referenca_id"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
});

export type Zaloga = typeof zalogeTable.$inferSelect;
export type ZalogaGib = typeof zalogaGibiTable.$inferSelect;
