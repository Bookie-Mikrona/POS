/**
 * Enkratni, ponovljiv uvoz izvornih GK knjižb kot OSNUTKOV (ne računov/izpiskov).
 * Privzeto samo preveri podatke. Zapiše jih le z --commit.
 *
 * Vse spremembe so v eni transakciji; ob napaki se ne shrani niti partnerjev
 * niti obdobij. Izvorna identiteta je v reference oziroma opisu vrstice.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const importScript = fileURLToPath(new URL("../../../scripts/bookie_old_k2_journal_export.py", import.meta.url));
const source = JSON.parse(execFileSync("python3", [importScript], { maxBuffer: 20 * 1024 * 1024 }).toString("utf8"));
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error("Baza ni nastavljena");
if (process.env.REPLIT_DEPLOYMENT) throw new Error("Uvoz v objavljeno okolje ni dovoljen");
if (source.companyOld !== "000001" || source.vouchers.length !== 3645 || source.sourceRows !== 12514) {
  throw new Error("Izvorni obseg ali podjetje se ne ujema");
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const commit = process.argv.includes("--commit");
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-k2-mikrona-journal-import'))");
  const company = await client.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (company.rowCount !== 1 || !/mikrona/i.test(company.rows[0].naziv)) {
    throw new Error("Ciljno podjetje ni Mikrona");
  }
  const current = await client.query(
    `SELECT
      (SELECT count(*)::int FROM journal_entries WHERE company_id=$1) AS entries,
      (SELECT count(*)::int FROM counterparties WHERE company_id=$1) AS partners,
      (SELECT count(*)::int FROM accounting_periods WHERE company_id=$1) AS periods,
      (SELECT count(*)::int FROM invoices WHERE company_id=$1) AS invoices,
      (SELECT count(*)::int FROM bank_statements WHERE company_id=$1) AS bank_statements`,
    [COMPANY_ID],
  );
  const counts = current.rows[0];
  if (Object.values(counts).some(value => value !== 0)) {
    throw new Error(`Podjetje ni prazno v ciljnih evidencah: ${JSON.stringify(counts)}. Prekinjeno brez zapisa.`);
  }

  const accounts = await client.query(
    "SELECT id,code,is_active,allows_posting,requires_partner,requires_cost_center,cost_center_policy,requires_project FROM accounts WHERE company_id=$1",
    [COMPANY_ID],
  );
  const accountByCode = new Map(accounts.rows.map(account => [account.code, account]));
  const requiredCodes = new Set(source.vouchers.flatMap(voucher => voucher.lines.map(line => line.accountCode)));
  for (const code of requiredCodes) {
    const account = accountByCode.get(code);
    if (!account || !account.is_active || !account.allows_posting) {
      throw new Error(`Manjkajoč, neaktiven ali skupinski ciljni konto: ${code}`);
    }
  }
  const warnings = { missingRequiredPartner: 0, missingRequiredCostCenter: 0, missingRequiredProject: 0 };
  for (const voucher of source.vouchers) {
    if (voucher.year < "2020" || voucher.year > "2026" || !voucher.lines.length) {
      throw new Error(`Nepravilna temeljnica ${voucher.reference}`);
    }
    for (const line of voucher.lines) {
      const account = accountByCode.get(line.accountCode);
      if (account.requires_partner && !line.partnerCode) warnings.missingRequiredPartner++;
      if (account.requires_cost_center || account.cost_center_policy === "required") warnings.missingRequiredCostCenter++;
      if (account.requires_project) warnings.missingRequiredProject++;
    }
  }
  console.log(JSON.stringify({
    mode: commit ? "commit" : "dry-run",
    company: company.rows[0].naziv,
    years: "2020–2026",
    sourceRows: source.sourceRows,
    vouchers: source.vouchers.length,
    journalLines: source.vouchers.reduce((sum, voucher) => sum + voucher.lines.length, 0),
    partners: source.partners.length,
    unbalanced2026: source.imbalances.length,
    difference2026: source.imbalances.map(row => Number(row.difference)).reduce((a, b) => a + b, 0).toFixed(2),
    unresolvedSourcePartners: source.unresolvedPartners,
    draftDimensionWarnings: warnings,
  }));

  if (!commit) {
    await client.query("ROLLBACK");
  } else {
    const periods = new Map();
    for (let year = 2020; year <= 2026; year++) {
      const periodId = randomUUID();
      await client.query(
        `INSERT INTO accounting_periods(id,company_id,name,start_date,end_date,status)
         VALUES($1,$2,$3,$4,$5,'open')`,
        [periodId, COMPANY_ID, `Bookie Old ${year} – uvoz osnutkov`, `${year}-01-01`, `${year}-12-31`],
      );
      periods.set(String(year), periodId);
    }

    const partnerIds = new Map();
    const partners = source.partners.map(partner => {
      const id = randomUUID();
      for (const code of partner.sourceCodes) partnerIds.set(code, id);
      return { ...partner, id };
    });
    await client.query(
      `INSERT INTO counterparties(id,company_id,type,name,tax_id,address,post_code,city,notes)
       SELECT p.id,$2,'both',p.name,p.tax_id,p.address,p.post_code,p.city,
              'Bookie Old K2 – šifre ' || p.source_codes
       FROM jsonb_to_recordset($1::jsonb) AS p(
         id uuid,source_codes text,name text,tax_id text,address text,post_code text,city text
       )`,
      [JSON.stringify(partners.map(p => ({
        id: p.id, source_codes: p.sourceCodes.join(", "), name: p.name, tax_id: p.taxId,
        address: p.address, post_code: p.postCode, city: p.city,
      }))), COMPANY_ID],
    );

    const entries = [];
    const lines = [];
    for (const voucher of source.vouchers) {
      const id = randomUUID();
      entries.push({
        id, period_id: periods.get(voucher.year), document_date: voucher.documentDate,
        entry_date: voucher.entryDate, tax_date: voucher.taxDate,
        receipt_date: voucher.type === "30" ? voucher.receiptDate : null,
        description: voucher.description, reference: voucher.reference,
      });
      voucher.lines.forEach((line, sequence) => {
        lines.push({
          entry_id: id, account_id: accountByCode.get(line.accountCode).id,
          side: line.side, amount: line.amount, sequence,
          partner_id: line.partnerCode ? partnerIds.get(line.partnerCode) : null,
          description: `${line.description} [Bookie Old GLAVNA #${line.sourceId}, konto ${line.sourceAccountCode}${line.partnerCode ? `, partner ${line.partnerCode}${line.sourcePartnerName ? ` ${line.sourcePartnerName}` : ""}` : ""}${line.unresolvedPartnerCode ? `, nerazrešen partner ${line.unresolvedPartnerCode}` : ""}]`,
        });
      });
    }
    for (let i = 0; i < entries.length; i += 500) {
      await client.query(
        `INSERT INTO journal_entries(
          id,company_id,period_id,document_date,entry_date,tax_date,receipt_date,
          description,reference,status,source_type,created_by
         )
         SELECT e.id,$2,e.period_id,e.document_date,e.entry_date,e.tax_date,e.receipt_date,
                e.description,e.reference,'draft','manual','bookie-old-k2-import'
         FROM jsonb_to_recordset($1::jsonb) AS e(
           id uuid,period_id uuid,document_date date,entry_date date,tax_date date,
           receipt_date date,description text,reference text
         )`,
        [JSON.stringify(entries.slice(i, i + 500)), COMPANY_ID],
      );
    }
    for (let i = 0; i < lines.length; i += 500) {
      await client.query(
        `INSERT INTO journal_entry_lines(entry_id,account_id,side,amount,sequence,partner_id,description)
         SELECT l.entry_id,l.account_id,l.side::journal_entry_side,l.amount,l.sequence,l.partner_id,l.description
         FROM jsonb_to_recordset($1::jsonb) AS l(
           entry_id uuid,account_id uuid,side text,amount numeric,sequence integer,
           partner_id uuid,description text
         )`,
        [JSON.stringify(lines.slice(i, i + 500))],
      );
    }
    const reconciled = await client.query(
      `SELECT e.reference, e.status, COUNT(l.id)::int AS lines,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='debit'),0)::text AS debit,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='credit'),0)::text AS credit
       FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
       WHERE e.company_id=$1
       GROUP BY e.reference,e.status`,
      [COMPANY_ID],
    );
    const byReference = new Map(reconciled.rows.map(row => [row.reference, row]));
    if (byReference.size !== source.vouchers.length) throw new Error("Napačno število temeljnic po zapisu");
    for (const voucher of source.vouchers) {
      const row = byReference.get(voucher.reference);
      if (!row || row.status !== "draft" || row.lines !== voucher.lines.length
        || Number(row.debit).toFixed(2) !== Number(voucher.sourceDebit).toFixed(2)
        || Number(row.credit).toFixed(2) !== Number(voucher.sourceCredit).toFixed(2)) {
        throw new Error(`Neujemanje po zapisu: ${voucher.reference}`);
      }
    }
    await client.query("COMMIT");
    console.log(`POTRJENO: ${entries.length} osnutkov, ${lines.length} vrstic, ${partners.length} partnerjev; 0 knjiženih.`);
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  client.release();
  await pool.end();
}