// tests/uvoz-cenik/01-zapisi-preslikave.test.ts
//
// Integracijski test za zapisiPreslikave po popravku podjetje_id → enota_id.
// Poganja se v transakciji, ki se vedno povrnne (ROLLBACK) — ne piše trajno.

import { db } from '@workspace/db';
import { Decimal } from 'decimal.js';
import { sql } from 'drizzle-orm';
import { zapisiPreslikave } from '../../artifacts/api-server/src/lib/uvoz/cenik';

let ok = 0;
let napak = 0;

function preveri(pogoj: boolean, sporocilo: string) {
  if (pogoj) {
    console.log(`  OK    ${sporocilo}`);
    ok += 1;
  } else {
    console.error(`  FAIL  ${sporocilo}`);
    napak += 1;
  }
}

async function run() {
  // ── Poišči testne podatke ────────────────────────────────────────────────
  const [enota] = (await db.execute<{ id: number }>(sql`
    SELECT id FROM enote ORDER BY id LIMIT 1
  `)).rows;

  if (!enota) {
    console.log('PRESKOČENO: ni enote v bazi');
    return;
  }

  const [artikel] = (await db.execute<{ id: number }>(sql`
    SELECT id FROM artikli WHERE enota_id = ${enota.id} AND nabavni_artikel = true LIMIT 1
  `)).rows;

  const [dobavitelj] = (await db.execute<{ id: number }>(sql`
    SELECT id FROM shranjeni_kupci WHERE enota_id = ${enota.id} LIMIT 1
  `)).rows;

  if (!artikel || !dobavitelj) {
    console.log('PRESKOČENO: ni nabavnega artikla ali dobavitelja v bazi');
    return;
  }

  console.log('\n═══ Test: zapisiPreslikave ═══');
  console.log(`  enota: ${enota.id}, artikel: ${artikel.id}, dobavitelj: ${dobavitelj.id}`);

  // ── Test znotraj ROLLBACK transakcije ────────────────────────────────────
  let napakaPovrnitve: Error | null = null;
  await db.transaction(async (tx) => {
    // 1. Vrstica s šifro → mora uspeti (enota_id, ne podjetje_id)
    console.log('\n═══ Primer 1: vrstica s šifro dobavitelja ═══');
    const izid1 = await zapisiPreslikave(
      tx as unknown as Parameters<typeof zapisiPreslikave>[0],
      Number(enota.id),
      Number(dobavitelj.id),
      [{
        artikelId:   Number(artikel.id),
        sifra:       'TEST-SIFRA-CENIK-77777',
        gtin:        null,
        naziv:       'Test cenik artikel',
        enota:       null,
        enotVPaketu: new Decimal(6),
        cenaEnota:   new Decimal('1.50'),
        ddvStopnja:  new Decimal('22'),
      }],
      0,
    );
    preveri(
      izid1.ustvarjenih + izid1.posodobljenih === 1,
      `ustvarjenih+posodobljenih = 1, dobljeno: ${JSON.stringify(izid1)}`,
    );

    // 2. Ponoven uvoz iste šifre z novo ceno → posodobitev
    console.log('\n═══ Primer 2: ponoven uvoz iste šifre → posodobitev cene ═══');
    const izid2 = await zapisiPreslikave(
      tx as unknown as Parameters<typeof zapisiPreslikave>[0],
      Number(enota.id),
      Number(dobavitelj.id),
      [{
        artikelId:   Number(artikel.id),
        sifra:       'TEST-SIFRA-CENIK-77777',
        gtin:        null,
        naziv:       'Test cenik artikel',
        enota:       null,
        enotVPaketu: new Decimal(6),
        cenaEnota:   new Decimal('1.80'),  // spremenjena cena
        ddvStopnja:  new Decimal('22'),
      }],
      0,
    );
    preveri(izid2.posodobljenih === 1, `posodobljenih = 1, dobljeno: ${JSON.stringify(izid2)}`);
    preveri(izid2.ustvarjenih  === 0, `ustvarjenih = 0, dobljeno: ${JSON.stringify(izid2)}`);

    // 3. Vrstica brez šifre in brez GTIN → preskočena (ck_ad_kljuc zaščita)
    console.log('\n═══ Primer 3: vrstica brez šifre in brez GTIN → preskočena ═══');
    const izid3 = await zapisiPreslikave(
      tx as unknown as Parameters<typeof zapisiPreslikave>[0],
      Number(enota.id),
      Number(dobavitelj.id),
      [{
        artikelId:   Number(artikel.id),
        sifra:       null,
        gtin:        null,
        naziv:       'Brez kljuca',
        enota:       null,
        enotVPaketu: new Decimal(1),
        cenaEnota:   new Decimal('1.00'),
        ddvStopnja:  null,
      }],
      0,
    );
    preveri(izid3.preskocenih === 1, `preskocenih = 1, dobljeno: ${JSON.stringify(izid3)}`);

    // Vedno povrni transakcijo — ne pišemo trajno
    throw Object.assign(new Error('ROLLBACK_TEST'), { jeTest: true });
  }).catch((e: Error & { jeTest?: boolean }) => {
    if (!e.jeTest) napakaPovrnitve = e;
  });

  if (napakaPovrnitve) throw napakaPovrnitve;

  // ── Povzetek ─────────────────────────────────────────────────────────────
  console.log('\n──────────────────────────────────────────────────');
  if (napak === 0) {
    console.log('✓ VSI TESTI USPEŠNI');
  } else {
    console.error(`✕ ${napak} TEST(OV) NEUSPEŠNIH`);
    process.exit(1);
  }
}

run().catch((e) => {
  console.error('NAPAKA:', e);
  process.exit(1);
});
