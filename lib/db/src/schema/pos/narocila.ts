import { pgTable, text, serial, integer, smallint, numeric, timestamp, boolean, index, jsonb, uniqueIndex } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { enoteTable } from "./enote";
import { mizeTable } from "./mize";
import { artikliTable } from "./artikli";
import { shranjeniKupciTable } from "./shranjeni-kupci";
import { narocnikiTable } from "./narocniki";
import { naseljaTable } from "./naselja";
import { rezervacijeMizTable } from "./rezervacije-miz";
import { dostavniKurirjiTable } from "./dostava-operacije";

export const narocilaTable = pgTable("narocila", {
  id: serial("id").primaryKey(),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  mizaId: integer("miza_id").references(() => mizeTable.id),
  /** Explicitly consumed reservation; never inferred from the table. */
  rezervacijaId: integer("rezervacija_id").references(() => rezervacijeMizTable.id, { onDelete: "set null" }),
  status: text("status", { enum: ["odprto", "zakljuceno", "preklicano"] }).notNull().default("odprto"),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull().default("0"),
  /** Napitnina, ki jo je gost vnesel na zaključnem pregledu QR naročila; ločena od prodaje. */
  znesekNapitnina: numeric("znesek_napitnina", { precision: 10, scale: 2 }).notNull().default("0"),
  opomba: text("opomba"),
  stevilkaNarocila: integer("stevilka_narocila"),
  /** Ali je naročilo označeno kot "Za s seboj" (vpliva na DDV razreševanje novih postavk) */
  toGo: boolean("to_go").notNull().default(false),
  /** Izvor naročila; telefonsko naročilo nima mize in uporablja oceno prevzema. */
  nacin: text("nacin", { enum: ["miza", "telefon"] }).notNull().default("miza"),
  /** Način nastanka naročila; QR gost se prikaže osebju, vendar ostane naročilo za mizo. */
  vir: text("vir", { enum: ["osebje", "qr_gost"] }).notNull().default("osebje"),
  /**
   * Naključna, lokalno shranjena identiteta brskalnika javnega QR menija.
   * Ločena je od postavke.napravaId, ki ostaja namenjen POS usmerjanju priprave.
   */
  qrNapravaId: text("qr_naprava_id"),
  strankaIme: text("stranka_ime"),
  strankaTelefon: text("stranka_telefon"),
  shranjeniKupecId: integer("shranjeni_kupec_id").references(() => shranjeniKupciTable.id, { onDelete: "set null" }),
  predvidenPrevzem: timestamp("predviden_prevzem", { withTimezone: true }),
  predvidenPrevzemRocen: boolean("predviden_prevzem_rocen").notNull().default(false),
  /**
   * Način izpolnitve telefonskega naročila. Prevzem je privzet zaradi združljivosti
   * z obstoječimi naročili in naročili za mizo.
   */
  nacinIzpolnitve: text("nacin_izpolnitve", { enum: ["prevzem", "dostava"] }).notNull().default("prevzem"),
  /** Fizična oseba iz ločenega šifranta naročnikov, ne poslovni partner. */
  narocnikId: integer("narocnik_id").references(() => narocnikiTable.id, { onDelete: "set null" }),
  /** Nespremenljiv naslovni posnetek ob oddaji dostavnega naročila. */
  dostavaUlica: text("dostava_ulica"),
  dostavaHisnaStevilka: text("dostava_hisna_stevilka"),
  dostavaVhod: text("dostava_vhod"),
  dostavaNadstropje: text("dostava_nadstropje"),
  dostavaNaseljeNaziv: text("dostava_naselje_naziv"),
  dostavaNavodilo: text("dostava_navodilo"),
  dostavaNaseljeId: integer("dostava_naselje_id").references(() => naseljaTable.id, { onDelete: "set null" }),
   /**
    * Nespremenljiva identiteta storitve, s katero je bila ustvarjena dostavna
    * postavka. Ne uporablja FK, saj gre za zgodovinski posnetek.
    */
   dostavaStoritevId: integer("dostava_storitev_id"),
   /** Snapshoti pogojev iz naselja; dejanski obračun je vedno postavka naročila. */
  dostavaCena: numeric("dostava_cena", { precision: 10, scale: 2 }),
  dostavaCasMin: integer("dostava_cas_min"),
  /** Predvideni prihod dostavljavca: čas pripravljenosti + čas naselja. */
  predvidenaDostava: timestamp("predvidena_dostava", { withTimezone: true }),
  dostavaStatus: text("dostava_status", { enum: ["prejeto", "potrjeno", "v_pripravi", "pripravljeno", "prevzel_kurir", "dostavljeno", "preklicano"] }),
  dostavaKurirId: integer("dostava_kurir_id").references(() => dostavniKurirjiTable.id, { onDelete: "set null" }),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  posodobljeno: timestamp("posodobljeno", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  index("ix_narocila_enota_status").on(t.enotaId, t.status),
  index("ix_narocila_rezervacija_id").on(t.rezervacijaId),
  index("ix_narocila_qr_history_retention")
    .on(t.posodobljeno)
    .where(sql`${t.vir} = 'qr_gost' AND ${t.status} IN ('zakljuceno', 'preklicano') AND ${t.qrNapravaId} IS NOT NULL`),
]);

export const postavkeTable = pgTable("postavke", {
  id: serial("id").primaryKey(),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  artikelId: integer("artikel_id").references(() => artikliTable.id),
  /**
   * Nespremenljiv posnetek POS kategorije ob nastanku postavke.
   * Brez FK-ja, da brisanje kategorije ne prepiše računovodske zgodovine.
   */
  kategorijaId: integer("kategorija_id"),
  modifikatorId: integer("modifikator_id"),
  ime: text("ime").notNull(),
  kolicina: integer("kolicina").notNull().default(1),
  cenaKos: numeric("cena_kos", { precision: 10, scale: 2 }).notNull(),
  cenaKosOriginalna: numeric("cena_kos_originalna", { precision: 10, scale: 2 }),
  skupaj: numeric("skupaj", { precision: 10, scale: 2 }).notNull(),
  davek: numeric("davek", { precision: 5, scale: 2 }).notNull(),
  opomba: text("opomba"),
  racunId: integer("racun_id"),
  gostStevilka: smallint("gost_stevilka"),
  parentPostavkaId: integer("parent_postavka_id"),
  /**
   * QR multicourse menu metadata.  Both the food and its paired wine are
   * independent, routable order lines, linked only by this immutable group.
   * Null keeps all pre-existing, flat-item ordering behaviour unchanged.
   */
  courseNumber: smallint("course_number"),
  courseSequence: smallint("course_sequence"),
  /** Immutable configured course name captured when the menu is ordered. */
  courseNameSnapshot: text("course_name_snapshot"),
  pairingGroupId: text("pairing_group_id"),
  /** Client idempotency key for composite sales flows. */
  idempotencyKey: text("idempotency_key"),
  malicaDailyMainItemId: integer("malica_daily_main_item_id"),
  malicaDailyCourseId: integer("malica_daily_course_id"),
  toGo: boolean("to_go").notNull().default(false),
  vrstaArtikla: text("vrsta_artikla"),
  /** Način priprave ob nastanku vrstice; ne spreminja se ob poznejši spremembi artikla. */
  mealType: text("meal_type", { enum: ["ala_carte", "prepared", "composite"] })
    .notNull()
    .default("ala_carte"),
  /** ID pravila iz vat_rule, ki je bilo upoštevano pri DDV razreševanju (revizija) */
  appliedRuleId: integer("applied_rule_id"),
  /** Nespremenljiv posnetek, da je bila postavka ob prodaji del menija. */
  jeDelMenija: boolean("je_del_menija").notNull().default(false),
  /** Izbrana velikost pice in njen nespremenljiv faktor za normative. */
  velikostPice: text("velikost_pice", { enum: ["mala", "normalna", "druzinska"] }),
  /** Nespremenljiv posnetek artikla testa, uporabljenega za velikost pice. */
  pizzaDoughArticleId: integer("pizza_dough_article_id"),
  normativFaktor: numeric("normativ_faktor", { precision: 12, scale: 6 }).notNull().default("1"),
  /** Nespremenljiv posnetek vhodnih artiklov normativa modifikatorja ob prodaji. */
  availabilityRequirements: jsonb("availability_requirements").$type<Array<{
    articleId: number;
    quantity: number;
    mealType: "ala_carte" | "prepared" | "composite";
  }>>(),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
  pripravljeno: timestamp("pripravljeno", { withTimezone: true }),
  napravaId: text("naprava_id"),
  /** Zgodovinski status potrditve; QR naročila ga ne uporabljajo za usmerjanje. */
  statusPotrditve: text("status_potrditve", { enum: ["ni_potrebno", "caka_potrditev", "potrjeno"] }).notNull().default("ni_potrebno"),
  /** Live lifecycle of a composite package; facts remain stored after cancellation. */
  packageStatus: text("package_status", { enum: ["active", "cancelled"] }).notNull().default("active"),
}, (t) => [
  index("ix_postavke_narocilo_idempotency").on(t.narociloId, t.idempotencyKey),
  uniqueIndex("ux_postavke_narocilo_idempotency").on(t.narociloId, t.idempotencyKey),
  index("ix_postavke_narocilo_id").on(t.narociloId),
]);

export const prenosiNarocilTable = pgTable("prenosi_narocil", {
  id: serial("id").primaryKey(),
  narociloId: integer("narocilo_id").notNull().references(() => narocilaTable.id, { onDelete: "cascade" }),
  enotaId: integer("enota_id").notNull().references(() => enoteTable.id, { onDelete: "cascade" }),
  staraMizaId: integer("stara_miza_id").references(() => mizeTable.id),
  novaMizaId: integer("nova_miza_id").references(() => mizeTable.id),
  ustvarjeno: timestamp("ustvarjeno", { withTimezone: true }).notNull().defaultNow(),
});

export const narocilaRelations = relations(narocilaTable, ({ one, many }) => ({
  miza: one(mizeTable, { fields: [narocilaTable.mizaId], references: [mizeTable.id] }),
  shranjeniKupec: one(shranjeniKupciTable, { fields: [narocilaTable.shranjeniKupecId], references: [shranjeniKupciTable.id] }),
  narocnik: one(narocnikiTable, { fields: [narocilaTable.narocnikId], references: [narocnikiTable.id] }),
  dostavaNaselje: one(naseljaTable, { fields: [narocilaTable.dostavaNaseljeId], references: [naseljaTable.id] }),
  postavke: many(postavkeTable),
  prenosi: many(prenosiNarocilTable),
}));

export const postavkeRelations = relations(postavkeTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [postavkeTable.narociloId], references: [narocilaTable.id] }),
  artikel: one(artikliTable, { fields: [postavkeTable.artikelId], references: [artikliTable.id] }),
}));

export const prenosiNarocilRelations = relations(prenosiNarocilTable, ({ one }) => ({
  narocilo: one(narocilaTable, { fields: [prenosiNarocilTable.narociloId], references: [narocilaTable.id] }),
  staraMiza: one(mizeTable, { fields: [prenosiNarocilTable.staraMizaId], references: [mizeTable.id], relationName: "prenosStaraMiza" }),
  novaMiza: one(mizeTable, { fields: [prenosiNarocilTable.novaMizaId], references: [mizeTable.id], relationName: "prenosNovaMiza" }),
}));

export type Narocilo = typeof narocilaTable.$inferSelect;
export type Postavka = typeof postavkeTable.$inferSelect;
export type PrenosNarocila = typeof prenosiNarocilTable.$inferSelect;
