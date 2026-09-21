/**
 * Live-DB verification for imported-receipt stock synchronization.
 *
 * The whole verification runs in one transaction and is deliberately rolled
 * back, so repeated runs never add audit-history rows to the database.
 */
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { knjizalogaGibiZaUvozPrejemnico } from "../../artifacts/api-server/src/lib/uvoz/uvoz-service";

let napak = 0;
const preveri = (pogoj: boolean, opis: string) => {
  if (!pogoj) napak++;
  console.log(`  ${pogoj ? "OK   " : "FAIL "} ${opis}`);
};

type Executor = Parameters<typeof knjizalogaGibiZaUvozPrejemnico>[0];

async function expectedReceipt(tx: Executor, prejemnicaId: number) {
  const [row] = (await tx.execute<{
    cnt: string;
    distinct_cnt: string;
    qty: string;
    value: string;
  }>(sql`
    SELECT COUNT(*) AS cnt,
           COUNT(DISTINCT artikel_id) AS distinct_cnt,
           COALESCE(SUM(kolicina::numeric), 0)::text AS qty,
           COALESCE(SUM(kolicina::numeric * cena_kos::numeric), 0)::text AS value
      FROM prejemnice_postavke
     WHERE prejemnica_id = ${prejemnicaId}
       AND artikel_id IS NOT NULL
  `)).rows;
  return {
    count: Number(row?.cnt ?? 0),
    distinctCount: Number(row?.distinct_cnt ?? 0),
    quantity: Number(row?.qty ?? 0),
    value: Number(row?.value ?? 0),
  };
}

async function movementState(tx: Executor, prejemnicaId: number) {
  const [row] = (await tx.execute<{
    active_count: string;
    total_count: string;
    reversal_count: string;
    duplicate_reversals: string;
    net_qty: string;
    net_value: string;
    active_sources: string[];
  }>(sql`
    WITH originals AS (
      SELECT zg.*
        FROM zaloga_gibi zg
       WHERE zg.referenca_id = ${prejemnicaId}
         AND zg.tip = 'prejemnica'
         AND (
           zg.source_snapshot IN ('uvoz-prejemnica', 'prejemnica')
           OR zg.source_snapshot IS NULL
         )
    ),
    reversals AS (
      SELECT r.*
        FROM zaloga_gibi r
        JOIN originals o ON o.id = r.reversal_of_id
    ),
    duplicate_links AS (
      SELECT reversal_of_id
        FROM reversals
       GROUP BY reversal_of_id
      HAVING COUNT(*) > 1
    ),
    relevant AS (
      SELECT kolicina, vrednost FROM originals
      UNION ALL
      SELECT kolicina, vrednost FROM reversals
    )
    SELECT
      (SELECT COUNT(*) FROM originals o
        WHERE NOT EXISTS (SELECT 1 FROM reversals r WHERE r.reversal_of_id=o.id)
      )::text AS active_count,
      ((SELECT COUNT(*) FROM originals) + (SELECT COUNT(*) FROM reversals))::text AS total_count,
      (SELECT COUNT(*) FROM reversals)::text AS reversal_count,
      (SELECT COUNT(*) FROM duplicate_links)::text AS duplicate_reversals,
      COALESCE((SELECT SUM(kolicina::numeric) FROM relevant), 0)::text AS net_qty,
      COALESCE((SELECT SUM(vrednost::numeric) FROM relevant), 0)::text AS net_value,
      ARRAY(
        SELECT DISTINCT o.source_snapshot
          FROM originals o
         WHERE NOT EXISTS (SELECT 1 FROM reversals r WHERE r.reversal_of_id=o.id)
         ORDER BY o.source_snapshot
      ) AS active_sources
  `)).rows;
  return {
    activeCount: Number(row?.active_count ?? 0),
    totalCount: Number(row?.total_count ?? 0),
    reversalCount: Number(row?.reversal_count ?? 0),
    duplicateReversals: Number(row?.duplicate_reversals ?? 0),
    netQuantity: Number(row?.net_qty ?? 0),
    netValue: Number(row?.net_value ?? 0),
    activeSources: row?.active_sources ?? [],
  };
}

const closeEnough = (a: number, b: number) => Math.abs(a - b) < 0.0001;
const ROLLBACK = new Error("ROLLBACK_STOCK_SYNC_VERIFICATION");

async function runChecks(tx: Executor) {
  const token = randomUUID();
  const sha = token.replace(/-/g, "");

  // Do not use a fixture selected from the live database: the assertions below
  // need an article that has no unrelated movements and receipts with a known
  // import lineage.
  const [company] = (await tx.execute<{ id: string }>(sql`
    INSERT INTO companies (podjetje_davcna, naziv)
    VALUES (${`SYNC-${token}`}, ${`Zalog sync test ${token}`})
    RETURNING id
  `)).rows;
  if (!company) throw new Error("Ni bilo mogoče ustvariti testnega podjetja.");

  const [unit] = (await tx.execute<{ id: number }>(sql`
    INSERT INTO enote (company_id, ime)
    VALUES (${company.id}, ${`Zalog sync test enota ${token}`})
    RETURNING id
  `)).rows;
  if (!unit) throw new Error("Ni bilo mogoče ustvariti testne enote.");

  const [article] = (await tx.execute<{ id: number }>(sql`
    INSERT INTO artikli (enota_id, ime, cena, nabavni_artikel, prodajni_artikel)
    VALUES (${unit.id}, ${`Zalog sync test artikel ${token}`}, 1, true, false)
    RETURNING id
  `)).rows;
  if (!article) throw new Error("Ni bilo mogoče ustvariti testnega artikla.");

  const [matchedSession] = (await tx.execute<{ id: string }>(sql`
    INSERT INTO uvoz_seja (enota_id, kanal, format, sha256, status)
    VALUES (${unit.id}, 'ROCNI_NALOG', 'JSON_LASTNI', ${`${sha}a`}, 'PREJETO')
    RETURNING id
  `)).rows;
  if (!matchedSession) throw new Error("Ni bilo mogoče ustvariti testne uvozne seje.");

  const [testPrej] = (await tx.execute<{ id: number; stevilka: string }>(sql`
    INSERT INTO prejemnice (enota_id, stevilka, datum, uvoz_seja_id, opomba)
    VALUES (
      ${unit.id}, ${`SYNC-${token}`}, '2024-01-15T12:00:00.000Z',
      ${matchedSession.id}, 'Deterministična testna prejemnica'
    )
    RETURNING id, stevilka
  `)).rows;
  if (!testPrej) throw new Error("Ni bilo mogoče ustvariti testne prejemnice.");

  await tx.execute(sql`
    UPDATE uvoz_seja SET prejemnica_id = ${testPrej.id} WHERE id = ${matchedSession.id}
  `);
  await tx.execute(sql`
    INSERT INTO prejemnice_postavke (
      prejemnica_id, artikel_id, kolicina, cena_kos, skupaj, uparjanje
    )
    VALUES (${testPrej.id}, ${article.id}, 3.5, 2.4, 8.4, 'rocno')
  `);

  console.log("\n═══ Test 1: append-only knjiženje uvožene prejemnice ═══");
  const expected = await expectedReceipt(tx, testPrej.id);
  const before = await movementState(tx, testPrej.id);

  await knjizalogaGibiZaUvozPrejemnico(tx, testPrej.id, null);
  const first = await movementState(tx, testPrej.id);
  preveri(first.activeCount === expected.count, `po prvem syncu: ${first.activeCount} aktivnih gibov`);
  preveri(closeEnough(first.netQuantity, expected.quantity), `neto količina ${first.netQuantity}`);
  preveri(closeEnough(first.netValue, expected.value), `neto vrednost ${first.netValue}`);
  preveri(first.duplicateReversals === 0, "vsak original ima največ eno izravnavo");
  preveri(first.activeSources.join(",") === "uvoz-prejemnica", "aktivni gibi ohranijo uvozni izvor");
  preveri(first.totalCount === before.totalCount + expected.count, "prvi sync doda pričakovano zgodovino");

  console.log("\n═══ Test 2: ponovni sync ohrani isti aktivni neto učinek ═══");
  await knjizalogaGibiZaUvozPrejemnico(tx, testPrej.id, null);
  const second = await movementState(tx, testPrej.id);
  preveri(second.activeCount === expected.count, `po drugem syncu: ${second.activeCount} aktivnih gibov`);
  preveri(closeEnough(second.netQuantity, expected.quantity), `stabilna neto količina ${second.netQuantity}`);
  preveri(closeEnough(second.netValue, expected.value), `stabilna neto vrednost ${second.netValue}`);
  preveri(second.duplicateReversals === 0, "reversal_of_id ostane enoličen");
  preveri(second.activeSources.join(",") === "uvoz-prejemnica", "ponovni sync ohrani uvozni izvor");
  preveri(second.reversalCount === first.activeCount, "ponovni sync enkrat stornira vsak prvi gib");
  preveri(second.totalCount === first.totalCount + first.activeCount + expected.count, "ponovni sync doda storna in svež snapshot");

  console.log("\n═══ Test 3: zaloge row obstaja po knjiženju ═══");
  const [zalogeRow] = (await tx.execute<{ cnt: string }>(sql`
    SELECT COUNT(*) AS cnt FROM zaloge WHERE artikel_id = ${article.id}
  `)).rows;
  const stockRows = Number(zalogeRow?.cnt ?? 0);
  preveri(stockRows === expected.distinctCount, `zaloge row za vsak unikaten artikel (${stockRows}/${expected.distinctCount})`);

  console.log("\n═══ Test 4: prejemnica brez uparjenih ne spremeni gibov ═══");
  const [unmatchedSession] = (await tx.execute<{ id: string }>(sql`
    INSERT INTO uvoz_seja (enota_id, kanal, format, sha256, status)
    VALUES (${unit.id}, 'ROCNI_NALOG', 'JSON_LASTNI', ${`${sha}b`}, 'PREJETO')
    RETURNING id
  `)).rows;
  if (!unmatchedSession) throw new Error("Ni bilo mogoče ustvariti seje brez ujemanja.");
  const [withoutMatches] = (await tx.execute<{ id: number; stevilka: string }>(sql`
    INSERT INTO prejemnice (enota_id, stevilka, datum, uvoz_seja_id)
    VALUES (${unit.id}, ${`SYNC-UNMATCHED-${token}`}, '2024-01-16T12:00:00.000Z', ${unmatchedSession.id})
    RETURNING id, stevilka
  `)).rows;
  if (!withoutMatches) throw new Error("Ni bilo mogoče ustvariti prejemnice brez ujemanja.");
  await tx.execute(sql`
    UPDATE uvoz_seja SET prejemnica_id = ${withoutMatches.id} WHERE id = ${unmatchedSession.id}
  `);
  await tx.execute(sql`
    INSERT INTO prejemnice_postavke (prejemnica_id, kolicina, cena_kos, skupaj, izv_naziv)
    VALUES (${withoutMatches.id}, 2, 7, 14, 'Neuparjena testna vrstica')
  `);
  const unmatchedExpected = await expectedReceipt(tx, withoutMatches.id);
  preveri(unmatchedExpected.count === 0, "fixture brez ujemanja nima artikel_id");
  const unmatchedBefore = await movementState(tx, withoutMatches.id);
  await knjizalogaGibiZaUvozPrejemnico(tx, withoutMatches.id, null);
  const unmatchedAfter = await movementState(tx, withoutMatches.id);
  preveri(unmatchedAfter.activeCount === 0, `${withoutMatches.stevilka}: brez aktivnih prejemov`);
  preveri(closeEnough(unmatchedAfter.netQuantity, 0), "neto količina je 0");
  preveri(closeEnough(unmatchedAfter.netValue, 0), "neto vrednost je 0");
  preveri(unmatchedAfter.duplicateReversals === 0, "ni podvojenih izravnav");
  preveri(unmatchedAfter.totalCount === unmatchedBefore.totalCount, "brez ujemanj ne doda zgodovine");
}

async function run() {
  try {
    await db.transaction(async (tx) => {
      await runChecks(tx as Executor);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }

  console.log("\n──────────────────────────────────────────────────");
  if (napak === 0) console.log("✓ VSI TESTI USPEŠNI (spremembe rollbackane)\n");
  else {
    console.log(`✗ ${napak} NAPAK\n`);
    process.exit(1);
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});