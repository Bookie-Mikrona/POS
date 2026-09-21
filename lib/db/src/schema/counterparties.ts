import {
  pgTable,
  text,
  uuid,
  timestamp,
  pgEnum,
  integer,
  boolean,
  jsonb,
} from "drizzle-orm/pg-core";
import { companiesTable } from "./companies";

export const counterpartyTypeEnum = pgEnum("counterparty_type", [
  "customer",
  "supplier",
  "both",
]);

/**
 * Skupen šifrant poslovnih partnerjev — kupci in dobavitelji.
 * Vezan na company (podjetje), NE na enoto — vse enote istega podjetja
 * in ERP moduli (Glavna knjiga, OS) delijo isti šifrant.
 * Tip "both" pomeni, da je partner hkrati kupec in dobavitelj.
 */
export const counterpartiesTable = pgTable("counterparties", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companiesTable.id, { onDelete: "cascade" }),
  type: counterpartyTypeEnum("type").notNull(),
  name: text("name").notNull(),
  /** Kratki/skrajšani naziv (POS) */
  kratkiNaziv: text("kratki_naziv"),
  /** Davčna številka (SI12345678 ali tuja) */
  taxId: text("tax_id"),
  /** DDV identifikacijska številka z državo (npr. SI12345678, DE123456789) */
  idZaDdv: text("id_za_ddv"),
  /** Matična številka podjetja (8-mestna, AJPES register) */
  registrationNumber: text("registration_number"),
  /** Zavezanec za DDV */
  vatPayer: boolean("vat_payer").notNull().default(false),
  /** Naslov (ulica + hišna številka v enem polju — za ERP) */
  address: text("address"),
  /** Ulica ločeno (za POS) */
  ulica: text("ulica"),
  postCode: text("post_code"),
  city: text("city"),
  country: text("country").default("SI"),
  /** Koda države (ISO 3166-1 alpha-2, npr. SI, DE, AT) */
  kodaDrzave: text("koda_drzave"),
  email: text("email"),
  phone: text("phone"),
  /** Primarni IBAN (za ERP plačila) */
  iban: text("iban"),
  /** Seznam TRR računov z IBAN in BIC (za POS) */
  trr: jsonb("trr").$type<Array<{ iban: string; bic: string }>>(),
  /** Plačilni rok v dnevih (privzeto 30) */
  paymentTermsDays: integer("payment_terms_days").default(30),
  notes: text("notes"),
  isActive: boolean("is_active").notNull().default(true),
  // ── POS-specifična polja ──────────────────────────────────────────────
  /** Vrsta partnerja: obcan / sp / podjetje / kmet / javni_sektor */
  vrstaPartnerja: text("vrsta_partnerja").$type<"obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor">(),
  /** KMG-MID kmetijsko gospodarstvo */
  kmgMid: text("kmg_mid"),
  /** Ali je partner prejemnik e-računov */
  eRacunPrejemnik: boolean("e_racun_prejemnik").default(false),
  /** Omrežje za dostavo e-računov (npr. "BizBox", "UJP") */
  eRacunOmrezje: text("e_racun_omrezje"),
  /** E-poštni naslov za e-račune */
  eRacunEmail: text("e_racun_email"),
  /** E-naslov prejemnika v e-račun omrežju */
  eRacunNaslov: text("e_racun_naslov"),
  /** Šifra proračunskega uporabnika (UJP) */
  eRacunSifraPu: text("e_racun_sifra_pu"),
  /** BIC koda banke za e-račune */
  eRacunBic: text("e_racun_bic"),
  /** Število uporab (POS pogosti partnerji) */
  steviloUpor: integer("stevilo_upor").notNull().default(1),
  /** Čas zadnje uporabe (POS pogosti partnerji) */
  zadnjaUporaba: timestamp("zadnja_uporaba", { withTimezone: true })
    .notNull()
    .defaultNow(),
  // ─────────────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type Counterparty = typeof counterpartiesTable.$inferSelect;
