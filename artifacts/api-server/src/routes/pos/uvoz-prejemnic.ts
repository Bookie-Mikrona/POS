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
import PDFDocument from 'pdfkit';

import { db } from '@workspace/db';
import { anthropic } from '@workspace/integrations-anthropic-ai';
import { requireEnota, type PosRequest } from '../../middlewares/pos';
import {
  dolociDobavitelja,
  DuplicatePrejemnicaError,
  razcleniSejo,
  resolveOrCreateDobavitelja,
  ustvariOsnutek,
  uvozi,
  zajemi,
  zaznajFormat,
} from '../../lib/uvoz/uvoz-service';
import { prazenDto, dodajNapako, prejemDtoSchema, type PrejemDTO } from '../../lib/uvoz/dto';
import {
  GenericArticleUnitMismatch,
  PurchaseArticleTargetNotFound,
  ReceiptLineNotFound,
  potrdiUparjanje,
  upariPrejemnico,
} from '../../lib/uvoz/uparjanje';
import { razcleniUparjanjeKandidate } from '../../lib/uvoz/kandidati-json';
import { razsiriOcrPrometeEmbalaze } from '../../lib/uvoz/ocr-embalaza';
import { lockPosReceiptForEdit, ReceiptEditConflict } from '../../lib/posReceiptBooking';
import { CsvRazclenjevalnik } from '../../lib/uvoz/parser-csv';
import { poisciDobaviteljaAI } from '../../lib/uvoz/poisci-dobavitelja';

// =====================================================================
// OCR helper — Claude Vision → PrejemDTO
// =====================================================================

/** Pretvori base64 PNG/JPEG sliko v enostranični PDF (Vertex AI ne sprejema image/base64). */
async function slikaVPdfBase64(imgBase64: string, mimeTip: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const imgBuf = Buffer.from(imgBase64, 'base64');
    const chunks: Buffer[] = [];
    const doc = new PDFDocument({ autoFirstPage: false, compress: true });
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks).toString('base64')));
    doc.on('error', reject);

    // Ugotovimo dimenzije slike
    const img = (doc as any).openImage(imgBuf);
    doc.addPage({ size: [img.width, img.height], margin: 0 });
    doc.image(imgBuf, 0, 0, { width: img.width, height: img.height });
    doc.end();
  });
}

async function ocrSlikaVDto(base64: string, mimeTip: string) {
  const isPdf = mimeTip === 'application/pdf';

  // Vertex AI proxy ne podpira image/base64 — pretvorimo v PDF
  let pdfBase64 = base64;
  if (!isPdf) {
    pdfBase64 = await slikaVPdfBase64(base64, mimeTip);
  }

  const mediaBlock = {
    type: 'document' as const,
    source: { type: 'base64' as const, media_type: 'application/pdf' as const, data: pdfBase64 },
  };

  const msg = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 8192,
    messages: [{
      role: 'user',
      content: [
        mediaBlock,
        {
          type: 'text',
          text: `Analiziraj sliko računa, fakture-dobavnice ali dobavnice in vrni SAMO veljavni JSON (brez razlage ali markdown) s to strukturo:
{
  "dobaviteljNaziv": "polno ime podjetja dobavitelja ali null",
  "dobaviteljDavcna": "davčna številka - samo 8 cifer brez SI predpone (slovensko podjetje) ali null",
  "dobaviteljIdDdv": "DDV identifikacijska številka z državo (npr. SI12345678, DE123456789, AT12345678) ali null",
  "dobaviteljDrzava": "dvočrkovna ISO koda države dobavitelja (npr. DE, AT, HR, IT, SI) ali null",
  "dobaviteljUlica": "ulica in hišna številka sedeža dobavitelja ali null",
  "dobaviteljPostnaStevilka": "poštna številka sedeža dobavitelja ali null",
  "dobaviteljKraj": "kraj/mesto sedeža dobavitelja ali null",
  "dobaviteljEmail": "e-mail naslov dobavitelja ali null",
  "dobaviteljTelefon": "telefonska številka dobavitelja ali null",
  "dobaviteljIban": "IBAN bančnega računa dobavitelja (brez presledkov) ali null",
  "dobaviteljBic": "BIC/SWIFT koda banke dobavitelja ali null",
  "dobaviteljMaticna": "matična številka podjetja dobavitelja (samo številke, brez prefiksa) ali null",
  "vrstaDokumenta": "RACUN, DOBAVNICA, DOBROPIS ali BREMEPIS",
  "stDokumenta": "številka dokumenta/računa ali null",
  "datumDokumenta": "datum v obliki YYYY-MM-DD ali null",
  "datumZapadlosti": "datum valute oziroma rok plačila v obliki YYYY-MM-DD ali null",
  "placilniNacin": "navedeni način plačila ali null",
  "placilniModel": "model sklica, npr. SI00, SI12 ali null",
  "placilniSklic": "celoten sklic oziroma referenca za plačilo ali null",
  "placilniNamen": "namen oziroma opis plačila ali null",
  "ceneBruto": true ali false (ali so cene z DDV),
  "skupajNeto": "skupni znesek brez DDV z dokumenta kot decimalni niz ali null",
  "postavke": [
    {
      "naziv": "polni naziv artikla/storitve",
      "kolicina": "običajna količina kot decimalni niz; pri embalaži z ločenima stolpcema prejeto/vrnjeno naj bo null",
      "prejetaKolicina": "samo pri povratni embalaži: prejeta/dobavljena količina iz stolpca Do., Dob., Prejeto ipd. ali null",
      "vrnjenaKolicina": "samo pri povratni embalaži: vrnjena količina iz stolpca Vr., Vračilo, Vrnjeno ipd. ali null",
      "cena": "kataložna/cenikovna cena na enoto brez DDV (PRED popusti) ali null",
      "popust": "popust v % kot decimalni niz ali null (npr. '5' za 5%)",
      "vrednost": "NETO vrednost vrstice po vseh popustih brez DDV kot decimalni niz — ta stolpec ima prednost pred ceno",
      "davek": stopnja DDV kot število (22, 9.5, 5 ali 0) ali null,
      "enota": "enota mere: kom, kg, l, m, pak itd. ali null",
      "gtin": "EAN/črtna koda če vidna ali null",
      "sifra": "šifra artikla dobavitelja če vidna ali null",
      "vrsticaTip": "artikel ali embalaza"
    }
  ]
}

PRAVILA:
- Vrni SAMO JSON brez markdown.
- Pred sestavo JSON obvezno preglej CELOTEN dokument od vrha do dna in evidentiraj vse ločene tabele oziroma razdelke. Posebej preveri spodnji del dokumenta za naslove "DOSTAVA IN VRAČILO EMBALAŽE", "EMBALAŽA", "POVRATNA EMBALAŽA" ali podobno. Če tak razdelek obstaja, mora biti vsaka njegova natisnjena vrstica vključena v postavke z vrsticaTip="embalaza"; razdelka ne smeš izpustiti zato, ker so vrednosti 0 ali ker sta dostavljena in vrnjena količina enaki.
- Če je dokument kjerkoli označen kot "FAKTURA-DOBAVNICA", "DOBAVNICA-FAKTURA", "RAČUN-DOBAVNICA", "FAKTURA", "RAČUN" ali enakovredno, vrni vrstaDokumenta="RACUN". Uporabnik vrste ne bo določal ročno.
- vrstaDokumenta="DOBAVNICA" vrni samo, če dokument ni hkrati označen kot račun ali faktura in ne vsebuje zahtevka za plačilo.
- Pri vrstaDokumenta="RACUN" obvezno skrbno preberi datum valute/rok plačila, vse natisnjene IBAN/TRR račune, BIC/SWIFT, način plačila, model, sklic/referenco in namen plačila. Če je računov več, v dobaviteljIban vrni tistega, ki je na dokumentu določen za plačilo te fakture.
- Za slovensko podjetje: dobaviteljDavcna = 8 cifer brez SI, dobaviteljIdDdv = "SI" + 8 cifer. Za tuje (AT, DE, HR ...): dobaviteljDavcna = null, dobaviteljIdDdv = "AT/DE/..."+številka.
- dobaviteljDavcna sme vsebovati SAMO številko, ki stoji neposredno ob oznaki "Davčna:", "Davčna št.", "ID za DDV:", "DIŠ:", "Davčna številka" ipd. NIKOLI ne beri davčne iz TRR/IBAN, številke dobavnice, šifre artikla ali bančnih podatkov.
- Datum: YYYY-MM-DD. Decimalno ločilo v vseh številih: pika.
- CENA PO POPUSTU (najpomembnejše): ko ima vrstica stolpec za popust ALI stolpec neto vrednosti, VEDNO vrni "vrednost" (neto vrednost vrstice po popustu). Cena/enoto se bo izračunala kot vrednost/kolicina na strežniku. Primer: kolicina=3.6 kg, katalog cena=3.68 €/kg, popust=10%, vrednost=11.92 € → vrni vrednost="11.92", cena="3.68" ali null.
- Če ni stolpca za popust in ni neto vrednosti: vrni cena = cena/enoto, vrednost = null.
- Vrstice povratne embalaže (zaboji, steklenice, gajbe, palete) ohrani tudi brez cene oziroma z vrednostjo 0, če imajo količino. So pomemben fizični promet, čeprav nimajo denarne vrednosti.
- Če ima razdelek povratne embalaže na isti vrstici ločena stolpca za prejeto/dobavljeno in vrnjeno količino, ju OBVEZNO vrni ločeno kot prejetaKolicina in vrnjenaKolicina. Ne uporabi samo prejete količine in ne vrni zgolj neto razlike. Primer Do.=20, Vr.=20 pomeni prejetaKolicina="20", vrnjenaKolicina="20", kolicina=null.
- Pri vsaki vrstici tabele nastavi vrsticaTip="artikel" za navadne postavke ali vrsticaTip="embalaza" za vrstice v razdelku EMBALAŽA.
- KRITIČNO ZA EMBALAŽO: vsako natisnjeno vrstico preberi povsem samostojno. Šifra, naziv, EAN, cena, dostavljeno in vrnjeno morajo vedno ostati na isti vodoravni vrstici dokumenta. Podatkov naslednje vrstice NIKOLI ne premakni k prejšnji šifri.
- V razdelku EMBALAŽA vrni tudi vrstico, ki ima šifro in naziv, vendar so EAN, cena, dostavljeno in vrnjeno vsi prazni: pri njej nastavi gtin=null, cena=null, prejetaKolicina=null in vrnjenaKolicina=null. Strežnik jo bo nato varno izločil. Ne preskoči je med OCR branjem, ker bi se podatki naslednje vrstice lahko pripisali napačni šifri.
- Prazno polje v embalažni tabeli vrni kot null, ne kot 0. Število 0 vrni samo, če je ničla dejansko natisnjena v tej isti celici.
- PRESKOČI vrstice, kjer je naziv zgolj zaporedna številka ali oznaka pozicije (npr. "1", "2", "Pos. 1", "Position 3") — to so številke vrstic, ne artikli.
- Naziv mora biti dejanski opis artikla ali storitve. Tuje nazive (nemške, angleške …) zapiši v izvornem jeziku — ne prevajaj.
- skupajNeto: preberi skupni znesek brez DDV iz seštevka/noge dokumenta (ne računaj sam).`,
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

  const davcna = (raw.dobaviteljDavcna as string) ?? '';
  if (/^\d{8}$/.test(davcna)) dto.dobaviteljDavcna = davcna;

  const idDdv = ((raw.dobaviteljIdDdv as string) ?? '').trim().replace(/\s/g, '');
  if (idDdv) dto.dobaviteljIdDdv = idDdv.toUpperCase();

  const drzava = (raw.dobaviteljDrzava as string) ?? '';
  if (/^[A-Za-z]{2}$/.test(drzava)) dto.dobaviteljDrzava = drzava.toUpperCase();

  dto.dobaviteljUlica           = (raw.dobaviteljUlica           as string) || null;
  dto.dobaviteljPostnaStevilka  = (raw.dobaviteljPostnaStevilka  as string) || null;
  dto.dobaviteljKraj            = (raw.dobaviteljKraj             as string) || null;
  dto.dobaviteljEmail           = (raw.dobaviteljEmail            as string) || null;
  dto.dobaviteljTelefon         = (raw.dobaviteljTelefon          as string) || null;
  const rawIban = ((raw.dobaviteljIban as string) ?? '').replace(/\s/g, '').toUpperCase();
  dto.dobaviteljIban            = rawIban || null;
  dto.dobaviteljBic             = ((raw.dobaviteljBic as string) ?? '').replace(/\s/g, '').toUpperCase() || null;
  const rawMaticna = ((raw.dobaviteljMaticna as string) ?? '').replace(/\D/g, '');
  dto.dobaviteljMaticna         = rawMaticna || null;
  const rawVrsta = String(raw.vrstaDokumenta ?? '').trim().toUpperCase();
  dto.vrstaDokumenta = rawVrsta === 'DOBAVNICA'
    ? 'DOBAVNICA'
    : rawVrsta === 'DOBROPIS'
      ? 'DOBROPIS'
      : rawVrsta === 'BREMEPIS'
        ? 'BREMEPIS'
        : 'RACUN';

  const datum = raw.datumDokumenta as string ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(datum)) dto.datumDokumenta = datum;
  const datumZapadlosti = raw.datumZapadlosti as string ?? '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(datumZapadlosti)) dto.datumZapadlosti = datumZapadlosti;
  dto.placilniNacin = typeof raw.placilniNacin === 'string' && raw.placilniNacin.trim()
    ? raw.placilniNacin.trim()
    : null;
  dto.placilniModel = typeof raw.placilniModel === 'string' && raw.placilniModel.trim()
    ? raw.placilniModel.trim().toUpperCase()
    : null;
  dto.placilniSklic = typeof raw.placilniSklic === 'string' && raw.placilniSklic.trim()
    ? raw.placilniSklic.trim()
    : null;
  dto.placilniNamen = typeof raw.placilniNamen === 'string' && raw.placilniNamen.trim()
    ? raw.placilniNamen.trim()
    : null;

  if (Array.isArray(raw.postavke)) {
    razsiriOcrPrometeEmbalaze(
      raw.postavke as Record<string, unknown>[],
    ).forEach((p, i) => {
      try {
        const kolicina  = new Decimal(String(p.kolicina ?? '1'));
        const vrednost  = p.vrednost != null && String(p.vrednost).trim() !== ''
          ? new Decimal(String(p.vrednost))
          : null;
        const cenaCenik = p.cena != null && String(p.cena).trim() !== ''
          ? new Decimal(String(p.cena))
          : null;

        // izvCena mora biti vedno kataložna/cenikovna cena PRED popustom.
        // Popust shranimo v rabat1Odst, da ga uvoz-service pravilno loči od cene.
        // Zaloge.tsx prikaže stolpec "Popust" le, ko izvCena != cena_kos.
        let izvCena: Decimal;
        let rabat1Odst: Decimal = new Decimal(0);
        const opozorila: import('../../lib/uvoz/dto.js').UvozOpozorilo[] = [];
        if (String(p.vrsticaTip ?? '').trim().toLowerCase() === 'embalaza') {
          opozorila.push({
            koda: 'EMB001',
            resnost: 'I' as const,
            sporocilo: 'OCR vrstica povratne embalaže.',
          });
        }

        if (vrednost !== null && kolicina.gt(0)) {
          const netoEnoto = vrednost.div(kolicina);
          if (cenaCenik && cenaCenik.gt(0) && netoEnoto.lt(cenaCenik)) {
            // Imamo katalog ceno in neto vrednost → popust se da izračunati
            const popustOdst = cenaCenik.minus(netoEnoto).div(cenaCenik).mul(100).toDecimalPlaces(2);
            izvCena    = cenaCenik;          // katalog cena (pred popustom)
            rabat1Odst = popustOdst;         // efektivni popust v %
            opozorila.push({
              koda: 'ZAJ080',
              resnost: 'I' as const,
              sporocilo: `Popust ${popustOdst}% upoštevan: katalog ${cenaCenik.toFixed(4)} €/enoto → neto ${netoEnoto.toDecimalPlaces(4).toFixed(4)} €/enoto`,
            });
          } else {
            // Katalog cena ni znana — shranimo neto ceno; popust ne bo prikazan
            izvCena = netoEnoto;
          }
        } else if (cenaCenik !== null) {
          // Vrednosti ni, imamo le katalog ceno in morebitni popust v %
          const popustOdst = p.popust != null ? new Decimal(String(p.popust)) : new Decimal(0);
          izvCena    = cenaCenik;     // vedno katalog cena
          rabat1Odst = popustOdst;   // 0 če ni popusta
          if (popustOdst.gt(0)) {
            const netoEnoto = cenaCenik.mul(new Decimal(1).minus(popustOdst.div(100)));
            opozorila.push({
              koda: 'ZAJ080',
              resnost: 'I' as const,
              sporocilo: `Popust ${popustOdst}% upoštevan: katalog ${cenaCenik.toFixed(4)} €/enoto → neto ${netoEnoto.toDecimalPlaces(4).toFixed(4)} €/enoto`,
            });
          }
        } else {
          izvCena = new Decimal(0);
        }

        dto.postavke.push({
          zap:               i + 1,
          izvNaziv:          String(p.naziv   ?? 'Artikel'),
          izvGtin:           (p.gtin   as string) ?? null,
          izvSifra:          (p.sifra  as string) ?? null,
          izvEnota:          (p.enota  as string) ?? null,
          izvKolicina:       kolicina,
          izvCena:           izvCena,
          izvVrednost:       vrednost,
          enotVPaketu:       new Decimal(1),
          rabat1Odst,
          rabat2Odst:        new Decimal(0),
          // OCR: rabat je ločen odstotek (ne vštet v ceno) — ne odbijati dvakrat.
          rabatVkljucenVCeni: false,
          ddvStopnja:        p.davek != null ? new Decimal(String(p.davek)) : null,
          ddvKategorija:     null,
          ddvOsnova:         vrednost,
          ddvZnesek:         p.davek != null && vrednost
            ? vrednost.mul(new Decimal(String(p.davek))).div(100)
            : null,
          ddvKoda:           null,
          vrsticaTip:        'zaloga',
          lot:               null,
          rokUporabe:        null,
          opozorila,
        });
      } catch { /* preskoči pokvarjeno vrstico */ }
    });
  }

  // Preskoči vrstice, kjer je naziv očitno zaporedna številka ali oznaka pozicije
  // (npr. "1", "2.", "Pos. 1", "Position 3", "Postavka 1") — OCR jih včasih prebere iz stolpca "Pos."
  const VRSTICNA_ST = /^\s*(\d+\.?\s*|pos\.?\s*\d*|position\s*\d*|postavka\s*\d*|artikel\s*\d+)\s*$/i;
  dto.postavke = dto.postavke.filter(p => !VRSTICNA_ST.test(p.izvNaziv));

  if (dto.postavke.length === 0) {
    dodajNapako(dto, 'ZAJ032', 'O',
      'OCR ni prepoznal nobene postavke. Poskusite s boljšo osvetlitvijo ali večjo ločljivostjo slike.');
  }

  // Validacija skupnega zneska: vsota vrstic mora ustrezati znesku na dokumentu
  const skupajNeto = raw.skupajNeto != null && String(raw.skupajNeto).trim() !== ''
    ? (() => { try { return new Decimal(String(raw.skupajNeto)); } catch { return null; } })()
    : null;

  if (skupajNeto !== null && skupajNeto.gt(0)) {
    const vsotaVrstic = dto.postavke.reduce((acc, p) => {
      const vred = p.izvVrednost ?? p.izvCena.mul(p.izvKolicina);
      return acc.plus(vred);
    }, new Decimal(0));

    const razlika = vsotaVrstic.minus(skupajNeto).abs();
    const toleranca = skupajNeto.mul('0.005'); // 0.5% toleranca za zaokroževanje

    if (razlika.gt(toleranca)) {
      dodajNapako(dto, 'ZAJ081', 'O',
        `Vsota uvoženih vrstic (${vsotaVrstic.toDecimalPlaces(2).toFixed(2)} €) se ne ujema s skupnim zneskom na dokumentu (${skupajNeto.toFixed(2)} €). Razlika: ${razlika.toFixed(2)} €. Preverite ročno.`);
    }
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
  dobaviteljId: z.string().trim().uuid().optional(),
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

    // 3. Določi ali samodejno ustvari dobavitelja
    const dob = await dolociDobavitelja(
      db, req.companyId, dto, null, vhod.data.dobaviteljId ?? null,
    );
    let dobaviteljId = await resolveOrCreateDobavitelja(db, req.companyId, dob, dto);

    // 3b. Če dobavitelja ni — poskusi AI iskanje (DDG Lite → bizi.si → davčna → VIES)
    let predlogAI = null as import('../../lib/uvoz/poisci-dobavitelja').PodjetjePredlog | null;
    if (!dobaviteljId) {
      try {
        predlogAI = await poisciDobaviteljaAI(dto.dobaviteljNaziv ?? '', dto.dobaviteljIban ?? null);
        if (predlogAI?.davcna) {
          const dtoZAI = { ...dto, dobaviteljDavcna: predlogAI.davcna, dobaviteljNaziv: predlogAI.naziv };
          const dobZAI = await dolociDobavitelja(db, req.companyId, dtoZAI, null, null);
          dobaviteljId = await resolveOrCreateDobavitelja(db, req.companyId, dobZAI, dtoZAI);
        }
      } catch (aiErr) {
        req.log?.warn({ err: aiErr }, 'AI iskanje dobavitelja ni uspelo — padamo na ročni picker');
      }
    }

    if (!dobaviteljId) {
      // Shrani DTO za kasnejši uvoz z ročno izbranim dobaviteljem
      await db.execute(sql`
        UPDATE uvoz_seja
           SET razclenitev = ${JSON.stringify(dto, (_k: string, v: unknown) => v instanceof Decimal ? v.toString() : v)}::jsonb,
               status = 'NAPAKA_RAZCLENITVE'
         WHERE id = ${zajem.sejaId}
      `);
      return posljiJson(res, 422, {
        status:                      'MANJKA_DOBAVITELJ',
        sejaId:                      zajem.sejaId,
        predlogAI,
        predlogDobavitelja:          dob.predlogNovega,
        dobaviteljNazivOcr:          dto.dobaviteljNaziv,
        // Vsi razpoložljivi OCR podatki dobavitelja — za predizpolnitev obrazca
        dobaviteljDavcnaOcr:         dto.dobaviteljDavcna,
        dobaviteljIdDdvOcr:          dto.dobaviteljIdDdv,
        dobaviteljMaticnaOcr:        dto.dobaviteljMaticna,
        dobaviteljIbanOcr:           dto.dobaviteljIban,
        dobaviteljUlicaOcr:          dto.dobaviteljUlica,
        dobaviteljPosteStevilkaOcr:  dto.dobaviteljPostnaStevilka,
        dobaviteljKrajOcr:           dto.dobaviteljKraj,
        dobaviteljDrzavaOcr:         dto.dobaviteljDrzava,
        dobaviteljEmailOcr:          dto.dobaviteljEmail,
        dobaviteljTelefonOcr:        dto.dobaviteljTelefon,
        napake:                      dto.napake,
      });
    }

    // 4. Ustvari osnutek
    const osnutek = await ustvariOsnutek(db, {
      enotaId:      req.enotaId,
      sejaId:       zajem.sejaId,
      dobaviteljId,
      dto,
      uporabnikId:  0,
      actorSnapshot: req.clerkUserId,
    });

    return posljiJson(res, 201, {
      status:  'OSNUTEK_USTVARJEN',
      sejaId:  zajem.sejaId,
      napake:  dto.napake,
      dobaviteljId,
      dobaviteljNazivOcr: dto.dobaviteljNaziv,
      ...osnutek,
    });
  } catch (e) {
    if (e instanceof DuplicatePrejemnicaError) {
      return posljiJson(res, 409, { prejemnicaId: e.obstojeciId || undefined });
    }
    req.log?.error({ err: e }, 'OCR uvoz napaka');
    return posljiJson(res, 500, {
      koda:     'ZAJ031',
      sporocilo: `OCR uvoz ni uspel: ${(e as Error).message}`,
    });
  }
});

// =====================================================================
// POST /api/uvoz/seja/:sejaId/s-dobaviteljem
// Dokonča uvoz seje kjer dobavitelja ni bilo mogoče samodejno določiti.
// =====================================================================

router.post('/seja/:sejaId/s-dobaviteljem', requireEnota, async (req: PosRequest, res: Response) => {
  const sejaId = req.params.sejaId as string;
  const vhod = z.object({ dobaviteljId: z.string().trim().uuid() }).safeParse(req.body);
  if (!vhod.success) return posljiJson(res, 400, { sporocilo: 'Manjka veljaven dobaviteljId.' });

  try {
    const [dobavitelj] = (await db.execute<{ id: string }>(sql`
      SELECT id
        FROM counterparties
       WHERE id = ${vhod.data.dobaviteljId}
         AND company_id = ${req.companyId}
         AND is_active = true
       LIMIT 1
    `)).rows;
    if (!dobavitelj) {
      return posljiJson(res, 400, {
        sporocilo: 'Izbrani dobavitelj ne obstaja v šifrantu aktivnega podjetja.',
      });
    }

    const [seja] = (await db.execute<{ razclenitev: unknown }>(sql`
      SELECT razclenitev FROM uvoz_seja
       WHERE id = ${sejaId} AND enota_id = ${req.enotaId}
    `)).rows;

    if (!seja?.razclenitev) {
      return posljiJson(res, 404, { sporocilo: 'Seja ne obstaja ali nima shranjene razčlenitve.' });
    }

    const osnutek = await ustvariOsnutek(db, {
      enotaId:      req.enotaId,
      sejaId,
      dobaviteljId: vhod.data.dobaviteljId,
      dto:          prejemDtoSchema.parse(seja.razclenitev),
      uporabnikId:  0,
      actorSnapshot: req.clerkUserId,
    });

    return posljiJson(res, 201, {
      status:       'OSNUTEK_USTVARJEN',
      sejaId,
      dobaviteljId: vhod.data.dobaviteljId,
      ...osnutek,
    });
  } catch (e) {
    if (e instanceof DuplicatePrejemnicaError) {
      return posljiJson(res, 409, { prejemnicaId: e.obstojeciId || undefined });
    }
    req.log?.error({ err: e }, 'Uvoz s-dobaviteljem napaka');
    return posljiJson(res, 500, { sporocilo: `Uvoz ni uspel: ${(e as Error).message}` });
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
        dobaviteljId: z.string().trim().uuid().optional(),
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

        if (zajem.status === 'PODVOJENO' && zajem.obstojecaPrejemnicaId != null) {
          // Seja obstaja IN ima prejemnico → resnično podvajanje
          return posljiJson(res, 409, {
            status:       'PODVOJENO',
            sejaId:       zajem.sejaId,
            prejemnicaId: zajem.obstojecaPrejemnicaId,
            napake:       [{ koda: 'ZAJ003', resnost: 'B', sporocilo: 'Ta PDF je bil že uvožen.' }],
          });
        }
        // Seja brez prejemnice (prejšnji uvoz je padel) → nadaljuj z enim sejaId

        const dob = await dolociDobavitelja(
          db, req.companyId, dto, null, vhod.data.dobaviteljId ?? null,
        );
        let dobaviteljId = await resolveOrCreateDobavitelja(db, req.companyId, dob, dto);

        let predlogAIPdf = null as import('../../lib/uvoz/poisci-dobavitelja').PodjetjePredlog | null;
        if (!dobaviteljId) {
          try {
            predlogAIPdf = await poisciDobaviteljaAI(dto.dobaviteljNaziv ?? '', dto.dobaviteljIban ?? null);
            if (predlogAIPdf?.davcna) {
              const dtoZ = { ...dto, dobaviteljDavcna: predlogAIPdf.davcna, dobaviteljNaziv: predlogAIPdf.naziv };
              const dobZ = await dolociDobavitelja(db, req.companyId, dtoZ, null, null);
              dobaviteljId = await resolveOrCreateDobavitelja(db, req.companyId, dobZ, dtoZ);
            }
          } catch { /* tiho pademo na picker */ }
        }

        if (!dobaviteljId) {
          await db.execute(sql`
            UPDATE uvoz_seja
               SET razclenitev = ${JSON.stringify(dto, (_k: string, v: unknown) => v instanceof Decimal ? v.toString() : v)}::jsonb,
                   status = 'NAPAKA_RAZCLENITVE'
             WHERE id = ${zajem.sejaId}
          `);
          return posljiJson(res, 422, {
            status:             'MANJKA_DOBAVITELJ',
            sejaId:             zajem.sejaId,
            predlogAI:          predlogAIPdf,
            predlogDobavitelja: dob.predlogNovega,
            dobaviteljNazivOcr: dto.dobaviteljNaziv,
            napake:             dto.napake,
          });
        }

        const osnutek = await ustvariOsnutek(db, {
          enotaId:      req.enotaId,
          sejaId:       zajem.sejaId,
          dobaviteljId,
          dto,
          uporabnikId:  0,
          actorSnapshot: req.clerkUserId,
        });

        return posljiJson(res, 201, {
          status: 'OSNUTEK_USTVARJEN',
          sejaId: zajem.sejaId,
          napake: dto.napake,
          dobaviteljId,
          dobaviteljNazivOcr: dto.dobaviteljNaziv,
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
        actorSnapshot: req.clerkUserId,
      });

      const koda =
        izid.status === 'OSNUTEK_USTVARJEN' ? 201
        : izid.status === 'PODVOJENO' ? 409
        : 422;

      return posljiJson(res, koda, izid);
    } catch (e) {
      if (e instanceof DuplicatePrejemnicaError) {
        return posljiJson(res, 409, { prejemnicaId: e.obstojeciId || undefined });
      }
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
        ? await r.razcleniXlsx(req.file.buffer, req.file.originalname)
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
        dobaviteljId: z.string().trim().uuid().optional(),
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
        db, req.companyId, dto, null, vhod.dobaviteljId ?? null,
      );
      let dobaviteljIdSeja = dob.dobaviteljId;
      if (!dobaviteljIdSeja) {
        try {
          const predlogAISeja = await poisciDobaviteljaAI(dto.dobaviteljNaziv ?? '', dto.dobaviteljIban ?? null);
          if (predlogAISeja?.davcna) {
            const dtoZ = { ...dto, dobaviteljDavcna: predlogAISeja.davcna, dobaviteljNaziv: predlogAISeja.naziv };
            const dobZ = await dolociDobavitelja(db, req.companyId, dtoZ, null, null);
            dobaviteljIdSeja = await resolveOrCreateDobavitelja(db, req.companyId, dobZ, dtoZ);
          }
        } catch { /* tiho pademo na picker */ }
      }
      if (!dobaviteljIdSeja) {
        return posljiJson(res, 422, {
          status: 'MANJKA_DOBAVITELJ',
          predlogDobavitelja: dob.predlogNovega,
        });
      }

      const izid = await ustvariOsnutek(db, {
        enotaId: req.enotaId,
        sejaId,
        dobaviteljId: dobaviteljIdSeja,
        dto,
        uporabnikId: 0,
        actorSnapshot: req.clerkUserId,
      });

      return posljiJson(res, 201, { status: 'OSNUTEK_USTVARJEN', ...izid });
    } catch (e) {
      if (e instanceof DuplicatePrejemnicaError) {
        return posljiJson(res, 409, { prejemnicaId: e.obstojeciId || undefined });
      }
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
      SELECT pp.id, pp.izv_gtin, pp.izv_sifra, pp.izv_naziv,
             pp.izv_enota, pp.izv_kolicina, pp.izv_cena,
             pp.enot_v_paketu, pp.artikel_id, pp.vrstica_tip,
             pp.uparjanje_zaupanje, pp.uparjanje_kandidati,
             pp.opozorila
        FROM prejemnice_postavke pp
        JOIN prejemnice p ON p.id = pp.prejemnica_id
       WHERE pp.prejemnica_id = ${req.params.id}
         AND p.enota_id = ${req.enotaId}
         AND pp.artikel_id IS NULL
       ORDER BY pp.id
    `);

    // Varnostno dedupliciranje: starejši uvozi so lahko shranili dvojne
    // kandidate za isti artikelId (napaka v GROUP BY pred LATERAL popravkom).
    // Ohranimo vrstico z najvišjo oceno; pri enaki oceni prednostno tisto
    // z neničelno zadnjaCenaEnota.
    const vrsticeDedup = (vrstice as unknown as Array<{
      id: number; artikel_id: number | null; vrstica_tip: string; uparjanje_kandidati: unknown;
      opozorila: unknown;
      [k: string]: unknown;
    }>).map((v) => {
      let opozorila: Array<Record<string, unknown>> = [];
      if (Array.isArray(v.opozorila)) {
        opozorila = v.opozorila.filter(
          (o): o is Record<string, unknown> => typeof o === 'object' && o !== null,
        );
      } else if (typeof v.opozorila === 'string' && v.opozorila.trim()) {
        try {
          const parsed = JSON.parse(v.opozorila) as unknown;
          if (Array.isArray(parsed)) {
            opozorila = parsed.filter(
              (o): o is Record<string, unknown> => typeof o === 'object' && o !== null,
            );
          } else if (typeof parsed === 'object' && parsed !== null) {
            opozorila = [parsed as Record<string, unknown>];
          }
        } catch {
          opozorila = [];
        }
      } else if (typeof v.opozorila === 'object' && v.opozorila !== null) {
        opozorila = [v.opozorila as Record<string, unknown>];
      }

      const k = razcleniUparjanjeKandidate(v.uparjanje_kandidati);
      if (k.length <= 1) return { ...v, opozorila, uparjanje_kandidati: k };
      const po: Map<number, Record<string, unknown>> = new Map();
      for (const kand of k) {
        const aid = Number(kand.artikelId);
        const obs = po.get(aid);
        if (!obs) { po.set(aid, kand); continue; }
        const novOcena = Number(kand.ocena ?? 0);
        const obsOcena = Number(obs.ocena ?? 0);
        const novCena  = Number(kand.zadnjaCenaEnota ?? 0);
        const obsCena  = Number(obs.zadnjaCenaEnota ?? 0);
        if (novOcena > obsOcena || (novOcena === obsOcena && novCena > obsCena)) {
          po.set(aid, kand);
        }
      }
      return { ...v, opozorila, uparjanje_kandidati: [...po.values()] };
    });

    return posljiJson(res, 200, { vsebina: vrsticeDedup, skupaj: vrsticeDedup.length });
  },
);

// syncZalogaGibiZaPrejemnico je bila premaknjena v uvoz-service.ts kot
// knjizalogaGibiZaUvozPrejemnico (izvožena, idempotentna, enotno mesto logike).

// =====================================================================
// POST /api/pos/uvoz/prejemnice/:id/uparjanje
// Ponovni zagon samodejnega uparjanja (npr. po uvozu cenika).
// =====================================================================

router.post(
  '/prejemnice/:id/uparjanje',
  requireEnota,
  async (req: PosRequest, res) => {
    const prejemnicaId = Number(req.params.id);
    try {
      const izid = await db.transaction(async (tx) => {
        await lockPosReceiptForEdit(tx, req.companyId, req.enotaId, prejemnicaId);
        const result = await upariPrejemnico(tx, req.enotaId, prejemnicaId);
        return result;
      });
      return posljiJson(res, 200, izid);
    } catch (error) {
      if (error instanceof ReceiptEditConflict) {
        return posljiJson(res, error.code === "RECEIPT_BOOKING_POSTED" ? 409 : 404, {
          koda: error.code,
          sporocilo: error.message,
        });
      }
      throw error;
    }
  },
);

// =====================================================================
// POST /api/pos/uvoz/postavke/:id/upari
// =====================================================================

const upariTelo = z.object({
  artikelId: z.coerce.number().int().positive().nullable().optional(),
  enotVPaketu: z.union([z.string(), z.number()]).default('1'),
  zapomni: z.boolean().default(true),
  vrsticaTip: z.enum(['zaloga', 'poraba_surovin', 'prevoz']).default('zaloga'),
});

router.post(
  '/postavke/:id/upari',
  requireEnota,
  async (req: PosRequest, res) => {
    const vhod = upariTelo.safeParse(req.body);
    if (!vhod.success) {
      return posljiJson(res, 400, { koda: 'ZAJ014', napake: vhod.error.issues });
    }

    const enotVPaketu = new Decimal(String(vhod.data.enotVPaketu).replace(',', '.'));
    if (!enotVPaketu.isFinite() || !enotVPaketu.gt(0)) {
      return posljiJson(res, 400, {
        koda: 'ZAJ014',
        sporocilo: 'Število enot v paketu mora biti večje od nič.',
      });
    }

    try {
      const found = await db.transaction(async (tx) => {
        const [candidate] = (await tx.execute<{
          izv_sifra: string | null;
          izv_gtin: string | null;
          izv_naziv: string | null;
          izv_cena: string | null;
          izv_enota: string | null;
          dobavitelj_id: string;
          datum: string;
          prejemnica_id: number;
        }>(sql`
          SELECT pp.izv_sifra, pp.izv_gtin, pp.izv_naziv, pp.izv_cena, pp.izv_enota,
                 p.dobavitelj_id, p.datum, pp.prejemnica_id
            FROM prejemnice_postavke pp
            JOIN prejemnice p ON p.id = pp.prejemnica_id
            JOIN enote e ON e.id = p.enota_id AND e.company_id = ${req.companyId}
           WHERE pp.id = ${req.params.id}
             AND p.enota_id = ${req.enotaId}
        `)).rows;
        if (!candidate) return false;
        await lockPosReceiptForEdit(tx, req.companyId, req.enotaId, candidate.prejemnica_id);
        const cenaPaket = candidate.izv_cena ? new Decimal(candidate.izv_cena) : null;
        if (vhod.data.artikelId) await potrdiUparjanje(tx, {
          enotaId: req.enotaId,
          dobaviteljId: candidate.dobavitelj_id,
          artikelId: vhod.data.artikelId,
          postavkaId: Number(req.params.id),
          uporabnikId: 0,
          enotVPaketu,
          izvSifra: candidate.izv_sifra,
          izvGtin: candidate.izv_gtin,
          izvNaziv: candidate.izv_naziv,
          izvEnota: candidate.izv_enota,
          izvCena: cenaPaket && enotVPaketu.gt(0) ? cenaPaket.div(enotVPaketu) : null,
          datumPrevzema: candidate.datum,
          zapomni: vhod.data.zapomni,
        });
        await tx.execute(sql`
          UPDATE prejemnice_postavke
             SET vrstica_tip = ${vhod.data.vrsticaTip},
                 artikel_id = ${vhod.data.vrsticaTip === "zaloga" ? vhod.data.artikelId ?? null : null},
                 uparjanje = ${vhod.data.vrsticaTip === "zaloga" ? "rocno" : "neposredni_strosek"}
           WHERE id = ${req.params.id}
        `);
        return true;
      });
      if (!found) {
        return posljiJson(res, 404, { koda: 'ZAJ020', sporocilo: 'Postavka ne obstaja.' });
      }
    } catch (err: unknown) {
      if (err instanceof ReceiptEditConflict) {
        return posljiJson(res, err.code === "RECEIPT_BOOKING_POSTED" ? 409 : 404, {
          koda: err.code,
          sporocilo: err.message,
        });
      }
      if (err instanceof GenericArticleUnitMismatch) {
        return posljiJson(res, 400, { koda: 'ZAJ014', sporocilo: err.message });
      }
      if (err instanceof PurchaseArticleTargetNotFound) {
        return posljiJson(res, 404, { koda: 'ZAJ020', sporocilo: err.message });
      }
      if (err instanceof ReceiptLineNotFound) {
        return posljiJson(res, 404, { koda: 'ZAJ020', sporocilo: err.message });
      }
      const msg = err instanceof Error ? err.message : '';
      return posljiJson(res, 500, {
        koda: 'ZAJ022',
        sporocilo: msg || 'Napaka pri shranjevanju povezave artikla.',
      });
    }

    return posljiJson(res, 200, { status: 'UPARJENO' });
  },
);

// =====================================================================
// GET /api/uvoz/vies/:idDdv
// Preveri EU VAT ID pri VIES — za ročno preverjanje v obrazcih.
// =====================================================================

router.get(
  '/vies/:idDdv',
  requireEnota,
  async (req: PosRequest, res) => {
    const { preveriVies } = await import('../../lib/vies.js');
    const raw = String(req.params.idDdv ?? '').replace(/\s/g, '').toUpperCase();
    if (!/^[A-Z]{2}.+$/.test(raw)) {
      return posljiJson(res, 400, { napaka: 'Neveljaven format VAT ID (pričakovano npr. DE123456789).' });
    }
    const izid = await preveriVies(raw);
    if (!izid) {
      return posljiJson(res, 503, { napaka: 'VIES ni dosegljiv. Poskusite pozneje.' });
    }
    return posljiJson(res, 200, izid);
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
        dobaviteljId: z.string().trim().uuid().optional(),
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
         AND (${q.dobaviteljId ?? null}::uuid IS NULL
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

// =====================================================================
// POST /api/pos/uvoz/zaloge/sync
// Servisni endpoint: dopolni zaloga_gibi za vse prejemnice z uparjenimi
// postavkami, ki jim manjkajo gibanja. Idempotenten — večkratni zagon
// je varen, ker syncZalogaGibiZaPrejemnico najprej briše stare gibi.
// =====================================================================

router.post(
  '/zaloge/sync',
  requireEnota,
  async (req: PosRequest, res) => {
    try {
      const result = await db.transaction(async (tx) => {
        const { rows: manjkajoPrejemnice } = await tx.execute<{ id: number }>(sql`
          SELECT DISTINCT pp.prejemnica_id AS id
            FROM prejemnice_postavke pp
            JOIN prejemnice p ON p.id = pp.prejemnica_id
            JOIN enote e ON e.id = p.enota_id AND e.company_id = ${req.companyId}
           WHERE pp.artikel_id IS NOT NULL
             AND p.enota_id = ${req.enotaId}
             AND NOT EXISTS (
               SELECT 1 FROM zaloga_gibi zg
                WHERE zg.referenca_id = pp.prejemnica_id
                  AND zg.tip = 'prejemnica'
             )
           ORDER BY pp.prejemnica_id
        `);
        for (const { id } of manjkajoPrejemnice) {
          await lockPosReceiptForEdit(tx, req.companyId, req.enotaId, id);
        }
        return { pregledanih: manjkajoPrejemnice.length, popravljenih: manjkajoPrejemnice.length };
      });
      return posljiJson(res, 200, { ...result, napake: [] });
    } catch (error) {
      if (error instanceof ReceiptEditConflict) {
        return posljiJson(res, error.code === "RECEIPT_BOOKING_POSTED" ? 409 : 404, {
          koda: error.code,
          sporocilo: error.message,
        });
      }
      throw error;
    }
  },
);

/**
 * Prenesi e-SLOG paket prejetega računa (ZIP).
 * Dostop je zaščiten z requireEnota — enako kot vse POS uvozne rute.
 * Vrne ZIP z XML + PDF (samo pri veljavnem RACUN) in VALIDACIJA.txt.
 */
router.get(
  '/prejemnice/:id/eracun-paket.zip',
  requireEnota,
  async (req: PosRequest, res: Response) => {
    const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const receiptId = parseInt(rawId ?? '', 10);
    if (!Number.isInteger(receiptId) || receiptId <= 0) {
      res.status(400).json({ error: 'Neveljaven ID prejemnice.' });
      return;
    }

    const { loadReceivedInvoice } = await import('../../lib/received-invoice-loader');
    const { validateReceivedInvoiceForEslog, generirajPrejetiEracunXml } = await import('../../lib/received-invoice-eslog');
    const { generateReceivedInvoicePdf } = await import('../../lib/external-export-pdf');
    const { buildReceivedInvoicePackage } = await import('../../lib/document-export-package');

    const loaded = await loadReceivedInvoice(req.companyId, receiptId);
    if (!loaded) {
      res.status(404).json({ error: 'Prejemnica ne obstaja ali ni dostopna v tem podjetju.' });
      return;
    }

    const validation = validateReceivedInvoiceForEslog(loaded.data);
    let xml: string | undefined;
    let pdf: Buffer | undefined;
    if (validation.valid) {
      xml = generirajPrejetiEracunXml(loaded.data);
      const h = loaded.data.header;
      pdf = await generateReceivedInvoicePdf({
        supplierName: h.supplier.name!,
        customerName: h.customer.name!,
        invoiceNumber: h.documentNumber!,
        invoiceDate: h.documentDate!,
        dueDate: h.dueDate,
        currency: h.currency ?? 'EUR',
        netTotal: h.netTotal!,
        vatTotal: h.vatTotal!,
        grossTotal: h.grossTotal!,
        items: loaded.data.lines.map((l) => ({
          name: l.name!, quantity: l.quantity!, unitPrice: l.netUnitPrice!,
          total: l.netAmount!, vatRate: l.vatRate!,
        })),
      });
    }

    const invoiceNumber = loaded.data.header.documentNumber ?? `prejemnica-${receiptId}`;
    const zip = await buildReceivedInvoicePackage({
      invoiceNumber,
      xml,
      pdf,
      original: loaded.source,
      warnings: [...validation.errors, ...validation.warnings],
    });

    const safeName = invoiceNumber.replace(/[^a-zA-Z0-9._-]/g, '_');
    res.type('application/zip').attachment(`prejeti-racun-${safeName}.zip`).send(zip);
  },
);

export default router;
