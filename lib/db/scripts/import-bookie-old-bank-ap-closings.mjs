/**
 * Read-only financial evidence for Bookie Old 2026 bank vouchers, Mikrona dev only.
 * Dry-run by default. --commit writes 53 historical links, no payments or GK postings.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const exportScript = fileURLToPath(new URL("../../../scripts/bookie_old_bank_ap_closings_export.py", import.meta.url));
const source = JSON.parse(execFileSync("python3", [exportScript], { maxBuffer: 1024 * 1024 }).toString());
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT ||
    !process.env.REPLIT_DEV_DOMAIN || !process.env.PGHOST ||
    new URL(process.env.DATABASE_URL).hostname !== process.env.PGHOST) {
  throw new Error("Dovoljena je samo razvojna baza");
}
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-mikrona-2026-ap-evidence'))");
  const { rows: companies } = await client.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (companies.length !== 1 || !/mikrona/i.test(companies[0].naziv)) throw new Error("Napačno podjetje");

  const { rows: statements } = await client.query(
    `SELECT s.id,s.source_filename,j.id AS entry_id,j.reference
     FROM bank_statements s LEFT JOIN journal_entries j
       ON j.company_id=s.company_id
       AND j.reference='BOOKIE-OLD/K2/2026/10/' || substring(s.source_filename from '^Bookie Old Promet 2026/([0-9]{6})')
     WHERE s.company_id=$1 AND s.statement_date >= '2026-01-01' AND s.statement_date < '2027-01-01'`,
    [COMPANY_ID],
  );
  const statementByRef = new Map(statements.map((s) => [s.reference, s]));
  if (statements.length !== 114 || statementByRef.size !== 114 ||
      source.statementReferences.some((ref) => !statementByRef.get(ref)?.entry_id)) {
    throw new Error("Izpiski 2026 in izvorne temeljnice niso povsem usklajeni");
  }
  const { rows: invoices } = await client.query(
    `SELECT id,historical_reference,historical_gross::numeric(18,2)::text AS gross
     FROM invoices WHERE company_id=$1 AND source_type='bookie-old' AND type='received'`,
    [COMPANY_ID],
  );
  const invoiceByRef = new Map(invoices.map((i) => [i.historical_reference, i]));
  const { rows: journalLines } = await client.query(
    `SELECT j.reference,l.description,l.side,l.amount::numeric(18,2)::text AS amount,a.code
     FROM journal_entry_lines l
     JOIN journal_entries j ON j.id=l.entry_id AND j.company_id=$1
     JOIN accounts a ON a.id=l.account_id AND a.company_id=$1
     WHERE j.reference LIKE 'BOOKIE-OLD/K2/2026/10/%'`,
    [COMPANY_ID],
  );
  const ledgerBySourceId = new Map(journalLines.flatMap((line) => {
    const sourceId = line.description?.match(/GLAVNA #(\d+)/)?.[1];
    return sourceId ? [[sourceId, line]] : [];
  }));
  const records = source.closings.map((item) => {
    const statement = statementByRef.get(item.statementReference);
    const invoice = invoiceByRef.get(item.invoiceReference);
    const ledgerLine = ledgerBySourceId.get(item.sourceBankLineId);
    if (!statement || !invoice || invoice.gross !== item.invoiceOriginal ||
        !ledgerLine || ledgerLine.reference !== item.statementReference ||
        ledgerLine.side !== "debit" || !ledgerLine.code.startsWith("220") ||
        ledgerLine.amount !== item.amount) {
      throw new Error(`Izvorno dokazilo se ne ujema z ERP: ${item.closingId}`);
    }
    return {
      company_id: COMPANY_ID,
      closing_id: item.closingId,
      statement_id: statement.id,
      invoice_id: invoice.id,
      source_bank_line_id: item.sourceBankLineId,
      source_invoice_line_id: item.sourceInvoiceLineId,
      amount: item.amount,
      recorded_date: item.recordedDate,
      source_sha256: createHash("sha256").update(JSON.stringify(item)).digest("hex"),
    };
  });
  if (records.length !== 53 || new Set(records.map((r) => r.closing_id)).size !== 53) {
    throw new Error("Nepričakovano število ali podvojitev zapiranj dobaviteljev");
  }
  const { rows: prior } = await client.query(
    `SELECT closing_id,statement_id,invoice_id,source_bank_line_id,source_invoice_line_id,
       amount::numeric(18,2)::text AS amount,recorded_date::text AS recorded_date,source_sha256
     FROM bookie_old_bank_ap_closings WHERE company_id=$1`,
    [COMPANY_ID],
  );
  if (prior.length && prior.length !== records.length) throw new Error("Delni uvoz; potreben je ročni pregled");
  if (prior.length) {
    const byId = new Map(prior.map((row) => [row.closing_id, row]));
    for (const record of records) {
      const previous = byId.get(record.closing_id);
      if (!previous || ["statement_id", "invoice_id", "source_bank_line_id",
        "source_invoice_line_id", "amount", "recorded_date", "source_sha256"]
        .some((key) => previous[key] !== record[key])) {
        throw new Error(`Prej uvoženo dokazilo se je spremenilo: ${record.closing_id}`);
      }
    }
  } else if (commit) {
    await client.query(
      `INSERT INTO bookie_old_bank_ap_closings
        (company_id,closing_id,statement_id,invoice_id,source_bank_line_id,
         source_invoice_line_id,amount,recorded_date,source_sha256)
       SELECT r.company_id,r.closing_id,r.statement_id,r.invoice_id,r.source_bank_line_id,
         r.source_invoice_line_id,r.amount,r.recorded_date,r.source_sha256
       FROM jsonb_to_recordset($1::jsonb) AS r(
         company_id uuid,closing_id text,statement_id uuid,invoice_id uuid,
         source_bank_line_id text,source_invoice_line_id text,amount numeric,
         recorded_date date,source_sha256 text)`,
      [JSON.stringify(records)],
    );
  }
  process.stdout.write(JSON.stringify({
    mode: commit ? "commit" : "dry-run",
    statementsChecked: statements.length,
    supplierClosings: records.length,
    statementsWithSupplierClosings: new Set(records.map((r) => r.statement_id)).size,
    previousClosings: prior.length,
  }) + "\n");
  await client.query(commit ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}