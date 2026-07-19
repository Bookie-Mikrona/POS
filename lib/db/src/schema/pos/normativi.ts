import { pgTable, serial, integer, numeric } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";

export const normativiTable = pgTable("normativi", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  vhodniArtikelId: integer("vhodni_artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull(),
  vrstniRed: integer("vrstni_red").notNull().default(0),
});

export type Normativ = typeof normativiTable.$inferSelect;
