import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const glasovniSinonimiTable = pgTable("glasovni_sinonimi", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  beseda: text("beseda").notNull(),
  alias: text("alias").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type GlasovniSinonim = typeof glasovniSinonimiTable.$inferSelect;
