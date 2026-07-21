import { pgTable, text, serial, integer, timestamp, boolean, jsonb } from "drizzle-orm/pg-core";
import { enoteTable } from "./enote";

export const shranjeniKupciTable = pgTable("shranjeni_kupci", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  naziv: text("naziv").notNull(),
  kratkiNaziv: text("kratki_naziv"),
  naslov: text("naslov"),
  ulica: text("ulica"),
  postnaStevilka: text("postna_stevilka"),
  kraj: text("kraj"),
  drzava: text("drzava"),
  kodaDrzave: text("koda_drzave"),
  zavezanecDdv: boolean("zavezanec_ddv"),
  davcnaStevilka: text("davcna_stevilka"),
  idZaDdv: text("id_za_ddv"),
  maticnaStevilka: text("maticna_stevilka"),
  trr: jsonb("trr").$type<Array<{ iban: string; bic: string }>>(),
  vrstaPartnerja: text("vrsta_partnerja").$type<"obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor">(),
  kmgMid: text("kmg_mid"),
  eRacunPrejemnik: boolean("e_racun_prejemnik"),
  eRacunOmrezje: text("e_racun_omrezje"),
  eRacunEmail: text("e_racun_email"),
  eRacunNaslov: text("e_racun_naslov"),
  eRacunSifraPu: text("e_racun_sifra_pu"),
  eRacunBic: text("e_racun_bic"),
  email: text("email"),
  telefon: text("telefon"),
  steviloUpor: integer("stevilo_upor").notNull().default(1),
  zadnjaUporaba: timestamp("zadnja_uporaba", { withTimezone: true }).notNull().defaultNow(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type ShranjeniKupec = typeof shranjeniKupciTable.$inferSelect;
export type InsertShranjeniKupec = typeof shranjeniKupciTable.$inferInsert;
