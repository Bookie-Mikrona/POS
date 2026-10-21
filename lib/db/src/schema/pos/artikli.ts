import { pgTable, text, serial, integer, numeric, boolean, json, jsonb, index, timestamp, unique, uniqueIndex, uuid, check } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { enoteTable } from "./enote";
import { kategorijeTable } from "./kategorije";
import { documentsTable } from "../documents";

/**
 * Stabilne kode 14 predpisanih EU alergenov. Kode so namenoma angleške,
 * prikazni nazivi pa ostanejo slovenski in se ne shranjujejo podvojeno.
 */
export const EU_ALERGENI = [
  { koda: "GLUTEN", naziv: "Žita, ki vsebujejo gluten" },
  { koda: "RAKI", naziv: "Raki" },
  { koda: "JAJCA", naziv: "Jajca" },
  { koda: "RIBE", naziv: "Ribe" },
  { koda: "ARASIDI", naziv: "Arašidi" },
  { koda: "SOJA", naziv: "Soja" },
  { koda: "MLEKO", naziv: "Mleko" },
  { koda: "OREŠČKI", naziv: "Oreščki" },
  { koda: "ZELENA", naziv: "Zelena" },
  { koda: "GORČICA", naziv: "Gorčica" },
  { koda: "SEZAM", naziv: "Sezamovo seme" },
  { koda: "SULFITI", naziv: "Žveplov dioksid in sulfiti" },
  { koda: "VOLČJI_BOB", naziv: "Volčji bob" },
  { koda: "MEHKUŽCI", naziv: "Mehkužci" },
] as const;

export type AlergenKoda = (typeof EU_ALERGENI)[number]["koda"];
export type AlergenStatusPotrditve = "nepreverjeno" | "potrjeno_brez" | "potrjeno";
export type AlergenVir = "etiketa" | "specifikacija" | "izjava_dobavitelja" | "normativ" | "rocno" | "drugo";

/** Neposredni, dokazljivi profil artikla oziroma zgodovinski snapshot vrstice. */
export type AlergenProfil = {
  alergeni: AlergenKoda[];
  alergeniSledi: AlergenKoda[];
  alergeniStatus: AlergenStatusPotrditve;
  alergeniVir: AlergenVir | null;
  alergeniOpombaVira: string | null;
  alergeniDocumentId: string | null;
  alergeniVerifiedBy: string | null;
  alergeniVerifiedAt: Date | null;
  alergeniRevision: number;
  alergeniHash: string | null;
};

export const artikliTable = pgTable("artikli", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  ime: text("ime").notNull(),
  opis: text("opis"),
  /** Kratka šifra (PLU) za hiter vnos; enolična znotraj enote. */
  plu: text("plu"),
  cena: numeric("cena", { precision: 10, scale: 2 }).notNull(),
  /** Prodajna cena male pice; null, kadar velikost ni v uporabi. */
  cenaMala: numeric("cena_mala", { precision: 10, scale: 2 }),
  /** Prodajna cena družinske pice; null, kadar velikost ni v uporabi. */
  cenaDruzinska: numeric("cena_druzinska", { precision: 10, scale: 2 }),
  davek: numeric("davek", { precision: 5, scale: 2 }).notNull().default("9.5"),
  aktiven: boolean("aktiven").notNull().default(true),
  kategorijaId: integer("kategorija_id").references(() => kategorijeTable.id),
  barva: text("barva"),
  /** Besedilo, uporabljeno za ustvarjanje slike artikla. */
  opisSlike: text("opis_slike"),
  /** Javni URL slike artikla, ki jo upravlja strežnik. */
  slikaUrl: text("slika_url"),
  vrstniRed: integer("vrstni_red").notNull().default(0),
  nabavniArtikel: boolean("nabavni_artikel").notNull().default(false),
  prodajniArtikel: boolean("prodajni_artikel").notNull().default(true),
  jeSkupinskiNabavniArtikel: boolean("je_skupinski_nabavni_artikel").notNull().default(false),
  povratnaEmbalaza: boolean("povratna_embalaza").notNull().default(false),
  /** Purchase-only quantity-tracked small hospitality equipment with no stock valuation. */
  drobniInventar: boolean("drobni_inventar").notNull().default(false),
  /** Stable template identity for optional small-inventory catalog imports. */
  drobniInventarPredlogaKljuc: text("drobni_inventar_predloga_kljuc"),
  vrstaEmbalaze: text("vrsta_embalaze", { enum: ["steklenica", "zaboj", "keg", "balon", "drugo"] }),
  depozitnaVrednost: numeric("depozitna_vrednost", { precision: 12, scale: 2 }),
  /** Ali je artikel označen kot alkohol za kasnejšo natakarjevo potrditev. */
  jeAlkohol: boolean("je_alkohol").notNull().default(false),
  /** Ročna razpoložljivost artikla na javnem QR meniju. */
  qrNaVoljo: boolean("qr_na_voljo").notNull().default(true),
  imeZaNabavo: text("ime_za_nabavo"),
  enotaMere: text("enota_mere"),
  /** Declared drained-product container contents mass, excluding packaging. */
  brutoTezaG: numeric("bruto_teza_g", { precision: 12, scale: 3 }),
  /** Usable drained mass per package. */
  netoTezaG: numeric("neto_teza_g", { precision: 12, scale: 3 }),
  /** Usable drained mass as a percentage of declared contents mass. */
  netoDelezOdst: numeric("neto_delez_odst", { precision: 7, scale: 4 }),
  /** Monotonic optimistic-concurrency revision for the complete normative. */
  normativRevision: integer("normativ_revision").notNull().default(1),
  /** Yield of one recipe batch; ingredient norms remain per reference portion. */
  recipeBatchPieces: integer("recipe_batch_pieces"),
  /** Optional normal-portion reference in the prepared item's base kg/l unit. Norms stay per base unit. */
  preparedNormPortionQuantity: numeric("prepared_norm_portion_quantity", { precision: 12, scale: 6 }),
  jePica: boolean("je_pica").notNull().default(false),
  /** Postaja priprave prodajnega artikla; null pomeni starejši/neopredeljen zapis. */
  pripravaVrsta: text("priprava_vrsta", { enum: ["pica", "hrana", "pijaca"] }),
  /** Explicit exclusion from preparation screens, independent of routing. */
  kdsIzkljucen: boolean("kds_izkljucen").notNull().default(false),
  jeDodatekZaPico: boolean("je_dodatek_za_pico").notNull().default(false),
  privzetiDodatki: json("privzeti_dodatki").$type<number[]>().notNull().default([]),
  jeModifikator: boolean("je_modifikator").notNull().default(false),
  privzetiModifikatorji: json("privzeti_modifikatorji").$type<number[]>().notNull().default([]),
  toGoArtikli: json("to_go_artikli").$type<number[]>().notNull().default([]),
  toGo: boolean("to_go").notNull().default(false),
  /** Predviden čas priprave za telefonsko/prevzemno naročilo, v minutah. */
  casPripraveMin: integer("cas_priprave_min").notNull().default(0),
  /**
   * Operativni način priprave hrane. Ne zamenjuj z vrstaArtikla, ki je
   * računovodska klasifikacija materiala/blaga/storitve.
   */
  mealType: text("meal_type", { enum: ["ala_carte", "prepared", "composite"] })
    .notNull()
    .default("ala_carte"),
  /**
   * Samo prikaz: ali novi prikaz menija kaže zalogo in opozorila za artikel.
   * Ne vpliva na strežniško preverjanje razpoložljivosti.
   */
  spremljajPorcije: boolean("spremljaj_porcije").notNull().default(false),
  /** Namenska vloga artikla v ponudbi Malic; privzeto nobena. */
  malicaVloga: text("malica_vloga", { enum: ["none", "main", "soup", "dessert"] })
    .notNull()
    .default("none"),
  vrstaArtikla: text("vrsta_artikla").default("storitev"),
  /** Happy Hour cena normalne pice oziroma običajnega artikla. */
  happyHourCena: numeric("happy_hour_cena", { precision: 10, scale: 2 }),
  /** Happy Hour cena male pice. */
  happyHourCenaMala: numeric("happy_hour_cena_mala", { precision: 10, scale: 2 }),
  /** Happy Hour cena družinske pice. */
  happyHourCenaDruzinska: numeric("happy_hour_cena_druzinska", { precision: 10, scale: 2 }),
  skupina: text("skupina"),
  /** DDV kategorija za razreševalnik: food | hot_beverage | cold_beverage | alcoholic */
  taxCategory: text("tax_category").notNull().default("food"),
  /** Ali se artikel prodaja kot sestavni del menija (znižana stopnja, razen alkohola). */
  jeDelMenija: boolean("je_del_menija").notNull().default(false),
  /** Ali artikel vsebuje dodan sladkor (relevantno za toplo in hladno pijačo — vpliva na DDV pri eat_in in to_go) */
  addedSugar: boolean("added_sugar").notNull().default(false),
  /** KN/CN carinska tarifna številka (opcijsko) */
  knCode: text("kn_code"),
  // --- uvozna polja (dodana z migracijo 0009) ---
  /** GTIN (EAN-8/12/13/14) črtna koda. Napolni se ob uparjanju. */
  gtin: text("gtin"),
  /**
   * Pričakovana vstopna DDV stopnja na prejemnici (LOČENA od prodajne davek).
   * Kavna zrna: nabava 9,5 %, prodaja pri mizi 22 % — oboje pravilno.
   */
  nabavnaDdvStopnja: numeric("nabavna_ddv_stopnja", { precision: 5, scale: 2 }),
  /** Neposredni alergenski profil; prazna seznama ne pomenita potrditve brez alergenov. */
  alergeni: jsonb("alergeni").$type<AlergenKoda[]>().notNull().default([]),
  alergeniSledi: jsonb("alergeni_sledi").$type<AlergenKoda[]>().notNull().default([]),
  alergeniStatus: text("alergeni_status", { enum: ["nepreverjeno", "potrjeno_brez", "potrjeno"] })
    .notNull().default("nepreverjeno"),
  alergeniVir: text("alergeni_vir", { enum: ["etiketa", "specifikacija", "izjava_dobavitelja", "normativ", "rocno", "drugo"] }),
  alergeniOpombaVira: text("alergeni_opomba_vira"),
  alergeniDocumentId: uuid("alergeni_document_id").references(() => documentsTable.id, { onDelete: "restrict" }),
  alergeniVerifiedBy: text("alergeni_verified_by"),
  alergeniVerifiedAt: timestamp("alergeni_verified_at", { withTimezone: true }),
  alergeniRevision: integer("alergeni_revision").notNull().default(0),
  alergeniHash: text("alergeni_hash"),
}, (t) => [
  // 032-performance-indexes.sql: ix_artikli_enota_aktiven
  index("ix_artikli_enota_aktiven").on(t.enotaId, t.aktiven),
  uniqueIndex("artikli_enota_drobni_inventar_predloga_unique")
    .on(t.enotaId, t.drobniInventarPredlogaKljuc)
    .where(sql`${t.drobniInventarPredlogaKljuc} IS NOT NULL`),
  unique("artikli_id_enota_unique").on(t.id, t.enotaId),
  check("artikli_prepared_norm_portion_positive",
    sql`${t.preparedNormPortionQuantity} IS NULL OR ${t.preparedNormPortionQuantity} > 0`),
  check(
    "artikli_skupinski_nabavni_artikel_check",
    sql`NOT ${t.jeSkupinskiNabavniArtikel} OR (
      ${t.nabavniArtikel} = true
      AND ${t.prodajniArtikel} = false
      AND ${t.enotaMere} IS NOT NULL
      AND upper(btrim(${t.enotaMere})) IN (
        'KOS', 'KOM', 'PCE', 'EA', 'H87',
        'KG', 'KGM', 'G', 'GRM',
        'L', 'LTR', 'ML', 'MLT',
        'M', 'MTR', 'M2', 'MTK', 'M3', 'MTQ',
        'KAR', 'CT', 'SKA', 'BX'
      )
    )`,
  ),
  check(
    "artikli_drobni_inventar_check",
    sql`NOT ${t.drobniInventar} OR (
      ${t.nabavniArtikel} = true
      AND ${t.prodajniArtikel} = false
      AND ${t.povratnaEmbalaza} = false
      AND ${t.vrstaArtikla} = 'material'
    )`,
  ),
]);

export const artikliRelations = relations(artikliTable, ({ one }) => ({
  kategorija: one(kategorijeTable, {
    fields: [artikliTable.kategorijaId],
    references: [kategorijeTable.id],
  }),
}));

/** Immutable audit trail of uploaded and AI-edited article images. Bytes remain in object storage. */
export const articleImageVersionsTable = pgTable("article_image_versions", {
  id: serial("id").primaryKey(),
  artikelId: integer("artikel_id").notNull().references(() => artikliTable.id, { onDelete: "cascade" }),
  storageKey: text("storage_key").notNull(),
  slikaUrl: text("slika_url").notNull(),
  altText: text("alt_text"),
  prompt: text("prompt"),
  source: text("source").notNull(), // upload | generate | edit | restore | bulk
  isCurrent: boolean("is_current").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("ix_article_image_versions_artikel").on(t.artikelId, t.createdAt),
  index("ix_article_image_versions_current").on(t.artikelId, t.isCurrent),
]);

export type Artikel = typeof artikliTable.$inferSelect;
export type InsertArtikel = typeof artikliTable.$inferInsert;
