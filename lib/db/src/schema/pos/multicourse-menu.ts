import { boolean, index, integer, jsonb, numeric, pgTable, serial, smallint, text, timestamp, unique } from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";
import { mizeTable } from "./mize";

/** Configuration belongs to the sellable menu article, never to a client request. */
export const multicourseMenusTable = pgTable("multicourse_menus", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  menuArtikelId: integer("menu_artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  izbor: text("izbor", { enum: ["fixed_four", "choose_three"] }).notNull(),
  /** Generic selection contract. `izbor` is retained for older callers. */
  selectionMode: text("selection_mode", { enum: ["fixed", "choose"] }).notNull().default("fixed"),
  selectionCount: smallint("selection_count"),
  /** Bruto delež cene menija, obdavčen kot hrana; preostanek je vinska spremljava. */
  foodPricePercent: numeric("food_price_percent", { precision: 5, scale: 2 }).notNull().default("100"),
  aktivno: boolean("aktivno").notNull().default(true),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("multicourse_menus_article_unique").on(t.menuArtikelId),
  index("ix_multicourse_menus_enota").on(t.enotaId, t.aktivno),
]);

/** Courses are application-validated as a contiguous sequence of 2 through 20. */
export const multicourseMenuCoursesTable = pgTable("multicourse_menu_courses", {
  id: serial("id").primaryKey(),
  menuId: integer("menu_id").notNull().references(() => multicourseMenusTable.id, { onDelete: "cascade" }),
  courseNumber: smallint("course_number").notNull(),
  courseName: text("course_name").notNull().default(""),
  wineRequired: boolean("wine_required").notNull().default(true),
  informational: boolean("informational").notNull().default(false),
  /** Legacy default food; retained while clients migrate to the food allowlist. */
  foodArtikelId: integer("food_artikel_id").notNull().references(() => artikliTable.id, { onDelete: "restrict" }),
  /** Server-owned allowlist of food articles for this course. */
  allowedFoodArtikelIds: jsonb("allowed_food_artikel_ids").$type<number[]>().notNull().default([]),
  /** Server-owned allowlist of sellable 1 dl wine articles. */
  allowedWineArtikelIds: jsonb("allowed_wine_artikel_ids").$type<number[]>().notNull().default([]),
}, (t) => [unique("multicourse_menu_courses_number_unique").on(t.menuId, t.courseNumber)]);

/** Persistent, table/device-scoped guest-to-POS service request audit trail. */
export const qrWaiterRequestsTable = pgTable("qr_waiter_requests", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  mizaId: integer("miza_id").notNull().references(() => mizeTable.id, { onDelete: "cascade" }),
  qrNapravaId: text("qr_naprava_id").notNull(),
  stanje: text("stanje", { enum: ["caka", "potrjeno", "zakljuceno"] }).notNull().default("caka"),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  potrjeno: timestamp("potrjeno", { withTimezone: true }),
  zakljuceno: timestamp("zakljuceno", { withTimezone: true }),
  actorClerkUserId: text("actor_clerk_user_id"),
}, (t) => [
  index("ix_qr_waiter_requests_enota_stanje").on(t.enotaId, t.stanje, t.ustvarjeno),
  index("ix_qr_waiter_requests_table_device").on(t.enotaId, t.mizaId, t.qrNapravaId, t.stanje),
]);