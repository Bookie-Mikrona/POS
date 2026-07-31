// artifacts/api-server/src/scheduled/zajem.ts
//
// Vstopna točka za Replit Scheduled Deployment.
//
//   Objava:  pos-opravila
//   Vrsta:   Scheduled
//   Urnik:   vsakih 10 minut
//   Ukaz:    npx tsx src/scheduled/zajem.ts
//
// ZAKAJ URNIK IN NE IMAP IDLE
// Autoscale objava se ob mirovanju skrči na nič strežnikov, zato trajne
// povezave ni mogoče vzdrževati. Reserved VM bi to zmogel, a dobavnica
// ni sporočilo v realnem času — prispe zjutraj, prevzame se ob dostavi.
// Zamik desetih minut ne pomeni ničesar, fiksni mesečni strošek pa.
//
// Isto opravilo obdela tudi seje, ki čakajo iz drugih kanalov (nalog
// velike datoteke, uvoz cenika), da ne potrebujemo druge objave.
//
// Odvisnosti:
//   npm i imapflow mailparser
//   npm i -D @types/mailparser

import { createHash } from 'node:crypto';
import { ImapFlow, type FetchMessageObject } from 'imapflow';
import { simpleParser } from 'mailparser';
import { sql } from 'drizzle-orm';

import { db } from '@workspace/db';
import { desifrirajGeslo } from '../lib/kripto';
import {
  dolociDobavitelja,
  razcleniSejo,
  ustvariOsnutek,
  zajemi,
} from '../lib/uvoz/uvoz-service';

// =====================================================================
// Omejitve enega zagona
// =====================================================================

const NAJVEC_SPOROCIL = 25;         // preostanek pobere naslednji zagon
const NAJVEC_SEJ = 50;
const NAJVECJA_PRILOGA = 20 * 1024 * 1024;
const DOVOLJENE_PRIPONKE = /\.(xml|csv|txt|xlsx|xls|pdf|edi|json|zip)$/i;

/** Sistemski uporabnik, pod katerim se knjižijo samodejni uvozi. */
const SISTEMSKI_UPORABNIK = 0;

// =====================================================================
// Svetovalni zaklep
// =====================================================================

/**
 * Prekrivajoči se zagoni so pri urniku realna možnost: če se prejšnji
 * zavleče, se naslednji začne, preden prvi konča. Enoličnost sha256 bi
 * dvojno obdelavo sicer ujela, a šele po nepotrebnem delu — in pri
 * premikanju sporočil v mapo Obdelano bi nastala zmeda.
 *
 * pg_advisory_lock se sprosti sam ob koncu seje, tudi ob sesutju.
 */
async function zZaklepom<T>(
  kljuc: string,
  opravilo: () => Promise<T>,
): Promise<T | null> {
  const [{ pridobljen }] = (await db.execute<{ pridobljen: boolean }>(sql`
    SELECT pg_try_advisory_lock(hashtext(${kljuc})) AS pridobljen
  `)).rows;

  if (!pridobljen) {
    // Ni napaka — prejšnji zagon še teče. Tiho končaj.
    console.log(`[zajem] zaklep ${kljuc} zaseden, preskakujem`);
    return null;
  }

  try {
    return await opravilo();
  } finally {
    await db.execute(sql`SELECT pg_advisory_unlock(hashtext(${kljuc}))`);
  }
}

// =====================================================================
// Zajem iz predala
// =====================================================================

interface Predal {
  id: number;
  enota_id: number | null;
  streznik: string;
  vrata: number;
  uporabnisko_ime: string;
  geslo_sifrirano: string;
  mapa: string;
  mapa_obdelano: string | null;
  mapa_karantena: string | null;
  uporabi_tls: boolean;
}

async function obdelajPredal(p: Predal): Promise<void> {
  const odjemalec = new ImapFlow({
    host: p.streznik,
    port: p.vrata,
    secure: p.uporabi_tls,
    auth: {
      user: p.uporabnisko_ime,
      pass: await desifrirajGeslo(p.geslo_sifrirano),
    },
    logger: false,
  });

  await odjemalec.connect();
  const zaklepMape = await odjemalec.getMailboxLock(p.mapa);

  try {
    const seznam = await odjemalec.search({ seen: false });
    const izbrani = (seznam || []).slice(0, NAJVEC_SPOROCIL);

    for (const uid of izbrani) {
      // fetchOne vrne false, kadar sporočila ni (npr. ga je vmes
      // premaknil drug odjemalec). Brez te straže se tip ne izide.
      const sporocilo = await odjemalec.fetchOne(String(uid), { source: true });
      if (sporocilo === false || !sporocilo.source) continue;

      const vKaranteno = await obdelajSporocilo(p, sporocilo);
      const cilj = vKaranteno
        ? (p.mapa_karantena ?? 'Karantena')
        : (p.mapa_obdelano ?? 'Obdelano');

      // Premakni, ne briši in ne označi le kot prebrano. Mapa Obdelano
      // je edini način, da se pri težavi ugotovi, kaj je sistem videl.
      await odjemalec.messageMove(String(uid), cilj);
    }

    await db.execute(sql`
      UPDATE uvoz_predal
         SET zadnja_povezava = now(), zadnja_napaka = NULL
       WHERE id = ${p.id}
    `);
    console.log(`[zajem] predal ${p.id}: obdelanih ${izbrani.length} sporočil`);
  } finally {
    zaklepMape.release();
    await odjemalec.logout();
  }
}

/** @returns true, če sporočilo sodi v karanteno */
async function obdelajSporocilo(
  p: Predal,
  sporocilo: FetchMessageObject,
): Promise<boolean> {
  const posta = await simpleParser(sporocilo.source as Buffer);
  const posiljatelj = posta.from?.value?.[0]?.address?.toLowerCase() ?? null;

  // Neznani pošiljatelji gredo v karanteno, ne v obdelavo. Predal je
  // edini vhod, ki ga lahko naslovi kdorkoli.
  const [znan] = (await db.execute<{ partner_id: number }>(sql`
    SELECT partner_id FROM partner_eposta
     WHERE enota_id = ${p.enota_id}
       AND (lower(naslov) = ${posiljatelj}
            OR lower(domena) = ${posiljatelj?.split('@')[1] ?? ''})
     LIMIT 1
  `)).rows;

  if (!znan) {
    console.log(`[zajem] neznan pošiljatelj ${posiljatelj} -> karantena`);
    return true;
  }

  const priloge = (posta.attachments ?? []).filter(
    (a) =>
      a.filename &&
      DOVOLJENE_PRIPONKE.test(a.filename) &&
      a.content.length <= NAJVECJA_PRILOGA,
  );

  if (!priloge.length) return true;

  // Kadar sporočilo vsebuje XML in PDF istega računa, obdelaj XML.
  const urejene = [...priloge].sort((a, b) => prednost(a.filename!) - prednost(b.filename!));

  for (const priloga of urejene) {
    try {
      const zajem = await zajemi(db, {
        enotaId: p.enota_id ?? 0,
        kanal: 'EPOSTA',
        raw: priloga.content,
        imeDatoteke: priloga.filename ?? undefined,
        mimeTip: priloga.contentType,
        metapodatki: {
          posiljatelj,
          zadeva: posta.subject ?? null,
          prejeto: posta.date?.toISOString() ?? null,
          predalId: p.id,
          sha256Sporocila: createHash('sha256')
            .update(sporocilo.source as Buffer)
            .digest('hex'),
        },
      });

      if (zajem.status === 'PODVOJENO') continue;

      // Uvoz iz e-pošte se NIKOLI ne knjiži samodejno, tudi ob
      // stoodstotnem uparjanju. Sicer lahko kdorkoli, ki pozna naslov
      // znanega dobavitelja, spremeni zalogo.
      const dto = await razcleniSejo(db, zajem.sejaId);
      if (dto.napake.some((n) => n.resnost === 'B')) continue;

      const dob = await dolociDobavitelja(db, p.enota_id ?? 0, dto, posiljatelj);
      if (!dob.dobaviteljId) continue;

      await ustvariOsnutek(db, {
        enotaId: p.enota_id ?? 0,
        sejaId: zajem.sejaId,
        dobaviteljId: dob.dobaviteljId,
        dto,
        uporabnikId: SISTEMSKI_UPORABNIK,
      });
    } catch (e) {
      console.error(`[zajem] napaka pri prilogi ${priloga.filename}:`, e);
    }
  }

  return false;
}

/** XML pred EDIFACT pred CSV pred PDF. */
function prednost(ime: string): number {
  if (/\.xml$/i.test(ime)) return 0;
  if (/\.edi$/i.test(ime)) return 1;
  if (/\.(csv|txt)$/i.test(ime)) return 2;
  if (/\.(xlsx|xls)$/i.test(ime)) return 3;
  return 9;
}

// =====================================================================
// Obdelava sej, ki čakajo iz drugih kanalov
// =====================================================================

async function obdelajCakajoceSeje(): Promise<void> {
  const { rows: seje } = await db.execute<{ id: string; enota_id: number }>(sql`
    SELECT id, enota_id FROM uvoz_seja
     WHERE status = 'PREJETO'
       AND prejeto < now() - interval '1 minute'
     ORDER BY prejeto
     LIMIT ${NAJVEC_SEJ}
  `);

  for (const s of seje) {
    try {
      const dto = await razcleniSejo(db, s.id);
      if (dto.napake.some((n) => n.resnost === 'B')) continue;

      const dob = await dolociDobavitelja(db, s.enota_id, dto);
      if (!dob.dobaviteljId) continue;

      await ustvariOsnutek(db, {
        enotaId: s.enota_id,
        sejaId: s.id,
        dobaviteljId: dob.dobaviteljId,
        dto,
        uporabnikId: SISTEMSKI_UPORABNIK,
      });
    } catch (e) {
      console.error(`[zajem] seja ${s.id}:`, e);
      await db.execute(sql`
        UPDATE uvoz_seja
           SET status = 'NAPAKA_RAZCLENITVE',
               napake = ${JSON.stringify([
                 { koda: 'ZAJ021', resnost: 'B', sporocilo: (e as Error).message },
               ])}::jsonb
         WHERE id = ${s.id}
      `);
    }
  }

  if (seje.length) console.log(`[zajem] obdelanih ${seje.length} čakajočih sej`);
}

// =====================================================================
// Glavni tok
// =====================================================================

async function glavni(): Promise<void> {
  const zacetek = Date.now();

  const { rows: predali } = await db.execute<Record<string, unknown>>(sql`
    SELECT id, enota_id, streznik, vrata, uporabnisko_ime,
           geslo_sifrirano, mapa, mapa_obdelano, mapa_karantena, uporabi_tls
      FROM uvoz_predal
     WHERE aktivno
     ORDER BY id
  `);

  for (const p of predali as unknown as Predal[]) {
    await zZaklepom(`zajem_eposta:${String(p.id)}`, async () => {
      try {
        await obdelajPredal(p);
      } catch (e) {
        console.error(`[zajem] predal ${p.id} ni dosegljiv:`, e);
        await db.execute(sql`
          UPDATE uvoz_predal SET zadnja_napaka = ${(e as Error).message}
           WHERE id = ${p.id}
        `);
      }
    });
  }

  await zZaklepom('obdelava_sej', obdelajCakajoceSeje);

  console.log(`[zajem] končano v ${Date.now() - zacetek} ms`);
}

glavni()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('[zajem] nepričakovana napaka:', e);
    process.exit(1);
  });
