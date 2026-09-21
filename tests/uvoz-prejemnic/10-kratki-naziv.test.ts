// tests/uvoz-prejemnic/10-kratki-naziv.test.ts
//
// Preverja, da dolociDobavitelja() najde obstoječega partnerja prek kratkega
// naziva (kratki_naziv), ko OCR naziv ne doseže praga prek dolgega naziva.
//
// Primer: dolgi naziv = "JULIUS MEINL, TRGOVINA S KAVO, D.O.O."
//         kratki naziv = "JULIUS MEINL d.o.o."
//         OCR bere     = "Julius Meinl d.o.o."
//         similarity(dolgi, OCR) ≈ 0.32  → pod pragom
//         similarity(kratki, OCR) ≈ 0.95 → nad pragom → najde
//
// Test teče v transakciji, ki se vedno povrne (ROLLBACK) — ne piše trajno.

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { dolociDobavitelja } from '../../artifacts/api-server/src/lib/uvoz/uvoz-service';

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
  // ── Pridobi testno podjetje ─────────────────────────────────────────────────
  const [company] = (await db.execute<{ id: string }>(sql`
    SELECT id FROM companies ORDER BY created_at LIMIT 1
  `)).rows;

  if (!company) {
    console.log('PRESKOČENO: ni podjetja v bazi');
    return;
  }

  const companyId = company.id;

  await db.execute(sql`BEGIN`);
  try {
    // ── Vstavi testnega partnerja z obema nazivoma ───────────────────────────
    const [partner] = (await db.execute<{ id: string }>(sql`
      INSERT INTO counterparties (company_id, type, name, kratki_naziv, tax_id)
      VALUES (
        ${companyId},
        'both',
        'JULIUS MEINL, TRGOVINA S KAVO, D.O.O.',
        'JULIUS MEINL d.o.o.',
        '99988877'
      )
      RETURNING id
    `)).rows;

    const partnerId = partner.id;

    // ── Test 1: OCR naziv = kratki naziv (razlika: velikost črk) ─────────────
    console.log('\n=== Kratki naziv: ujemanje prek kratki_naziv ===');
    const izid1 = await dolociDobavitelja(db, companyId, {
      dobaviteljNaziv: 'Julius Meinl d.o.o.',
      dobaviteljDavcna: null,
      dobaviteljIdDdv: null,
      dobaviteljMaticna: null,
      dobaviteljIban: null,
    } as Parameters<typeof dolociDobavitelja>[2]);

    preveri(izid1.dobaviteljId === partnerId, `OCR "Julius Meinl d.o.o." → najde partnerja #${partnerId} (vir: ${izid1.vir})`);
    preveri(izid1.vir === 'IME', `vir = 'IME' (dobljeno: '${izid1.vir}')`);

    // ── Test 2: Dolgi naziv še vedno deluje ────────────────────────────────────
    console.log('\n=== Dolgi naziv: ujemanje prek naziv (nazaj-kompatibilnost) ===');
    const izid2 = await dolociDobavitelja(db, companyId, {
      dobaviteljNaziv: 'JULIUS MEINL, TRGOVINA S KAVO, D.O.O.',
      dobaviteljDavcna: null,
      dobaviteljIdDdv: null,
      dobaviteljMaticna: null,
      dobaviteljIban: null,
    } as Parameters<typeof dolociDobavitelja>[2]);

    preveri(izid2.dobaviteljId === partnerId, `Dolgi naziv → najde partnerja #${partnerId}`);

    // ── Test 3: Partner brez kratki_naziv — dolgi naziv deluje normalno ────────
    console.log('\n=== Partner brez kratki_naziv: brez napake ===');
    const [partnerBrez] = (await db.execute<{ id: string }>(sql`
      INSERT INTO counterparties (company_id, type, name, kratki_naziv, tax_id)
      VALUES (
        ${companyId},
        'both',
        'TESTNI PARTNER BREZ KRATKEGA NAZIVA D.O.O.',
        NULL,
        '11122233'
      )
      RETURNING id
    `)).rows;

    const izid3 = await dolociDobavitelja(db, companyId, {
      dobaviteljNaziv: 'TESTNI PARTNER BREZ KRATKEGA NAZIVA D.O.O.',
      dobaviteljDavcna: null,
      dobaviteljIdDdv: null,
      dobaviteljMaticna: null,
      dobaviteljIban: null,
    } as Parameters<typeof dolociDobavitelja>[2]);

    preveri(izid3.dobaviteljId === partnerBrez.id, 'Partner z NULL kratki_naziv → najde prek dolgega naziva');

    // ── Test 4: Brez ujemanja → ne najde ──────────────────────────────────────
    console.log('\n=== Brez ujemanja: vrne null ===');
    const izid4 = await dolociDobavitelja(db, companyId, {
      dobaviteljNaziv: 'Popolnoma Neobstojece Podjetje X.Y.Z.',
      dobaviteljDavcna: null,
      dobaviteljIdDdv: null,
      dobaviteljMaticna: null,
      dobaviteljIban: null,
    } as Parameters<typeof dolociDobavitelja>[2]);

    preveri(izid4.dobaviteljId === null, 'Neznan naziv → dobaviteljId = null');

  } finally {
    await db.execute(sql`ROLLBACK`);
  }
}

run()
  .then(() => {
    console.log('\n' + (napak ? `NEUSPESNO: ${napak} napak` : 'VSI TESTI USPESNI'));
    process.exit(napak ? 1 : 0);
  })
  .catch((err) => {
    console.error('NAPAKA:', err);
    process.exit(1);
  });
