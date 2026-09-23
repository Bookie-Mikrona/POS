import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";
import { counterpartiesTable } from "../counterparties";
import { postavkeTable } from "./narocila";

export const malicaGroupsTable = pgTable("malica_groups", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  code: text("code").notNull(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("malica_groups_enota_code_uq").on(t.enotaId, t.code),
  unique("malica_groups_enota_order_uq").on(t.enotaId, t.sortOrder),
]);

export const malicaGroupPricesTable = pgTable("malica_group_prices", {
  id: serial("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => malicaGroupsTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  priceCents: integer("price_cents").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
  status: text("status", { enum: ["draft", "scheduled", "active", "past"] }).notNull().default("scheduled"),
  reason: text("reason"),
  createdBy: text("created_by"),
  confirmedBy: text("confirmed_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
}, (t) => [
  index("ix_malica_group_prices_lookup").on(t.enotaId, t.groupId, t.validFrom),
]);

export const malicaArticleAssignmentsTable = pgTable("malica_article_assignments", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").references(() => malicaGroupsTable.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["none", "main", "soup", "dessert"] }).notNull(),
  malicaPriceCents: integer("malica_price_cents"),
  autoSyncPrice: boolean("auto_sync_price").notNull().default(true),
  validFrom: date("valid_from", { mode: "string" }),
  validTo: date("valid_to", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("malica_article_assignments_unit_article_uq").on(t.enotaId, t.artikelId),
  index("ix_malica_article_assignments_role").on(t.enotaId, t.role, t.groupId),
]);

export const malicaDailyOffersTable = pgTable("malica_daily_offers", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  businessDate: date("business_date", { mode: "string" }).notNull(),
  status: text("status", { enum: ["draft", "published", "closed"] }).notNull().default("draft"),
  version: integer("version").notNull().default(1),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  publishedBy: text("published_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("malica_daily_offers_unit_date_version_uq").on(t.enotaId, t.businessDate, t.version),
  index("ix_malica_daily_offers_unit_date").on(t.enotaId, t.businessDate),
]);

export const malicaDailyMainItemsTable = pgTable("malica_daily_main_items", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => malicaDailyOffersTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => malicaGroupsTable.id, { onDelete: "restrict" }),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  position: integer("position").notNull().default(0),
  enabled: boolean("enabled").notNull().default(true),
  articleNameSnapshot: text("article_name_snapshot").notNull(),
  priceCentsSnapshot: integer("price_cents_snapshot").notNull(),
  availableQuantity: numeric("available_quantity", { precision: 14, scale: 4 }),
}, (t) => [
  unique("malica_daily_main_items_offer_article_uq").on(t.offerId, t.artikelId),
  index("ix_malica_daily_main_items_offer_group").on(t.offerId, t.groupId),
]);

export const malicaDailyIncludedCoursesTable = pgTable("malica_daily_included_courses", {
  id: serial("id").primaryKey(),
  offerId: integer("offer_id").notNull().references(() => malicaDailyOffersTable.id, { onDelete: "cascade" }),
  courseType: text("course_type", { enum: ["soup", "dessert"] }).notNull(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  articleNameSnapshot: text("article_name_snapshot").notNull(),
  quantity: numeric("quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  reservedQuantity: numeric("reserved_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  consumedQuantity: numeric("consumed_quantity", { precision: 14, scale: 4 }).notNull().default("0"),
  enabled: boolean("enabled").notNull().default(true),
}, (t) => [
  unique("malica_daily_courses_offer_type_article_uq").on(t.offerId, t.courseType, t.artikelId),
  index("ix_malica_daily_courses_offer_type").on(t.offerId, t.courseType),
]);

export const malicaPartnerGroupPricesTable = pgTable("malica_partner_group_prices", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  kupecId: uuid("kupec_id").notNull().references(() => counterpartiesTable.id, { onDelete: "cascade" }),
  groupId: integer("group_id").notNull().references(() => malicaGroupsTable.id, { onDelete: "cascade" }),
  priceCents: integer("price_cents").notNull(),
  validFrom: date("valid_from", { mode: "string" }).notNull(),
  validTo: date("valid_to", { mode: "string" }),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("malica_partner_group_prices_uq").on(t.enotaId, t.kupecId, t.groupId, t.validFrom),
  index("ix_malica_partner_group_prices_lookup").on(t.enotaId, t.kupecId, t.groupId),
]);

export const malicaSaleSnapshotsTable = pgTable("malica_sale_snapshots", {
  id: serial("id").primaryKey(),
  postavkaId: integer("postavka_id").notNull().references(() => postavkeTable.id, { onDelete: "cascade" }),
  offerId: integer("offer_id").notNull().references(() => malicaDailyOffersTable.id, { onDelete: "restrict" }),
  offerVersion: integer("offer_version").notNull(),
  groupId: integer("group_id").notNull().references(() => malicaGroupsTable.id, { onDelete: "restrict" }),
  regularPriceCents: integer("regular_price_cents").notNull(),
  actualPriceCents: integer("actual_price_cents").notNull(),
  priceSource: text("price_source", { enum: ["regular", "partner"] }).notNull(),
  partnerId: uuid("partner_id").references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  mainItemId: integer("main_item_id").notNull().references(() => malicaDailyMainItemsTable.id, { onDelete: "restrict" }),
  soupId: integer("soup_id").references(() => malicaDailyIncludedCoursesTable.id, { onDelete: "restrict" }),
  dessertId: integer("dessert_id").references(() => malicaDailyIncludedCoursesTable.id, { onDelete: "restrict" }),
  selectedCourseIds: jsonb("selected_course_ids").$type<number[]>().notNull().default([]),
  extraCourseIds: jsonb("extra_course_ids").$type<number[]>().notNull().default([]),
  contractId: integer("contract_id"),
  contractVersion: integer("contract_version"),
  regularGrossCents: integer("regular_gross_cents"),
  partnerCoveredCents: integer("partner_covered_cents"),
  guestPayableCents: integer("guest_payable_cents"),
  surchargeCents: integer("surcharge_cents").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("malica_sale_snapshots_postavka_uq").on(t.postavkaId),
]);

export type MalicaGroup = typeof malicaGroupsTable.$inferSelect;
export type MalicaGroupPrice = typeof malicaGroupPricesTable.$inferSelect;
export type MalicaArticleAssignment = typeof malicaArticleAssignmentsTable.$inferSelect;
export type MalicaDailyOffer = typeof malicaDailyOffersTable.$inferSelect;
export type MalicaDailyMainItem = typeof malicaDailyMainItemsTable.$inferSelect;
export type MalicaDailyIncludedCourse = typeof malicaDailyIncludedCoursesTable.$inferSelect;
export type MalicaPartnerGroupPrice = typeof malicaPartnerGroupPricesTable.$inferSelect;
export type MalicaSaleSnapshot = typeof malicaSaleSnapshotsTable.$inferSelect;