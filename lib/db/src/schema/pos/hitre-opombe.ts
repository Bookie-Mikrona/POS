import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { kategorijeTable } from "./kategorije";

/** Vnaprej pripravljeni gumbi za opombe na postavki naročila. Prazna kategorija pomeni vse kategorije. */
export const hitreOpombeTable = pgTable("hitre_opombe", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  kategorijaId: integer("kategorija_id").references(() => kategorijeTable.id, { onDelete: "cascade" }),
  besedilo: text("besedilo").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type HitraOpomba = typeof hitreOpombeTable.$inferSelect;
