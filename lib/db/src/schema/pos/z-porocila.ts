import {
  pgTable, serial, integer, text, uuid, numeric, timestamp, date, jsonb, index, unique, uniqueIndex, boolean,
} from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { enoteTable } from "./enote";
import { blagajneTable } from "./blagajne";

export const zPorocilaTable = pgTable("z_porocila", {
  id:                    serial("id").primaryKey(),
  companyId:             uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId:               integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  blagajnaId:            integer("blagajna_id").notNull().references(() => blagajneTable.id, { onDelete: "restrict" }),
  poslovniDatum:         date("poslovni_datum").notNull(),
  zStevilka:             integer("z_stevilka").notNull(),
  zakljucenOb:           timestamp("zakljucen_ob", { withTimezone: true }).notNull().defaultNow(),
  zakljucilUporabnik:    text("zakljucil_uporabnik").notNull(),
  grandTotalPrej:        numeric("grand_total_prej", { precision: 14, scale: 2 }).notNull().default("0"),
  grandTotalNov:         numeric("grand_total_nov",  { precision: 14, scale: 2 }).notNull().default("0"),
  prometDneva:           numeric("promet_dneva",     { precision: 14, scale: 2 }).notNull().default("0"),
  skupajPromet:          numeric("skupaj_promet",    { precision: 14, scale: 2 }).notNull().default("0"),
  skupajDdv:             numeric("skupaj_ddv",       { precision: 14, scale: 2 }).notNull().default("0"),
  steviloRacunov:        integer("stevilo_racunov").notNull().default(0),
  odZap:                 text("od_zap"),
  doZap:                 text("do_zap"),
  gotovina:              numeric("gotovina",     { precision: 14, scale: 2 }).notNull().default("0"),
  kartica:               numeric("kartica",      { precision: 14, scale: 2 }).notNull().default("0"),
  znesekNapitnina:       numeric("znesek_napitnina", { precision: 14, scale: 2 }).notNull().default("0"),
  /** Immutable legal/accounting breakdown from receipt-level policy snapshots. */
  tipBreakdown:          jsonb("tip_breakdown").$type<{
    gross: number; net: number; vat: number; cardFee: number; liability: number; revenue: number;
    byPolicyMode: Array<{ policyMode: string; paymentMethod: "cash" | "card" | "unknown"; vatTreatment: string; gross: number; net: number; vat: number; cardFee: number; liability: number; revenue: number }>;
  }>().notNull().default({ gross: 0, net: 0, vat: 0, cardFee: 0, liability: 0, revenue: 0, byPolicyMode: [] }),
  sumup:                 numeric("sumup",        { precision: 14, scale: 2 }).notNull().default("0"),
  bon:                   numeric("bon",          { precision: 14, scale: 2 }).notNull().default("0"),
  bonPica:               numeric("bon_pica",     { precision: 14, scale: 2 }).notNull().default("0"),
  steviloBonov:          integer("stevilo_bonov").notNull().default(0),
  negotovinsko:          numeric("negotovinsko", { precision: 14, scale: 2 }).notNull().default("0"),
  reprezentanca:         numeric("reprezentanca",{ precision: 14, scale: 2 }).notNull().default("0"),
  lastnaPoraba:          numeric("lastna_poraba",{ precision: 14, scale: 2 }).notNull().default("0"),
  ddvPoStopnjah:         jsonb("ddv_po_stopnjah")
    .$type<{ stopnja: number; ddvZnesek: number; osnova: number }[]>()
    .notNull().default([]),
  menjalniDenar:         numeric("menjalni_denar",         { precision: 14, scale: 2 }).notNull().default("0"),
  gotovinskaProdaja:     numeric("gotovinska_prodaja",     { precision: 14, scale: 2 }).notNull().default("0"),
  pologiGotovine:        numeric("pologi_gotovine",        { precision: 14, scale: 2 }).notNull().default("0"),
  izplacilaJobaviteljem: numeric("izplacila_dobaviteljem", { precision: 14, scale: 2 }).notNull().default("0"),
  pologiTrr:             numeric("pologi_trr",             { precision: 14, scale: 2 }).notNull().default("0"),
  stanjeBlagajne:        numeric("stanje_blagajne",        { precision: 14, scale: 2 }).notNull().default("0"),
  darilniBoniIzdaja:     numeric("darilni_boni_izdaja",    { precision: 14, scale: 2 }).notNull().default("0"),
  darilniBoniUnovcitev:  numeric("darilni_boni_unovcitev", { precision: 14, scale: 2 }).notNull().default("0"),
  sspSubvencija:         numeric("ssp_subvencija",         { precision: 14, scale: 2 }).notNull().default("0"),
  fursPotrjeni:          integer("furs_potrjeni").notNull().default(0),
  fursNepotrjeni:        integer("furs_nepotrjeni").notNull().default(0),
  odklenjenOb:           timestamp("odklenjen_ob", { withTimezone: true }),
  odklenilUporabnik:     text("odklenil_uporabnik"),
}, (t) => [
  unique("z_porocila_unikat").on(t.enotaId, t.blagajnaId, t.poslovniDatum),
  index("ix_z_porocila_enota_blagajna").on(t.enotaId, t.blagajnaId),
]);

export const zPorociloOdklePiTable = pgTable("z_porocilo_odklepi", {
  id:                 serial("id").primaryKey(),
  zPorociloId:        integer("z_porocilo_id").notNull().references(() => zPorocilaTable.id, { onDelete: "restrict" }),
  odklenilUporabnik:  text("odklenil_uporabnik").notNull(),
  odklenjenoOb:       timestamp("odklenjeno_ob", { withTimezone: true }).notNull().defaultNow(),
  razlog:             text("razlog").notNull(),
  gtPrej:             numeric("gt_prej",         { precision: 14, scale: 2 }).notNull(),
  gtPoPonovnem:       numeric("gt_po_ponovnem",  { precision: 14, scale: 2 }),
}, (t) => [
  index("ix_z_porocilo_odklepi_z_id").on(t.zPorociloId),
]);

export const zTipBreakdownCorrectionsTable = pgTable("z_tip_breakdown_corrections", {
  id:                 serial("id").primaryKey(),
  zPorociloId:        integer("z_porocilo_id").notNull().references(() => zPorocilaTable.id, { onDelete: "restrict" }),
  previousBreakdown:  jsonb("previous_breakdown").notNull(),
  replacementBreakdown: jsonb("replacement_breakdown").notNull(),
  reason:             text("reason").notNull(),
  actorId:            text("actor_id").notNull(),
  createdAt:          timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("z_tip_breakdown_corrections_z_idx").on(t.zPorociloId, t.createdAt),
]);

/** Counted cash is an auditable per-register, per-business-day reconciliation. */
export const posCashReconciliationsTable = pgTable("pos_cash_reconciliations", {
  id: serial("id").primaryKey(),
  companyId: uuid("company_id").notNull().references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  blagajnaId: integer("blagajna_id").notNull().references(() => blagajneTable.id, { onDelete: "restrict" }),
  poslovniDatum: date("poslovni_datum").notNull(),
  pricakovanaGotovina: numeric("pricakovana_gotovina", { precision: 14, scale: 2 }).notNull(),
  prestetaGotovina: numeric("presteta_gotovina", { precision: 14, scale: 2 }).notNull(),
  razlika: numeric("razlika", { precision: 14, scale: 2 }).notNull(),
  confirmed: boolean("confirmed").notNull().default(false),
  overrideRazlog: text("override_razlog"),
  actorId: text("actor_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  idempotencyKey: text("idempotency_key").notNull(),
}, (t) => [
  uniqueIndex("pos_cash_reconciliations_idempotency").on(t.enotaId, t.idempotencyKey),
  uniqueIndex("pos_cash_reconciliations_business_day").on(t.enotaId, t.blagajnaId, t.poslovniDatum),
  index("ix_pos_cash_reconciliations_register_day").on(t.enotaId, t.blagajnaId, t.poslovniDatum),
]);

export type ZPorocilo   = typeof zPorocilaTable.$inferSelect;
export type ZPorociloOdklep = typeof zPorociloOdklePiTable.$inferSelect;
export type ZTipBreakdownCorrection = typeof zTipBreakdownCorrectionsTable.$inferSelect;
export type PosCashReconciliation = typeof posCashReconciliationsTable.$inferSelect;
