/**
 * Repeatable million-row EXPLAIN benchmark; no business rows are touched.
 * pnpm --filter @workspace/api-server exec tsx scripts/verify-report-export-indexes.ts
 *
 * Uses a session-local shadow table, real migration SQL, the retention function's
 * actual DELETE, and the history route's metadata-only projection. Temporary
 * tables cannot use parallel scans, so compare access paths and buffers rather
 * than treating elapsed time as a production SLA.
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { db, pool, reportExportsTable, type PoolClient } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";
import { deleteExpiredReportExportBatch } from "../src/lib/reportExportRetention";

type PlanNode = {
  "Node Type": string;
  "Index Name"?: string;
  "Actual Rows": number;
  "Actual Loops": number;
  Plans?: PlanNode[];
  [key: string]: unknown;
};
type Explanation = { Plan: PlanNode; "Execution Time": number };
const flatten = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(flatten)];
const client = await pool.connect();
const cutoff = new Date("2025-10-18T12:00:00Z");
const companyId = "00000000-0000-0000-0000-000000000007";
const migrations = [
  "267-report-export-retention-index.sql",
  "268-report-export-company-history-index.sql",
];

async function explain(sql: string, params: unknown[] = []): Promise<Explanation> {
  const result = await client.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`, params);
  return result.rows[0]["QUERY PLAN"][0];
}

// Keep the DELETE benchmark tied to the application's actual SQL and batch size.
async function explainCleanup(boundary: Date): Promise<Explanation> {
  let result: Explanation | undefined;
  await client.query("BEGIN");
  try {
    await deleteExpiredReportExportBatch({
      query: async (sql: string, values: unknown[]) => {
        result = await explain(sql, values);
        return { rowCount: 0 };
      },
    } as Pick<PoolClient, "query">, boundary);
    assert.ok(result);
    return result;
  } finally {
    // EXPLAIN ANALYZE executes DELETE, so restore the test rows for later cases.
    await client.query("ROLLBACK");
  }
}

function historyQuery(company: string, boundary: Date) {
  return db.select({
    id: reportExportsTable.id,
    reportType: reportExportsTable.reportType,
    params: reportExportsTable.params,
    filename: reportExportsTable.filename,
    exportedBy: reportExportsTable.exportedBy,
    exportedByName: reportExportsTable.exportedByName,
    exportedAt: reportExportsTable.exportedAt,
    emailSentTo: reportExportsTable.emailSentTo,
  }).from(reportExportsTable).where(and(
    eq(reportExportsTable.companyId, company),
    gte(reportExportsTable.exportedAt, boundary),
  )).orderBy(desc(reportExportsTable.exportedAt)).limit(200).toSQL();
}

async function history(company = companyId, boundary = cutoff) {
  const query = historyQuery(company, boundary);
  return explain(query.sql, query.params);
}

function checkIndexed(plan: Explanation, expected: string | string[]) {
  const nodes = flatten(plan.Plan);
  const indexes = Array.isArray(expected) ? expected : [expected];
  assert.ok(nodes.some(node => indexes.includes(node["Index Name"] ?? "")), `Missing ${expected}`);
  assert.ok(!nodes.some(node => /Seq Scan|Sort/.test(node["Node Type"])),
    "Indexed access must not scan the whole table or sort it");
  // Guards against index scans with a residual filter that still visit all rows.
  assert.ok(nodes.every(node => Number(node["Rows Removed by Filter"] ?? 0) < 1000));
}

function log(label: string, plan: Explanation) {
  console.log(JSON.stringify({ label, ...plan }));
}

try {
  // SET is session-local and restored before releasing the connection.
  await client.query("SET statement_timeout = '180s'");
  await client.query("SET search_path = pg_temp, public");
  await client.query(`CREATE TEMP TABLE report_exports
    (LIKE public.report_exports INCLUDING DEFAULTS)`);
  await client.query("ALTER TABLE report_exports ADD PRIMARY KEY (id)");
  // 1,000,000 rows, 100 tenants, 1,000 days, timestamp ties and 50% expired.
  // A PDF placeholder is intentional: neither query should read PDF contents.
  await client.query(`INSERT INTO report_exports
    (id, company_id, report_type, params, filename, exported_by, exported_at, pdf_data)
    SELECT md5(i::text)::uuid,
      ('00000000-0000-0000-0000-' || lpad((i % 100)::text, 12, '0'))::uuid,
      'trial-balance', '{"dateFrom":"2025-01-01","dateTo":"2025-12-31"}'::jsonb,
      'trial-balance.pdf', 'benchmark-user',
      $1::timestamptz + ((i / 1000) - 500) * interval '1 day',
      decode(repeat('25', 128), 'hex')
    FROM generate_series(1, 1000000) i`, [cutoff]);
  await client.query("ANALYZE report_exports");
  const beforeCleanup = await explainCleanup(cutoff);
  const beforeHistory = await history();
  for (const [label, plan] of [["before-cleanup", beforeCleanup], ["before-history", beforeHistory]] as const) {
    assert.ok(flatten(plan.Plan).some(node => node["Node Type"] === "Seq Scan"));
    log(label, plan);
  }

  // Real migration files, replayed twice to prove idempotency. PostgreSQL builds
  // temp-table indexes non-concurrently; real-table concurrent DDL is checked by
  // the normal migration runners, separately from this isolated workload.
  for (let replay = 0; replay < 2; replay++) {
    for (const file of migrations) {
      const sql = await readFile(fileURLToPath(new URL(
        `../../../lib/db/src/migrations/${file}`, import.meta.url,
      )), "utf8");
      await client.query(sql);
    }
  }
  await client.query("ANALYZE report_exports");
  const afterCleanup = await explainCleanup(cutoff);
  const afterHistory = await history();
  checkIndexed(afterCleanup, "report_exports_retention_idx");
  checkIndexed(afterHistory, "report_exports_company_history_idx");
  assert.equal(afterHistory.Plan["Actual Rows"], 200);
  assert.ok(flatten(afterCleanup.Plan).some(node =>
    node["Node Type"] === "Limit" && node["Actual Rows"] === 100));
  log("after-cleanup", afterCleanup);
  log("after-history", afterHistory);

  // No expired rows, absent tenant, and no recent exports must also be cheap.
  const emptyCleanup = await explainCleanup(new Date("2000-01-01T00:00:00Z"));
  checkIndexed(emptyCleanup, "report_exports_retention_idx");
  const emptyCompany = await history("00000000-0000-0000-0000-000000000999");
  checkIndexed(emptyCompany, "report_exports_company_history_idx");
  assert.equal(emptyCompany.Plan["Actual Rows"], 0);
  const emptyHistory = await history(companyId, new Date("2100-01-01T00:00:00Z"));
  // With no rows anywhere after the cutoff, the global time index is also an
  // optimal path. Assert bounded indexed access, not a particular planner choice.
  checkIndexed(emptyHistory, ["report_exports_company_history_idx", "report_exports_retention_idx"]);
  assert.equal(emptyHistory.Plan["Actual Rows"], 0);
  log("empty-cleanup", emptyCleanup);
  log("empty-company-history", emptyCompany);
  log("empty-recent-history", emptyHistory);
  assert.equal((await client.query("SELECT count(*) FROM pg_temp.report_exports")).rows[0].count, "1000000");
  console.log("PASS: million-row indexed retention and company history; all test deletions rolled back.");
} finally {
  try {
    await client.query("DROP TABLE IF EXISTS pg_temp.report_exports");
    await client.query("RESET search_path");
    await client.query("RESET statement_timeout");
  } finally {
    client.release();
    await pool.end();
  }
}
