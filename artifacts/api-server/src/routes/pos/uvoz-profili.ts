// artifacts/api-server/src/routes/pos/uvoz-profili.ts
//
// Uvozni profili po dobavitelju in uvoz cenikov.
//
// Brez profila razčlenitev CSV in XLSX ne deluje — uvoz-service vrne
// ZAJ012. Ta ruta je torej pogoj za fazo 2 iz dokumenta 07.

import { Router, type Response } from 'express';
import multer from 'multer';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@workspace/db';
import { requireEnota, type PosRequest } from '../../middlewares/pos';
import { CsvRazclenjevalnik } from '../../lib/uvoz/parser-csv';
import { zaznajFormat } from '../../lib/uvoz/uvoz-service';
import { dekodiraj, zaznajLocilo } from '../../lib/uvoz/parser-csv';
import {
  predogledCenika,
  razcleniCenik,
  ugibajStolpce,
  zapisiPreslikave,
  type CenikProfil,
  type CenikZapisVrstica,
} from '../../lib/uvoz/cenik';

const router = Router();

const nalozi = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
});

const jsonVarno = (v: unknown) =>
  JSON.stringify(v, (_k, x) => (x instanceof Decimal ? x.toString() : x));

const posljiJson = (res: Response, koda: number, telo: unknown) =>
  res.status(koda).type('application/json').send(jsonVarno(telo));

// =====================================================================
// Shema konfiguracije profila
// =====================================================================

const stolpecPravilo = z.object({
  indeks: z.number().int().min(0),
  privzeto: z.union([z.string(), z.number()]).optional(),
  preslikava: z.record(z.string(), z.string()).optional(),
});

const konfigSchema = z.object({
  kodiranje: z.enum(['utf-8', 'utf-8-sig', 'cp1250', 'utf-16le']).optional(),
  locilo: z.string().max(1).optional(),
  decimalnoLocilo: z.enum([',', '.']).optional(),
  formatDatuma: z.string().optional(),
  glavaVsebuje: z.array(z.string()).optional(),
  prvaVrsticaPodatkov: z.number().int().min(1).optional(),
  list: z.string().optional(),
  ceneBruto: z.boolean().optional(),
  glavaDokumenta: z
    .record(
      z.string(),
      z.union([
        z.object({ vir: z.literal('CELICA'), naslov: z.string() }),
        z.object({ vir: z.literal('IME_DATOTEKE'), regex: z.string() }),
        z.object({ vir: z.literal('ISKANJE'), vsebuje: z.string(), regex: z.string() }),
      ]),
    )
    .optional(),
  stolpci: z.object({
    naziv: stolpecPravilo,
    kolicina: stolpecPravilo,
    cena: stolpecPravilo,
    sifra: stolpecPravilo.optional(),
    gtin: stolpecPravilo.optional(),
    enota: stolpecPravilo.optional(),
    enotVPaketu: stolpecPravilo.optional(),
    rabatOdst: stolpecPravilo.optional(),
    rabat2Odst: stolpecPravilo.optional(),
    ddv: stolpecPravilo.optional(),
    vrednost: stolpecPravilo.optional(),
  }),
  preskociVrsticeKjer: z
    .object({
      stolpec: z.number().int().min(0),
      prazno: z.boolean().optional(),
      vsebuje: z.string().optional(),
    })
    .optional(),
  vrsticaVsote: z
    .object({
      prepoznajPo: z.object({
        stolpec: z.number().int().min(0),
        vsebuje: z.string(),
      }),
      stolpci: z
        .object({
          izvOsnova: z.number().int().optional(),
          izvDdv: z.number().int().optional(),
          izvSkupaj: z.number().int().optional(),
        })
        .optional(),
    })
    .optional(),
});

// =====================================================================
// GET /api/pos/uvoz/profili?dobaviteljId=
// =====================================================================

router.get('/profili', requireEnota, async (req: PosRequest, res) => {
  const q = z
    .object({ dobaviteljId: z.coerce.number().int().positive().optional() })
    .parse(req.query);

  const { rows: vrstice } = await db.execute(sql`
    SELECT p.id, p.naziv, p.format, p.cene_bruto, p.prepoznava,
           p.konfiguracija, p.aktivno, p.ustvarjeno,
           d.naziv AS dobavitelj, p.dobavitelj_id
      FROM uvoz_profil p
      JOIN partnerji d ON d.id = p.dobavitelj_id
     WHERE p.enota_id = ${req.enotaId}
       AND (${q.dobaviteljId ?? null}::bigint IS NULL
            OR p.dobavitelj_id = ${q.dobaviteljId ?? null})
     ORDER BY d.naziv, p.naziv
  `);

  return posljiJson(res, 200, { vsebina: vrstice });
});

// =====================================================================
// POST /api/pos/uvoz/profili/vzorec
// Vrne surovo matriko prvih vrstic in predlog preslikave stolpcev.
// Uporabnik nato v vmesniku samo potrdi ali popravi.
// =====================================================================

router.post(
  '/profili/vzorec',
  requireEnota,
  nalozi.single('datoteka'),
  async (req: PosRequest, res) => {
    if (!req.file) {
      return posljiJson(res, 400, { koda: 'ZAJ013', sporocilo: 'Datoteka ni bila poslana.' });
    }

    const format = zaznajFormat(req.file.buffer, req.file.originalname);
    if (format !== 'CSV' && format !== 'XLSX') {
      return posljiJson(res, 200, {
        zaznanFormat: format,
        sporocilo: 'Za ta format profil ni potreben — razčlenitev je standardna.',
        potrebenProfil: false,
      });
    }

    let vrstice: string[][] = [];
    let kodiranje: string | undefined;
    let locilo: string | undefined;

    if (format === 'CSV') {
      const d = dekodiraj(req.file.buffer);
      kodiranje = d.kodiranje;
      locilo = zaznajLocilo(d.besedilo);
      vrstice = d.besedilo
        .split(/\r?\n/)
        .slice(0, 25)
        .map((v) => v.split(locilo!));
    } else {
      const XLSX = await import('xlsx');
      const wb = XLSX.read(req.file.buffer, { type: 'buffer', cellDates: true });
      const ws = wb.Sheets[wb.SheetNames[0]];
      vrstice = XLSX.utils
        .sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: '', blankrows: true })
        .slice(0, 25);
    }

    // Poišči vrstico, ki je najbolj verjetno glava: največ nepraznih celic
    // med prvimi desetimi vrsticami, ki niso večinoma številke.
    let glavaIdx = 0;
    let najbolje = -1;
    vrstice.slice(0, 10).forEach((v, i) => {
      const neprazne = v.filter((c) => String(c).trim()).length;
      const besedilne = v.filter((c) => /[a-zčšž]/i.test(String(c))).length;
      const ocena = neprazne + besedilne;
      if (ocena > najbolje) {
        najbolje = ocena;
        glavaIdx = i;
      }
    });

    return posljiJson(res, 200, {
      zaznanFormat: format,
      potrebenProfil: true,
      kodiranje,
      locilo,
      glavaIdx,
      predlogStolpcev: ugibajStolpce(vrstice[glavaIdx] ?? []),
      vrstice,
    });
  },
);

// =====================================================================
// POST /api/pos/uvoz/profili
// =====================================================================

const profilTelo = z.object({
  dobaviteljId: z.coerce.number().int().positive(),
  naziv: z.string().min(1).max(120),
  format: z.enum(['CSV', 'XLSX']),
  ceneBruto: z.boolean().default(false),
  prepoznava: z
    .object({
      imeDatotekeRegex: z.string().optional(),
      glavaVsebuje: z.array(z.string()).optional(),
      epostaPosiljatelj: z.string().optional(),
    })
    .default({}),
  konfiguracija: konfigSchema,
});

router.post('/profili', requireEnota, async (req: PosRequest, res) => {
  const v = profilTelo.safeParse(req.body);
  if (!v.success) {
    return posljiJson(res, 400, { koda: 'ZAJ014', napake: v.error.issues });
  }

  const [p] = (await db.execute<{ id: number }>(sql`
    INSERT INTO uvoz_profil (
      podjetje_id, dobavitelj_id, naziv, format, cene_bruto,
      prepoznava, konfiguracija)
    VALUES (
      ${req.enotaId}, ${v.data.dobaviteljId}, ${v.data.naziv},
      ${v.data.format}, ${v.data.ceneBruto},
      ${JSON.stringify(v.data.prepoznava)}::jsonb,
      ${JSON.stringify(v.data.konfiguracija)}::jsonb)
    RETURNING id
  `)).rows;

  return posljiJson(res, 201, { id: Number(p.id) });
});

router.put('/profili/:id', requireEnota, async (req: PosRequest, res) => {
  const v = profilTelo.partial().safeParse(req.body);
  if (!v.success) {
    return posljiJson(res, 400, { koda: 'ZAJ014', napake: v.error.issues });
  }

  await db.execute(sql`
    UPDATE uvoz_profil SET
      naziv         = COALESCE(${v.data.naziv ?? null}, naziv),
      cene_bruto    = COALESCE(${v.data.ceneBruto ?? null}, cene_bruto),
      prepoznava    = COALESCE(${v.data.prepoznava ? JSON.stringify(v.data.prepoznava) : null}::jsonb, prepoznava),
      konfiguracija = COALESCE(${v.data.konfiguracija ? JSON.stringify(v.data.konfiguracija) : null}::jsonb, konfiguracija)
     WHERE id = ${req.params.id} AND enota_id = ${req.enotaId}
  `);

  return posljiJson(res, 200, { status: 'SHRANJENO' });
});

router.delete(
  '/profili/:id',
  requireEnota,
  async (req: PosRequest, res) => {
    // Ne brišemo — seje se nanj sklicujejo in revizijska sled mora ostati.
    await db.execute(sql`
      UPDATE uvoz_profil SET aktivno = false
       WHERE id = ${req.params.id} AND enota_id = ${req.enotaId}
    `);
    return posljiJson(res, 200, { status: 'DEAKTIVIRANO' });
  },
);

// =====================================================================
// POST /api/pos/uvoz/profili/preizkus
// Živa razčlenitev z nešranjeno konfiguracijo — za urejevalnik profila.
// =====================================================================

router.post(
  '/profili/preizkus',
  requireEnota,
  nalozi.single('datoteka'),
  async (req: PosRequest, res) => {
    if (!req.file) {
      return posljiJson(res, 400, { koda: 'ZAJ013', sporocilo: 'Datoteka ni bila poslana.' });
    }

    let surova: unknown;
    try {
      surova = JSON.parse(String(req.body?.konfiguracija ?? ''));
    } catch {
      return posljiJson(res, 400, {
        koda: 'ZAJ016',
        sporocilo: 'Konfiguracija ni veljaven JSON.',
      });
    }

    const k = konfigSchema.safeParse(surova);
    if (!k.success) {
      return posljiJson(res, 400, { koda: 'ZAJ022', napake: k.error.issues });
    }

    const format = zaznajFormat(req.file.buffer, req.file.originalname);
    const r = new CsvRazclenjevalnik(k.data as never);
    const dto =
      format === 'XLSX'
        ? r.razcleniXlsx(req.file.buffer, req.file.originalname)
        : r.razcleni(req.file.buffer, req.file.originalname);

    return posljiJson(res, 200, { zaznanFormat: format, dto });
  },
);

// =====================================================================
// CENIK
// =====================================================================

const cenikProfilSchema = z.object({
  kodiranje: z.string().optional(),
  locilo: z.string().max(1).optional(),
  decimalnoLocilo: z.enum([',', '.']).optional(),
  glavaVsebuje: z.array(z.string()).optional(),
  prvaVrsticaPodatkov: z.number().int().min(1).optional(),
  list: z.string().optional(),
  stolpci: z.object({
    naziv: z.number().int().min(0),
    cena: z.number().int().min(0),
    sifra: z.number().int().min(0).optional(),
    gtin: z.number().int().min(0).optional(),
    enota: z.number().int().min(0).optional(),
    enotVPaketu: z.number().int().min(0).optional(),
    ddv: z.number().int().min(0).optional(),
  }),
});

/**
 * POST /api/pos/uvoz/cenik/predogled
 *
 * Ne zapiše ničesar. Uvoz cenika brez predogleda je nevaren: napačna
 * preslikava, ustvarjena v svežnju, se tiho uporablja pri vseh
 * naslednjih dobavnicah.
 */
router.post(
  '/cenik/predogled',
  requireEnota,
  nalozi.single('datoteka'),
  async (req: PosRequest, res) => {
    const vhod = z
      .object({
        dobaviteljId: z.coerce.number().int().positive(),
        profil: z.string(),
      })
      .safeParse(req.body);

    if (!req.file || !vhod.success) {
      return posljiJson(res, 400, {
        koda: 'ZAJ014',
        sporocilo: 'Manjka datoteka ali parametri.',
        napake: vhod.success ? undefined : vhod.error.issues,
      });
    }

    const profil = cenikProfilSchema.safeParse(JSON.parse(vhod.data.profil));
    if (!profil.success) {
      return posljiJson(res, 400, { koda: 'ZAJ022', napake: profil.error.issues });
    }

    const format = zaznajFormat(req.file.buffer, req.file.originalname);
    const { vrstice, napake } = razcleniCenik(
      req.file.buffer,
      profil.data as CenikProfil,
      format === 'XLSX',
    );

    if (!vrstice.length) {
      return posljiJson(res, 422, { koda: 'ZAJ023', napake });
    }

    const predogled = await predogledCenika(
      db, req.enotaId, vhod.data.dobaviteljId, vrstice,
    );

    return posljiJson(res, 200, { ...predogled, napake });
  },
);

/**
 * POST /api/pos/uvoz/cenik/potrdi
 *
 * Sprejme SAMO vrstice, ki jih je uporabnik videl v predogledu in
 * potrdil. Odjemalec pošlje že razrešene pare artikel–šifra, zato se
 * uparjanje tu ne ponavlja.
 */
const cenikPotrdiTelo = z.object({
  dobaviteljId: z.coerce.number().int().positive(),
  vrstice: z
    .array(
      z.object({
        artikelId: z.number().int().positive(),
        sifra: z.string().nullable(),
        gtin: z.string().nullable(),
        naziv: z.string(),
        enota: z.string().nullable(),
        enotVPaketu: z.union([z.string(), z.number()]),
        cenaEnota: z.union([z.string(), z.number()]).nullable(),
        ddvStopnja: z.union([z.string(), z.number()]).nullable(),
      }),
    )
    .min(1)
    .max(20000),
});

router.post(
  '/cenik/potrdi',
  requireEnota,
  async (req: PosRequest, res) => {
    const v = cenikPotrdiTelo.safeParse(req.body);
    if (!v.success) {
      return posljiJson(res, 400, { koda: 'ZAJ014', napake: v.error.issues });
    }

    const vrstice: CenikZapisVrstica[] = v.data.vrstice.map((r) => ({
      artikelId: r.artikelId,
      sifra: r.sifra,
      gtin: r.gtin,
      naziv: r.naziv,
      enota: r.enota,
      enotVPaketu: new Decimal(r.enotVPaketu),
      cenaEnota: r.cenaEnota === null ? null : new Decimal(r.cenaEnota),
      ddvStopnja: r.ddvStopnja === null ? null : new Decimal(r.ddvStopnja),
    }));

    try {
      const izid = await zapisiPreslikave(
        db,
        req.enotaId,
        v.data.dobaviteljId,
        vrstice,
        0,
      );
      return posljiJson(res, 200, izid);
    } catch (e) {
      req.log?.error({ err: e }, 'napaka pri zapisu cenika');
      return posljiJson(res, 500, {
        koda: 'ZAJ024',
        sporocilo: 'Cenika ni bilo mogoče shraniti v celoti.',
      });
    }
  },
);

/**
 * GET /api/pos/uvoz/preslikave?dobaviteljId=
 * Pregled in vzdrževanje naučenih preslikav.
 */
router.get(
  '/preslikave',
  requireEnota,
  async (req: PosRequest, res) => {
    const q = z
      .object({
        dobaviteljId: z.coerce.number().int().positive(),
        iskanje: z.string().optional(),
        stran: z.coerce.number().int().min(0).default(0),
        velikost: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);

    const { rows: vrstice } = await db.execute(sql`
      SELECT ad.id, ad.sifra_dobavitelja, ad.gtin, ad.naziv_dobavitelja,
             ad.enot_v_paketu, ad.zadnja_cena_enota, ad.zadnji_prevzem,
             ad.st_prevzemov, ad.aktivno,
             a.id AS artikel_id, a.sifra AS artikel_sifra, a.naziv AS artikel_naziv
        FROM artikel_dobavitelj ad
        JOIN artikli a ON a.id = ad.artikel_id
       WHERE ad.enota_id = ${req.enotaId}
         AND ad.dobavitelj_id = ${q.dobaviteljId}
         AND (${q.iskanje ?? null}::text IS NULL
              OR public.naziv_norm(ad.naziv_dobavitelja)
                 LIKE '%' || public.naziv_norm(${q.iskanje ?? null}) || '%'
              OR public.naziv_norm(a.naziv)
                 LIKE '%' || public.naziv_norm(${q.iskanje ?? null}) || '%'
              OR ad.sifra_dobavitelja ILIKE '%' || ${q.iskanje ?? null} || '%')
       ORDER BY ad.st_prevzemov DESC, a.naziv
       LIMIT ${q.velikost} OFFSET ${q.stran * q.velikost}
    `);

    return posljiJson(res, 200, { vsebina: vrstice });
  },
);

router.delete(
  '/preslikave/:id',
  requireEnota,
  async (req: PosRequest, res) => {
    await db.execute(sql`
      DELETE FROM artikel_dobavitelj
       WHERE id = ${req.params.id} AND enota_id = ${req.enotaId}
    `);
    return posljiJson(res, 204, null);
  },
);

export default router;
