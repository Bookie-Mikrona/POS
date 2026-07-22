import { pgTable, text, serial, timestamp, index } from "drizzle-orm/pg-core";

/**
 * AJPES Poslovni register Slovenije — subjekti.
 * Vir: OPSI javni CSV
 * https://podatki.gov.si/dataset/poslovni-register-slovenije
 *
 * Javni CSV vsebuje: matična, naziv, ulica, hišna št., naselje, poštna, pošta, država, pravna oblika.
 * Email, telefon in www so v polnem izvozu AJPES FTP (zahteva registracijo pri AJPES).
 * Polja so prisotna v shemi in bodo zapolnjena, ko bo na voljo polni izvoz.
 */
export const ajpesSubjektiTable = pgTable("ajpes_subjekti", {
  id: serial("id").primaryKey(),
  maticnaSt: text("maticna_st").notNull(),          // 10-mestna (OPSI format, npr. "5000018000")
  naziv: text("naziv").notNull(),
  skrajsanoIme: text("skrajsano_ime"),
  ulica: text("ulica"),
  hisnaSt: text("hisna_st"),
  naselje: text("naselje"),
  postnaStevilka: text("postna_stevilka"),
  posta: text("posta"),
  drzava: text("drzava"),
  email: text("email"),                              // null iz OPSI; zapolni se iz polnega FTP izvoza
  telefon: text("telefon"),
  www: text("www"),
  pravnaOblika: text("pravna_oblika"),
  zadnjiUvoz: timestamp("zadnji_uvoz", { withTimezone: true }).notNull().defaultNow(),
}, t => [
  index("ajpes_maticna_idx").on(t.maticnaSt),
]);

export type AjpesSubjekt = typeof ajpesSubjektiTable.$inferSelect;
