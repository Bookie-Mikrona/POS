import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  serial,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
  date,
} from "drizzle-orm/pg-core";
import { artikliTable } from "./artikli";
import { enoteTable } from "./enote";
import { counterpartiesTable } from "../counterparties";

export const posSupplierReorderSettingsTable = pgTable(
  "pos_supplier_reorder_settings",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
    artikelId: integer("artikel_id").notNull(),
    reorderPoint: numeric("reorder_point", { precision: 18, scale: 6 }).notNull(),
    targetStock: numeric("target_stock", { precision: 18, scale: 6 }).notNull(),
    preferredMappingId: integer("preferred_mapping_id"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pos_supplier_reorder_settings_unit_article_uq").on(t.enotaId, t.artikelId),
    foreignKey({
      columns: [t.artikelId, t.enotaId],
      foreignColumns: [artikliTable.id, artikliTable.enotaId],
      name: "pos_supplier_reorder_settings_article_unit_fk",
    }).onDelete("cascade"),
    check("pos_supplier_reorder_settings_nonnegative_check", sql`${t.reorderPoint} >= 0`),
    check("pos_supplier_reorder_settings_target_check", sql`${t.targetStock} > ${t.reorderPoint}`),
    index("ix_pos_supplier_reorder_settings_unit").on(t.enotaId),
  ],
);

export const posSupplierTermsTable = pgTable(
  "pos_supplier_terms",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
    dobaviteljId: uuid("dobavitelj_id").notNull().references(() => counterpartiesTable.id, { onDelete: "cascade" }),
    minZnesekNarocila: numeric("min_znesek_narocila", { precision: 15, scale: 2 }),
    rokDobaveDni: integer("rok_dobave_dni"),
    updatedBy: text("updated_by"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique("pos_supplier_terms_unit_supplier_uq").on(t.enotaId, t.dobaviteljId),
    check("pos_supplier_terms_min_znesek_check", sql`${t.minZnesekNarocila} IS NULL OR ${t.minZnesekNarocila} >= 0`),
    check("pos_supplier_terms_rok_check", sql`${t.rokDobaveDni} IS NULL OR (${t.rokDobaveDni} >= 0 AND ${t.rokDobaveDni} <= 365)`),
  ],
);

export const posSupplierOrdersTable = pgTable(
  "pos_supplier_orders",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
    dobaviteljId: uuid("dobavitelj_id").notNull().references(() => counterpartiesTable.id, { onDelete: "restrict" }),
    dobaviteljNaziv: text("dobavitelj_naziv").notNull(),
    stevilka: text("stevilka").notNull(),
    status: text("status").notNull().default("draft"),
    datumDobave: date("datum_dobave"),
    opomba: text("opomba"),
    navodiloDobavitelju: text("navodilo_dobavitelju"),
    razlogZaprtja: text("razlog_zaprtja"),
    ustvaril: text("ustvaril"),
    ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
    posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
    poslanoDne: timestamp("poslano_dne", { withTimezone: true }),
    zaprtoDne: timestamp("zaprto_dne", { withTimezone: true }),
  },
  (t) => [
    unique("pos_supplier_orders_id_unit_uq").on(t.id, t.enotaId),
    uniqueIndex("pos_supplier_orders_unit_number_uq").on(t.enotaId, t.stevilka),
    check(
      "pos_supplier_orders_status_check",
      sql`${t.status} IN ('draft', 'sent', 'partially_received', 'received', 'closed', 'cancelled')`,
    ),
    index("ix_pos_supplier_orders_unit_status_date").on(t.enotaId, t.status, t.ustvarjeno),
  ],
);

export const posSupplierOrderLinesTable = pgTable(
  "pos_supplier_order_lines",
  {
    id: serial("id").primaryKey(),
    enotaId: integer("enota_id").notNull(),
    narociloId: integer("narocilo_id").notNull(),
    supplierMappingId: integer("supplier_mapping_id").notNull(),
    artikelId: integer("artikel_id").notNull(),
    artikelNaziv: text("artikel_naziv").notNull(),
    dobaviteljevNaziv: text("dobaviteljev_naziv"),
    dobaviteljevaSifra: text("dobaviteljeva_sifra"),
    dobaviteljevEan: text("dobaviteljev_ean"),
    kolicinaPakiranj: numeric("kolicina_pakiranj", { precision: 18, scale: 6 }).notNull(),
    faktorPakiranja: numeric("faktor_pakiranja", { precision: 18, scale: 6 }).notNull(),
    nazivPakiranja: text("naziv_pakiranja"),
    osnovnaEnota: text("osnovna_enota"),
    cenaPakiranja: numeric("cena_pakiranja", { precision: 15, scale: 6 }),
  },
  (t) => [
    foreignKey({
      columns: [t.narociloId, t.enotaId],
      foreignColumns: [posSupplierOrdersTable.id, posSupplierOrdersTable.enotaId],
      name: "pos_supplier_order_lines_order_unit_fk",
    }).onDelete("cascade"),
    foreignKey({
      columns: [t.artikelId, t.enotaId],
      foreignColumns: [artikliTable.id, artikliTable.enotaId],
      name: "pos_supplier_order_lines_article_unit_fk",
    }).onDelete("restrict"),
    uniqueIndex("pos_supplier_order_lines_order_mapping_uq").on(t.narociloId, t.supplierMappingId),
    check("pos_supplier_order_lines_package_qty_check", sql`${t.kolicinaPakiranj} > 0`),
    check("pos_supplier_order_lines_package_factor_check", sql`${t.faktorPakiranja} > 0`),
    check(
      "pos_supplier_order_lines_package_price_check",
      sql`${t.cenaPakiranja} IS NULL OR ${t.cenaPakiranja} >= 0`,
    ),
    index("ix_pos_supplier_order_lines_unit_article").on(t.enotaId, t.artikelId),
  ],
);

export type PosSupplierReorderSettings = typeof posSupplierReorderSettingsTable.$inferSelect;
export type PosSupplierOrder = typeof posSupplierOrdersTable.$inferSelect;
export type PosSupplierOrderLine = typeof posSupplierOrderLinesTable.$inferSelect;
