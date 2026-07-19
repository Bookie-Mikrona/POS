import { pgTable, text, serial, integer } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const prostoriTable = pgTable("prostori", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  vrstniRed: integer("vrstni_red").notNull().default(0),
});

export type Prostor = typeof prostoriTable.$inferSelect;
