import {
  pgTable,
  uuid,
  varchar,
  char,
  text,
  numeric,
  date,
  smallint,
  timestamp,
  index,
  check,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { journalEntriesTable } from "./journal-entries";
import { invoicesTable } from "./invoices";
import { documentsTable } from "./documents";
import { counterpartiesTable } from "./counterparties";
import { vatCodeTable } from "./vat-code";

/**
 * Centralna transakcijska DDV tabela — jedro KIR/KPR modula.
 *
 * Vsaka knjižba z DDV kodo ustvari eno ali dve vrstici:
 *   - direction='OUT' → KIR (izdana stran)
 *   - direction='IN'  → KPR (prejeta stran)
 *
 * Samoobdavčitve (EUB*, EUS*, RC76A*, TS*, UV*) ustvarijo obe vrstici;
 * povežeta se z `pair_id` (self-referenca na vat_ledger.id).
 *
 * Nespremenljivost: DB trigger `trg_vat_ledger_no_update_after_report` in
 * `trg_vat_ledger_no_delete_after_report` preprečita spremembe ko je
 * reported_at IS NOT NULL. Definirano v: lib/db/src/migrations/001-vat-tables.sql
 *
 * Spec: ERP 3. del, razdelek D.
 */
export const vatLedgerTable = pgTable(
  "vat_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),

    // ── Three-way link na glavno knjigo in izvorni dokument ────────────────
    /**
     * Temeljnica v GK — vrstica se ustvari ob potrditvi v isti transakciji.
     * Nullable: pri predknjižbi (account_payable before posted journal entry).
     */
    journalEntryId: uuid("journal_entry_id")
      .references(() => journalEntriesTable.id, { onDelete: "restrict" }),
    /** Izvorni račun (invoices) — neobvezno */
    invoiceId: uuid("invoice_id")
      .references(() => invoicesTable.id, { onDelete: "restrict" }),
    /** Skeniran dokument (documents) — neobvezno */
    documentId: uuid("document_id")
      .references(() => documentsTable.id, { onDelete: "restrict" }),

    // ── Partner (snapshot ob knjiženju) ───────────────────────────────────
    partnerId: uuid("partner_id")
      .references(() => counterpartiesTable.id, { onDelete: "restrict" }),
    /** ISO 3166, 2 znaka — snapshot */
    partnerCountryCode: char("partner_country_code", { length: 2 }),
    /** ID za DDV brez kode države (KIR P6DS / KPR P7DS) */
    partnerVatId: varchar("partner_vat_id", { length: 32 }),
    /** Naziv + naslov — snapshot za KIR P5 / KPR P6 */
    partnerName: varchar("partner_name", { length: 250 }),

    // ── Klasifikacija ──────────────────────────────────────────────────────
    /**
     * FK na globalni FURS šifrant (vat_code.id) — kaže na konkretno verzijo kode
     * veljavno ob knjiženju.
     */
    vatCodeId: uuid("vat_code_id")
      .notNull()
      .references(() => vatCodeTable.id),
    /** OUT = KIR (izdana), IN = KPR (prejeta) */
    direction: varchar("direction", { length: 3 })
      .notNull()
      .$type<"IN" | "OUT">(),
    /**
     * Self-ref za par pri samoobdavčitvah: OUT vrstica kaže na IN ali obratno.
     * DB FK: REFERENCES vat_ledger(id) — ustvarjen v migracijskem SQL.
     */
    pairId: uuid("pair_id").references((): AnyPgColumn => vatLedgerTable.id),
    /** Zastavica za OS in nepremičnine (informativno za polji 34/35 DDV-O) */
    assetType: varchar("asset_type", { length: 16 })
      .notNull()
      .default("NONE")
      .$type<"NONE" | "REALESTATE" | "OTHER_FA">(),

    // ── Datumi ────────────────────────────────────────────────────────────
    /** KIR P4 / KPR P5 — datum listine */
    invoiceDate: date("invoice_date", { mode: "string" }).notNull(),
    /** Datum opravljene storitve / dobave (za izračun davčne točke) */
    serviceDate: date("service_date", { mode: "string" }).notNull(),
    /** KPR P4 — datum prejema (samo za direction='IN') */
    receiptDate: date("receipt_date", { mode: "string" }),
    /** KIR/KPR P2 — datum knjiženja v evidenco */
    postingDate: date("posting_date", { mode: "string" }).notNull(),
    /** Izračunan davčni datum (tax_point) po pravilih ZDDV-1 */
    taxPointDate: date("tax_point_date", { mode: "string" }).notNull(),
    /**
     * DDV obdobje v FURS formatu 'MMMM':
     *   '0701' = jan, '0707' = jul, '0709' = Q3 ...
     */
    vatPeriod: char("vat_period", { length: 4 }).notNull(),
    vatPeriodYear: smallint("vat_period_year").notNull(),

    // ── Zneski (EUR) ───────────────────────────────────────────────────────
    /** Osnova brez DDV; negativno za dobropise */
    baseAmount: numeric("base_amount", { precision: 15, scale: 2 }).notNull(),
    /** Obračunani / odbitni DDV; 0 za oproščene */
    vatAmount: numeric("vat_amount", { precision: 15, scale: 2 }).notNull().default("0"),
    /** Neodbitni del DDV → KPR P17 */
    nonDeductibleVat: numeric("non_deductible_vat", { precision: 15, scale: 2 }).notNull().default("0"),
    /** Odbitni delež v % (0–100); 100 = polna pravica */
    deductionPercent: numeric("deduction_percent", { precision: 5, scale: 2 }).notNull().default("100.00"),

    // ── Reference ─────────────────────────────────────────────────────────
    /**
     * KIR/KPR P3 — številka listine.
     * Za KIR: FURS tridelna številka (davčno potrjeni računi).
     * Za KPR: DOBAVITELJEVA številka (ne interna PF!).
     */
    documentNo: varchar("document_no", { length: 50 }).notNull(),
    /** MRN za uvozne carinske deklaracije */
    mrn: varchar("mrn", { length: 50 }),
    /** KIR P28 / KPR P22 — opomba */
    remarks: varchar("remarks", { length: 250 }),

    // ── Samoprijava / popravek ─────────────────────────────────────────────
    /** 1 = redni, 2 = samoprijava (88.b), 3 = samo obresti */
    treatment: smallint("treatment").notNull().default(1),
    /** MMMMLLLL (npr. '05002026' za maj 2026) — če treatment ∈ {2,3} */
    correctionPeriod: char("correction_period", { length: 8 }),
    /** Znesek DDV predmeta popravka (pozitiven) */
    correctionAmount: numeric("correction_amount", { precision: 15, scale: 2 }),

    // ── Nespremenljivost in revizijska sled ───────────────────────────────
    /**
     * Kdaj je bila vrstica vključena v oddano evidenco.
     * Ko IS NOT NULL: DB trigger prepreči UPDATE/DELETE.
     * Triggerja: trg_vat_ledger_no_update_after_report,
     *            trg_vat_ledger_no_delete_after_report
     */
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    /** YYYYMM obdobje oddane evidence (npr. '202607') */
    reportedPeriod: char("reported_period", { length: 6 }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    /** Clerk user ID */
    createdBy: text("created_by").notNull(),
    /**
     * Self-ref na storno vrstico.
     * DB FK: REFERENCES vat_ledger(id) — ustvarjen v migracijskem SQL.
     */
    reversedById: uuid("reversed_by_id").references((): AnyPgColumn => vatLedgerTable.id),
  },
  (t) => [
    index("ix_vat_ledger_period").on(t.vatPeriodYear, t.vatPeriod),
    index("ix_vat_ledger_invoice").on(t.invoiceId),
    index("ix_vat_ledger_document").on(t.documentId),
    index("ix_vat_ledger_partner").on(t.partnerId),
    index("ix_vat_ledger_vat_code").on(t.vatCodeId),
    index("ix_vat_ledger_reported").on(t.reportedPeriod),
    check("chk_vat_ledger_direction", sql`direction IN ('IN', 'OUT')`),
    check("chk_vat_ledger_asset_type", sql`asset_type IN ('NONE', 'REALESTATE', 'OTHER_FA')`),
    check("chk_vat_ledger_treatment", sql`treatment IN (1, 2, 3)`),
    check("chk_vat_ledger_deduction", sql`deduction_percent >= 0 AND deduction_percent <= 100`),
  ],
);

export type VatLedger = typeof vatLedgerTable.$inferSelect;
export type NewVatLedger = typeof vatLedgerTable.$inferInsert;
