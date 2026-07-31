// artifacts/api-server/src/routes/pos/uvoz-prejemnic.ts
//
// Rute modula uvoza. Slog sledi obstoječim ruram v routes/pos/prejemnice.ts.
//
// Odvisnosti:
//   npm i multer
//   npm i -D @types/multer

import { Router, type Request, type Response } from 'express';
import multer from 'multer';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@workspace/db';
import { anthropic } from '@workspace/integrations-anthropic-ai';
import { requireEnota, type PosRequest } from '../../middlewares/pos';
import {
  dolociDobavitelja,
  razcleniSejo,
  ustvariOsnutek,
  uvozi,
  zajemi,
  zaznajFormat,
} from '../../lib/uvoz/uvoz-service';
import { prazenDto, dodajNapako } from '../../lib/uvoz/dto';
import { potrdiUparjanje, upariPrejemnico } from '../../lib/uvoz/uparjanje';
import { CsvRazclenjevalnik } from '../../lib/uvoz/parser-csv';

// =====================================================================
// OCR helper — Claude Vision → PrejemDTO
// =====================================================================

async function ocrSlikaVDto(base64: string, mimeTip: string) {
  type ImgMime = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';
  const isPdf = mimeTip === 'application/pdf';

  const mediaBlock = isPdf
    ? ({
        type: 'document' as const,
        source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: base64 },
      })
    : ({
        type: 'image' as const,
        source: { type: 'base64' as const, media_type: mimeTip as ImgMime, data: base64 },
      });

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        mediaBlock,
        {
          type: 'text',
          text: `Analiziraj sliko računa ali dobavnice in vrni SAMO veljavni JSON (brez razlage ali markdown) s to strukturo:
{
  "dobaviteljNaziv": "ime podjetja dobavitelja ali null",
  "dobaviteljDavcna": "davčna številka - samo 8 cifer brez SI predpone ali null",
  "stDokumenta": "številka dokumenta/računa ali null",
  "datumDokumenta": "datum v obliki YYYY-MM-DD ali null",
  "ceneBruto": true ali false (ali so cene z DDV),
  "postavke": [
    {
      "naziv": "polni naziv artikla/storitve",
      "kolicina": "količina kot decimalni niz (pika kot ločilo)",
      "cena": "cena na enoto brez DDV kot decimalni niz",
      "davek": stopnja DDV kot število (22, 9.5, 5 ali 0) ali null,
      "enota": "enota mere: kom, kg, l, m, pak itd. ali null",
      "gtin": "EAN/črtna koda če vidna ali null",
      "sifra": "šifra artikla dobavitelja če vidna ali null"
    }
  ]
}

PRAVILA: Vrni SAMO JSON. Davčna: 8 cifer brez SI. Datum: YYYY-MM-DD. Decimalno ločilo: pika. Cene neto razen če ceneBruto=true.`,
        },
      ],
    }],
  });

  const tb = msg.content.find(b => b.type === 'text');
  if (!tb || tb.type !== 'text') throw new Error('Claude ni vrnil odgovora.');

  let jsonStr = tb.text.trim();
  const md = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (md) jsonStr = md[1].trim();

  const raw = JSON.parse(jsonStr) as Record<string, unknown>;
  const dto = prazenDto();

  dto.dobaviteljNaziv   = (raw.dobaviteljNaziv  as string)  ?? null;
  dto.stDokumenta       = (raw.stDokumenta       as string)  ?? null;
  dto.ceneBruto         = !!(raw.ceneBruto);

  const davcna = raw.dobaviteljDavcna as string ?? '';
  if (/^\d{8}$/.test(davcna)) dto.dobaviteljDavcna = davcna;

  const datum = raw.datumDokumenta as string ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) dto.datumDokumenta = datum;

  if (Array.isArray(raw.postavke)) {
    (raw.postavke as Record<string, unknown>[]).forEach((p, i) => {
      try {
        dto.postavke.push({
          zap:           i + 1,
          izvNaziv:      String(p.naziv   ?? 'Artikel'),
          izvGtin:       (p.gtin   as string) ?? null,
          izvSifra:      (p.sifra  as string) ?? null,
          izvEnota:      (p.enota  as string) ?? null,
          izvKolicina:   new Decimal(String(p.kolicina ?? '1')),
          izvCena:       new Decimal(String(p.cena ?? '0')),
          izvVrednost:   null,
          enotVPaketu:   new Decimal(1),
          rabat1Odst:    new Decimal(0),
          rabat2Odst:    new Decimal(0),
          ddvStopnja:    p.davek != null ? new Decimal(String(p.davek)) : null,
          ddvKategorija: null,
          lot:           null,
          rokUporabe:    null,
          opozorila:     [],
        });
      } catch { /* preskoči pokvarjeno vrstico */ }
    });
  }

  if (dto.postavke.length === 0) {
    dodajNapako(dto, 'ZAJ032', 'O',
      'OCR ni prepoznal nobene postavke. Poskusite s boljšo osvetlitvijo ali večjo ločljivostjo slike.');
  }

  return dto;
}

const router = Router();

// Datoteke ostanejo v pomnilniku; na Replitu je datotečni sistem
// pri Autoscale objavi minljiv, izvirnik pa se tako ali tako shrani
// v uvoz_seja.vsebina.
const nalozi = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const dovoljene = /\.(xml|csv|txt|xlsx|xls|pdf|edi|json|zip)$/i;
    cb(null, dovoljene.test(file.originalname));
  },
});

/** Decimal v odgovoru kot niz — number bi izgubil natančnost. */
const jsonVarno = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x instanceof Decimal ? x.toString() : x));

function posljiJson(res: Response, koda: number, telo: unknown): void {
  res.status(koda).type('application/json').send(jsonVarno(telo));
}

// =====================================================================
// POST /api/pos/uvoz/datoteka
// =====================================================================

// =====================================================================
// POST /api/pos/uvoz/ocr
// Sprejme base64 sliko, jo pošlje Claude Vision, ustvari osnutek prejemnice.
// =====================================================================

const ocrTelo = z.object({
  slika:       z.string().min(50),
  mimeTip:     z.enum(['image/jpeg', 'image/png', 'image/webp']).default('image/jpeg'),
  dobaviteljId: z.coerce.number().int().positive().optional(),
});

router.post('/ocr', requireEnota, async (req: PosRequest, res: Response) => {
  const vhod = ocrTelo.safeParse(req.body);
  if (!vhod.success) {
    return posljiJson(res, 400, { koda: 'ZAJ030', sporocilo: 'Neveljavni parametri.' });
  }

  try {
    // 1. Claude Vision → PrejemDTO
    const dto = await ocrSlikaVDto(vhod.data.slika, vhod.data.mimeTip);

    // 2. Shrani sliko v uvoz_seja (idempotenca prek SHA256)
    const imgBuf = Buffer.from(vhod.data.slika, 'base64');
    const zajem = await zajemi(db, {
      enotaId:    req.enotaId,
      kanal:      'ROCNI_NALOG',
      raw:        imgBuf,
      imeDatoteke: `ocr.${vhod.data.mimeTip === 'image/png' ? 'png' : 'jpg'}`,
      mimeTip:    vhod.data.mimeTip,
      metapodatki: { vir: 'OCR_KAMERA', model: 'claude-sonnet-4-6' },
    });

    if (zajem.status === 'PODVOJENO') {
      return posljiJson(res, 409, {
        status: 'PODVOJENO',
        sejaId: zajem.sejaId,
        sporocilo: 'Ta slika je bila že uvožena.',
      });
    }

    // 3. Določi dobavitelja
    const dob = await dolociDobavitelja(
      db, req.enotaId, dto, null, vhod.data.dobaviteljId ?? null,
    );

    if (!dob.dobaviteljId) {
      return posljiJson(res, 422, {
        status:              'MANJKA_DOBAVITELJ',
        sejaId:              zajem.sejaId,
        predlogDobavitelja:  dob.predlogNovega,
        dobaviteljNazivOcr:  dto.dobaviteljNaziv,
        napake:              dto.napake,
      });
    }

    // 4. Ustvari osnutek
    const osnutek = await ustvariOsnutek(db, {
      enotaId:      req.enotaId,
      sejaId:       zajem.sejaId,
      dobaviteljId: dob.dobaviteljId,
      dto,
      uporabnikId:  0,
    });

    return posljiJson(res, 201, {
      status:  'OSNUTEK_USTVARJEN',
      sejaId:  zajem.sejaId,
      napake:  dto.napake,
      ...osnutek,
    });
  } catch (e) {
    req.log?.error({ err: e }, 'OCR uvoz napaka');
    return posljiJson(res, 500, {
      koda:     'ZAJ031',
      sporocilo: `OCR uvoz ni uspel: ${(e as Error).message}`,
    });
  }
});

// =====================================================================
// POST /api/pos/uvoz/datoteka
// =====================================================================

router.post(
  '/datoteka',
  requireEnota,
  nalozi.single('datoteka'),
  async (req: PosRequest, res: Response) => {
    if (!req.file) {
      return posljiJson(res, 400, {
        koda: 'ZAJ013',
        sporocilo: 'Datoteka ni bila poslana ali njena vrsta ni podprta.',
      });
    }

    const vhod = z
      .object({
        dobaviteljId: z.coerce.number().int().positive().optional(),
        enotaId: z.coerce.number().int().positive().optional(),
        takojObdelaj: z.coerce.boolean().default(true),
      })
      .safeParse(req.body);

    if (!vhod.success) {
      return posljiJson(res, 400, { koda: 'ZAJ014', sporocilo: 'Neveljavni parametri.', napake: vhod.error.issues });
    }

    try {
      // PDF → Claude Vision OCR (zaznajFormat vrne 'PDF_PREDLOGA', ki ni razčlenljiv)
      const format = zaznajFormat(req.file.buffer, req.file.originalname);
      if (format === 'PDF_PREDLOGA' || format === 'PDF_OCR') {
        const base64 = req.file.buffer.toString('base64');
        const dto = await ocrSlikaVDto(base64, 'application/pdf');

        const zajem = await zajemi(db, {
          enotaId:     req.enotaId,
          kanal:       'ROCNI_NALOG',
          raw:         req.file.buffer,
          imeDatoteke: req.file.originalname,
          mimeTip:     req.file.mimetype,
          metapodatki: { vir: 'OCR_PDF', model: 'claude-sonnet-4-6' },
        });

        if (zajem.status === 'PODVOJENO') {
          return posljiJson(res, 409, {
            status:    'PODVOJENO',
            sejaId:    zajem.sejaId,
            napake:    [{ koda: 'ZAJ003', resnost: 'B', sporocilo: 'Ta PDF je bil že uvožen.' }],
            prejemnicaId: zajem.obstojecaPrejemnicaId,
          });
        }

        const dob = await dolociDobavitelja(
          db, req.enotaId, dto, null, vhod.data.dobaviteljId ?? null,
        );
        if (!dob.dobaviteljId) {
          return posljiJson(res, 422, {
            status:             'MANJKA_DOBAVITELJ',
            sejaId:             zajem.sejaId,
            predlogDobavitelja: dob.predlogNovega,
            dobaviteljNazivOcr: dto.dobaviteljNaziv,
            napake:             dto.napake,
          });
        }

        const osnutek = await ustvariOsnutek(db, {
          enotaId:      req.enotaId,
          sejaId:       zajem.sejaId,
          dobaviteljId: dob.dobaviteljId,
          dto,
          uporabnikId:  0,
        });

        return posljiJson(res, 201, {
          status: 'OSNUTEK_USTVARJEN',
          sejaId: zajem.sejaId,
          napake: dto.napake,
          ...osnutek,
        });
      }

      // Ostali formati: standardni pipeline
      const izid = await uvozi(db, {
        enotaId:     req.enotaId,
        kanal:       'ROCNI_NALOG',
        raw:         req.file.buffer,
        imeDatoteke: req.file.originalname,
        mimeTip:     req.file.mimetype,
        dobaviteljId: vhod.data.dobaviteljId ?? null,
        uporabnikId: 0,
      });

      const koda =
        izid.status === 'OSNUTEK_USTVARJEN' ? 201
        : izid.status === 'PODVOJENO' ? 409
        : 422;

      return posljiJson(res, koda, izid);
    } catch (e) {
      req.log?.error({ err: e }, 'napaka pri uvozu datoteke');
      return posljiJson(res, 500, {
        koda: 'ZAJ015',
        sporocilo: 'Uvoza ni bilo mogoče dokončati.',
      });
    }
  },
);

// =====================================================================
// POST /api/pos/uvoz/predogled
// Razčleni brez shranjevanja — za nastavljanje uvoznega profila.
// =====================================================================

router.post(
  '/predogled',
  requireEnota,
  nalozi.single('datoteka'),
  async (req: PosRequest, res: Response) => {
    if (!req.file) {
      return posljiJson(res, 400, { koda: 'ZAJ013', sporocilo: 'Datoteka ni bila poslana.' });
    }

    const format = zaznajFormat(req.file.buffer, req.file.originalname);
    let konfiguracija: unknown = null;
    if (typeof req.body?.konfiguracija === 'string') {
      try {
        konfiguracija = JSON.parse(req.body.konfiguracija);
      } catch {
        return posljiJson(res, 400, {
          koda: 'ZAJ016',
          sporocilo: 'Konfiguracija profila ni veljaven JSON.',
        });
      }
    }

    if (format !== 'CSV' && format !== 'XLSX') {
      return posljiJson(res, 200, {
        zaznanFormat: format,
        sporocilo: 'Za ta format profil ni potreben.',
      });
    }
    if (!konfiguracija) {
      return posljiJson(res, 400, {
        koda: 'ZAJ017',
        sporocilo: 'Za predogled CSV ali XLSX je potrebna konfiguracija profila.',
      });
    }

    const r = new CsvRazclenjevalnik(konfiguracija as never);
    const dto =
      format === 'XLSX'
        ? r.razcleniXlsx(req.file.buffer, req.file.originalname)
        : r.razcleni(req.file.buffer, req.file.originalname);

    return posljiJson(res, 200, { zaznanFormat: format, dto });
  },
);

// =====================================================================
// GET /api/pos/uvoz/seje
// =====================================================================

router.get('/seje', requireEnota, async (req: PosRequest, res) => {
  const q = z
    .object({
      status: z.string().optional(),
      kanal: z.string().optional(),
      od: z.string().date().optional(),
      do: z.string().date().optional(),
      stran: z.coerce.number().int().min(0).default(0),
      velikost: z.coerce.number().int().min(1).max(200).default(50),
    })
    .parse(req.query);

  const { rows: vrstice } = await db.execute(sql`
    SELECT s.id, s.kanal, s.format, s.ime_datoteke, s.velikost_b,
           s.prejeto, s.obdelano, s.status, s.prejemnica_id,
           s.napake, p.stevilka AS prejemnica_stevilka
      FROM uvoz_seja s
      LEFT JOIN prejemnice p ON p.id = s.prejemnica_id
     WHERE s.enota_id = ${req.enotaId}
       AND (${q.status ?? null}::text IS NULL OR s.status::text = ${q.status ?? null})
       AND (${q.kanal ?? null}::text IS NULL OR s.kanal::text = ${q.kanal ?? null})
       AND (${q.od ?? null}::date IS NULL OR s.prejeto >= ${q.od ?? null}::date)
       AND (${q.do ?? null}::date IS NULL OR s.prejeto < (${q.do ?? null}::date + 1))
     ORDER BY s.prejeto DESC
     LIMIT ${q.velikost} OFFSET ${q.stran * q.velikost}
  `);

  return posljiJson(res, 200, { vsebina: vrstice });
});

// =====================================================================
// GET /api/pos/uvoz/seje/:id/izvirnik
// Izvirna datoteka za revizijske namene.
// =====================================================================

router.get(
  '/seje/:id/izvirnik',
  requireEnota,
  async (req: PosRequest, res) => {
    const [s] = (await db.execute<{
      vsebina: Buffer | null;
      ime_datoteke: string | null;
      mime_tip: string | null;
    }>(sql`
      SELECT vsebina, ime_datoteke, mime_tip FROM uvoz_seja
       WHERE id = ${req.params.id} AND enota_id = ${req.enotaId}
    `)).rows;

    if (!s?.vsebina) {
      return posljiJson(res, 404, { koda: 'ZAJ018', sporocilo: 'Izvirnik ni na voljo.' });
    }

    res.setHeader('Content-Type', s.mime_tip ?? 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(s.ime_datoteke ?? 'izvirnik')}"`,
    );
    return res.send(s.vsebina);
  },
);

// =====================================================================
// POST /api/pos/uvoz/seje/:id/ponovi
// Ponovna obdelava iz izvirnika po popravku profila ali preslikav.
// =====================================================================

router.post(
  '/seje/:id/ponovi',
  requireEnota,
  async (req: PosRequest, res) => {
    const vhod = z
      .object({
        profilId: z.coerce.number().int().positive().optional(),
        dobaviteljId: z.coerce.number().int().positive().optional(),
      })
      .parse(req.body ?? {});

    try {
      if (vhod.profilId) {
        await db.execute(sql`
          UPDATE uvoz_seja SET profil_id = ${vhod.profilId}
           WHERE id = ${req.params.id} AND enota_id = ${req.enotaId}
        `);
      }

      const sejaId = String(req.params.id);
      const dto = await razcleniSejo(db, sejaId);
      if (dto.napake.some((n) => n.resnost === 'B')) {
        return posljiJson(res, 422, { status: 'NAPAKA', napake: dto.napake });
      }

      const dob = await dolociDobavitelja(
        db, req.enotaId, dto, null, vhod.dobaviteljId ?? null,
      );
      if (!dob.dobaviteljId) {
        return posljiJson(res, 422, {
          status: 'MANJKA_DOBAVITELJ',
          predlogDobavitelja: dob.predlogNovega,
        });
      }

      const izid = await ustvariOsnutek(db, {
        enotaId: req.enotaId,
        sejaId,
        dobaviteljId: dob.dobaviteljId,
        dto,
        uporabnikId: 0,
      });

      return posljiJson(res, 201, { status: 'OSNUTEK_USTVARJEN', ...izid });
    } catch (e) {
      return posljiJson(res, 500, {
        koda: 'ZAJ019',
        sporocilo: (e as Error).message,
      });
    }
  },
);

// =====================================================================
// GET /api/pos/uvoz/prejemnice/:id/neuparjeno
// =====================================================================

router.get(
  '/prejemnice/:id/neuparjeno',
  requireEnota,
  async (req: PosRequest, res) => {
    const { rows: vrstice } = await db.execute(sql`
      SELECT pp.id, pp.zap_st, pp.izv_gtin, pp.izv_sifra, pp.izv_naziv,
             pp.izv_enota, pp.izv_kolicina, pp.izv_cena,
             pp.enot_v_paketu, pp.uparjanje_zaupanje, pp.uparjanje_kandidati,
             pp.opozorila
        FROM prejemnice_postavke pp
        JOIN prejemnice p ON p.id = pp.prejemnica_id
       WHERE pp.prejemnica_id = ${req.params.id}
         AND p.enota_id = ${req.enotaId}
         AND pp.artikel_id IS NULL
       ORDER BY pp.zap_st
    `);

    return posljiJson(res, 200, { vsebina: vrstice, skupaj: vrstice.length });
  },
);

// =====================================================================
// POST /api/pos/uvoz/prejemnice/:id/uparjanje
// Ponovni zagon samodejnega uparjanja (npr. po uvozu cenika).
// =====================================================================

router.post(
  '/prejemnice/:id/uparjanje',
  requireEnota,
  async (req: PosRequest, res) => {
    const izid = await upariPrejemnico(
      db, req.enotaId, Number(req.params.id),
    );
    return posljiJson(res, 200, izid);
  },
);

// =====================================================================
// POST /api/pos/uvoz/postavke/:id/upari
// =====================================================================

const upariTelo = z.object({
  artikelId: z.coerce.number().int().positive(),
  enotVPaketu: z.union([z.string(), z.number()]).default('1'),
  zapomni: z.boolean().default(true),
});

router.post(
  '/postavke/:id/upari',
  requireEnota,
  async (req: PosRequest, res) => {
    const vhod = upariTelo.safeParse(req.body);
    if (!vhod.success) {
      return posljiJson(res, 400, { koda: 'ZAJ014', napake: vhod.error.issues });
    }

    const [post] = (await db.execute<{
      izv_sifra: string | null;
      izv_gtin: string | null;
      izv_naziv: string | null;
      izv_cena: string | null;
      dobavitelj_id: number;
      datum: string;
    }>(sql`
      SELECT pp.izv_sifra, pp.izv_gtin, pp.izv_naziv, pp.izv_cena,
             p.dobavitelj_id, p.datum
        FROM prejemnice_postavke pp
        JOIN prejemnice p ON p.id = pp.prejemnica_id
       WHERE pp.id = ${req.params.id}
         AND p.enota_id = ${req.enotaId}
    `)).rows;

    if (!post) {
      return posljiJson(res, 404, { koda: 'ZAJ020', sporocilo: 'Postavka ne obstaja.' });
    }

    const enotVPaketu = new Decimal(vhod.data.enotVPaketu);
    const cenaPaket = post.izv_cena ? new Decimal(post.izv_cena) : null;

    await potrdiUparjanje(db, {
      enotaId: req.enotaId,
      dobaviteljId: Number(post.dobavitelj_id),
      artikelId: vhod.data.artikelId,
      postavkaId: Number(req.params.id),
      uporabnikId: 0,
      enotVPaketu,
      izvSifra: post.izv_sifra,
      izvGtin: post.izv_gtin,
      izvNaziv: post.izv_naziv,
      // v preslikavo gre cena NA ENOTO, ne cena paketa
      izvCena: cenaPaket && enotVPaketu.gt(0) ? cenaPaket.div(enotVPaketu) : null,
      datumPrevzema: post.datum,
      zapomni: vhod.data.zapomni,
    });

    return posljiJson(res, 200, { status: 'UPARJENO' });
  },
);

// =====================================================================
// GET /api/pos/uvoz/odstopanja
// Poročilo o odstopanjih cen — edini del modula z merljivim donosom.
// =====================================================================

router.get(
  '/odstopanja',
  requireEnota,
  async (req: PosRequest, res) => {
    const q = z
      .object({
        dobaviteljId: z.coerce.number().int().positive().optional(),
        od: z.string().date().optional(),
        do: z.string().date().optional(),
        minOdstopanje: z.coerce.number().default(10),
      })
      .parse(req.query);

    const { rows: vrstice } = await db.execute(sql`
      SELECT p.id AS prejemnica_id, p.stevilka, p.datum, p.st_dokumenta,
             d.naziv AS dobavitelj, a.naziv AS artikel,
             pp.cena_enota AS nova_cena,
             ad.zadnja_cena_enota AS prejsnja_cena,
             round(100 * (pp.cena_enota - ad.zadnja_cena_enota)
                   / nullif(ad.zadnja_cena_enota, 0), 2) AS odstopanje_odst,
             round((pp.cena_enota - ad.zadnja_cena_enota)
                   * pp.kolicina_enot, 2) AS financni_ucinek,
             ad.enot_v_paketu AS prejsnje_pakiranje,
             pp.enot_v_paketu AS novo_pakiranje,
             (ad.enot_v_paketu IS DISTINCT FROM pp.enot_v_paketu)
                   AS pakiranje_spremenjeno
        FROM prejemnice p
        JOIN prejemnice_postavke pp ON pp.prejemnica_id = p.id
        JOIN artikli a ON a.id = pp.artikel_id
        JOIN partnerji d ON d.id = p.dobavitelj_id
        LEFT JOIN artikel_dobavitelj ad
               ON ad.artikel_id = pp.artikel_id
              AND ad.dobavitelj_id = p.dobavitelj_id
              AND ad.podjetje_id = p.podjetje_id
       WHERE p.enota_id = ${req.enotaId}
         AND ad.zadnja_cena_enota IS NOT NULL
         AND ad.zadnja_cena_enota > 0
         AND abs(pp.cena_enota - ad.zadnja_cena_enota)
             / ad.zadnja_cena_enota * 100 >= ${q.minOdstopanje}
         AND (${q.dobaviteljId ?? null}::bigint IS NULL
              OR p.dobavitelj_id = ${q.dobaviteljId ?? null})
         AND (${q.od ?? null}::date IS NULL OR p.datum >= ${q.od ?? null}::date)
         AND (${q.do ?? null}::date IS NULL OR p.datum <= ${q.do ?? null}::date)
       ORDER BY abs((pp.cena_enota - ad.zadnja_cena_enota) * pp.kolicina_enot) DESC
       LIMIT 500
    `);

    const skupniUcinek = vrstice.reduce(
      (a: Decimal, v: Record<string, unknown>) =>
        a.plus(new Decimal(String(v.financni_ucinek ?? 0))),
      new Decimal(0),
    );

    return posljiJson(res, 200, { vsebina: vrstice, skupniUcinek });
  },
);

export default router;
