import {
  date,
  index,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  integer,
} from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { counterpartiesTable } from "../counterparties";
import { invoicesTable } from "../invoices";
import { journalEntriesTable } from "../journal-entries";
import { enoteTable } from "./enote";
import { blagajneTable } from "./blagajne";

export const blagajniskiPremikTipi = [
  "IZPLACILO_DOBAVITELJU",
  "POLOG_GOTOVINE",
  "DVIG_GOTOVINE",
  "POLOG_TRR",
  "PRILIV_TRR",
  "STORNO",
] as const;

export const blagajniskiPremikStatusi = ["OSNUTEK", "POTRJEN", "STORNIRAN"] as const;

/**
 * Nespremenljiva evidenca fizičnih premikov gotovine v POS blagajni.
 * Potrjen zapis se nikoli ne izbriše ali spremeni; popravek je nov STORNO zapis.
 */
export const blagajniskiPremikiTable = pgTable("blagajniski_premiki", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id")
    .notNull()
    .references(() => enoteTable.id, { onDelete: "restrict" }),
  blagajnaId: integer("blagajna_id")
    .notNull()
    .references(() => blagajneTable.id, { onDelete: "restrict" }),
  poslovniDatum: date("poslovni_datum", { mode: "string" }).notNull(),
  datumCas: timestamp("datum_cas", { withTimezone: true }).notNull().defaultNow(),
  tip: text("tip", { enum: blagajniskiPremikTipi }).notNull(),
  status: text("status", { enum: blagajniskiPremikStatusi }).notNull().default("OSNUTEK"),
  znesek: numeric("znesek", { precision: 14, scale: 2 }).notNull(),
  opis: text("opis").notNull(),
  opomba: text("opomba"),
  partnerId: uuid("partner_id").references(() => counterpartiesTable.id, { onDelete: "restrict" }),
  prejetiRacunId: uuid("prejeti_racun_id").references(() => invoicesTable.id, { onDelete: "restrict" }),
  /** A = v blagajni ostane menjalni denar; B = položi se tudi menjalni denar. */
  scenarijPologa: text("scenarij_pologa", { enum: ["A", "B"] }),
  /** Zahtevan sledljiv razlog, kadar plačilo dobavitelju presega pravilnik 420 EUR. */
  razlogIzjeme420: text("razlog_izjeme_420"),
  stornoOdId: uuid("storno_od_id"),
  journalEntryId: uuid("journal_entry_id").references(() => journalEntriesTable.id, { onDelete: "restrict" }),
  createdBy: text("created_by").notNull(),
  confirmedBy: text("confirmed_by"),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ix_blagajniski_premiki_company_datum").on(t.companyId, t.poslovniDatum),
  index("ix_blagajniski_premiki_enota_blagajna_datum").on(t.enotaId, t.blagajnaId, t.poslovniDatum),
  index("ix_blagajniski_premiki_partner_datum").on(t.partnerId, t.poslovniDatum),
  unique("blagajniski_premiki_storno_od_unique").on(t.stornoOdId),
]);

/** Nastavitev začetnega menjalnega denarja, ločeno za vsako fizično blagajno. */
export const blagajniskeNastavitveTable = pgTable("blagajniske_nastavitve", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id")
    .notNull()
    .references(() => enoteTable.id, { onDelete: "cascade" }),
  blagajnaId: integer("blagajna_id")
    .notNull()
    .references(() => blagajneTable.id, { onDelete: "cascade" }),
  menjalniDenar: numeric("menjalni_denar", { precision: 14, scale: 2 }).notNull().default("50.00"),
  updatedBy: text("updated_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("blagajniske_nastavitve_company_enota_blagajna_unique").on(t.companyId, t.enotaId, t.blagajnaId),
]);

export type BlagajniskiPremik = typeof blagajniskiPremikiTable.$inferSelect;
export type BlagajniskaNastavitev = typeof blagajniskeNastavitveTable.$inferSelect;