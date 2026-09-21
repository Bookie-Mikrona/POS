import { pgTable, serial, integer, numeric, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { counterpartiesTable } from "../counterparties";
import { artikliTable } from "./artikli";

export const partnerCenikiTable = pgTable("partner_ceniki", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull(),
  kupecId: uuid("kupec_id").notNull().references(() => counterpartiesTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  cena: numeric("cena", { precision: 10, scale: 2 }).notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("partner_ceniki_kupec_artikel_uq").on(t.kupecId, t.artikelId)]);

export type PartnerCenikVrstica = typeof partnerCenikiTable.$inferSelect;
