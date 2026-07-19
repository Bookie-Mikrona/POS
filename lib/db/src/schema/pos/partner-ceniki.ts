import { pgTable, serial, integer, numeric, text, timestamp, unique } from "drizzle-orm/pg-core";
import { shranjeniKupciTable } from "./shranjeni-kupci";
import { artikliTable } from "./artikli";

export const partnerCenikiTable = pgTable("partner_ceniki", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull(),
  kupecId: integer("kupec_id").notNull().references(() => shranjeniKupciTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  cena: numeric("cena", { precision: 10, scale: 2 }).notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("partner_ceniki_kupec_artikel_uq").on(t.kupecId, t.artikelId)]);

export type PartnerCenikVrstica = typeof partnerCenikiTable.$inferSelect;
