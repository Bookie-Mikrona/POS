import { pgTable, uuid, integer, numeric, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { companiesTable } from "../companies";
import { enoteTable } from "./enote";
import { racuniTable } from "./racuni";
import { posKarticnaPlacilaAttemptTable } from "./karticna-placila-attempts";

/**
 * Skupna evidenca večnamenskih darilnih bonov.
 *
 * Bon nima kode ali individualnega salda: odprti znesek je vsota izdaj minus
 * vsota unovčitev za podjetje. Stornirane račune izračun salda izloči.
 */
export const darilniBonGibiTable = pgTable("darilni_bon_gibi", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  racunId: integer("racun_id")
    .notNull()
    .references(() => racuniTable.id, { onDelete: "restrict" }),
  tip: text("tip", { enum: ["izdaja", "unovcitev"] }).notNull(),
  znesek: numeric("znesek", { precision: 14, scale: 2 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("darilni_bon_gibi_racun_tip_unique").on(table.racunId, table.tip),
]);

export type DarilniBonGib = typeof darilniBonGibiTable.$inferSelect;

/**
 * Strežniška rezervacija izdaje darilnega bona.
 *
 * Idempotentni ključ prepreči, da ponovljen klik ali ponovljen HTTP zahtevek
 * izda še en fiskalni račun. Pri kartici se obstoječa SumUp/Viva referenca
 * zabeleži in je za podjetje uporabna samo enkrat. Ta tabela ni potrdilo
 * terminalskega plačila: brez plačilne namere ponudnika ga ne more potrditi.
 */
export const darilniBonIzdajeTable = pgTable("darilni_bon_izdaje", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id")
    .notNull()
    .references(() => enoteTable.id, { onDelete: "restrict" }),
  idempotencyKey: text("idempotency_key").notNull(),
  placilnaNacin: text("placilna_nacin", { enum: ["gotovina", "kartica"] }).notNull(),
  znesek: numeric("znesek", { precision: 14, scale: 2 }).notNull(),
  /** SumUp/Viva referenca, kadar jo obstoječi terminalski tok vrne. */
  karticnaReferenca: text("karticna_referenca"),
  cardPaymentAttemptId: uuid("card_payment_attempt_id")
    .references(() => posKarticnaPlacilaAttemptTable.id, { onDelete: "restrict" }),
  /** Brez ponudnikove plačilne namere strežnik plačila ne more dokazati. */
  terminalskoPlaciloPreverjeno: text("terminalsko_placilo_preverjeno", { enum: ["nepreverjeno", "preverjeno"] })
    .notNull()
    .default("nepreverjeno"),
  status: text("status", { enum: ["pending", "issued", "failed"] }).notNull().default("pending"),
  racunId: integer("racun_id")
    .references(() => racuniTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("darilni_bon_izdaje_company_key_unique").on(table.companyId, table.idempotencyKey),
  uniqueIndex("darilni_bon_izdaje_company_card_ref_unique").on(table.companyId, table.karticnaReferenca),
  uniqueIndex("darilni_bon_izdaje_card_payment_attempt_unique").on(table.cardPaymentAttemptId),
  uniqueIndex("darilni_bon_izdaje_racun_unique").on(table.racunId),
]);

export type DarilniBonIzdaja = typeof darilniBonIzdajeTable.$inferSelect;

/**
 * Enotna atomska rezervacija ponudnikove kartične reference.
 *
 * Uporabljata jo navaden POS račun in izdaja darilnega bona pred FURS klicem,
 * zato ista terminalsko pridobljena referenca ne more fiskalizirati dveh
 * zahtevkov niti pri sočasnem prihodu.
 */
export const posKarticnaPlacilaReferenceTable = pgTable("pos_karticna_placila_reference", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["sumup", "viva"] }).notNull(),
  referenca: text("referenca").notNull(),
  status: text("status", { enum: ["reserved", "used", "failed"] }).notNull().default("reserved"),
  racunId: integer("racun_id")
    .references(() => racuniTable.id, { onDelete: "restrict" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  // Referenca ponudnika je globalna, enako kot zaščitna indeksa na računih.
  uniqueIndex("pos_karticna_placila_reference_unique").on(table.provider, table.referenca),
  uniqueIndex("pos_karticna_placila_reference_racun_unique").on(table.racunId),
]);

export type PosKarticnaPlacilaReference = typeof posKarticnaPlacilaReferenceTable.$inferSelect;