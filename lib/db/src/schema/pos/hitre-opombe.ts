import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { kategorijeTable } from "./kategorije";
import { artikliTable } from "./artikli";

/** Vnaprej pripravljeni gumbi za opombe na postavki naročila. Gumb z artiklom velja samo za ta artikel; brez artikla in kategorije je zastarel splošni zapis. */
export const hitreOpombeTable = pgTable("hitre_opombe", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  kategorijaId: integer("kategorija_id").references(() => kategorijeTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").references(() => artikliTable.id, { onDelete: "cascade" }),
  besedilo: text("besedilo").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type HitraOpomba = typeof hitreOpombeTable.$inferSelect;
