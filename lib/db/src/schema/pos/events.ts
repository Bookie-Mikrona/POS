import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { enoteTable } from "./enote";
import { companiesTable } from "../companies";
import { artikliTable } from "./artikli";
import { posUporabnikiTable } from "./uporabniki";

export const POS_EVENT_STATUSES = ["planned", "active", "closed", "cancelled"] as const;
const POS_EVENT_STATUSES_SQL = sql.raw(POS_EVENT_STATUSES.map(status => `'${status}'`).join(", "));
export const POS_EVENT_TYPES = ["festival", "wedding", "catering", "celebration", "other"] as const;
const POS_EVENT_TYPES_SQL = sql.raw(POS_EVENT_TYPES.map(type => `'${type}'`).join(", "));
export const POS_STOCK_TRANSFER_DIRECTIONS = ["outbound", "return"] as const;
const POS_STOCK_TRANSFER_DIRECTIONS_SQL = sql.raw(
  POS_STOCK_TRANSFER_DIRECTIONS.map(direction => `'${direction}'`).join(", "),
);
export const POS_STOCK_TRANSFER_STATUSES = ["draft", "completed", "cancelled"] as const;
const POS_STOCK_TRANSFER_STATUSES_SQL = sql.raw(
  POS_STOCK_TRANSFER_STATUSES.map(status => `'${status}'`).join(", "),
);

export const posEventsTable = pgTable("pos_events", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull(),
  name: text("name").notNull(),
  type: text("type", { enum: POS_EVENT_TYPES }).notNull(),
  status: text("status", { enum: POS_EVENT_STATUSES }).notNull().default("planned"),
  location: text("location").notNull(),
  customerName: text("customer_name"),
  customerContact: text("customer_contact"),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  endsAt: timestamp("ends_at", { withTimezone: true }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("pos_events_id_company_unique").on(t.id, t.companyId),
  unique("pos_events_id_company_unit_unique").on(t.id, t.companyId, t.enotaId),
  foreignKey({
    columns: [t.enotaId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_events_unit_company_fk",
  }).onDelete("cascade"),
  index("ix_pos_events_unit_start").on(t.enotaId, t.startsAt),
  index("ix_pos_events_status").on(t.status),
  check("pos_events_type_check", sql`${t.type} IN (${POS_EVENT_TYPES_SQL})`),
  check("pos_events_status_check", sql`${t.status} IN (${POS_EVENT_STATUSES_SQL})`),
]);

export const posEventUnitsTable = pgTable("pos_event_units", {
  companyId: uuid("company_id").notNull(),
  eventId: integer("event_id").notNull(),
  enotaId: integer("enota_id").notNull(),
}, (t) => [
  primaryKey({ columns: [t.companyId, t.eventId, t.enotaId] }),
  foreignKey({
    columns: [t.eventId, t.companyId],
    foreignColumns: [posEventsTable.id, posEventsTable.companyId],
    name: "pos_event_units_event_company_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.enotaId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_event_units_unit_company_fk",
  }).onDelete("cascade"),
  index("ix_pos_event_units_unit").on(t.enotaId),
]);

export const posEventMenuItemsTable = pgTable("pos_event_menu_items", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  eventId: integer("event_id").notNull(),
  sourceUnitId: integer("source_unit_id").notNull(),
  targetUnitId: integer("target_unit_id").notNull(),
  sourceArticleId: integer("source_article_id").notNull(),
  targetArticleId: integer("target_article_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.eventId, t.companyId, t.sourceUnitId],
    foreignColumns: [posEventsTable.id, posEventsTable.companyId, posEventsTable.enotaId],
    name: "pos_event_menu_event_source_unit_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.targetUnitId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_event_menu_target_unit_company_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.sourceArticleId, t.sourceUnitId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pos_event_menu_source_article_unit_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.targetArticleId, t.targetUnitId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pos_event_menu_target_article_unit_fk",
  }).onDelete("restrict"),
  uniqueIndex("ux_pos_event_menu_source").on(t.companyId, t.eventId, t.targetUnitId, t.sourceArticleId),
  uniqueIndex("ux_pos_event_menu_target").on(t.companyId, t.eventId, t.targetUnitId, t.targetArticleId),
]);

export const posEventStaffGrantsTable = pgTable("pos_event_staff_grants", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  eventId: integer("event_id").notNull(),
  posUserId: integer("pos_user_id").notNull(),
  unitId: integer("unit_id").notNull(),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validTo: timestamp("valid_to", { withTimezone: true }).notNull(),
  revoked: boolean("revoked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  foreignKey({
    columns: [t.eventId, t.companyId],
    foreignColumns: [posEventsTable.id, posEventsTable.companyId],
    name: "pos_event_staff_event_company_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.posUserId, t.companyId],
    foreignColumns: [posUporabnikiTable.id, posUporabnikiTable.companyId],
    name: "pos_event_staff_user_company_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.unitId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_event_staff_unit_company_fk",
  }).onDelete("cascade"),
  uniqueIndex("ux_pos_event_staff_grant").on(t.companyId, t.eventId, t.posUserId, t.unitId),
  index("ix_pos_event_staff_active").on(t.posUserId, t.unitId, t.validFrom, t.validTo),
  check("pos_event_staff_period_order_check", sql`${t.validTo} > ${t.validFrom}`),
]);

export const posStockTransfersTable = pgTable("pos_stock_transfers", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "restrict" }),
  eventId: integer("event_id").notNull(),
  sourceUnitId: integer("source_unit_id").notNull(),
  targetUnitId: integer("target_unit_id").notNull(),
  direction: text("direction", { enum: POS_STOCK_TRANSFER_DIRECTIONS }).notNull(),
  status: text("status", { enum: POS_STOCK_TRANSFER_STATUSES }).notNull().default("draft"),
  returnOfId: integer("return_of_id"),
  createdBy: text("created_by").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("pos_stock_transfers_id_scope_unique").on(t.id, t.companyId, t.sourceUnitId, t.targetUnitId),
  unique("pos_stock_transfers_id_company_unique").on(t.id, t.companyId),
  foreignKey({
    columns: [t.eventId, t.companyId],
    foreignColumns: [posEventsTable.id, posEventsTable.companyId],
    name: "pos_stock_transfers_event_company_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.sourceUnitId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_stock_transfers_source_unit_company_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.targetUnitId, t.companyId],
    foreignColumns: [enoteTable.id, enoteTable.companyId],
    name: "pos_stock_transfers_target_unit_company_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.returnOfId, t.companyId],
    foreignColumns: [t.id, t.companyId],
    name: "pos_stock_transfers_return_company_fk",
  }).onDelete("restrict"),
  uniqueIndex("ux_pos_stock_transfer_event_units_direction").on(
    t.companyId,
    t.eventId,
    t.sourceUnitId,
    t.targetUnitId,
    t.direction,
  ),
  check(
    "pos_stock_transfers_direction_check",
    sql`${t.direction} IN (${POS_STOCK_TRANSFER_DIRECTIONS_SQL})`,
  ),
  check(
    "pos_stock_transfers_status_check",
    sql`${t.status} IN (${POS_STOCK_TRANSFER_STATUSES_SQL})`,
  ),
  check(
    "pos_stock_transfers_completion_check",
    sql`(
      (${t.status} = 'completed' AND ${t.completedAt} IS NOT NULL)
      OR (${t.status} <> 'completed' AND ${t.completedAt} IS NULL)
    )`,
  ),
]);

export const posStockTransferLinesTable = pgTable("pos_stock_transfer_lines", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull(),
  transferId: integer("transfer_id").notNull(),
  sourceUnitId: integer("source_unit_id").notNull(),
  targetUnitId: integer("target_unit_id").notNull(),
  sourceArticleId: integer("source_article_id").notNull(),
  targetArticleId: integer("target_article_id").notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  unitCost: numeric("unit_cost", { precision: 14, scale: 6 }).notNull(),
}, (t) => [
  foreignKey({
    columns: [t.transferId, t.companyId, t.sourceUnitId, t.targetUnitId],
    foreignColumns: [
      posStockTransfersTable.id,
      posStockTransfersTable.companyId,
      posStockTransfersTable.sourceUnitId,
      posStockTransfersTable.targetUnitId,
    ],
    name: "pos_stock_transfer_lines_transfer_scope_fk",
  }).onDelete("cascade"),
  foreignKey({
    columns: [t.sourceArticleId, t.sourceUnitId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pos_stock_transfer_lines_source_article_unit_fk",
  }).onDelete("restrict"),
  foreignKey({
    columns: [t.targetArticleId, t.targetUnitId],
    foreignColumns: [artikliTable.id, artikliTable.enotaId],
    name: "pos_stock_transfer_lines_target_article_unit_fk",
  }).onDelete("restrict"),
  uniqueIndex("ux_pos_stock_transfer_line").on(t.companyId, t.transferId, t.sourceArticleId),
]);

export type PosEvent = typeof posEventsTable.$inferSelect;
export type InsertPosEvent = typeof posEventsTable.$inferInsert;