import { pgTable, text, uuid, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * ERP register podjetij.
 * `podjetje_davcna` je skupni multi-tenant ključ s FURS POS Web —
 * vsak zapis v FURS POS Web tabelah ima ta stolpec.
 */
export const companiesTable = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** Davčna številka — skupni ključ s FURS POS Web (format: SI12345678) */
  podjetjeDavcna: text("podjetje_davcna").notNull().unique(),
  naziv: text("naziv").notNull(),
  kratekNaziv: text("kratek_naziv"),
  /** Polni naslov v eni vrstici (za nazaj-združljivost) */
  naslov: text("naslov"),
  /** Ulica in hišna številka (ločeno od poštne) */
  ulica: text("ulica"),
  postnaStevika: text("postna_stevilka"),
  kraj: text("kraj"),
  drzava: text("drzava"),
  kodaDrzave: text("koda_drzave"),
  /** Matična številka podjetja */
  maticnaStevilka: text("maticna_stevilka"),
  /** ID za DDV (SI + 8-mestna davčna) */
  idZaDdv: text("id_za_ddv"),
  /** Ali je podjetje DDV zavezanec */
  zavezanecDdv: boolean("zavezanec_ddv"),
  /** Bančni računi (TRR): [{iban, bic}], prvi je privzeti za negotovinsko plačilo */
  trr: jsonb("trr").$type<Array<{ iban: string; bic: string }>>(),
  /** Kontaktni podatki */
  email: text("email"),
  telefon: text("telefon"),
  www: text("www"),
  /** e-Račun nastavitve */
  eRacunPrejemnik: boolean("e_racun_prejemnik"),
  eRacunOmrezje: text("e_racun_omrezje"),
  eRacunEmail: text("e_racun_email"),
  eRacunNaslov: text("e_racun_naslov"),
  eRacunSifraPu: text("e_racun_sifra_pu"),
  eRacunBic: text("e_racun_bic"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertCompanySchema = createInsertSchema(companiesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export const selectCompanySchema = createSelectSchema(companiesTable);
export type InsertCompany = z.infer<typeof insertCompanySchema>;
export type Company = typeof companiesTable.$inferSelect;
