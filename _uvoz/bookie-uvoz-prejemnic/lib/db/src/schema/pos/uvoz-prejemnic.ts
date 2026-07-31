// lib/db/src/schema/pos/uvoz-prejemnic.ts
//
// Modul uvoza prejemnic — Drizzle shema.
//
// Opomba k migraciji: `drizzle-kit generate` NE zna ustvariti funkcij
// f_unaccent in naziv_norm, od katerih je odvisen generirani stolpec
// naziv_norm. Migracija 009 jih zato ustvari ročno PRED tabelami.
// Glej lib/db/src/migrations/0009_uvoz_prejemnic.sql.

import { sql } from 'drizzle-orm';
import {
  bigint,
  bigserial,
  boolean,
  customType,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

// Obstoječe tabele — imena preveri z dejansko shemo
import { artikli } from './artikli';
import { prejemnice, prejemnicePostavke } from './prejemnice';
import { partnerji } from '../partnerji';

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

export const artikelDobavitelj = pgTable(
  'artikel_dobavitelj',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    artikelId: bigint('artikel_id', { mode: 'number' })
      .notNull()
      .references(() => artikli.id),
    dobaviteljId: bigint('dobavitelj_id', { mode: 'number' })
      .notNull()
      .references(() => partnerji.id),

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
    potrdilUporabnik: bigint('potrdil_uporabnik', { mode: 'number' }),
    potrjenoDne: timestamp('potrjeno_dne', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('uq_ad_sifra').on(t.podjetjeId, t.dobaviteljId, t.sifraDobavitelja),
    uniqueIndex('uq_ad_gtin').on(t.podjetjeId, t.dobaviteljId, t.gtin),
    index('ix_ad_artikel').on(t.podjetjeId, t.artikelId),
    // GIN indeks nad naziv_norm se ustvari v migraciji — Drizzle nima
    // izraznega zapisa za operatorski razred gin_trgm_ops.
  ],
);

export type ArtikelDobavitelj = typeof artikelDobavitelj.$inferSelect;
export type NovArtikelDobavitelj = typeof artikelDobavitelj.$inferInsert;

// ---------------------------------------------------------------------
// Trajno pakiranje na artiklu
// ---------------------------------------------------------------------

export const artikelPakiranje = pgTable(
  'artikel_pakiranje',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    artikelId: bigint('artikel_id', { mode: 'number' })
      .notNull()
      .references(() => artikli.id, { onDelete: 'cascade' }),
    naziv: text('naziv').notNull(), // 'karton 6x1 l'
    enotVPaketu: numeric('enot_v_paketu', { precision: 18, scale: 6 }).notNull(),
    gtin: text('gtin'),
    privzeto: boolean('privzeto').notNull().default(false),
  },
  (t) => [
    index('ix_pakiranje_artikel').on(t.podjetjeId, t.artikelId),
    // delni enolični indeks (WHERE privzeto) — v migraciji
  ],
);

export type ArtikelPakiranje = typeof artikelPakiranje.$inferSelect;

// ---------------------------------------------------------------------
// Uvozne seje
// ---------------------------------------------------------------------

export const uvozSeja = pgTable(
  'uvoz_seja',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    enotaId: bigint('enota_id', { mode: 'number' }),

    kanal: uvozKanal('kanal').notNull(),
    format: uvozFormat('format'),
    profilId: bigint('profil_id', { mode: 'number' }),

    imeDatoteke: text('ime_datoteke'),
    mimeTip: text('mime_tip'),
    velikostB: bigint('velikost_b', { mode: 'number' }),

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

    prejemnicaId: bigint('prejemnica_id', { mode: 'number' }).references(
      () => prejemnice.id,
    ),
    prvotnaSejaId: uuid('prvotna_seja_id'),
  },
  (t) => [
    uniqueIndex('uq_seja_hash').on(t.podjetjeId, t.sha256),
    index('ix_seja_status').on(t.podjetjeId, t.status, t.prejeto),
  ],
);

export type UvozSeja = typeof uvozSeja.$inferSelect;
export type NovaUvozSeja = typeof uvozSeja.$inferInsert;

// ---------------------------------------------------------------------
// Uvozni profil po dobavitelju
// ---------------------------------------------------------------------

export const uvozProfil = pgTable(
  'uvoz_profil',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    dobaviteljId: bigint('dobavitelj_id', { mode: 'number' })
      .notNull()
      .references(() => partnerji.id),
    naziv: text('naziv').notNull(),
    format: uvozFormat('format').notNull(),
    // ustreza preklopu Neto/Bruto na obstoječem zaslonu
    ceneBruto: boolean('cene_bruto').notNull().default(false),
    prepoznava: jsonb('prepoznava').notNull().default(sql`'{}'::jsonb`),
    konfiguracija: jsonb('konfiguracija').notNull(),
    aktivno: boolean('aktivno').notNull().default(true),
    ustvarjeno: timestamp('ustvarjeno', { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index('ix_profil_dobavitelj').on(t.podjetjeId, t.dobaviteljId)],
);

export type UvozProfil = typeof uvozProfil.$inferSelect;

// ---------------------------------------------------------------------
// Predal za zajem e-pošte
// ---------------------------------------------------------------------

export const uvozPredal = pgTable('uvoz_predal', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
  enotaId: bigint('enota_id', { mode: 'number' }),
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
// Naslovi partnerjev za prepoznavo pošiljatelja
// ---------------------------------------------------------------------

export const partnerEposta = pgTable(
  'partner_eposta',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    partnerId: bigint('partner_id', { mode: 'number' })
      .notNull()
      .references(() => partnerji.id, { onDelete: 'cascade' }),
    naslov: text('naslov'),
    domena: text('domena'),
    zaupanjaVreden: boolean('zaupanja_vreden').notNull().default(false),
    dodalUporabnik: bigint('dodal_uporabnik', { mode: 'number' }),
    dodano: timestamp('dodano', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('ix_pe_partner').on(t.podjetjeId, t.partnerId)],
);

// ---------------------------------------------------------------------
// Dnevnik uvoza
// ---------------------------------------------------------------------

export const uvozDnevnik = pgTable(
  'uvoz_dnevnik',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    podjetjeId: bigint('podjetje_id', { mode: 'number' }).notNull(),
    sejaId: uuid('seja_id'),
    prejemnicaId: bigint('prejemnica_id', { mode: 'number' }),
    cas: timestamp('cas', { withTimezone: true }).notNull().defaultNow(),
    uporabnikId: bigint('uporabnik_id', { mode: 'number' }),
    dogodek: text('dogodek').notNull(),
    podrobnosti: jsonb('podrobnosti'),
  },
  (t) => [index('ix_dnevnik_prejemnica').on(t.prejemnicaId, t.cas)],
);

// ---------------------------------------------------------------------
// Razširitev obstoječe postavke prejemnice
//
// Teh stolpcev NE definiramo tu znova — dodamo jih z ALTER TABLE v
// migraciji, obstoječo definicijo v prejemnice.ts pa dopolnimo.
// Spodaj je le seznam, ki naj se doda v prejemnicePostavke:
//
//   izvGtin:            text('izv_gtin'),
//   izvSifra:           text('izv_sifra'),
//   izvNaziv:           text('izv_naziv'),
//   izvEnota:           text('izv_enota'),
//   izvKolicina:        numeric('izv_kolicina', { precision: 18, scale: 6 }),
//   izvCena:            numeric('izv_cena', { precision: 15, scale: 6 }),
//   uparjanje:          uparjanjeMetoda('uparjanje'),
//   uparjanjeZaupanje:  numeric('uparjanje_zaupanje', { precision: 5, scale: 2 }),
//   uparjanjeKandidati: jsonb('uparjanje_kandidati'),
//   rabat1Odst:         numeric('rabat_1_odst', { precision: 7, scale: 4 }).default('0'),
//   rabat2Odst:         numeric('rabat_2_odst', { precision: 7, scale: 4 }).default('0'),
//   opozorila:          jsonb('opozorila'),
//
// In v prejemnice:
//   stDokumenta:        text('st_dokumenta'),
//   datumDokumenta:     date('datum_dokumenta'),
//   uvozSejaId:         uuid('uvoz_seja_id'),
// ---------------------------------------------------------------------

export { prejemnice, prejemnicePostavke };
