import {
  pgTable,
  uuid,
  varchar,
  text,
  numeric,
  date,
  boolean,
  unique,
} from "drizzle-orm/pg-core";

/**
 * Globalni FURS šifrant DDV kod z mapiranji v KIR/KPR polja.
 *
 * Ločena od per-company `vat_codes` tabele (ki hrani konte za podjetje).
 * Versioning: za spremembo stopnje/pravil dodaj novo vrstico z novim valid_from
 * (nikoli ne posodabljaj obstoječih). PK je UUID, naravni ključ je (code, valid_from).
 *
 * Vir: FURS DDV_KIR_KPR_1.xsd v1.3, Spec. ERP 3. del, razdelek C.
 */
export const vatCodeTable = pgTable(
  "vat_code",
  {
    /** Surrogate PK — vat_ledger.vat_code_id kaže sem */
    id: uuid("id").primaryKey().defaultRandom(),
    /** Koda npr. 'S22', 'EUB22', 'RC76A-22'. Naravni ključ skupaj z valid_from. */
    code: varchar("code", { length: 16 }).notNull(),
    description: text("description").notNull(),
    /** Smer: OUT = izdana stran (KIR), IN = prejeta stran (KPR) */
    direction: varchar("direction", { length: 3 })
      .notNull()
      .$type<"IN" | "OUT">(),
    /** DDV stopnja v % (0.00, 5.00, 9.50, 22.00) */
    rate: numeric("rate", { precision: 5, scale: 2 }).notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    /** NULL = trenutno veljavna */
    validTo: date("valid_to", { mode: "string" }),

    // ── Kam prispeva osnova ─────────────────────────────────────────────────
    /** KIR polje za osnovo (npr. 'P7', 'P10'); NULL če koda ne polni KIR osnove */
    kirBaseField: varchar("kir_base_field", { length: 4 }),
    /** KPR polje za osnovo (npr. 'P8', 'P10', 'P11'); NULL če koda ne polni KPR osnove */
    kprBaseField: varchar("kpr_base_field", { length: 4 }),

    // ── Kam prispeva DDV ───────────────────────────────────────────────────
    /** KIR polje za DDV (npr. 'P14', 'P17', 'P23', 'P26'); NULL za oproščene */
    kirVatField: varchar("kir_vat_field", { length: 4 }),
    /** KPR polje za odbitek (npr. 'P18', 'P19', 'P20', 'P21' za pavšal) */
    kprVatField: varchar("kpr_vat_field", { length: 4 }),

    // ── Dodatni obrazci ───────────────────────────────────────────────────
    /** Ali koda sproži vpis v RP-O (rekapitulacijsko poročilo) */
    triggersRpO: boolean("triggers_rp_o").notNull().default(false),
    /** Stolpec v RP-O ('A3', 'B3'); NULL če triggersRpO = false */
    rpOColumn: varchar("rp_o_column", { length: 2 }),
    triggersPdO: boolean("triggers_pd_o").notNull().default(false),

    // ── Posebni zastavici ──────────────────────────────────────────────────
    /**
     * TRUE pri kodah ki generirajo par (IN + OUT) vrstic v vat_ledger:
     * RC76A-*, EUB*, EUS*, TS*, UV*
     */
    isReverseCharge: boolean("is_reverse_charge").notNull().default(false),
    /** TRUE samo za uvozne kode (UV22, UV95, UV5, UVP22) */
    isImport: boolean("is_import").notNull().default(false),
  },
  (t) => [
    // Naravni ključ — prepreči podvojene verzije iste kode
    unique("uq_vat_code_version").on(t.code, t.validFrom),
  ],
);

export type VatCodeFurs = typeof vatCodeTable.$inferSelect;
