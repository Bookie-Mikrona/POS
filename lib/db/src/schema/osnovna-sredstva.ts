/**
 * osnovna-sredstva.ts — Register osnovnih sredstev (Faza 3a–3b, Možnost A)
 *
 * Hierarhija GLAVA + PODZAPISI:
 *   osnovna_sredstva (glava)  — skupni atributi: naziv, skupina, STM, konti, status
 *   os_doknjizbe (podzapisi)  — vrednostna polja: nabavna vrednost, datumi, neamort.
 *
 * seq=0 = osnovni nakup (ustvari se samodejno ob vnosu sredstva)
 * seq=1,2,3 = dograditve (naknadna vlaganja)
 * Dograditev prevzame skupino in konte iz glave (ni jih na os_doknjizbe).
 * Vsaka doknjižba se amortizira od svojega datum_aktivacije po skupini GLAVE (3c).
 *
 * Vezave na obstoječe skupne šifrante:
 *   accounts     (kontni načrt — account_id, konto_popravka_id, konto_stroska_id)
 *   cost_centers (stroškovna mesta — NI novega STM šifranta)
 *   companies    (company_id FK s cascade)
 *
 * Ta modul NE vsebuje amortizacijskega obračuna niti knjižb v GK.
 * TODO: Prihodnja izboljšava — leto-verzioniranje stopenj amortizacijskih skupin.
 */

import {
  pgTable,
  text,
  uuid,
  boolean,
  timestamp,
  numeric,
  integer,
  date,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";
import { costCentersTable } from "./dimensions";
import { accountsTable } from "./accounts";
import { counterpartiesTable } from "./counterparties";

// ─── Amortizacijske skupine ─────────────────────────────────────────────────

export const osAmortizacijskeSkupineTable = pgTable(
  "os_amortizacijske_skupine",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    koda: text("koda").notNull(),
    naziv: text("naziv").notNull(),
    /** Računovodska letna stopnja amortizacije v % (npr. 10.000 = 10 %). */
    racunovodskaStonja: numeric("racunovodska_stopnja", {
      precision: 6,
      scale: 3,
    }).notNull(),
    /** Davčna letna stopnja — ločena od računovodske. Privzeto = računovodska. */
    davcnaStonja: numeric("davcna_stopnja", {
      precision: 6,
      scale: 3,
    }).notNull(),
    aktivno: boolean("aktivno").notNull().default(true),
    opomba: text("opomba"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
);

export type OsAmortizacijskaSkupina =
  typeof osAmortizacijskeSkupineTable.$inferSelect;

// ─── Glava osnovnega sredstva ───────────────────────────────────────────────

export const osnovnaSredstvaTable = pgTable("osnovna_sredstva", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  /** Inventarna številka — enolična znotraj podjetja (BREZ doknjizba v ključu). */
  inventarnaSt: text("inventarna_st").notNull(),
  naziv: text("naziv").notNull(),
  /**
   * FK na os_amortizacijske_skupine — skupna za vse doknjižbe tega sredstva.
   * Dograditve prevzamejo skupino iz glave, ne definirajte skupin na doknjižbah.
   */
  skupinaId: uuid("skupina_id").references(
    () => osAmortizacijskeSkupineTable.id,
    { onDelete: "restrict" },
  ),
  /** FK na OBSTOJEČ šifrant cost_centers — NI novega STM šifranta. */
  costCenterId: uuid("cost_center_id").references(() => costCentersTable.id, {
    onDelete: "set null",
  }),
  /** FK na OBSTOJEČ kontni načrt accounts (konto OS). */
  accountId: uuid("account_id").references(() => accountsTable.id, {
    onDelete: "restrict",
  }),
  /** Konto popravka vrednosti (akumulirani odpis). */
  kontoPopravkaId: uuid("konto_popravka_id").references(() => accountsTable.id, {
    onDelete: "restrict",
  }),
  /** Konto stroška amortizacije. */
  kontoStroskaId: uuid("konto_stroska_id").references(() => accountsTable.id, {
    onDelete: "restrict",
  }),
  /**
   * Status celotnega sredstva (skupaj z vsemi doknjižbami).
   * Soft delete = status → izloceno (vse doknjižbe se hkrati označijo).
   */
  status: text("status").notNull().default("v_teku"),
  opomba: text("opomba"),
  /**
   * Datum prodaje / odtujitve / uničenja celotnega sredstva.
   * Amortizacija se preneha obračunavati s PRVIM DNEM MESECA odtujitve
   * (mesec odtujitve se NE šteje — simetrično z začetnim pravilom).
   * Primer: prodano 15.10.2026 → zadnji mesec = september → 9 mesecev (jan–sep).
   */
  datumOdtujitve: date("datum_odtujitve"),
  /** Razlog izločitve: prodaja/odpis/uničenje/… (neobvezno). */
  razlogIzlocitve: text("razlog_izlocitve"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OsnovnoSredstvo = typeof osnovnaSredstvaTable.$inferSelect;

// ─── Doknjižbe (podzapisi) ──────────────────────────────────────────────────

export const osDoknjizbeTable = pgTable("os_doknjizbe", {
  id: uuid("id").primaryKey().defaultRandom(),
  /**
   * FK na glavo. ON DELETE CASCADE — ko se briše sredstvo, se brišejo vse doknjižbe.
   * Skupini in konti so SAMO na glavi; doknjižba jih prevzame prek JOIN.
   */
  sredstvoId: uuid("sredstvo_id")
    .notNull()
    .references(() => osnovnaSredstvaTable.id, { onDelete: "cascade" }),
  /**
   * Zaporedna številka doknjižbe:
   *   0 = osnovni nakup (ustvari se samodejno ob vnosu sredstva)
   *   1, 2, 3, … = dograditve/naknadna vlaganja
   */
  seq: integer("seq").notNull().default(0),
  /** Opis vlaganja — za seq=0 neobvezen; za dograditve priporočljiv. */
  nazivVlaganja: text("naziv_vlaganja"),
  /**
   * Dobavitelj tega nakupa / dograditve — FK na obstoječ šifrant counterparties.
   * Naziv in davčna se berejo prek JOIN, ne kopirajo.
   */
  partnerId: uuid("partner_id").references(() => counterpartiesTable.id, {
    onDelete: "set null",
  }),
  /** Številka prejetega računa / nabavnega dokumenta. */
  stRacuna: text("st_racuna"),
  /** Datum prejetega računa (datum dokumenta). */
  datumRacuna: date("datum_racuna"),
  nabavnaVrednost: numeric("nabavna_vrednost", {
    precision: 14,
    scale: 2,
  }).notNull(),
  odpisanaVrednost: numeric("odpisana_vrednost", {
    precision: 14,
    scale: 2,
  })
    .notNull()
    .default("0"),
  /**
   * Delež nabavne vrednosti, ki se NE amortizira (0–100).
   * Amortizirljiva osnova = nabavnaVrednost × (100 − pct) / 100.
   */
  neamortizljiviDelPct: numeric("neamortizljivi_del_pct", {
    precision: 5,
    scale: 2,
  })
    .notNull()
    .default("0"),
  datumNabave: date("datum_nabave").notNull(),
  /** Ob vnosu sproži amortizacijo; NULL = investicija v teku. */
  datumAktivacije: date("datum_aktivacije"),
  datumIzpisa: date("datum_izpisa"),
  /**
   * Status te posamezne doknjižbe:
   *   v_teku   — investicija v teku
   *   v_uporabi — se amortizira
   *   odpisano  — amortizacija zaključena
   *   izloceno  — prodano/odtujeno skupaj z glavo
   */
  status: text("status").notNull().default("v_teku"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type OsDoknjizba = typeof osDoknjizbeTable.$inferSelect;
