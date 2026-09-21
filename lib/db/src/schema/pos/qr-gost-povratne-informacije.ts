import { check, integer, jsonb, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { enoteTable } from "./enote";
import { narocilaTable } from "./narocila";

/**
 * One consented, immutable guest assessment for an accepted QR order.
 *
 * Device ownership is verified against the order before insertion. The
 * feedback row deliberately does not retain the pseudonymous QR device token.
 */
export const qrGostPovratneInformacijeTable = pgTable("qr_gost_povratne_informacije", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "restrict" }),
  hranaOcena: integer("hrana_ocena").notNull(),
  ambientOcena: integer("ambient_ocena").notNull(),
  storitevOcena: integer("storitev_ocena").notNull(),
  /** Map of order-line IDs to a 1–5 score; ownership is checked at the API boundary. */
  ocenePostavk: jsonb("ocene_postavk").$type<Record<string, number>>(),
  komentar: text("komentar"),
  consentVersion: text("consent_version").notNull(),
  consentedAt: timestamp("consented_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_qr_gost_povratne_informacije_narocilo").on(t.narociloId),
  check("qr_gost_povratne_informacije_hrana_ocena_check", sql`${t.hranaOcena} BETWEEN 1 AND 5`),
  check("qr_gost_povratne_informacije_ambient_ocena_check", sql`${t.ambientOcena} BETWEEN 1 AND 5`),
  check("qr_gost_povratne_informacije_storitev_ocena_check", sql`${t.storitevOcena} BETWEEN 1 AND 5`),
]);

export const insertQrGostPovratnaInformacijaSchema = createInsertSchema(qrGostPovratneInformacijeTable)
  .omit({ id: true, createdAt: true })
  .extend({
    hranaOcena: z.number().int().min(1).max(5),
    ambientOcena: z.number().int().min(1).max(5),
    storitevOcena: z.number().int().min(1).max(5),
    ocenePostavk: z.record(z.string(), z.number().int().min(1).max(5)).optional(),
    komentar: z.string().max(2_000).optional(),
    consentVersion: z.string().min(1).max(100),
  });

export type InsertQrGostPovratnaInformacija = z.infer<typeof insertQrGostPovratnaInformacijaSchema>;
export type QrGostPovratnaInformacija = typeof qrGostPovratneInformacijeTable.$inferSelect;