import { pgTable, serial, integer, numeric, timestamp, text } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { natakariTable } from "./natakari";

export const izmeneTable = pgTable("izmene", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  natakariId: integer("natakari_id").notNull().references(() => natakariTable.id),
  zacetek: timestamp("zacetek", { withTimezone: true }).notNull().defaultNow(),
  konec: timestamp("konec", { withTimezone: true }),
  skupajZnesek: numeric("skupaj_znesek", { precision: 10, scale: 2 }).notNull().default("0"),
  steviloRacunov: integer("stevilo_racunov").notNull().default(0),
});

export const izmeneRelations = relations(izmeneTable, ({ one }) => ({
  natakar: one(natakariTable, { fields: [izmeneTable.natakariId], references: [natakariTable.id] }),
}));

export type Izmena = typeof izmeneTable.$inferSelect;
