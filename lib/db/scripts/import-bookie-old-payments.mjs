/** Development-only, dry-run by default. Adds evidence records, never journals or closings. */
import pg from "pg";
import { mkdirSync, writeFileSync } from "node:fs";
import { planHistoricalPayments, HISTORICAL_PAYMENT_ACTOR } from "./bookie-old-payment-plan.mjs";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT || !process.env.REPLIT_DEV_DOMAIN
  || !process.env.PGHOST || new URL(process.env.DATABASE_URL).hostname !== process.env.PGHOST) {
  throw new Error("Dovoljena je samo razvojna baza");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
async function fingerprint() {
  const result = {};
  for (const table of ["journal_entries", "journal_entry_lines", "invoices", "bank_statements",
    "bank_statement_lines", "payment_allocations", "payment_ledger_allocations",
    "bookie_old_ar_settlements", "bookie_old_ap_settlements",
    "bookie_old_bank_ap_closings", "bookie_old_native_ledger_evidence"]) {
    const scope = table === "journal_entry_lines"
      ? "entry_id IN (SELECT id FROM journal_entries WHERE company_id=$1)"
      : table === "bank_statement_lines"
        ? "statement_id IN (SELECT id FROM bank_statements WHERE company_id=$1)"
        : table.startsWith("payment_") ? "payment_id IN (SELECT id FROM payments WHERE company_id=$1)" : "company_id=$1";
    const { rows } = await client.query(`SELECT count(*)::int AS count,
      md5(coalesce(string_agg(to_jsonb(t)::text,'|' ORDER BY to_jsonb(t)::text),'')) AS digest FROM ${table} t WHERE ${scope}`, [COMPANY_ID]);
    result[table] = rows[0];
  }
  return result;
}
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout='120s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`bookie-old-payments:${COMPANY_ID}`]);
  const { rows: companies } = await client.query("SELECT naziv FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID]);
  if (companies.length !== 1 || !/mikrona/i.test(companies[0].naziv)) throw new Error("Napačno podjetje");
  const before = await fingerprint();
  const { rows } = await client.query(`SELECT j.company_id,j.id AS entry_id,j.period_id,j.reference,j.status,j.created_by,
    l.id AS line_id,l.account_id,a.code AS account_code,l.partner_id,l.side,l.amount::text,l.description,
    substring(l.description from 'GLAVNA #([0-9]+)') AS source_line_id,
    s.id AS statement_id,s.bank_account_id AS statement_bank_account_id,s.statement_date::text
    FROM journal_entries j JOIN accounting_periods p ON p.id=j.period_id AND p.company_id=j.company_id
    JOIN journal_entry_lines l ON l.entry_id=j.id
    JOIN accounts a ON a.id=l.account_id AND a.company_id=j.company_id
    LEFT JOIN counterparties c ON c.id=l.partner_id AND c.company_id=j.company_id
    LEFT JOIN bank_statements s ON s.company_id=j.company_id
      AND s.source_filename = 'Bookie Old Promet ' || split_part(j.reference,'/',3) || '/' ||
      split_part(j.reference,'/',5) || ' – rekonstrukcija iz GK'
    WHERE j.company_id=$1 AND j.reference LIKE 'BOOKIE-OLD/K2/%/10/%'
    AND (l.partner_id IS NULL OR c.id IS NOT NULL) ORDER BY j.reference,l.sequence,l.id`, [COMPANY_ID]);
  const { rows: statementLines } = await client.query(`SELECT l.id,l.statement_id,l.booking_date::text,l.amount::text
    FROM bank_statement_lines l JOIN bank_statements s ON s.id=l.statement_id WHERE s.company_id=$1`, [COMPANY_ID]);
  const plan = planHistoricalPayments(rows, statementLines, COMPANY_ID);
  let inserted = 0, existing = 0;
  for (const payment of plan.payments) {
    const { rows: duplicates } = await client.query(`SELECT *,payment_date::text AS payment_date FROM payments
      WHERE id=$1 OR (company_id=$2 AND created_by=$3 AND reference=$4)
      OR (company_id=$2 AND linked_entry_id=$5 AND created_by<>$3)
      OR (bank_statement_line_id IS NOT NULL AND bank_statement_line_id=$6)`,
    [payment.id, COMPANY_ID, HISTORICAL_PAYMENT_ACTOR, payment.reference, payment.linked_entry_id, payment.bank_statement_line_id]);
    if (duplicates.length) {
      if (duplicates.length !== 1 || duplicates[0].id !== payment.id
        || Object.keys(payment).some(key => key === "payment_date"
          ? String(duplicates[0][key]).slice(0, 10) !== payment[key]
          : duplicates[0][key] !== payment[key])) throw new Error(`Konflikt obstoječega plačila: ${payment.reference}`);
      existing++;
      continue;
    }
    if (commit) {
      const keys = Object.keys(payment);
      await client.query(`INSERT INTO payments (${keys.join(",")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(",")})`,
        keys.map(key => payment[key]));
    }
    inserted++;
  }
  const after = await fingerprint();
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error("Spremenjene obstoječe knjižbe, računi ali zapiranja — razveljavitev");
  const byYear = {};
  for (const payment of plan.payments) {
    const year = payment.payment_date.slice(0, 4);
    byYear[year] ??= { inbound: 0, outbound: 0 };
    byYear[year][payment.direction]++;
  }
  const report = { mode: commit ? "commit" : "dry-run", planned: plan.payments.length, inserted,
    existing, byYear, skipped: plan.skipped, financialEvidenceUnchanged: true, before, after };
  await client.query(commit ? "COMMIT" : "ROLLBACK");
  mkdirSync("reports", { recursive: true });
  writeFileSync(`reports/bookie-old-payments-${commit ? "commit" : "dry-run"}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, skipped: report.skipped.length, before: undefined, after: undefined }, null, 2));
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
