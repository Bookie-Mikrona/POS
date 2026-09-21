/**
 * os-amortizacija-obracun.ts — Shranjen mesečni/letni obračun amortizacije (Faza 3c/3)
 *
 * os_amortizacija_obracun (glava): ena vrstica na (company_id, leto)
 *   status = 'odprt'     → do_meseca < 12
 *   status = 'zakljucen' → do_meseca = 12
 *
 * os_amortizacija_obracun_sredstvo (vrstice): ena vrstica na (obracun_id, sredstvo_id)
 *   Ažurira se ob vsakem ponovnem zagonu istega leta (UPSERT).
 */

import {
  pgTable,
  uuid,
  integer,
  numeric,
  text,
  timestamp,
  check,
  unique,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { companiesTable } from "./companies";
import { osnovnaSredstvaTable } from "./osnovna-sredstva";
import { journalEntriesTable } from "./journal-entries";

// ─── Glava obračuna ──────────────────────────────────────────────────────────

export const osAmortizacijaObracunTable = pgTable(
  "os_amortizacija_obracun",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companiesTable.id, { onDelete: "cascade" }),
    leto: integer("leto").notNull(),
    doMeseca: integer("do_meseca").notNull(),
    /** 'odprt' = do_meseca < 12; 'zakljucen' = do_meseca = 12 */
    status: text("status").notNull().default("odprt"),
    /**
     * FK na journal_entries.id: draft osnutek temeljnice v GLK za to leto.
     * NULL = OS-only podjetje ali brez GLK modula ali obračun pred uvedbo 3a.
     * Nastavi se samodejno ob obračunu, ko ima podjetje erp modul.
     */
    glkTemeljnicaId: uuid("glk_temeljnica_id")
      .references(() => journalEntriesTable.id, { onDelete: "set null" }),
    /**
     * Pravilo začetka amortizacije, ki je bilo veljavno ob zadnjem zagonu obračuna.
     * NULL = obračun ustvarjen pred uvedbo tega polja; primerjava zastarelosti se preskoči.
     */
    praviloZacetkaAmortizacije: text("pravilo_zacetka_amortizacije"),
    /**
     * SHA-256 hex hash vhodnih podatkov (pravilo + sortirane doknjižbe po sredstvih).
     * NULL = obračun ustvarjen pred uvedbo tega polja; primerjava hash se preskoči.
     */
    vhodniPodpis: text("vhodni_podpis"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("os_amortizacija_obracun_company_leto_uniq").on(t.companyId, t.leto),
  ],
);

export type OsAmortizacijaObracun = typeof osAmortizacijaObracunTable.$inferSelect;

// ─── Vrstice obračuna (po sredstvih) ─────────────────────────────────────────

export const osAmortizacijaObracunSredstvoTable = pgTable(
  "os_amortizacija_obracun_sredstvo",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    obracunId: uuid("obracun_id")
      .notNull()
      .references(() => osAmortizacijaObracunTable.id, { onDelete: "cascade" }),
    sredstvoId: uuid("sredstvo_id")
      .notNull()
      .references(() => osnovnaSredstvaTable.id, { onDelete: "cascade" }),
    /** Amortizacijska osnova = nabavna × (100 − neamortizljivi%) / 100 */
    osnova: numeric("osnova", { precision: 14, scale: 2 }).notNull().default("0"),
    /** Računovodska amortizacijska stopnja % */
    stopnja: numeric("stopnja", { precision: 6, scale: 3 }).notNull().default("0"),
    /** Izračunana amortizacija do do_meseca */
    obracunano: numeric("obracunano", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * Oslabitev vrednosti OS (SRS 1.35+) — vnese se na ZAKLJUČENEM letnem obračunu leta N.
     * Znesek zmanjša osnovo amortizacije naslednjega leta N+1.
     * Oslabitev je LOČENA od amortizacije (svoja knjižba v razred 7/0 za GLK-podjetja).
     */
    oslabitev: numeric("oslabitev", { precision: 14, scale: 2 }).notNull().default("0"),
    /**
     * Metoda obračuna oslabitve per sredstvo (SRS 1.35+):
     *   1 = amortizacija od nabavne vrednosti (stopnja × NV) — skrajša dobo (privzeto)
     *   2 = amortizacija od nove osnove po oslabitvi (effectivePreostalo × stopnja) — nižji letni znesek
     */
    oslabitevMetoda: integer("oslabitev_metoda").notNull().default(1),
    /**
     * Metoda 2 — nova (krajša) preostala doba v letih, ki jo vnese uporabnik.
     * NULL pri Metodi 1 (doba se izračuna iz stopnje: 100/stopnja − pretečena).
     */
    oslabitevNovaDobeLet: integer("oslabitev_nova_doba_let"),
    /**
     * Preračunana nova letna amortizacija (RAC) po oslabitvi.
     * = nova_knjižna / preostala_doba.
     * Shrani se ob vnosu oslabitve, engine jo prevzame za vse kasnejše obračune.
     * NULL = ni oslabitve ali ni veljavne vrednosti.
     */
    oslabitevNovaLetnaAmRac: numeric("oslabitev_nova_letna_am_rac", { precision: 14, scale: 2 }),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique("os_amortizacija_obracun_sredstvo_uniq").on(t.obracunId, t.sredstvoId),
    index("idx_os_amort_obr_sredstvo_sredstvo_id").on(t.sredstvoId),
  ],
);

export type OsAmortizacijaObracunSredstvo = typeof osAmortizacijaObracunSredstvoTable.$inferSelect;
