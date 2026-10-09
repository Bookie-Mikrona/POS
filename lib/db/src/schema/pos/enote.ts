import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";

export const HOSPITALITY_PROFILES = [
  "restaurant", "inn", "fine_dining", "self_service", "fast_food", "bar",
  "cafe_pastry", "tourist_farm", "festival_society", "event_stall",
  "catering_celebrations", "food_truck", "hotel_food_service",
] as const;

export const UNIT_CAPABILITIES = [
  "tables", "checkout", "shifts", "receipts", "kitchen", "bar",
  "prepared_food", "plate_waste", "menu", "inventory", "statistics",
  "operational_reports", "realization", "journals", "cash_movements",
  "hours", "simulation", "settings", "reservations", "delivery",
  "phone_orders", "qr_menu", "multi_course", "self_service",
  "events", "stock_transfers", "deposits_tokens",
] as const;

export const SERVICE_MODES = [
  "table_service", "counter", "self_service", "mobile_event", "catering", "mixed",
] as const;

export type HospitalityProfile = (typeof HOSPITALITY_PROFILES)[number];
export type UnitCapability = (typeof UNIT_CAPABILITIES)[number];
export type ServiceMode = (typeof SERVICE_MODES)[number];

const COMMON_UNIT_CAPABILITIES: UnitCapability[] = [
  "checkout", "shifts", "receipts", "menu", "inventory", "statistics",
  "operational_reports", "realization", "journals", "cash_movements",
  "hours", "settings",
];

function unitProfileDefaults(
  capabilities: UnitCapability[],
  serviceMode: ServiceMode,
  temporary = false,
) {
  return {
    capabilities: [...new Set([...COMMON_UNIT_CAPABILITIES, ...capabilities])],
    serviceMode,
    temporary,
  };
}

/** Strežniško avtoritativne privzete vrednosti; profil je predloga, ne trajna omejitev. */
export const HOSPITALITY_PROFILE_DEFAULTS: Record<
  HospitalityProfile,
  { capabilities: UnitCapability[]; serviceMode: ServiceMode; temporary: boolean }
> = {
  restaurant: unitProfileDefaults(["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "delivery", "phone_orders", "qr_menu"], "table_service"),
  inn: unitProfileDefaults(["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "events", "delivery", "phone_orders", "qr_menu"], "table_service"),
  fine_dining: unitProfileDefaults(["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "multi_course", "events"], "table_service"),
  self_service: unitProfileDefaults(["kitchen", "prepared_food", "plate_waste"], "self_service"),
  fast_food: unitProfileDefaults(["kitchen", "prepared_food", "delivery", "phone_orders", "qr_menu"], "counter"),
  bar: unitProfileDefaults(["tables", "bar", "qr_menu"], "mixed"),
  cafe_pastry: unitProfileDefaults(["tables", "bar", "prepared_food", "qr_menu", "phone_orders"], "table_service"),
  tourist_farm: unitProfileDefaults(["tables", "kitchen", "bar", "prepared_food", "reservations", "events", "multi_course"], "table_service"),
  festival_society: unitProfileDefaults(["kitchen", "bar", "events", "stock_transfers", "deposits_tokens"], "mobile_event", true),
  event_stall: unitProfileDefaults(["kitchen", "bar", "events", "stock_transfers", "deposits_tokens"], "mobile_event", true),
  catering_celebrations: unitProfileDefaults(["tables", "kitchen", "bar", "reservations", "multi_course", "events", "stock_transfers"], "catering"),
  food_truck: unitProfileDefaults(["kitchen", "prepared_food", "events", "stock_transfers"], "mobile_event"),
  hotel_food_service: unitProfileDefaults(["tables", "kitchen", "bar", "prepared_food", "plate_waste", "reservations", "events", "qr_menu"], "mixed"),
};

/**
 * Poslovne enote (lokacije) — podenota podjetja v POS sistemu.
 * Primer: veriga restavracij ima eno podjetje (company) z več enotami (enote).
 * companyId veže enoto na ERP podjetje.
 */
export const enoteTable = pgTable("enote", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  opis: text("opis"),
  aktiven: boolean("aktiven").notNull().default(true),
  hospitalityProfile: text("hospitality_profile")
    .$type<(typeof HOSPITALITY_PROFILES)[number]>()
    .notNull()
    .default("restaurant"),
  serviceMode: text("service_mode")
    .$type<(typeof SERVICE_MODES)[number]>()
    .notNull()
    .default("mixed"),
  capabilities: text("capabilities")
    .array()
    .$type<Array<(typeof UNIT_CAPABILITIES)[number]>>()
    .notNull()
    .default(sql`ARRAY[${sql.join(UNIT_CAPABILITIES.map(value => sql`${value}`), sql`, `)}]::text[]`),
  isTemporary: boolean("is_temporary").notNull().default(false),
  temporaryLocation: text("temporary_location"),
  parentUnitId: integer("parent_unit_id"),
  activeFrom: timestamp("active_from", { withTimezone: true }),
  activeTo: timestamp("active_to", { withTimezone: true }),
  ctiToken: text("cti_token"),
  zacetekDnevaUra: text("zacetek_dneva_ura").notNull().default("04:00"),
  /** Središče 50-metrskega območja, v katerem je dovoljeno aktivirati javni QR meni. */
  qrLatitude: numeric("qr_latitude", { precision: 9, scale: 6 }),
  qrLongitude: numeric("qr_longitude", { precision: 9, scale: 6 }),
  /** Javni IP-ji/CIDR lokalnega Wi-Fi-ja za rezervno aktivacijo brez GPS signala. */
  qrWifiNetworks: text("qr_wifi_networks").array().notNull().default(sql`ARRAY[]::text[]`),
  /** Ime gostujočega Wi-Fi omrežja, prikazano na tiskanem QR meniju. */
  qrWifiSsid: text("qr_wifi_ssid"),
  /** Geslo gostujočega Wi-Fi omrežja, prikazano na tiskanem QR meniju. */
  qrWifiPassword: text("qr_wifi_password"),
  /** STM (stroškovno mesto) za POS→ERP knjiženje; mehka referenca na cost_centers.id */
  costCenterId: uuid("cost_center_id"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("ux_enote_cti_token").on(t.ctiToken),
  unique("enote_id_company_unique").on(t.id, t.companyId),
  foreignKey({
    columns: [t.parentUnitId, t.companyId],
    foreignColumns: [t.id, t.companyId],
    name: "enote_parent_company_fk",
  }).onDelete("restrict"),
  check("enote_parent_not_self_check", sql`${t.parentUnitId} IS NULL OR ${t.parentUnitId} <> ${t.id}`),
  check(
    "enote_active_period_check",
    sql`(${t.activeFrom} IS NULL AND ${t.activeTo} IS NULL) OR (${t.activeFrom} IS NOT NULL AND ${t.activeTo} IS NOT NULL AND ${t.activeTo} > ${t.activeFrom})`,
  ),
  check(
    "enote_temporary_fields_check",
    sql`NOT ${t.isTemporary} OR (${t.parentUnitId} IS NOT NULL AND ${t.activeFrom} IS NOT NULL AND ${t.activeTo} IS NOT NULL)`,
  ),
]);

export type Enota = typeof enoteTable.$inferSelect;
export type InsertEnota = typeof enoteTable.$inferInsert;
