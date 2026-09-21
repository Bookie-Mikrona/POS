import { pgTable, serial, integer, numeric, timestamp, text, uuid, date, jsonb, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { enoteTable } from "./enote";
import { natakariTable } from "./natakari";
import { blagajneTable } from "./blagajne";
import { costCentersTable } from "../dimensions";
import { companiesTable } from "../companies";

export const izmeneTable = pgTable("izmene", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  natakariId: integer("natakari_id").notNull().references(() => natakariTable.id),
  /** Blagajna, na kateri je natakar odprl izmeno (opcijsko — za zgodovino) */
  blagajnaId: integer("blagajna_id").references(() => blagajneTable.id, { onDelete: "set null" }),
  /** STM enote ob odprtju izmene; povezava enote se lahko pozneje spremeni. */
  costCenterId: uuid("cost_center_id").references(() => costCentersTable.id, { onDelete: "set null" }),
  /** Nespremenljiva oznaka STM ob odprtju izmene — zgodovinski obračun ne bere trenutnega šifranta. */
  costCenterCode: text("cost_center_code"),
  /** Nespremenljiv naziv STM ob odprtju izmene — ostane tudi po deaktivaciji/izbrisu šifranta. */
  costCenterName: text("cost_center_name"),
  zacetek: timestamp("zacetek", { withTimezone: true }).notNull().defaultNow(),
  konec: timestamp("konec", { withTimezone: true }),
  skupajZnesek: numeric("skupaj_znesek", { precision: 10, scale: 2 }).notNull().default("0"),
  steviloRacunov: integer("stevilo_racunov").notNull().default(0),
  status: text("status", { enum: ["osnutek", "v_potrditvi", "potrjeno", "zavrnjeno"] }).notNull().default("osnutek"),
  potrjenoBy: text("potrjeno_by"),
  potrjenoAt: timestamp("potrjeno_at", { withTimezone: true }),
  zavrnitevRazlog: text("zavrnitev_razlog"),
});

export const izmeneRelations = relations(izmeneTable, ({ one }) => ({
  natakar: one(natakariTable, { fields: [izmeneTable.natakariId], references: [natakariTable.id] }),
  costCenter: one(costCentersTable, { fields: [izmeneTable.costCenterId], references: [costCentersTable.id] }),
}));

export type Izmena = typeof izmeneTable.$inferSelect;

export const odmoriTable = pgTable("odmori", {
  id: serial("id").primaryKey(),
  izmenaId: integer("izmena_id").notNull().references(() => izmeneTable.id, { onDelete: "cascade" }),
  vrsta: text("vrsta", { enum: ["placan", "neplacan"] }).notNull().default("neplacan"),
  zacetek: timestamp("zacetek", { withTimezone: true }).notNull(),
  konec: timestamp("konec", { withTimezone: true }),
  opomba: text("opomba"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("odmori_izmena_zacetek_idx").on(table.izmenaId, table.zacetek),
]);

export const odsotnostiTable = pgTable("odsotnosti", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  natakariId: integer("natakari_id").notNull().references(() => natakariTable.id, { onDelete: "restrict" }),
  od: date("od", { mode: "string" }).notNull(),
  do: date("do", { mode: "string" }).notNull(),
  tip: text("tip", { enum: ["dopust", "bolniska", "druga_odsotnost"] }).notNull(),
  opomba: text("opomba"),
  status: text("status", { enum: ["osnutek", "potrjeno", "zavrnjeno"] }).notNull().default("osnutek"),
  createdBy: text("created_by").notNull(),
  potrjenoBy: text("potrjeno_by"),
  potrjenoAt: timestamp("potrjeno_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (table) => [
  index("odsotnosti_enota_obdobje_idx").on(table.enotaId, table.od, table.do),
  index("odsotnosti_natakar_obdobje_idx").on(table.natakariId, table.od, table.do),
]);

export const izmenaPopravkiTable = pgTable("izmena_popravki", {
  id: uuid("id").primaryKey().defaultRandom(),
  izmenaId: integer("izmena_id").notNull().references(() => izmeneTable.id, { onDelete: "restrict" }),
  starZacetek: timestamp("star_zacetek", { withTimezone: true }).notNull(),
  starKonec: timestamp("star_konec", { withTimezone: true }),
  novZacetek: timestamp("nov_zacetek", { withTimezone: true }).notNull(),
  novKonec: timestamp("nov_konec", { withTimezone: true }),
  razlog: text("razlog").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("izmena_popravki_izmena_created_idx").on(table.izmenaId, table.createdAt),
]);

export const kadrovskiAuditTable = pgTable("kadrovski_audit", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  entiteta: text("entiteta").notNull(),
  entitetaId: text("entiteta_id").notNull(),
  dejanje: text("dejanje").notNull(),
  razlog: text("razlog"),
  actorId: text("actor_id").notNull(),
  pred: jsonb("pred"),
  po: jsonb("po"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("kadrovski_audit_entity_idx").on(table.entiteta, table.entitetaId, table.createdAt),
  index("kadrovski_audit_company_idx").on(table.companyId, table.createdAt),
]);

export type Odmor = typeof odmoriTable.$inferSelect;
export type Odsotnost = typeof odsotnostiTable.$inferSelect;
export type IzmenaPopravek = typeof izmenaPopravkiTable.$inferSelect;
export type KadrovskiAudit = typeof kadrovskiAuditTable.$inferSelect;
