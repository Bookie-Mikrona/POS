import { pgTable, text, serial, integer, date, uniqueIndex } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";
import { modifikatorjiTable } from "./modifikatorji";

export const dnevniMeniTable = pgTable(
  "dnevni_meni",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
    datum: date("datum").notNull(),
    artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
    modifikatorId: integer("modifikator_id").notNull().references(() => modifikatorjiTable.id, { onDelete: "cascade" }),
  },
  (t) => [uniqueIndex("dnevni_meni_unique").on(t.enotaId, t.datum, t.artikelId, t.modifikatorId)]
);

export type DnevniMeniVnos = typeof dnevniMeniTable.$inferSelect;
