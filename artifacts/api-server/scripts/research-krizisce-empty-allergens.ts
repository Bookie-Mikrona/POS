/**
 * Explicitly authorized one-off research of the 67 empty profiles from the PDF alignment.
 * Does not select the rest of the catalog or certify absence of allergens.
 */
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "@workspace/db";
import { runNextAllergenResearch } from "../src/lib/allergen-research-runner";
import { normalizirajAlergenProfil } from "../src/lib/alergeni";

const reportPath = (name: string) => fileURLToPath(new URL(`../../../reports/${name}`, import.meta.url));
const unitId = 309;
const resumeFailed = process.argv.includes("--resume-failed");
const input = JSON.parse(await readFile(reportPath("krizisce-allergen-catalog-alignment.json"), "utf8"));
const ids: number[] = input.proposals.filter((p: { codes: string[]; traces: string[] }) =>
  !p.codes.length && !p.traces.length).map((p: { id: number }) => p.id);
if (ids.length !== 67 || new Set(ids).size !== 67 || input.unitId !== unitId) {
  throw new Error("Unexpected authorized research scope.");
}
const fingerprint = async () => (await pool.query(`SELECT md5(string_agg(row_to_json(p)::text,'' ORDER BY p.id)) AS hash
  FROM prepared_food_daily_ledgers p WHERE enota_id=$1`, [unitId])).rows[0].hash;
const snapshot = async () => (await pool.query(`SELECT a.id,a.ime,a.ime_za_nabavo,a.alergeni,a.alergeni_sledi,
  a.alergeni_status,a.alergeni_vir,a.alergeni_opomba_vira,a.alergeni_document_id,a.alergeni_hash,
  a.alergeni_revision,a.alergeni_verified_by,a.alergeni_verified_at,j.status AS research_status,j.attempts
  FROM artikli a LEFT JOIN pos_allergen_research_jobs j ON j.artikel_id=a.id AND j.enota_id=a.enota_id
  WHERE a.enota_id=$1 AND a.id=ANY($2::int[]) ORDER BY a.id`, [unitId, ids])).rows;
let stop = false;
const startedAt = new Date().toISOString();
try {
  const before = await snapshot();
  if (before.length !== 67 || before.some(a => (!resumeFailed && (a.alergeni.length || a.alergeni_sledi.length))
    || a.alergeni_status !== "nepreverjeno" || a.alergeni_document_id !== input.sourceDocumentId)) {
    throw new Error("Profiles have changed since authorization; no jobs were added.");
  }
  const historyBefore = await fingerprint();
  if (!resumeFailed) await writeFile(reportPath("krizisce-allergen-web-research-before.json"), JSON.stringify({
    unitId, startedAt, articleIds: ids, preparationHistoryHash: historyBefore, articles: before,
  }, null, 2));
  const targetIds = resumeFailed ? before.filter(a => a.research_status === "failed").map(a => a.id) : ids;
  // All jobs are enqueued atomically. The regular durable runner also processes them.
  await pool.query(`INSERT INTO pos_allergen_research_jobs (artikel_id,enota_id)
    SELECT id,enota_id FROM artikli WHERE enota_id=$1 AND id=ANY($2::int[])
      AND jsonb_array_length(alergeni)=0 AND jsonb_array_length(alergeni_sledi)=0 AND alergeni_status='nepreverjeno'
    ON CONFLICT (artikel_id) DO UPDATE SET status='pending',attempts=0,available_at=now(),
      lease_until=NULL,lease_token=NULL,error=NULL
    WHERE pos_allergen_research_jobs.status IN ('done','failed')`, [unitId, targetIds]);
  console.log(`QUEUED ${targetIds.length} explicitly authorized existing articles.`);
  // Two scoped temporary workers plus the regular runner; no unrelated jobs claimed here.
  const workers = Array.from({ length: resumeFailed ? 0 : 2 }, async () => {
    while (!stop) {
      if (!await runNextAllergenResearch({ enotaId: unitId, articleIds: ids })) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  });
  const deadline = Date.now() + 30 * 60_000;
  let lastProgress = "";
  while (Date.now() < deadline) {
    const rows = await snapshot();
    const counts = rows.reduce((acc: Record<string, number>, row) => {
      const status = row.research_status ?? "missing";
      acc[status] = (acc[status] ?? 0) + 1;
      return acc;
    }, {});
    const progress = JSON.stringify(counts);
    if (progress !== lastProgress) { console.log(`PROGRESS ${progress}`); lastProgress = progress; }
    if ((counts.done ?? 0) + (counts.failed ?? 0) === 67) break;
    await new Promise(resolve => setTimeout(resolve, 5000));
  }
  stop = true;
  await Promise.all(workers);
  const after = await snapshot();
  const historyAfter = await fingerprint();
  const verified = after.map(a => {
    const profile = normalizirajAlergenProfil({
      alergeni: a.alergeni, alergeniSledi: a.alergeni_sledi, alergeniStatus: a.alergeni_status,
      alergeniVir: a.alergeni_vir, alergeniOpombaVira: a.alergeni_opomba_vira,
      alergeniDocumentId: a.alergeni_document_id,
    });
    return { id: a.id, hashMatches: a.alergeni_hash === profile.alergeniHash };
  });
  const summary = {
    completed: after.filter(a => a.research_status === "done").length,
    failed: after.filter(a => a.research_status === "failed").length,
    pending: after.filter(a => !["done", "failed"].includes(a.research_status)).length,
    withAllergens: after.filter(a => a.alergeni.length > 0).length,
    withTraces: after.filter(a => a.alergeni_sledi.length > 0).length,
    empty: after.filter(a => !a.alergeni.length && !a.alergeni_sledi.length).length,
    allUnverified: after.every(a => a.alergeni_status === "nepreverjeno" && !a.alergeni_verified_by && !a.alergeni_verified_at),
    documentLinksPreserved: after.every(a => a.alergeni_document_id === input.sourceDocumentId),
    allHashesValid: verified.every(a => a.hashMatches),
    historyUnchanged: historyBefore === historyAfter,
  };
  await writeFile(reportPath("krizisce-allergen-web-research.json"), JSON.stringify({
    unitId, startedAt, finishedAt: new Date().toISOString(), summary, verification: verified, articles: after,
  }, null, 2));
  console.log(`COMPLETE ${JSON.stringify(summary)}`);
  if (summary.pending || !summary.allHashesValid || !summary.allUnverified
    || !summary.documentLinksPreserved || !summary.historyUnchanged) process.exitCode = 1;
} finally {
  stop = true;
  await pool.end();
}