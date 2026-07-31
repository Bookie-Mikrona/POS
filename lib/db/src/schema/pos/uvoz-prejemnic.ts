// lib/db/src/schema/pos/uvoz-prejemnic.ts
//
// Modul uvoza prejemnic — Drizzle shema, prilagojena za BOOKIE.
//
// Prilagoditve glede na Claudov izvornik:
//   - bigserial/bigint → serial/integer (BOOKIE uporablja integer PKs)
//   - podjetje_id → enota_id (tenant ključ v BOOKIE)
//   - partnerji → shranjeniKupciTable (tabela kupcev/dobaviteljev v BOOKIE)
//   - artikel.naziv → artikel.ime, artikel.osnovna_enota → artikel.enota_mere
//   - tip IN ('NABAVNI',...) → nabavni_artikel = TRUE
//
// Opomba k migraciji: `drizzle-kit generate` NE zna ustvariti funkcij
// f_unaccent in naziv_norm, od katerih je odvisen generirani stolpec.
// Migracija 0009 jih zato ustvari ročno PRED tabelami.

import { sql } from 'drizzle-orm';
import {
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Obstoječe BOOKIE tabele
import { artikliTable } from './artikli';
import { prejemniceTable, prejemnicePostavkeTable } from './prejemnice';
import { shranjeniKupciTable } from './shranjeni-kupci';

// ---------------------------------------------------------------------
// Pomožni tip: bytea (Drizzle ga nima vgrajenega)
// ---------------------------------------------------------------------

export const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return 'bytea';
  },
});

// ---------------------------------------------------------------------
// Naštevni tipi
// ---------------------------------------------------------------------

export const uvozKanal = pgEnum('uvoz_kanal', [
  'ROCNI_NALOG',
  'NADZOROVANA_MAPA',
  'EPOSTA',
  'PEPPOL',
  'API_DOBAVITELJ',
  'FOTOAPARAT',
  'ROCNI_VNOS',
]);

export const uvozFormat = pgEnum('uvoz_format', [
  'ESLOG_2_0_RACUN',
  'ESLOG_2_0_DOBAVNICA',
  'ESLOG_1_6_1',
  'UBL_2_1_INVOICE',
  'UBL_2_1_DESPATCH',
  'CII_D16B',
  'EDIFACT_DESADV',
  'EDIFACT_INVOIC',
  'EDIFACT_PRICAT',
  'CSV',
  'XLSX',
  'JSON_LASTNI',
  'XML_LASTNI',
  'PDF_PREDLOGA',
  'PDF_OCR',
  'BREZ',
]);

export const uvozStatus = pgEnum('uvoz_status', [
  'PREJETO',
  'V_OBDELAVI',
  'RAZCLENJENO',
  'NAPAKA_RAZCLENITVE',
  'PODVOJENO',
  'OBDELANO',
  'ZAVRZENO',
]);

export const uparjanjeMetoda = pgEnum('uparjanje_metoda', [
  'GTIN',
  'SIFRA_DOBAVITELJA',
  'INTERNA_SIFRA',
  'PODOBNOST_NAZIVA',
  'ROCNO',
  'NOV_ARTIKEL',
]);

// ---------------------------------------------------------------------
// Preslikave artiklov dobavitelja — jedro uvoza
// ---------------------------------------------------------------------

export const artikelDobaviteljTable = pgTable(
  'artikel_dobavitelj',
  {
    id: serial('id').primaryKey(),
    enotaId: integer('enota_id').notNull(),
    artikelId: integer('artikel_id')
      .notNull()
      .references(() => artikliTable.id),
    dobaviteljId: integer('dobavitelj_id')
      .notNull()
      .references(() => shranjeniKupciTable.id),

    sifraDobavitelja: text('sifra_dobavitelja'),
    gtin: text('gtin'),
    nazivDobavitelja: text('naziv_dobavitelja'),

    // Generirani stolpec prek NESPREMENLJIVE ovojnice.
    // Neposreden klic unaccent() tu ne deluje — glej migracijo 0009.
    nazivNorm: text('naziv_norm').generatedAlwaysAs(
      sql`public.naziv_norm(naziv_dobavitelja)`,
    ),

    enotVPaketu: numeric('enot_v_paketu', { precision: 18, scale: 6 })
      .notNull()
      .default('1'),
    nazivPaketa: text('naziv_paketa'),

    zadnjaCenaPaket: numeric('zadnja_cena_paket', { precision: 15, scale: 6 }),
    zadnjaCenaEnota: numeric('zadnja_cena_enota', { precision: 15, scale: 6 }),
    zadnjaDdvStopnja: numeric('zadnja_ddv_stopnja', { precision: 5, scale: 2 }),
    zadnjiPrevzem: date('zadnji_prevzem'),
    stPrevzemov: integer('st_prevzemov').notNull().default(0),

    aktivno: boolean('aktivno').notNull().default(true),
    potrdilUporabnik: integer('potrdil_uporabnik'),
    potrjenoDne: timestamp('potrjeno_dne', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_ad_sifra').on(t.enotaId, t.dobaviteljId, t.sifraDobavitelja),
    uniqueIndex('uq_ad_gtin').on(t.enotaId, t.dobaviteljId, t.gtin),
    index('ix_ad_artikel').on(t.enotaId, t.artikelId),
    // GIN indeks nad naziv_norm se ustvari v migraciji — Drizzle nima
    // izraznega zapisa za operatorski razred gin_trgm_ops.
  ],
);

export type ArtikelDobavitelj = typeof artikelDobaviteljTable.$inferSelect;
export type NovArtikelDobavitelj = typeof artikelDobaviteljTable.$inferInsert;

// ---------------------------------------------------------------------
// Trajno pakiranje na artiklu
// ---------------------------------------------------------------------

export const artikelPakiranjeTable = pgTable(
  'artikel_pakiranje',
  {
    id: serial('id').primaryKey(),
    enotaId: integer('enota_id').notNull(),
    artikelId: integer('artikel_id')
      .notNull()
      .references(() => artikliTable.id, { onDelete: 'cascade' }),
    naziv: text('naziv').notNull(), // 'karton 6x1 l'
    enotVPaketu: numeric('enot_v_paketu', { precision: 18, scale: 6 }).notNull(),
    gtin: text('gtin'),
    privzeto: boolean('privzeto').notNull().default(false),
  },
  (t) => [
    index('ix_pakiranje_artikel').on(t.enotaId, t.artikelId),
    // delni enolični indeks (WHERE privzeto) — v migraciji
  ],
);

export type ArtikelPakiranje = typeof artikelPakiranjeTable.$inferSelect;

// ---------------------------------------------------------------------
// Uvozne seje
// ---------------------------------------------------------------------

export const uvozSejaTable = pgTable(
  'uvoz_seja',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    enotaId: integer('enota_id').notNull(),

    kanal: uvozKanal('kanal').notNull(),
    format: uvozFormat('format'),
    profilId: integer('profil_id'),

    imeDatoteke: text('ime_datoteke'),
    mimeTip: text('mime_tip'),
    velikostB: integer('velikost_b'),

    // sha256 kot heksadecimalni niz — enostavnejše od bytea pri primerjavah
    sha256: text('sha256').notNull(),
    // izvirnik: majhne datoteke v zbirko, velike v App Storage
    vsebina: bytea('vsebina'),
    vsebinaKljuc: text('vsebina_kljuc'),

    prejeto: timestamp('prejeto', { withTimezone: true }).notNull().defaultNow(),
    obdelano: timestamp('obdelano', { withTimezone: true }),
    status: uvozStatus('status').notNull().default('PREJETO'),

    razclenitev: jsonb('razclenitev'),
    napake: jsonb('napake'),
    metapodatki: jsonb('metapodatki'), // pošiljatelj, zadeva, Peppol ID

    prejemnicaId: integer('prejemnica_id').references(
      () => prejemniceTable.id,
    ),
    prvotnaSejaId: uuid('prvotna_seja_id'),
  },
  (t) => [
    uniqueIndex('uq_seja_hash').on(t.enotaId, t.sha256),
    index('ix_seja_status').on(t.enotaId, t.status, t.prejeto),
  ],
);

export type UvozSeja = typeof uvozSejaTable.$inferSelect;
export type NovaUvozSeja = typeof uvozSejaTable.$inferInsert;

// ---------------------------------------------------------------------
// Uvozni profil po dobavitelju
// ---------------------------------------------------------------------

export const uvozProfilTable = pgTable(
  'uvoz_profil',
  {
    id: serial('id').primaryKey(),
    enotaId: integer('enota_id').notNull(),
    dobaviteljId: integer('dobavitelj_id')
      .notNull()
      .references(() => shranjeniKupciTable.id),
    naziv: text('naziv').notNull(),
    format: uvozFormat('format').notNull(),
    ceneBruto: boolean('cene_bruto').notNull().default(false),
    prepoznava: jsonb('prepoznava').notNull().default(sql`'{}'::jsonb`),
    konfiguracija: jsonb('konfiguracija').notNull(),
    aktivno: boolean('aktivno').notNull().default(true),
    ustvarjeno: timestamp('ustvarjeno', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ix_profil_dobavitelj').on(t.enotaId, t.dobaviteljId)],
);

export type UvozProfil = typeof uvozProfilTable.$inferSelect;

// ---------------------------------------------------------------------
// Predal za zajem e-pošte
// ---------------------------------------------------------------------

export const uvozPredalTable = pgTable('uvoz_predal', {
  id: serial('id').primaryKey(),
  enotaId: integer('enota_id').notNull(),
  streznik: text('streznik').notNull(),
  vrata: integer('vrata').notNull().default(993),
  uporabniskoIme: text('uporabnisko_ime').notNull(),
  gesloSifrirano: text('geslo_sifrirano').notNull(), // AES-GCM, ključ v Secrets
  mapa: text('mapa').notNull().default('INBOX'),
  mapaObdelano: text('mapa_obdelano').default('Obdelano'),
  mapaKarantena: text('mapa_karantena').default('Karantena'),
  uporabiTls: boolean('uporabi_tls').notNull().default(true),
  aktivno: boolean('aktivno').notNull().default(true),
  zadnjaPovezava: timestamp('zadnja_povezava', { withTimezone: true }),
  zadnjaNapaka: text('zadnja_napaka'),
});

// ---------------------------------------------------------------------
// E-poštni naslovi dobaviteljev za prepoznavo pošiljatelja
// ---------------------------------------------------------------------

export const partnerEpostaTable = pgTable(
  'partner_eposta',
  {
    id: serial('id').primaryKey(),
    enotaId: integer('enota_id').notNull(),
    partnerId: integer('partner_id')
      .notNull()
      .references(() => shranjeniKupciTable.id, { onDelete: 'cascade' }),
    naslov: text('naslov'),
    domena: text('domena'),
    zaupanjaVreden: boolean('zaupanja_vreden').notNull().default(false),
    dodalUporabnik: integer('dodal_uporabnik'),
    dodano: timestamp('dodano', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_pe_partner').on(t.enotaId, t.partnerId)],
);

// ---------------------------------------------------------------------
// Dnevnik uvoza
// ---------------------------------------------------------------------

export const uvozDnevnikTable = pgTable(
  'uvoz_dnevnik',
  {
    id: serial('id').primaryKey(),
    enotaId: integer('enota_id').notNull(),
    sejaId: uuid('seja_id'),
    prejemnicaId: integer('prejemnica_id'),
    cas: timestamp('cas', { withTimezone: true }).notNull().defaultNow(),
    uporabnikId: integer('uporabnik_id'),
    dogodek: text('dogodek').notNull(),
    podrobnosti: jsonb('podrobnosti'),
  },
  (t) => [index('ix_dnevnik_prejemnica').on(t.prejemnicaId, t.cas)],
);

// ---------------------------------------------------------------------
// Razširitev obstoječih tabel (dodamo stolpce v prejemnice.ts in artikli.ts)
//
// Na prejemnice: st_dokumenta, datum_dokumenta, uvoz_seja_id
// Na prejemnice_postavke: izv_*, uparjanje*, rabat_*, opozorila
// Na artikli: gtin, nabavna_ddv_stopnja
//
// Te stolpce DODAMO v obstoječe datoteke (prejemnice.ts, artikli.ts)
// in migriramo z ALTER TABLE v 0009_uvoz_prejemnic.sql.
// ---------------------------------------------------------------------

export { prejemniceTable as prejemnice, prejemnicePostavkeTable as prejemnicePostavke };
