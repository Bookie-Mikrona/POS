import { pgTable, text, serial, integer, boolean, timestamp, uuid, unique } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { enoteTable } from "./enote";

/**
 * POS uporabniki — Clerk računi z vlogo v POS sistemu.
 * Hierarhija: superadmin (env) > admin (podjetje) > admin_enote (ena enota) > uporabnik (ena enota)
 * companyId je vedno obvezen; enotaId je obvezen za admin_enote in uporabnik, null za admin.
 */
export const posUporabnikiTable = pgTable("pos_uporabniki", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id")
    .references(() => enoteTable.id, { onDelete: "cascade" }),
  vloga: text("vloga").notNull(), // "admin" | "admin_enote" | "uporabnik"
  ime: text("ime").notNull(),
  priimek: text("priimek").notNull(),
  aktiven: boolean("aktiven").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("pos_uporabniki_clerk_company_unique").on(t.clerkUserId, t.companyId),
]);

export type PosUporabnik = typeof posUporabnikiTable.$inferSelect;
export type InsertPosUporabnik = typeof posUporabnikiTable.$inferInsert;
