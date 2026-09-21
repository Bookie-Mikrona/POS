import { bigserial, boolean, index, integer, pgTable, serial, text, timestamp, unique } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";
import { kategorijeTable } from "./kategorije";
import { artikliTable } from "./artikli";
import { narocilaTable, postavkeTable } from "./narocila";

export const kdsPostajeTable = pgTable("kds_postaje", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  /** Logical production lane; screens subscribe to lanes independently. */
  tip: text("tip", { enum: ["bar", "kitchen", "pizza", "dispatch", "custom"] }).notNull().default("custom"),
  aktivna: boolean("aktivna").notNull().default(true),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("kds_postaje_ime_enota_unique").on(t.enotaId, t.ime)]);

export const kdsPostajaMapiranjaTable = pgTable("kds_postaja_mapiranja", {
  id: serial("id").primaryKey(),
  postajaId: integer("postaja_id").notNull().references(() => kdsPostajeTable.id, { onDelete: "cascade" }),
  kategorijaId: integer("kategorija_id").references(() => kategorijeTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").references(() => artikliTable.id, { onDelete: "cascade" }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

/** Per-unit KDS policy.  The fallback is deliberately a station, not a screen. */
export const kdsNastavitveTable = pgTable("kds_nastavitve", {
  enotaId: integer("enota_id").primaryKey().references(() => enoteTable.id, { onDelete: "cascade" }),
  profil: text("profil", { enum: ["bar_combined_kitchen", "bar_separate_kitchen_pizza", "custom"] }).notNull().default("bar_combined_kitchen"),
  fallbackPostajaId: integer("fallback_postaja_id").references(() => kdsPostajeTable.id, { onDelete: "set null" }),
  dispatchOmogocen: boolean("dispatch_omogocen").notNull().default(false),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow(),
});

/** A physical display may render tickets from one or several logical stations. */
export const kdsPrikazovalnikiTable = pgTable("kds_prikazovalniki", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  aktiven: boolean("aktiven").notNull().default(true),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("kds_prikazovalniki_ime_enota_unique").on(t.enotaId, t.ime)]);

export const kdsPrikazovalnikNaročnineTable = pgTable("kds_prikazovalnik_narocnine", {
  id: serial("id").primaryKey(),
  prikazovalnikId: integer("prikazovalnik_id").notNull().references(() => kdsPrikazovalnikiTable.id, { onDelete: "cascade" }),
  postajaId: integer("postaja_id").notNull().references(() => kdsPostajeTable.id, { onDelete: "cascade" }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("kds_prikazovalnik_narocnine_unique").on(t.prikazovalnikId, t.postajaId)]);

export const kdsNalogiTable = pgTable("kds_nalogi", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  postajaId: integer("postaja_id").notNull().references(() => kdsPostajeTable.id),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  postavkaId: integer("postavka_id").references(() => postavkeTable.id, { onDelete: "set null" }),
  /** Later multicourse courses remain held until an operator explicitly fires them. */
  stanje: text("stanje", { enum: ["zadrzano", "aktivno", "bumped", "ack", "preklicano"] }).notNull().default("aktivno"),
  /** Snapshot of the source line's multicourse serving metadata. */
  courseNumber: integer("course_number"),
  courseSequence: integer("course_sequence"),
  courseNameSnapshot: text("course_name_snapshot"),
  pairingGroupId: text("pairing_group_id"),
  uporabljenFallback: boolean("uporabljen_fallback").notNull().default(false),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  bumpedAt: timestamp("bumped_at", { withTimezone: true }),
  ackAt: timestamp("ack_at", { withTimezone: true }),
}, (t) => [unique("kds_nalogi_postaja_postavka_unique").on(t.postajaId, t.postavkaId), index("ix_kds_nalogi_enota_postaja_aktivni").on(t.enotaId, t.postajaId, t.ustvarjeno)]);

export const kdsDogodkiTable = pgTable("kds_dogodki", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  nalogId: integer("nalog_id").notNull().references(() => kdsNalogiTable.id),
  zaporedje: integer("zaporedje").notNull(),
  tip: text("tip", { enum: ["materializiran", "sproscen", "bump", "ack", "preklic"] }).notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique("kds_dogodki_nalog_zaporedje_unique").on(t.nalogId, t.zaporedje), unique("kds_dogodki_nalog_idempotency_unique").on(t.nalogId, t.idempotencyKey)]);

/** Immutable order-level handoff audit record for dispatch-enabled KDS units. */
export const kdsIzdajaDogodkiTable = pgTable("kds_izdaja_dogodki", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id),
  tip: text("tip", { enum: ["predano"] }).notNull().default("predano"),
  idempotencyKey: text("idempotency_key").notNull(),
  actorClerkUserId: text("actor_clerk_user_id").notNull(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("kds_izdaja_dogodki_narocilo_unique").on(t.narociloId),
  unique("kds_izdaja_dogodki_enota_idempotency_unique").on(t.enotaId, t.idempotencyKey),
  index("ix_kds_izdaja_dogodki_enota_narocilo").on(t.enotaId, t.narociloId),
]);