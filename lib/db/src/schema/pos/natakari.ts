import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

/**
 * Natakari / blagajniki — POS osebje.
 * clerkUserId je opcijski: poveže natakarja s Clerk računom (za prijavo z Clerk).
 */
export const natakariTable = pgTable("natakari", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id"), // opcijski — poveže s Clerk uporabniškim računom
  ime: text("ime").notNull(),
  priimek: text("priimek").notNull(),
  davcnaStevilka: text("davcna_stevilka"),
  aktiven: boolean("aktiven").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type Natakar = typeof natakariTable.$inferSelect;
export type InsertNatakar = typeof natakariTable.$inferInsert;
