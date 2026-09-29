/**
 * Bookie Old AR reconciliation for development Mikrona only.
 * Dry-run by default; --commit inserts evidence, never payments or postings.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const exportScript = fileURLToPath(new URL("../../../scripts/bookie_old_ar_settlements_export.py", import.meta.url));
const source = JSON.parse(execFileSync("python3", [exportScript], { maxBuffer: 16 * 1024 * 1024 }).toString());
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT ||
    !process.env.REPLIT_DEV_DOMAIN || !process.env.PGHOST ||
    new URL(process.env.DATABASE_URL).hostname !== process.env.PGHOST) {
  throw new Error("Dovoljena je samo razvojna baza");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const amounts = (row) => ({
  original: Number(row.original).toFixed(2),
  closed: Number(row.closed).toFixed(2),
  remaining: Number(row.remaining).toFixed(2),
});

try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-mikrona-ar-settlements'))");
  const { rows: companies } = await client.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (companies.length !== 1 || !/mikrona/i.test(companies[0].naziv)) throw new Error("Napačno podjetje");

  const { rows: invoices } = await client.query(
    `SELECT i.id, i.historical_reference AS reference, i.status,
       COALESCE(SUM(COALESCE(l.vat_base::numeric+l.vat_amount::numeric,
         l.quantity::numeric*l.unit_price::numeric*(1+l.vat_rate::numeric/100))),0)::numeric(18,2)::text AS gross
     FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id=i.id
     WHERE i.company_id=$1 AND i.source_type='bookie-old' AND i.type='issued'
     GROUP BY i.id`,
    [COMPANY_ID],
  );
  const byRef = new Map(invoices.map((invoice) => [invoice.reference, invoice]));
  const { rows: prior } = await client.query(
    "SELECT invoice_id,source_sha256,original_amount::text,closed_amount::text,remaining_amount::text FROM bookie_old_ar_settlements WHERE company_id=$1",
    [COMPANY_ID],
  );
  if (prior.length === 0) {
    const { rows: overlaps } = await client.query(
      `SELECT COUNT(*)::int AS n FROM payment_allocations a
       JOIN payments p ON p.id=a.payment_id
       JOIN invoices i ON i.id=a.invoice_id
       WHERE i.company_id=$1 AND i.source_type='bookie-old' AND i.type='issued'
         AND p.status='posted' AND a.allocated_amount::numeric>0`,
      [COMPANY_ID],
    );
    if (overlaps[0].n !== 0) {
      throw new Error("Obstoječa knjižena plačila zahtevajo ročno uskladitev pred prvim uvozom");
    }
  }
  const records = source.settlements.map((item) => {
    const invoice = byRef.get(item.reference);
    if (!invoice || invoice.gross !== item.original) {
      throw new Error(`Izvorni in ciljni znesek se ne ujemata: ${item.reference}`);
    }
    const year = Number(item.reference.split("/")[2]);
    if (!prior.length && invoice.status !== (year === 2026 ? "draft" : "posted")) {
      throw new Error(`Nepričakovan status računa: ${item.reference}`);
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
  if (records.length !== 1659 || new Set(records.map((record) => record.invoice_id)).size !== records.length) {
    throw new Error("Nepričakovan obseg ali podvojeni računi");
  }
  if (prior.length !== 0 && prior.length !== records.length) {
    throw new Error(`Delni uvoz; ročni pregled pred ponovitvijo (${prior.length})`);
  }
  if (prior.length) {
    const existing = new Map(prior.map((row) => [row.invoice_id, row]));
    for (const record of records) {
      const row = existing.get(record.invoice_id);
      if (!row || row.source_sha256 !== record.source_sha256 ||
          JSON.stringify(amounts({ original: row.original_amount, closed: row.closed_amount, remaining: row.remaining_amount })) !==
          JSON.stringify(amounts({ original: record.original_amount, closed: record.closed_amount, remaining: record.remaining_amount }))) {
        throw new Error(`Spremenjen izvor ali cilj: ${record.source_line_id}`);
      }
    }
  } else if (commit) {
    for (let i = 0; i < records.length; i += 250) {
      await client.query(
        `INSERT INTO bookie_old_ar_settlements
          (company_id,invoice_id,source_line_id,original_amount,closed_amount,remaining_amount,source_as_of,evidence,source_sha256)
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
  const { rows: draftStatus } = await client.query(
    `SELECT COUNT(*)::int AS n FROM invoices
     WHERE company_id=$1 AND source_type='bookie-old' AND status='draft' AND invoice_date >= '2026-01-01'`,
    [COMPANY_ID],
  );
  if (!prior.length && draftStatus[0].n !== 174) throw new Error("Osnutki 2026 so se nepričakovano spremenili");
  if (commit && !prior.length) {
    const { rows: check } = await client.query(
      `SELECT COUNT(*)::int AS n,
        COALESCE(SUM(remaining_amount) FILTER (WHERE remaining_amount>0),0)::numeric(18,2)::text AS open_debit,
        COUNT(*) FILTER (WHERE remaining_amount>0)::int AS open_count
       FROM bookie_old_ar_settlements WHERE company_id=$1`,
      [COMPANY_ID],
    );
    if (check[0].n !== 1659 || check[0].open_debit !== "8711.44" || check[0].open_count !== 64) {
      throw new Error("Uvoz se ne ujema s kontrolnim IOP");
    }
  }
  console.info(JSON.stringify({
    mode: commit ? "commit" : "dry-run",
    evidenceRows: records.length,
    evidenceLinks: records.reduce((total, record) => total + record.evidence.length, 0),
    previousRows: prior.length,
    openInvoices: records.filter((record) => Number(record.remaining_amount) > 0).length,
    openDebit: records.reduce((total, record) => total + Math.round(Number(record.remaining_amount) * 100), 0) / 100,
    unchangedDraftInvoices2026: draftStatus[0].n,
  }));
  await client.query(commit ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}