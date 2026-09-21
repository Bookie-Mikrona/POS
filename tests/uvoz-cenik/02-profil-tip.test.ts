// tests/uvoz-cenik/02-profil-tip.test.ts
//
// Preverja, da je stolpec 'tip' dodan na tabelo uvoz_profil z DEFAULT 'PREJEMNICA'
// in da obstoječi zapisi imajo veljavno vrednost.

import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

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
  console.log('\n═══ Test: stolpec tip na tabeli uvoz_profil ═══');

  // 1. Stolpec obstaja
  const [stolpec] = (await db.execute<{
    column_name: string;
    column_default: string | null;
    is_nullable: string;
  }>(sql`
    SELECT column_name, column_default, is_nullable
      FROM information_schema.columns
     WHERE table_name = 'uvoz_profil'
       AND column_name = 'tip'
  `)).rows;

  preveri(!!stolpec, 'stolpec tip obstaja v tabeli uvoz_profil');
  preveri(
    stolpec?.column_default?.includes('PREJEMNICA') ?? false,
    `DEFAULT vrednost je 'PREJEMNICA', dobljeno: ${stolpec?.column_default ?? 'ni stolpca'}`,
  );
  preveri(
    stolpec?.is_nullable === 'NO',
    `stolpec je NOT NULL, dobljeno: is_nullable=${stolpec?.is_nullable ?? '?'}`,
  );

  console.log('\n═══ Test: obstoječi profili imajo veljavno vrednost tip ═══');

  // 2. Obstoječi profili imajo tip IN ('PREJEMNICA', 'CENIK')
  const [napacni] = (await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM uvoz_profil
     WHERE tip NOT IN ('PREJEMNICA', 'CENIK')
  `)).rows;

  preveri(
    Number(napacni?.cnt ?? 0) === 0,
    `vsi profili imajo veljavno vrednost tip (napačnih: ${napacni?.cnt ?? 0})`,
  );

  // 3. Če testna baza vsebuje profile, ima vsaj eden privzeti tip PREJEMNICA.
  //    Prazna baza je veljaven scenarij: pravilnost DEFAULT-a preverimo zgoraj
  //    neposredno na definiciji stolpca.
  const [skupaj] = (await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM uvoz_profil
  `)).rows;

  const [prejemnica] = (await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM uvoz_profil WHERE tip = 'PREJEMNICA'
  `)).rows;

  const [cenik] = (await db.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM uvoz_profil WHERE tip = 'CENIK'
  `)).rows;

  const stSkupaj = Number(skupaj?.cnt ?? 0);
  const stPrejemnica = Number(prejemnica?.cnt ?? 0);
  const stCenik = Number(cenik?.cnt ?? 0);

  console.log(`  INFO  skupaj profilov: ${stSkupaj}, z tip='PREJEMNICA': ${stPrejemnica}, z tip='CENIK': ${stCenik}`);
  preveri(
    stSkupaj === 0 || stPrejemnica > 0,
    stSkupaj === 0
      ? 'prazna testna baza nima profilov; DEFAULT je preverjen na stolpcu'
      : `vsaj en obstoječi profil ima tip='PREJEMNICA' (${stPrejemnica}/${stSkupaj})`,
  );

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
