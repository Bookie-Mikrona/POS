/**
 * Historical Bookie Old AP settlement evidence for Mikrona development only.
 * Dry-run by default; --commit inserts evidence only, never payments or postings.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const exportScript = fileURLToPath(new URL("../../../scripts/bookie_old_ap_settlements_export.py", import.meta.url));
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT ||
    !process.env.REPLIT_DEV_DOMAIN || !process.env.PGHOST ||
    new URL(process.env.DATABASE_URL).hostname !== process.env.PGHOST) {
  throw new Error("Dovoljena je samo razvojna baza");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const amount = (value) => Number(value).toFixed(2);
const canonical = (value) => JSON.stringify(value, (_key, nested) =>
  nested && !Array.isArray(nested) && typeof nested === "object"
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
    : nested);

try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-mikrona-ap-settlements'))");
  const { rows: companies } = await client.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (companies.length !== 1 || !/mikrona/i.test(companies[0].naziv)) throw new Error("Napačno podjetje");

  const { rows: invoices } = await client.query(
    `SELECT i.id,i.historical_reference AS reference,i.status,i.invoice_date,
       i.counterparty_id,i.historical_gross::numeric(18,2)::text AS gross,
       l.amount::numeric(18,2)::text AS native_credit,
       substring(l.description from 'GLAVNA #([0-9]+)') AS source_line_id,
       COUNT(l.id) OVER (PARTITION BY i.id) AS matched_line_count
     FROM invoices i
     LEFT JOIN journal_entries j ON j.id=i.linked_entry_id AND j.company_id=i.company_id
       AND j.status='posted' AND j.reference=i.historical_reference
     LEFT JOIN journal_entry_lines l ON l.entry_id=j.id AND l.partner_id=i.counterparty_id
       AND l.side='credit' AND l.description ~ 'GLAVNA #[0-9]+'
       AND l.account_id IN (
         SELECT a.id FROM accounts a WHERE a.company_id=i.company_id AND a.code LIKE '22%'
       )
     WHERE i.company_id=$1 AND i.source_type='bookie-old' AND i.type='received'
       AND i.status IN ('posted','paid')
       AND i.historical_reference ~ '^BOOKIE-OLD/K2/(2020|2021|2022|2023|2024|2025)/30/'`,
    [COMPANY_ID],
  );
  const sourceInvoices = new Map(invoices.map((invoice) => [invoice.id, invoice]));
  const positiveInvoices = [...sourceInvoices.values()].filter((invoice) => Number(invoice.gross) > 0);
  const skippedNonPositive = sourceInvoices.size - positiveInvoices.length;
  const map = positiveInvoices.map((invoice) => {
    if (Number(invoice.matched_line_count) !== 1 || !invoice.source_line_id) {
      throw new Error(`Nepričakovana partnerju pripisana kreditna vrstica: ${invoice.reference}`);
    }
    return {
      id: invoice.id,
      reference: invoice.reference,
      status: invoice.status,
      historicalGross: invoice.gross,
      nativeCredit: invoice.native_credit,
      sourceLineId: invoice.source_line_id,
    };
  });
  const source = JSON.parse(execFileSync("python3", [exportScript], {
    input: JSON.stringify(map),
    maxBuffer: 16 * 1024 * 1024,
  }).toString());
  const byRef = new Map(map.map((invoice) => [invoice.reference, invoice]));
  const records = source.settlements.map((item) => {
    const invoice = byRef.get(item.reference);
    if (!invoice || invoice.sourceLineId !== item.sourceLineId ||
        amount(invoice.historicalGross) !== item.original ||
        amount(invoice.nativeCredit) !== item.original) {
      throw new Error(`Izvorno dokazilo se ne ujema z računom: ${item.reference}`);
    }
    return {
      company_id: COMPANY_ID,
      invoice_id: invoice.id,
      source_line_id: item.sourceLineId,
      original_amount: item.original,
      closed_amount: item.closed,
      remaining_amount: item.remaining,
      source_as_of: item.asOf,
      evidence: item.evidence,
      source_sha256: createHash("sha256").update(JSON.stringify(item)).digest("hex"),
    };
  });
  if (records.length !== map.length ||
      new Set(records.map((record) => record.invoice_id)).size !== records.length ||
      new Set(records.map((record) => record.source_line_id)).size !== records.length) {
    throw new Error("Nepričakovan obseg ali podvojeni AP računi");
  }
  const { rows: tableCheck } = await client.query("SELECT to_regclass('public.bookie_old_ap_settlements') IS NOT NULL AS present");
  const destinationTablePresent = tableCheck[0].present;
  if (!destinationTablePresent && commit) throw new Error("Ciljna tabela manjka; pred uvozom uporabite migracijo 246");
  const priorResult = destinationTablePresent
    ? await client.query(
      `SELECT invoice_id,source_line_id,source_sha256,original_amount::numeric(18,2)::text,
          closed_amount::numeric(18,2)::text,remaining_amount::numeric(18,2)::text,
          source_as_of::text,evidence
       FROM bookie_old_ap_settlements WHERE company_id=$1`,
      [COMPANY_ID],
    )
    : { rows: [] };
  const prior = priorResult.rows;
  if (prior.length && prior.length !== records.length) throw new Error("Delni uvoz; ročni pregled pred ponovitvijo");
  if (prior.length) {
    const priorByInvoice = new Map(prior.map((row) => [row.invoice_id, row]));
    for (const record of records) {
      const row = priorByInvoice.get(record.invoice_id);
      if (!row || row.source_line_id !== record.source_line_id ||
          row.source_sha256 !== record.source_sha256 ||
          amount(row.original_amount) !== record.original_amount ||
          amount(row.closed_amount) !== record.closed_amount ||
          amount(row.remaining_amount) !== record.remaining_amount ||
          row.source_as_of !== record.source_as_of ||
          canonical(row.evidence) !== canonical(record.evidence)) {
        throw new Error(`Prej uvoženo dokazilo se je spremenilo: ${record.source_line_id}`);
      }
    }
  } else if (commit) {
    for (let i = 0; i < records.length; i += 250) {
      await client.query(
        `INSERT INTO bookie_old_ap_settlements
          (company_id,invoice_id,source_line_id,original_amount,closed_amount,remaining_amount,
           source_as_of,evidence,source_sha256)
         SELECT r.company_id,r.invoice_id,r.source_line_id,r.original_amount,r.closed_amount,
           r.remaining_amount,r.source_as_of,r.evidence,r.source_sha256
         FROM jsonb_to_recordset($1::jsonb) AS r(
           company_id uuid,invoice_id uuid,source_line_id text,original_amount numeric,
           closed_amount numeric,remaining_amount numeric,source_as_of date,evidence jsonb,source_sha256 text
         )`,
        [JSON.stringify(records.slice(i, i + 250))],
      );
    }
  }
  process.stdout.write(JSON.stringify({
    mode: commit ? "commit" : "dry-run",
    sourceInvoices: sourceInvoices.size,
    invoicesChecked: map.length,
    skippedNonPositive,
    evidenceInvoices: records.length,
    evidenceLinks: records.reduce((sum, row) => sum + row.evidence.length, 0),
    previousRows: prior.length,
    destinationTablePresent,
    openInvoices: records.filter((row) => Number(row.remaining_amount) > 0).length,
    totalRemaining: records.reduce((sum, row) => sum + Math.round(Number(row.remaining_amount) * 100), 0) / 100,
  }) + "\n");
  await client.query(commit ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}