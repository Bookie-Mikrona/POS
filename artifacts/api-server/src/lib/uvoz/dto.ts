// artifacts/api-server/src/lib/uvoz/dto.ts
//
// Kanonični model uvoza. Vsak razčlenjevalnik vrne PrejemDTO; nič za
// njim ne ve, iz katerega formata je dokument prišel.
//
// Denarni zneski in količine so Decimal, NIKOLI number. Cena 5,476 v
// dvojiški plavajoči vejici ni 5,476, in razlika se v zalogi sešteje.

import { Decimal } from 'decimal.js';
import { z } from 'zod';

// ---------------------------------------------------------------------
// Nastavitev decimal.js
// ---------------------------------------------------------------------

Decimal.set({
  precision: 28,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -15,
  toExpPos: 20,
});

/** Zaokroži na dano število mest. Privzeto 2 (denar). */
export const zaokrozi = (d: Decimal.Value, mest = 2): Decimal =>
  new Decimal(d).toDecimalPlaces(mest, Decimal.ROUND_HALF_UP);

// ---------------------------------------------------------------------
// Resnost opozoril
// ---------------------------------------------------------------------

export const Resnost = {
  BLOKADA: 'B',
  OPOZORILO: 'O',
  INFO: 'I',
} as const;
export type Resnost = (typeof Resnost)[keyof typeof Resnost];

export const opozoriloSchema = z.object({
  koda: z.string(),
  resnost: z.enum(['B', 'O', 'I']),
  sporocilo: z.string(),
  polje: z.string().optional(),
  podatki: z.record(z.string(), z.unknown()).optional(),
  potrdilUporabnik: z.number().int().nullable().optional(),
  potrjenoDne: z.string().datetime().nullable().optional(),
  opomba: z.string().nullable().optional(),
});
export type Opozorilo = z.infer<typeof opozoriloSchema>;

// ---------------------------------------------------------------------
// Decimal v Zod
// ---------------------------------------------------------------------

/**
 * Sprejme string, number ali Decimal in vrne Decimal.
 * Number je dovoljen samo zaradi berljivosti testov — v razčlenjevalnikih
 * naj se vedno uporabi string, da se izogne izgubi natančnosti.
 */
export const decimalSchema = z
  .union([z.string(), z.number(), z.instanceof(Decimal)])
  .transform((v, ctx) => {
    try {
      const d = new Decimal(v as Decimal.Value);
      if (!d.isFinite()) throw new Error('ni končno število');
      return d;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Neveljavno število: ${String(v)}` });
      return z.NEVER;
    }
  });

// ---------------------------------------------------------------------
// Enote mere
// ---------------------------------------------------------------------

/** UN/ECE Rec 20 -> interna koda. Uporablja se pri XML formatih. */
export const UNECE_ENOTE: Record<string, string> = {
  H87: 'KOS', C62: 'KOS', EA: 'KOS', PCE: 'KOS', NAR: 'KOS',
  LTR: 'L', MLT: 'ML', CLT: 'CL', DLT: 'DL',
  KGM: 'KG', GRM: 'G', DJ: 'DAG', TNE: 'T',
  CT: 'KAR', BX: 'SKA', CS: 'GAJ', PF: 'PAL', KEG: 'SOD',
  MTR: 'M', MTK: 'M2', MTQ: 'M3',
};

/** Prosti zapis dobaviteljev -> interna koda. Uporablja se pri CSV/XLSX. */
export const PROSTE_ENOTE: Record<string, string> = {
  KOM: 'KOS', KOS: 'KOS', KO: 'KOS', PCE: 'KOS', 'KOS.': 'KOS',
  L: 'L', LTR: 'L', LIT: 'L', 'L.': 'L',
  KG: 'KG', KILOGRAM: 'KG', G: 'G', DAG: 'DAG',
  KAR: 'KAR', KARTON: 'KAR', KART: 'KAR', CT: 'KAR',
  GAJ: 'GAJ', GAJBA: 'GAJ', PAK: 'PAK', PAKET: 'PAK', SOD: 'SOD',
};

export function normalizirajEnoto(surova?: string | null): string | undefined {
  if (!surova) return undefined;
  const k = surova.trim().toUpperCase();
  return UNECE_ENOTE[k] ?? PROSTE_ENOTE[k] ?? (k || undefined);
}

// ---------------------------------------------------------------------
// Davčne kategorije UNCL5305
// ---------------------------------------------------------------------

export const DAVCNE_KATEGORIJE = {
  S:  { opis: 'standardna stopnja',            samoobdavcitev: false },
  Z:  { opis: 'ničelna stopnja',               samoobdavcitev: false },
  E:  { opis: 'oproščeno',                     samoobdavcitev: false },
  AE: { opis: 'obrnjena davčna obveznost',     samoobdavcitev: true },
  K:  { opis: 'dobava znotraj EU',             samoobdavcitev: true },
  G:  { opis: 'izvoz',                         samoobdavcitev: false },
  O:  { opis: 'zunaj sistema DDV',             samoobdavcitev: false },
} as const;

export type DavcnaKategorija = keyof typeof DAVCNE_KATEGORIJE;

export const zahtevaSamoobdavcitev = (k?: string | null): boolean =>
  !!k && k in DAVCNE_KATEGORIJE && DAVCNE_KATEGORIJE[k as DavcnaKategorija].samoobdavcitev;

// ---------------------------------------------------------------------
// Postavka
// ---------------------------------------------------------------------

export const postavkaSchema = z.object({
  zap: z.number().int().positive(),

  // izvorni podatki, nespremenjeni
  izvNaziv: z.string().min(1),
  izvGtin: z.string().nullable().default(null),
  izvSifra: z.string().nullable().default(null),
  izvEnota: z.string().nullable().default(null),
  izvKolicina: decimalSchema,
  /** VEDNO na eno enoto. Pri XML formatih že deljeno z BaseQuantity. */
  izvCena: decimalSchema,
  izvVrednost: decimalSchema.nullable().default(null),

  // pakiranje
  enotVPaketu: decimalSchema.default(() => new Decimal(1)),

  // rabati
  rabat1Odst: decimalSchema.default(() => new Decimal(0)),
  rabat2Odst: decimalSchema.default(() => new Decimal(0)),

  // davek
  ddvStopnja: decimalSchema.nullable().default(null),
  ddvKategorija: z.string().nullable().default(null),

  // sledljivost
  lot: z.string().nullable().default(null),
  rokUporabe: z.string().date().nullable().default(null),

  opozorila: z.array(opozoriloSchema).default([]),
});

export type Postavka = z.infer<typeof postavkaSchema>;

// ---------------------------------------------------------------------
// Dokument
// ---------------------------------------------------------------------

export const prejemDtoSchema = z.object({
  // dobavitelj
  dobaviteljDavcna: z.string().regex(/^\d{8}$/).nullable().default(null),
  dobaviteljIdDdv: z.string().nullable().default(null),
  dobaviteljNaziv: z.string().nullable().default(null),
  dobaviteljGln: z.string().nullable().default(null),
  dobaviteljDrzava: z.string().length(2).nullable().default(null),
  dobaviteljUlica: z.string().nullable().default(null),
  dobaviteljPostnaStevilka: z.string().nullable().default(null),
  dobaviteljKraj: z.string().nullable().default(null),

  // dokument
  stDokumenta: z.string().nullable().default(null),
  datumDokumenta: z.string().date().nullable().default(null),
  vrstaDokumenta: z
    .enum(['RACUN', 'DOBAVNICA', 'DOBROPIS', 'BREMEPIS'])
    .default('RACUN'),
  valuta: z.string().length(3).default('EUR'),

  /** Ustreza preklopu Neto/Bruto na obstoječem zaslonu prejemnice. */
  ceneBruto: z.boolean().default(false),
  samoobdavcitev: z.boolean().default(false),

  postavke: z.array(postavkaSchema).default([]),

  odvisniStroski: z
    .array(
      z.object({
        vrsta: z.string(),
        razlog: z.string().nullable().default(null),
        znesek: decimalSchema,
        ddvStopnja: decimalSchema.nullable().default(null),
      }),
    )
    .default([]),

  rabatiGlave: z
    .array(z.object({ razlog: z.string().nullable(), znesek: decimalSchema }))
    .default([]),

  // kontrolne vsote iz dokumenta
  izvOsnova: decimalSchema.nullable().default(null),
  izvDdv: decimalSchema.nullable().default(null),
  izvSkupaj: decimalSchema.nullable().default(null),

  napake: z.array(opozoriloSchema).default([]),
});

export type PrejemDTO = z.infer<typeof prejemDtoSchema>;

// ---------------------------------------------------------------------
// Pomožne funkcije za sestavljanje
// ---------------------------------------------------------------------

export function prazenDto(): PrejemDTO {
  return prejemDtoSchema.parse({});
}

export function dodajNapako(
  dto: PrejemDTO,
  koda: string,
  resnost: Resnost,
  sporocilo: string,
  podatki?: Record<string, unknown>,
): void {
  dto.napake.push({ koda, resnost, sporocilo, podatki });
}

export function dodajOpozorilo(
  p: Postavka,
  koda: string,
  resnost: Resnost,
  sporocilo: string,
  podatki?: Record<string, unknown>,
): void {
  p.opozorila.push({ koda, resnost, sporocilo, podatki });
}

/** Ali dokument sme v knjiženje. */
export function imaBlokado(dto: PrejemDTO): boolean {
  return (
    dto.napake.some((n) => n.resnost === 'B') ||
    dto.postavke.some((p) => p.opozorila.some((o) => o.resnost === 'B'))
  );
}

// ---------------------------------------------------------------------
// GTIN
// ---------------------------------------------------------------------

/** GS1 modulo 10. Uteži 3,1,3,1... od prve števke pri poravnavi na 14 mest. */
export function gtinVeljaven(gtin?: string | null): boolean {
  if (!gtin) return false;
  const s = gtin.replace(/\D/g, '');
  if (![8, 12, 13, 14].includes(s.length)) return false;
  const v = s.padStart(14, '0');
  let vsota = 0;
  for (let i = 0; i < 13; i++) vsota += Number(v[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (vsota % 10)) % 10 === Number(v[13]);
}

/**
 * Poravna na 14 mest, da se EAN-13 in ITF-14 ujemata brez posebne logike.
 * Excel rad naredi 3.8388E+12 iz črtne kode — tak zapis je nepovraten
 * in se zavrne, ne popravi.
 */
export function gtinNorm(surov?: string | number | null): string | null {
  if (surov === null || surov === undefined || surov === '') return null;
  let s = String(surov).trim();
  if (/e\+/i.test(s)) return null; // Excel je kodo uničil
  s = s.replace(/\D/g, '');
  return s.length >= 8 && s.length <= 14 ? s.padStart(14, '0') : null;
}

// ---------------------------------------------------------------------
// Kaskadni rabati
// ---------------------------------------------------------------------

/** 10 % in 5 % NISTA 15 %. 100 -> 90 -> 85,50, ne 85,00. */
export function netoPoRabatih(
  bruto: Decimal.Value,
  r1: Decimal.Value = 0,
  r2: Decimal.Value = 0,
): Decimal {
  return new Decimal(bruto)
    .mul(new Decimal(1).minus(new Decimal(r1).div(100)))
    .mul(new Decimal(1).minus(new Decimal(r2).div(100)));
}
