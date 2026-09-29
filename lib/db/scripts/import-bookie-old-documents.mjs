/**
 * Uvoz zgodovinskih finančnih listin in bančnega prometa; brez novih GK knjižb.
 * Privzeto samo preveri, --commit je ena transakcija. Samo razvojna Mikrona.
 */
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const script = fileURLToPath(new URL("../../../scripts/bookie_old_documents_export.py", import.meta.url));
const source = JSON.parse(execFileSync("python3", [script], { maxBuffer: 12 * 1024 * 1024 }).toString());
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) throw new Error("Dovoljena je samo razvojna baza");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const db = await pool.connect();

async function insertBatches(table, columns, recordTypes, rows) {
  for (let i = 0; i < rows.length; i += 400) {
    await db.query(
      `INSERT INTO ${table}(${columns.join(",")})
       SELECT ${columns.map(c => `r.${c}`).join(",")}
       FROM jsonb_to_recordset($1::jsonb) AS r(${recordTypes})`,
      [JSON.stringify(rows.slice(i, i + 400))],
    );
  }
}

try {
  await db.query("BEGIN");
  await db.query("SET LOCAL statement_timeout = '180s'");
  await db.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-k2-mikrona-documents-import'))");
  const company = await db.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (company.rowCount !== 1 || !/mikrona/i.test(company.rows[0].naziv)) throw new Error("Napačno podjetje");
  const existing = await db.query(
    `SELECT (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1) AS invoices,
            (SELECT COUNT(*)::int FROM bank_statements WHERE company_id=$1) AS statements`,
    [COMPANY_ID],
  );
  if (existing.rows[0].invoices || existing.rows[0].statements) {
    throw new Error(`Ciljne evidence niso prazne; uvoz se ne ponovi: ${JSON.stringify(existing.rows[0])}`);
  }
  const entries = await db.query("SELECT id,reference,period_id,status FROM journal_entries WHERE company_id=$1", [COMPANY_ID]);
  const partners = await db.query("SELECT id,notes FROM counterparties WHERE company_id=$1", [COMPANY_ID]);
  const accounts = await db.query("SELECT id,code FROM accounts WHERE company_id=$1", [COMPANY_ID]);
  const periods = await db.query("SELECT id,start_date::text FROM accounting_periods WHERE company_id=$1", [COMPANY_ID]);
  const entryByRef = new Map(entries.rows.map(e => [e.reference, e]));
  if (entryByRef.size !== 3645 || entries.rows.some(e => e.status !== "draft")) {
    throw new Error("Manjkajo obstoječi GK osnutki oziroma so bili medtem knjiženi");
  }
  const partnerByOldCode = new Map();
  for (const p of partners.rows) {
    const match = p.notes?.match(/^Bookie Old K2 – šifre ([\d, ]+)$/);
    if (match) for (const code of match[1].split(", ")) partnerByOldCode.set(code, p.id);
  }
  const accountByOldCode = new Map();
  const mappingFile = fileURLToPath(new URL("../../../reports/bookie-old-K2-finalna-preslikava-2020plus.csv", import.meta.url));
  const mapping = execFileSync("python3", ["-c",
    "import csv,json,sys;print(json.dumps({r['stari_konto']:r['ciljni_konto'] for r in csv.DictReader(open(sys.argv[1],encoding='utf-8-sig'),delimiter=';')}))",
    mappingFile,
  ]).toString();
  const codeMap = JSON.parse(mapping);
  const accountIds = new Map(accounts.rows.map(a => [a.code, a.id]));
  for (const [old, target] of Object.entries(codeMap)) accountByOldCode.set(old, accountIds.get(target));
  const periodByYear = new Map(periods.rows.map(p => [p.start_date.slice(0, 4), p.id]));
  const bankAccountId = accountByOldCode.get("1100000");
  if (!bankAccountId) throw new Error("Manjka bančni konto");

  const invoices = [];
  const invoiceLines = [];
  const bankStatements = [];
  const bankLines = [];
  const anomalies = [];
  for (const doc of source.invoices) {
    const linked = entryByRef.get(doc.reference);
    if (doc.hasLedger !== Boolean(linked) || !partnerByOldCode.get(doc.partner) || !periodByYear.get(doc.year)) {
      throw new Error(`Izvornega računa ni mogoče povezati: ${doc.reference}`);
    }
    const accountId = accountByOldCode.get(doc.arCode);
    if (!accountId) throw new Error(`Manjka konto terjatve/obveznosti ${doc.reference}`);
    const id = randomUUID();
    const notes = [
      `Bookie Old K2: ${doc.reference}. Izvorna številka ${doc.invoiceNumber}, partner ${doc.partner}.`,
      "Zgodovinski uvoz brez nove knjižbe GK. Knjižba v razvojnem ERP ostane osnutek.",
      ...doc.warnings,
      ...(!linked ? ["Manjkajoča GK temeljnica; konto terjatve na glavi je tehnična izbira, ne knjižba."] : []),
    ].join(" ");
    invoices.push({
      id, company_id: COMPANY_ID, type: doc.kind === "30" ? "received" : "issued",
      source_type: "bookie-old", counterparty_id: partnerByOldCode.get(doc.partner),
      period_id: periodByYear.get(doc.year), invoice_number: doc.invoiceNumber,
      invoice_date: doc.date, due_date: doc.dueDate, status: "draft",
      ar_ap_account_id: accountId, linked_entry_id: linked?.id ?? null,
      historical_reference: doc.reference, historical_net: doc.net,
      historical_vat: doc.vat, historical_gross: doc.gross,
      created_by: "bookie-old-k2-import", notes,
    });
    if (doc.warnings.length) anomalies.push({ ref: doc.reference, warnings: doc.warnings });
    // Prejeti računi v starem programu nimajo postavk; ne ustvarjamo artiklov
    // ali umetnih količin. Izdane postavke so izključno iz Promet1.
    if (doc.kind === "30") continue;
    for (const [sequence, line] of doc.lines.entries()) {
      // F_Konto je zapolnjen samo pri delu izvornih postavk; sicer vzamemo
      // dejanski prihodkovni konto te temeljnice. Le pri 10 računih brez GK
      // ostane tehnični konto, ki ga izrecno označimo v opombi.
      const lineAccount = accountByOldCode.get(line.sourceAccount)
        || accountByOldCode.get(doc.revenueCode)
        || (!linked ? accountByOldCode.get("7602000") : null);
      if (!lineAccount) throw new Error(`Manjka tehnični konto postavke ${doc.reference}`);
      invoiceLines.push({
        invoice_id: id,
        description: `${line.description || "Brez naziva"} [Bookie Old Promet1 #${line.sourceId}, artikel ${line.article || "—"}]`,
        quantity: line.quantity, unit_price: line.listPrice, vat_rate: line.vatRate,
        vat_base: line.net, vat_amount: line.vat, account_id: lineAccount, sequence,
      });
    }
  }
  for (const statement of source.statements) {
    const linked = entryByRef.get(statement.reference);
    if (statement.hasLedger !== Boolean(linked)) throw new Error(`Manjka bančna temeljnica ${statement.reference}`);
    const id = randomUUID();
    const hash = createHash("sha256").update(`bookie-old-k2:${statement.reference}`).digest("hex");
    bankStatements.push({
      id, company_id: COMPANY_ID, bank_account_id: bankAccountId,
      statement_number: null, statement_date: statement.date,
      opening_balance: null, closing_balance: null, currency: "EUR",
      source_filename: `Bookie Old Promet ${statement.year}/${statement.number} – ${linked ? "rekonstrukcija iz GK" : "brez GK"}${!statement.lines.length ? " – brez bančne vrstice, pregled" : ""}`,
      source_sha256: hash, created_by: "bookie-old-k2-import",
    });
    for (const [index, line] of statement.lines.entries()) {
      bankLines.push({
        statement_id: id, transaction_key: `BOOKIE-OLD/GLAVNA/${line.sourceId}`,
        line_number: index + 1, booking_date: line.date, amount: line.amount,
        currency: "EUR", description: `${line.description} [${statement.reference}; GLAVNA #${line.sourceId}]`,
        counterparty_name: line.counterpartyName || null,
      });
    }
  }
  if (invoices.length !== 2429 || invoiceLines.length !== 1742 || bankStatements.length !== 1104 || bankLines.length !== 1102) {
    throw new Error("Nepričakovano število listin/postavk/bančnih vrstic");
  }
  console.log(JSON.stringify({
    mode: commit ? "commit" : "dry-run", company: company.rows[0].naziv,
    received: 757, issued: 1672, issuedLines: invoiceLines.length,
    bankRecords: bankStatements.length, bankMovements: bankLines.length,
    linkedInvoices: invoices.filter(i => i.linked_entry_id).length,
    withoutLedger: anomalies.filter(a => a.warnings.some(w => w.startsWith("Brez temeljnice"))).length,
    exceptions: anomalies.filter(a => !a.warnings.every(w => w.startsWith("Samoobdavčitev"))),
  }));
  if (!commit) {
    await db.query("ROLLBACK");
  } else {
    await insertBatches("invoices",
      ["id","company_id","type","source_type","counterparty_id","period_id","invoice_number","invoice_date","due_date","status","ar_ap_account_id","linked_entry_id","historical_reference","historical_net","historical_vat","historical_gross","created_by","notes"],
      "id uuid,company_id uuid,type invoice_type,source_type text,counterparty_id uuid,period_id uuid,invoice_number text,invoice_date date,due_date date,status invoice_status,ar_ap_account_id uuid,linked_entry_id uuid,historical_reference text,historical_net numeric,historical_vat numeric,historical_gross numeric,created_by text,notes text", invoices);
    await insertBatches("invoice_lines",
      ["invoice_id","description","quantity","unit_price","vat_rate","vat_base","vat_amount","account_id","sequence"],
      "invoice_id uuid,description text,quantity numeric,unit_price numeric,vat_rate numeric,vat_base numeric,vat_amount numeric,account_id uuid,sequence integer", invoiceLines);
    await insertBatches("bank_statements",
      ["id","company_id","bank_account_id","statement_number","statement_date","opening_balance","closing_balance","currency","source_filename","source_sha256","created_by"],
      "id uuid,company_id uuid,bank_account_id uuid,statement_number text,statement_date date,opening_balance numeric,closing_balance numeric,currency text,source_filename text,source_sha256 text,created_by text", bankStatements);
    await insertBatches("bank_statement_lines",
      ["statement_id","transaction_key","line_number","booking_date","amount","currency","description","counterparty_name"],
      "statement_id uuid,transaction_key text,line_number integer,booking_date date,amount numeric,currency text,description text,counterparty_name text", bankLines);
    const checks = await db.query(
      `SELECT (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1) AS invoices,
              (SELECT COUNT(*)::int FROM invoice_lines l JOIN invoices i ON i.id=l.invoice_id WHERE i.company_id=$1) AS lines,
              (SELECT COUNT(*)::int FROM bank_statements WHERE company_id=$1) AS statements,
              (SELECT COUNT(*)::int FROM bank_statement_lines l JOIN bank_statements s ON s.id=l.statement_id WHERE s.company_id=$1) AS bank_lines,
              (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND status<>'draft') AS posted`,
      [COMPANY_ID],
    );
    const c = checks.rows[0];
    if (c.invoices !== 2429 || c.lines !== 1742 || c.statements !== 1104 || c.bank_lines !== 1102 || c.posted !== 0) {
      throw new Error(`Preverjanje po uvozu ni uspelo: ${JSON.stringify(c)}`);
    }
    await db.query("COMMIT");
    console.log(`POTRJENO: ${JSON.stringify(c)}`);
  }
} catch (error) {
  await db.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  db.release();
  await pool.end();
}