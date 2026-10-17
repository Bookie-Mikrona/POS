import { pgTable, serial, text, timestamp, numeric, integer, date, uuid, pgEnum, uniqueIndex, jsonb, check, boolean } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { enoteTable } from "./enote";
import { artikliTable } from "./artikli";
import { counterpartiesTable } from "../counterparties";
import { purchaseSourceDocumentsTable } from "../purchase-source-documents";
import { posSupplierOrderLinesTable } from "./narocila-dobaviteljem";
import type { AlergenKoda, AlergenStatusPotrditve, AlergenVir } from "./artikli";

export const prejemnicaVrstaDokumenta = pgEnum("prejemnica_vrsta_dokumenta", [
  "RACUN", "DOBAVNICA", "DOBROPIS", "BREMEPIS",
]);
export const prejemnicaStatus = pgEnum("prejemnica_status", ["draft", "confirmed"]);

export const prejemniceTable = pgTable("prejemnice", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  dobaviteljId: uuid("dobavitelj_id").references(() => counterpartiesTable.id, { onDelete: "set null" }),
  stevilka: text("stevilka"),
  datum: timestamp("datum").notNull().defaultNow(),
  opomba: text("opomba"),
  vrstaCen: text("vrsta_cen").notNull().default("neto"),
  skupajVrednost: numeric("skupaj_vrednost", { precision: 10, scale: 2 }).notNull().default("0"),
  ustvarjeno: timestamp("ustvarjeno").notNull().defaultNow(),
  // --- uvozna polja (dodata z migracijo 0009) ---
  /** Številka dobaviteljevega dokumenta */
  stDokumenta: text("st_dokumenta"),
  /** Datum dobaviteljevega dokumenta */
  datumDokumenta: date("datum_dokumenta"),
  /** Sklic na uvozno sejo, ki je ustvarila to prejemnico */
  uvozSejaId: uuid("uvoz_seja_id"),
  /** ISO valuta dobaviteljevega dokumenta. Obstoječe prejemnice so v EUR. */
  valuta: text("valuta").notNull().default("EUR"),
  /** Rok plačila na dobaviteljevem dokumentu. */
  datumZapadlosti: date("datum_zapadlosti"),
  /** Skupna davčna osnova dokumenta, kadar jo dobavitelj navede. */
  ddvOsnova: numeric("ddv_osnova", { precision: 14, scale: 2 }),
  /** Skupni znesek DDV dokumenta, kadar ga dobavitelj navede. */
  ddvZnesek: numeric("ddv_znesek", { precision: 14, scale: 2 }),
  vrstaDokumenta: prejemnicaVrstaDokumenta("vrsta_dokumenta"),
  datumDobave: date("datum_dobave"),
  datumOpravljeneStoritve: date("datum_opravljene_storitve"),
  brutoSkupaj: numeric("bruto_skupaj", { precision: 14, scale: 2 }),
  placilniNacin: text("placilni_nacin"),
  placanoZGotovino: boolean("placano_z_gotovino").notNull().default(false),
  placilniModel: text("placilni_model"),
  placilniSklic: text("placilni_sklic"),
  placilniNamen: text("placilni_namen"),
  // Nespremenljiv dokumentni posnetek; ne bere se ponovno iz živega šifranta.
  dobaviteljNaziv: text("dobavitelj_naziv"),
  dobaviteljDavcna: text("dobavitelj_davcna"),
  dobaviteljIdDdv: text("dobavitelj_id_ddv"),
  dobaviteljMaticna: text("dobavitelj_maticna"),
  dobaviteljUlica: text("dobavitelj_ulica"),
  dobaviteljPosta: text("dobavitelj_posta"),
  dobaviteljKraj: text("dobavitelj_kraj"),
  dobaviteljDrzava: text("dobavitelj_drzava"),
  dobaviteljIban: text("dobavitelj_iban"),
  dobaviteljBic: text("dobavitelj_bic"),
  prejemnikNaziv: text("prejemnik_naziv"),
  prejemnikDavcna: text("prejemnik_davcna"),
  prejemnikIdDdv: text("prejemnik_id_ddv"),
  prejemnikNaslov: text("prejemnik_naslov"),
  prejemnikDrzava: text("prejemnik_drzava"),
  snapshotZajet: timestamp("snapshot_zajet", { withTimezone: true }),
  /** Skupna identiteta listine čez POS in ERP. */
  sourceDocumentId: uuid("source_document_id").references(
    () => purchaseSourceDocumentsTable.id,
    { onDelete: "restrict" },
  ),
  status: prejemnicaStatus("status").notNull().default("draft"),
}, (t) => [
  uniqueIndex("prejemnice_source_document_unique")
    .on(t.sourceDocumentId),
]);

export const prejemnicePostavkeTable = pgTable("prejemnice_postavke", {
  id: serial("id").primaryKey(),
  prejemnicaId: integer("prejemnica_id").notNull().references(() => prejemniceTable.id, { onDelete: "cascade" }),
  supplierOrderLineId: integer("supplier_order_line_id").references(
    () => posSupplierOrderLinesTable.id,
    { onDelete: "restrict" },
  ),
  // artikel_id je NULL pri uvoznih osnutkih (DROP NOT NULL v migraciji 0009)
  artikelId: integer("artikel_id").references(() => artikliTable.id),
  kolicina: numeric("kolicina", { precision: 10, scale: 4 }).notNull().default("0"),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 4 }).notNull().default("0"),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull().default("0"),
  enotVPaketu: numeric("enot_v_paketu", { precision: 10, scale: 4 }).notNull().default("1"),
  // --- uvozna polja (dodana z migracijo 0009) ---
  izvGtin:            text("izv_gtin"),
  izvSifra:           text("izv_sifra"),
  izvNaziv:           text("izv_naziv"),
  izvEnota:           text("izv_enota"),
  izvKolicina:        numeric("izv_kolicina", { precision: 18, scale: 6 }),
  izvCena:            numeric("izv_cena", { precision: 15, scale: 6 }),
  /** Source unit price basis; null only on legacy rows with unknown semantics. */
  izvCenaVrsta:       text("izv_cena_vrsta", { enum: ["neto", "bruto"] }),
  /** Whether source price already includes the recorded discounts; null on legacy rows. */
  rabatVkljucenVCeni: boolean("rabat_vkljucen_v_ceni"),
  uparjanje:          text("uparjanje"),
  uparjanjeZaupanje:  numeric("uparjanje_zaupanje", { precision: 5, scale: 2 }),
  uparjanjeKandidati: text("uparjanje_kandidati"), // JSONB, preberemo kot text
  rabat1Odst:         numeric("rabat_1_odst", { precision: 7, scale: 4 }).default("0"),
  rabat2Odst:         numeric("rabat_2_odst", { precision: 7, scale: 4 }).default("0"),
  opozorila:          text("opozorila"), // JSONB, preberemo kot text
  /** DDV podatki z dobaviteljeve vrstice; ne vplivajo na zalogo v KORAKU 2. */
  ddvStopnja:         numeric("ddv_stopnja", { precision: 5, scale: 2 }),
  ddvOsnova:          numeric("ddv_osnova", { precision: 14, scale: 2 }),
  ddvZnesek:          numeric("ddv_znesek", { precision: 14, scale: 2 }),
  vatCodeId:           uuid("vat_code_id"),
  /** Kanonični računovski podatki za prihodnji e-SLOG prejetega računa. */
  enotaMere:           text("enota_mere"),
  netoCena:            numeric("neto_cena", { precision: 15, scale: 6 }),
  netoZnesek:          numeric("neto_znesek", { precision: 14, scale: 2 }),
  ddvKategorija:       text("ddv_kategorija"),
  /** Immutable drained-yield snapshot used for this receipt line. */
  brutoTezaG:          numeric("bruto_teza_g", { precision: 12, scale: 3 }),
  netoTezaG:           numeric("neto_teza_g", { precision: 12, scale: 3 }),
  netoDelezOdst:       numeric("neto_delez_odst", { precision: 7, scale: 4 }),
  /** Stabilna računovodska obravnava vrstice; ne ugiba se iz naziva. */
  vrsticaTip:          text("vrstica_tip").notNull().default("zaloga"),
  /**
   * Nespremenljiv alergenski posnetek dobaviteljeve vrstice. Živi profil
   * artikla se lahko kasneje spremeni, posnetek pa ostane dokaz zgodovine.
   */
  alergeni: jsonb("alergeni").$type<AlergenKoda[]>().notNull().default([]),
  alergeniSledi: jsonb("alergeni_sledi").$type<AlergenKoda[]>().notNull().default([]),
  alergeniStatus: text("alergeni_status", { enum: ["nepreverjeno", "potrjeno_brez", "potrjeno"] })
    .notNull().default("nepreverjeno"),
  alergeniVir: text("alergeni_vir", { enum: ["etiketa", "specifikacija", "izjava_dobavitelja", "normativ", "rocno", "drugo"] }),
  alergeniOpombaVira: text("alergeni_opomba_vira"),
  alergeniDocumentId: uuid("alergeni_document_id"),
  alergeniVerifiedBy: text("alergeni_verified_by"),
  alergeniVerifiedAt: timestamp("alergeni_verified_at", { withTimezone: true }),
  alergeniRevision: integer("alergeni_revision").notNull().default(0),
  alergeniHash: text("alergeni_hash"),
}, (t) => [
  check("prejemnice_postavke_vrstica_tip_check", sql`${t.vrsticaTip} IN ('zaloga', 'poraba_surovin', 'prevoz')`),
]);

export const prejemniceRelations = relations(prejemniceTable, ({ many }) => ({
  postavke: many(prejemnicePostavkeTable),
  odvisniStroski: many(prejemniceOdvisniStroskiTable),
}));

export const prejemnicePostavkeRelations = relations(prejemnicePostavkeTable, ({ one }) => ({
  prejemnica: one(prejemniceTable, { fields: [prejemnicePostavkeTable.prejemnicaId], references: [prejemniceTable.id] }),
}));

/**
 * Stroški dobave, prevoza, zavarovanja ipd. so ločeni od materialnih vrstic.
 * Njihova računovodska obravnava se uporabi šele pri nabavni temeljnici.
 */
export const prejemniceOdvisniStroskiTable = pgTable("prejemnice_odvisni_stroski", {
  id: serial("id").primaryKey(),
  prejemnicaId: integer("prejemnica_id")
    .notNull()
    .references(() => prejemniceTable.id, { onDelete: "cascade" }),
  naziv: text("naziv").notNull(),
  znesek: numeric("znesek", { precision: 14, scale: 2 }).notNull(),
  ddvStopnja: numeric("ddv_stopnja", { precision: 5, scale: 2 }),
  /** Ali strošek poveča nabavno vrednost zaloge ali ostane ločen strošek. */
  obravnava: text("obravnava").notNull().default("zaloga"),
});

export const prejemniceOdvisniStroskiRelations = relations(prejemniceOdvisniStroskiTable, ({ one }) => ({
  prejemnica: one(prejemniceTable, {
    fields: [prejemniceOdvisniStroskiTable.prejemnicaId],
    references: [prejemniceTable.id],
  }),
}));

export type Prejemnica = typeof prejemniceTable.$inferSelect;
export type PrejemnicaPostavka = typeof prejemnicePostavkeTable.$inferSelect;
export type PrejemnicaOdvisniStrosek = typeof prejemniceOdvisniStroskiTable.$inferSelect;
