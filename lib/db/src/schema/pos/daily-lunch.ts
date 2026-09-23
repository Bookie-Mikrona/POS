import { date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";
import { narocilaTable, postavkeTable } from "./narocila";

export type DailyLunchMode = "three_course" | "four_course";
export type DailyLunchRole = "starter" | "soup" | "main" | "dessert";

export const dailyLunchOffersTable = pgTable("daily_lunch_offers", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  businessDate: date("business_date").notNull(),
  status: text("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
  baseFlatAmount: numeric("base_flat_amount", { precision: 10, scale: 2 }).notNull().default("8.00"),
  starterFlatAmount: numeric("starter_flat_amount", { precision: 10, scale: 2 }).notNull().default("10.00"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ix_daily_lunch_offers_unit_date_status").on(t.enotaId, t.businessDate, t.status),
  unique("daily_lunch_offers_unit_date_unique").on(t.enotaId, t.businessDate),
]);

export const dailyLunchOfferChoicesTable = pgTable("daily_lunch_offer_choices", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => dailyLunchOffersTable.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["starter", "soup", "main", "dessert"] }).notNull(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  sortOrder: integer("sort_order").notNull().default(0),
}, (t) => [unique("daily_lunch_offer_choices_unique").on(t.offerId, t.role, t.artikelId)]);

export const dailyLunchSaleSnapshotsTable = pgTable("daily_lunch_sale_snapshots", {
  id: serial("id").primaryKey(),
  postavkaId: integer("postavka_id").notNull().references(() => postavkeTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  offerId: integer("offer_id").notNull().references(() => dailyLunchOffersTable.id, { onDelete: "restrict" }),
  businessDate: date("business_date").notNull(),
  mode: text("mode", { enum: ["three_course", "four_course"] }).notNull(),
  selectedDishes: jsonb("selected_dishes").notNull(),
  mainLivePrice: numeric("main_live_price", { precision: 10, scale: 2 }).notNull(),
  baseFlatAmount: numeric("base_flat_amount", { precision: 10, scale: 2 }).notNull(),
  starterFlatAmount: numeric("starter_flat_amount", { precision: 10, scale: 2 }).notNull(),
  total: numeric("total", { precision: 10, scale: 2 }).notNull(),
  vatRequirements: jsonb("vat_requirements").notNull(),
  availabilityRequirements: jsonb("availability_requirements").notNull(),
  pairingGroupId: text("pairing_group_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("daily_lunch_sale_snapshots_postavka_unique").on(t.postavkaId),
  index("ix_daily_lunch_snapshots_business_date").on(t.businessDate),
]);