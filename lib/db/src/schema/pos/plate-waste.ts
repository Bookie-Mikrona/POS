import {
  check,
  date,
  index,
  integer,
  type AnyPgColumn,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { enoteTable } from "./enote";

/**
 * Interna evidenca ostankov hrane s krožnikov.
 *
 * Namenoma nima povezave z artikli, normativi, naročili ali zalogami. Količina
 * je masa odpadka v kilogramih in predstavlja samostojen okoljski zapis.
 */
export const plateWasteDailyEntriesTable = pgTable("plate_waste_daily_entries", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  quantityKg: numeric("quantity_kg", { precision: 14, scale: 3 }).notNull().default("0"),
  note: text("note").notNull().default(""),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_plate_waste_daily_entries_enota_date").on(t.enotaId, t.businessDate),
  index("ix_plate_waste_daily_entries_enota_date").on(t.enotaId, t.businessDate),
  check("plate_waste_daily_entries_quantity_check", sql`${t.quantityKg} >= 0`),
]);

/**
 * Oddaje in sledljivi popravki oddaj. Zapisi so nespremenljivi: popravek se
 * vnese kot nova vrstica z entryType=popravek in morebitno povezavo na izvirnik.
 */
export const plateWasteHandoversTable = pgTable("plate_waste_handovers", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  handoverDate: date("handover_date", { mode: "string" }).notNull(),
  entryType: text("entry_type", { enum: ["oddaja", "popravek"] }).notNull().default("oddaja"),
  quantityKg: numeric("quantity_kg", { precision: 14, scale: 3 }).notNull(),
  collectorName: text("collector_name").notNull(),
  manifestNumber: text("manifest_number").notNull().default(""),
  note: text("note").notNull().default(""),
  correctionOfId: integer("correction_of_id")
    .references((): AnyPgColumn => plateWasteHandoversTable.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ix_plate_waste_handovers_enota_date").on(t.enotaId, t.handoverDate),
  check(
    "plate_waste_handovers_quantity_check",
    sql`(${t.entryType} = 'oddaja' AND ${t.quantityKg} > 0) OR (${t.entryType} = 'popravek' AND ${t.quantityKg} <> 0)`,
  ),
  check(
    "plate_waste_handovers_correction_reference_check",
    sql`(${t.entryType} = 'oddaja' AND ${t.correctionOfId} IS NULL) OR (${t.entryType} = 'popravek' AND ${t.correctionOfId} IS NOT NULL)`,
  ),
]);

export type PlateWasteDailyEntry = typeof plateWasteDailyEntriesTable.$inferSelect;
export type InsertPlateWasteDailyEntry = typeof plateWasteDailyEntriesTable.$inferInsert;
export type PlateWasteHandover = typeof plateWasteHandoversTable.$inferSelect;
export type InsertPlateWasteHandover = typeof plateWasteHandoversTable.$inferInsert;