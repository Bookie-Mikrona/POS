import { pgTable, text, serial, uuid, boolean, timestamp } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";

/**
 * Natakari / blagajniki — POS osebje.
 * Vezani so na podjetje (company), NE na posamezno enoto.
 * Natakar, ki je dodan v katerikoli enoti, je na voljo za delo v vseh enotah podjetja.
 * clerkUserId je opcijski: poveže natakarja s Clerk računom (za prijavo z Clerk).
 */
export const natakariTable = pgTable("natakari", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  clerkUserId: text("clerk_user_id"), // opcijski — poveže s Clerk uporabniškim računom
  ime: text("ime").notNull(),
  priimek: text("priimek").notNull(),
  davcnaStevilka: text("davcna_stevilka"),
  aktiven: boolean("aktiven").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export type Natakar = typeof natakariTable.$inferSelect;
export type InsertNatakar = typeof natakariTable.$inferInsert;
