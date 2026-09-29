/**
 * Potrdi samo 10 zgodovinskih izdanih ničelnih računov Mikrone brez GK temeljnice.
 * Vir Promet1: 100 % popust na vsaki postavki, osnova in DDV = 0.
 * Privzeto le preverjanje; --simulate preveri cel zapis in ga razveljavi.
 * --commit potrdi status računa in revizijo, ne ustvari GK, DDV ali plačil.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const ACTOR = "bookie-old-k2-zero-invoice-confirmation";
const refs = [
  "2020/000037", "2020/000038", "2020/000039", "2020/000041",
  "2020/000157", "2020/000158", "2020/000160", "2020/000209",
  "2023/000168", "2023/000171",
];
const expected = new Set(refs.map((r) => `BOOKIE-OLD/K2/${r.slice(0, 4)}/60/${r.slice(5)}`));
const simulate = process.argv.includes("--simulate");
const commit = process.argv.includes("--commit");
if ((simulate && commit) || process.argv.some((arg) => arg.startsWith("--") && !["--simulate", "--commit"].includes(arg))) {
  throw new Error("Izberi največ eno od --simulate ali --commit");
}
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) throw new Error("Samo razvojna baza");
function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

// Ne sklepaj o 100-odstotnem popustu iz redne cene v ERP:
// preveri polja Popust, Vre_pro in Vre_DDV neposredno v izvornih postavkah.
const sourcePath = fileURLToPath(new URL("../../../attached_assets/Promet1_1790688558815.txt", import.meta.url));
const checkSource = `
import csv,json,sys
expected=set(sys.argv[2].split(","))
found={}
with open(sys.argv[1],encoding="cp852",newline="") as f:
  for r in csv.DictReader(f,delimiter=";"):
    if r["Zavezanec"]=="000001" and r["Vrsta"]=="60" and r["Leto"] and r["Stevilka"]:
      key=r["Leto"]+"/"+r["Stevilka"]
      if key in expected:
        found.setdefault(key,[]).append(r)
assert set(found)==expected and sum(map(len,found.values()))==11
assert all(float(r["Popust"])==100 and float(r["Vre_pro"])==0 and float(r["Vre_DDV"])==0 for rows in found.values() for r in rows)
print(json.dumps({key:len(rows) for key,rows in found.items()}))
`;
const sourceLines = JSON.parse(execFileSync("python3", ["-c", checkSource, sourcePath, refs.join(",")]).toString());

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-k2-mikrona-zero-invoices'))");
  const { rows: company } = await client.query(
    "SELECT naziv FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID],
  );
  ensure(company.length === 1 && /mikrona/i.test(company[0].naziv), "Napačno podjetje");
  const { rows: invoices } = await client.query(
    `SELECT i.id,i.historical_reference,i.invoice_number,i.notes,i.status,
            i.historical_net::text AS net,i.historical_vat::text AS vat,
            i.historical_gross::text AS gross,i.linked_entry_id,
            i.type,i.invoice_date::text AS invoice_date,p.status AS period_status
     FROM invoices i JOIN accounting_periods p ON p.id=i.period_id
     WHERE i.company_id=$1 AND i.source_type='bookie-old'
       AND i.linked_entry_id IS NULL FOR UPDATE OF i,p`, [COMPANY_ID],
  );
  ensure(invoices.length === 10 && invoices.every((i) => expected.has(i.historical_reference)),
    "Nabor računov brez GK se je spremenil");
  for (const i of invoices) {
    ensure(i.type === "issued" && i.status === "draft" && i.period_status === "locked"
      && i.net === "0.00" && i.vat === "0.00" && i.gross === "0.00"
      && i.historical_reference.includes(`/${i.invoice_date.slice(0, 4)}/60/`)
      && i.notes.includes(" Zgodovinski uvoz brez nove knjižbe GK.")
      && i.notes.includes("Brez temeljnice GK: izvorni račun je neknjižen"),
    `Račun ni preverjen ničelni osnutek: ${i.historical_reference}`);
  }
  const { rows: lineCheck } = await client.query(
    `SELECT i.id,COUNT(l.invoice_id)::int AS n,
            COALESCE(SUM(ABS(l.vat_base)),0)::text AS base,
            COALESCE(SUM(ABS(l.vat_amount)),0)::text AS vat
     FROM invoices i LEFT JOIN invoice_lines l ON l.invoice_id=i.id
     WHERE i.company_id=$1 AND i.source_type='bookie-old'
       AND i.linked_entry_id IS NULL GROUP BY i.id`, [COMPANY_ID],
  );
  ensure(lineCheck.length === 10 && lineCheck.reduce((n, x) => n + x.n, 0) === 11
    && lineCheck.every((x) => x.n > 0 && Number(x.base) === 0 && Number(x.vat) === 0),
  "Postavke v ERP niso ničelne");
  const { rows: vatRows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM vat_ledger v JOIN invoices i ON i.id=v.invoice_id
     WHERE i.company_id=$1 AND i.source_type='bookie-old' AND i.linked_entry_id IS NULL`,
    [COMPANY_ID],
  );
  ensure(vatRows[0].n === 0, "Računi že imajo DDV evidenco");
  console.log(JSON.stringify({
    mode: commit ? "commit" : simulate ? "simulate" : "dry-run",
    invoices: invoices.length, sourceLines: Object.values(sourceLines).reduce((a, b) => a + b, 0),
    scope: "2020 (8), 2023 (2)", grossTotal: "0.00",
    newJournalEntries: 0, newVatRows: 0, newPayments: 0,
  }));

  if (!commit && !simulate) {
    await client.query("ROLLBACK");
  } else {
    const { rowCount: audited } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       SELECT $1,'invoice',i.id,'post',$2,jsonb_build_object(
         'historicalZeroInvoice',true,'discountPercent',100,
         'gross','0.00','journalEntryCreated',false,'source','Bookie Old Promet1',
         'previousStatus',i.status,'previousNotes',i.notes,
         'reason','User confirmed correct COVID-era invoices issued for zero payment')
       FROM invoices i WHERE i.company_id=$1 AND i.source_type='bookie-old'
         AND i.linked_entry_id IS NULL AND i.status='draft'`,
      [COMPANY_ID, ACTOR],
    );
    ensure(audited === 10, "Revizija računov ni popolna");
    const { rows: confirmed } = await client.query(
      `UPDATE invoices SET status='posted',
         notes=split_part(notes,' Zgodovinski uvoz brez nove knjižbe GK.',1) ||
           ' Zgodovinski ničelni račun: 100 % popust v času COVID. Osnova, DDV in znesek za plačilo so 0,00 EUR. Račun je potrjen brez finančne GK temeljnice in brez terjatve.'
       WHERE company_id=$1 AND source_type='bookie-old' AND linked_entry_id IS NULL
         AND status='draft' RETURNING id`, [COMPANY_ID],
    );
    ensure(confirmed.length === 10, "Del ničelnih računov ni bil potrjen");
    const { rows: final } = await client.query(
      `SELECT
        (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1 AND source_type='bookie-old'
           AND invoice_date<'2026-01-01' AND status='posted') AS posted_invoices,
        (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1 AND source_type='bookie-old'
           AND invoice_date>='2026-01-01' AND status='draft') AS drafts_2026,
        (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND status='posted') AS posted_entries,
        (SELECT COUNT(*)::int FROM vat_ledger v JOIN journal_entries e
           ON e.id=v.journal_entry_id WHERE e.company_id=$1) AS vat_entries`,
      [COMPANY_ID],
    );
    ensure(final[0].posted_invoices === 2255 && final[0].drafts_2026 === 174
      && final[0].posted_entries === 3357 && final[0].vat_entries === 0,
    "Zaključno preverjanje ni uspelo");
    if (simulate) {
      await client.query("ROLLBACK");
      console.log(`SIMULACIJA RAZVELJAVLJENA: ${JSON.stringify(final[0])}`);
    } else {
      await client.query("COMMIT");
      console.log(`POTRJENO: ${JSON.stringify(final[0])}`);
    }
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}