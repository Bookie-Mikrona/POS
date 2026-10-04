import {
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";

/**
 * Operativna zaloga zamrznjenih porcij pripravljenih jedi. Ni računovodska
 * zaloga in zato nima neposredne povezave s temeljnicami. En zapis predstavlja
 * stanje posamezne jedi na lokaciji v poslovnem letu.
 */
export const preparedFoodStocksTable = pgTable("prepared_food_stocks", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id")
    .notNull()
    .references(() => enoteTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id")
    .notNull()
    .references(() => artikliTable.id, { onDelete: "restrict" }),
  year: integer("year").notNull(),
  openingQuantity: numeric("opening_quantity", { precision: 14, scale: 4 })
    .notNull()
    .default("0"),
  openingCostPerPortion: numeric("opening_cost_per_portion", { precision: 14, scale: 6 })
    .notNull()
    .default("0"),
  frozenQuantity: numeric("frozen_quantity", { precision: 14, scale: 4 })
    .notNull()
    .default("0"),
  frozenCostPerPortion: numeric("frozen_cost_per_portion", { precision: 14, scale: 6 })
    .notNull()
    .default("0"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_prepared_food_stocks_enota_article_year").on(t.enotaId, t.artikelId, t.year),
]);

/**
 * Dnevna evidenca pripravljenih jedi. Stroškovna polja so ob zaključku
 * zamrznjena, da kasnejše spremembe WAC sestavin ne spremenijo zgodovine.
 */
export const preparedFoodDailyLedgersTable = pgTable("prepared_food_daily_ledgers", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id")
    .notNull()
    .references(() => enoteTable.id, { onDelete: "cascade" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  artikelId: integer("artikel_id")
    .notNull()
    .references(() => artikliTable.id, { onDelete: "restrict" }),
  thawedQuantity: numeric("thawed_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  preparedQuantity: numeric("prepared_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  preparationBatches: jsonb("preparation_batches").$type<Array<{ batchCount: number; piecesPerBatch: number }> | null>(),
  normativeBatchPieces: integer("normative_batch_pieces"),
  preparationRecipeSnapshot: jsonb("preparation_recipe_snapshot").$type<Array<{ ingredientId: number; quantity: string }> | null>(),
  /** Korekcija računalniške količine na dejansko količino v posodi. */
  correctionQuantity: numeric("correction_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  /** Izračunana količina prodanih vrhnjih postavk; ni uporabniški vnos. */
  soldQuantity: numeric("sold_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  frozenAtEndQuantity: numeric("frozen_at_end_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  /** Izračunano: thawed + prepared + correction - sold - frozenAtEnd. */
  wasteQuantity: numeric("waste_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  wasteDeliveredQuantity: numeric("waste_delivered_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  thawedCostPerPortion: numeric("thawed_cost_per_portion", { precision: 14, scale: 6 }),
  preparedCostPerPortion: numeric("prepared_cost_per_portion", { precision: 14, scale: 6 }),
  wasteValue: numeric("waste_value", { precision: 14, scale: 4 }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_prepared_food_daily_ledger").on(t.enotaId, t.businessDate, t.artikelId),
  index("ix_prepared_food_daily_ledger_date").on(t.enotaId, t.businessDate),
  check(
    "prepared_food_daily_delivered_quantity_check",
    sql`${t.wasteDeliveredQuantity} >= 0 AND ${t.wasteDeliveredQuantity} <= ${t.wasteQuantity}`,
  ),
]);

export const preparedFoodWasteRecordsTable = pgTable("prepared_food_waste_records", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "restrict" }),
  recordNumber: integer("record_number").notNull(),
  companyName: text("company_name").notNull(),
  businessUnitName: text("business_unit_name").notNull(),
  recordDate: date("record_date", { mode: "string" }).notNull(),
  periodFrom: date("period_from", { mode: "string" }).notNull(),
  periodTo: date("period_to", { mode: "string" }).notNull(),
  wasteObservedAt: timestamp("waste_observed_at", { withTimezone: true }).notNull(),
  disposalReason: text("disposal_reason").notNull(),
  signaturePerson: text("signature_person").notNull(),
  signatureManager: text("signature_manager").notNull(),
  status: text("status", { enum: ["osnutek", "potrjen"] }).notNull().default("osnutek"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_prepared_food_waste_records_enota_number").on(t.enotaId, t.recordNumber),
  index("ix_prepared_food_waste_records_enota_period").on(t.enotaId, t.periodFrom, t.periodTo),
]);

export const preparedFoodWasteRecordLinesTable = pgTable("prepared_food_waste_record_lines", {
  id: serial("id").primaryKey(),
  recordId: integer("record_id").notNull().references(() => preparedFoodWasteRecordsTable.id, { onDelete: "cascade" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  articleName: text("article_name").notNull(),
  unitOfMeasure: text("unit_of_measure").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull(),
  /** Nabavna/lastna cena ene enote v trenutku zajema zapisnika. */
  costPerUnit: numeric("cost_per_unit", { precision: 14, scale: 6 }).notNull().default("0"),
  /** Vrednost konkretne količine odpisa v trenutku zajema zapisnika. */
  totalValue: numeric("total_value", { precision: 14, scale: 4 }).notNull().default("0"),
}, (t) => [
  uniqueIndex("ux_prepared_food_waste_record_line").on(t.recordId, t.businessDate, t.artikelId),
  index("ix_prepared_food_waste_record_lines_record").on(t.recordId),
]);

export type PreparedFoodStock = typeof preparedFoodStocksTable.$inferSelect;
export type InsertPreparedFoodStock = typeof preparedFoodStocksTable.$inferInsert;
export type PreparedFoodDailyLedger = typeof preparedFoodDailyLedgersTable.$inferSelect;
export type InsertPreparedFoodDailyLedger = typeof preparedFoodDailyLedgersTable.$inferInsert;
export type PreparedFoodWasteRecord = typeof preparedFoodWasteRecordsTable.$inferSelect;
export type InsertPreparedFoodWasteRecord = typeof preparedFoodWasteRecordsTable.$inferInsert;
export type PreparedFoodWasteRecordLine = typeof preparedFoodWasteRecordLinesTable.$inferSelect;
export type InsertPreparedFoodWasteRecordLine = typeof preparedFoodWasteRecordLinesTable.$inferInsert;