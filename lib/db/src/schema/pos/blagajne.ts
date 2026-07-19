import { pgTable, serial, text, boolean, timestamp, integer } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const blagajneTable = pgTable("blagajne", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ppId: text("pp_id").notNull(),
  bId: text("b_id").notNull(),
  ime: text("ime").notNull(),
  aktivna: boolean("aktivna").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type Blagajna = typeof blagajneTable.$inferSelect;
