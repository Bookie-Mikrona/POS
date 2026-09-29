/**
 * One-time, company-scoped administrative import of two UNPOSTED 2025 drafts.
 * Dry-run by default. --commit writes in one transaction, with the previously
 * locked period opened and re-locked BEFORE COMMIT, so no other session can
 * observe an open 2025 period. This is not the normal authenticated UI path.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const COMPANY_REG = "5711053000";
const YEAR_START = "2025-01-01";
const YEAR_END = "2025-12-31";
const ACTOR = "replit-agent-mikrona-2025-closing-import";
const REFERENCES = ["ZT-2025-01", "ZT-2025-02"];
const COST_CENTER_CODES = [
  "4000000", "4010000", "4012000", "4102000",
  "4141000", "4172000", "4190000", "4191000",
];
const EXPECTED = new Map([
  [REFERENCES[0], { count: 20, cents: 1770375 }],
  [REFERENCES[1], { count: 3, cents: 241411 }],
]);
const TITLES = new Map([
  [REFERENCES[0], "Zaključna temeljnica 2025 – zapiranje prihodkov in odhodkov (osnutek)"],
  [REFERENCES[1], "Zaključna temeljnica 2025 – pokritje izgube in zakonske rezerve po AJPES (osnutek)"],
]);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--commit")) {
  throw new Error("Uporabi brez argumentov za pregled ali --commit za shranitev osnutkov");
}
const commit = args[0] === "--commit";
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Dovoljena je izključno razvojna baza");
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function toCents(value) {
  ensure(/^\d+\.\d{2}$/.test(value), `Neveljaven znesek: ${value}`);
  const [whole, fraction] = value.split(".");
  return Number(whole) * 100 + Number(fraction);
}

function parseProposal() {
  const source = fileURLToPath(
    new URL("../../../reports/mikrona-2025-predlog-zakljucnih-temeljnic.csv", import.meta.url),
  );
  const rows = readFileSync(source, "utf8").replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
  ensure(rows.shift() === "Temeljnica;Datum;Vrstica;Konto;Naziv;Breme EUR;Dobro EUR;Status;Vir",
    "Napačna glava CSV");
  const groups = new Map(REFERENCES.map((reference) => [reference, []]));
  for (const row of rows) {
    const columns = row.split(";");
    ensure(columns.length === 9, "CSV vsebuje nepričakovane stolpce");
    const [ref, date, sequence, code, name, debit, credit, status] = columns;
    ensure(groups.has(ref) && date === YEAR_END && status === "PREDLOG - NI KNJIŽENO",
      `Nepričakovana temeljnica, datum ali status: ${ref}`);
    ensure(/^\d{7}$/.test(code) && Number(sequence) === groups.get(ref).length + 1,
      `Nepričakovan konto ali vrstni red: ${code}`);
    const debitCents = toCents(debit), creditCents = toCents(credit);
    ensure((debitCents > 0) !== (creditCents > 0), `Neveljavni strani pri ${code}`);
    groups.get(ref).push({
      code, name, sequence: Number(sequence),
      side: debitCents ? "debit" : "credit",
      amount: (Math.max(debitCents, creditCents) / 100).toFixed(2),
      debitCents, creditCents,
    });
  }
  for (const [reference, lines] of groups) {
    const expected = EXPECTED.get(reference);
    ensure(lines.length === expected.count
      && lines.reduce((sum, l) => sum + l.debitCents, 0) === expected.cents
      && lines.reduce((sum, l) => sum + l.creditCents, 0) === expected.cents,
    `Neujemanje vrstic ali vsot: ${reference}`);
  }
  ensure(groups.get(REFERENCES[1]).map((l) => `${l.code}:${l.side}:${l.amount}`).join("|")
    === "9320000:debit:2414.11|9310000:credit:2295.11|9200000:credit:119.00",
  "Razporeditev dobička odstopa od preverjenega izkaza AJPES");
  return groups;
}

const groups = parseProposal();
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let transactionOpen = false;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mikrona-2025-closing-drafts'))");

  const { rows: companies } = await client.query(
    "SELECT id,naziv,maticna_stevilka FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID],
  );
  ensure(companies.length === 1
    && companies[0].maticna_stevilka === COMPANY_REG
    && /mikrona/i.test(companies[0].naziv), "Napačno podjetje");
  const { rows: periods } = await client.query(
    `SELECT id,start_date::text,end_date::text,status
     FROM accounting_periods WHERE company_id=$1 AND start_date=$2 AND end_date=$3 FOR UPDATE`,
    [COMPANY_ID, YEAR_START, YEAR_END],
  );
  ensure(periods.length === 1 && periods[0].status === "locked",
    "Obdobje 2025 ni enolično zaklenjeno; ničesar ne spreminjaj");
  const periodId = periods[0].id;

  const { rows: duplicates } = await client.query(
    "SELECT id,reference,status FROM journal_entries WHERE company_id=$1 AND reference=ANY($2::text[])",
    [COMPANY_ID, REFERENCES],
  );
  ensure(duplicates.length === 0, "Temeljnica s tem sklicem že obstaja; brez podvajanja");

  const codes = [...new Set([...groups.values()].flat().map((line) => line.code))];
  const { rows: accounts } = await client.query(
    `SELECT id,code,is_active,allows_posting,requires_partner,requires_cost_center,
            cost_center_policy,requires_project
       FROM accounts WHERE company_id=$1 AND code=ANY($2::text[]) ORDER BY code FOR UPDATE`,
    [COMPANY_ID, codes],
  );
  ensure(accounts.length === codes.length, "Manjka Mikronin konto");
  const byCode = new Map(accounts.map((account) => [account.code, account]));
  for (const code of codes) {
    const account = byCode.get(code);
    ensure(account?.is_active && account?.allows_posting
      && !account?.requires_partner && !account?.requires_project,
    `Konto ${code} ni primeren za osnutek brez drugih dimenzij`);
    const required = COST_CENTER_CODES.includes(code);
    ensure(account.requires_cost_center === required
      && account.cost_center_policy === (required ? "required" : account.cost_center_policy)
      && (!required || account.cost_center_policy === "required"),
    `Nastavitve stroškovnega mesta na kontu ${code} so se spremenile`);
    ensure(required || account.cost_center_policy !== "required",
      `Nepričakovana zahteva po stroškovnem mestu: ${code}`);
  }
  console.log(`Preverjeno: Mikrona, zaklenjeno obdobje 2025, ${accounts.length} kontov, brez podvojitev.`);
  console.log("ZT-2025-01: 20 vrstic, 17.703,75 € na vsaki strani.");
  console.log("ZT-2025-02: 3 vrstice, 2.414,11 € na vsaki strani.");

  if (!commit) {
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("Samo pregled. Baza ni spremenjena.");
  } else {
    const { rows: changedAccounts } = await client.query(
      `UPDATE accounts
          SET requires_cost_center=false,cost_center_policy='allowed',updated_at=now()
        WHERE company_id=$1 AND code=ANY($2::text[])
          AND requires_cost_center=true AND cost_center_policy='required'
        RETURNING code`,
      [COMPANY_ID, COST_CENTER_CODES],
    );
    ensure(changedAccounts.length === COST_CENTER_CODES.length,
      "Nastavitve niso bile spremenjene na natanko osmih kontih");
    const { rowCount: opened } = await client.query(
      "UPDATE accounting_periods SET status='open',updated_at=now() WHERE id=$1 AND status='locked'",
      [periodId],
    );
    ensure(opened === 1, "Obdobja ni bilo mogoče začasno odpreti");

    const ids = [];
    for (const reference of REFERENCES) {
      const { rows: inserted } = await client.query(
        `INSERT INTO journal_entries
         (company_id,period_id,document_date,entry_date,description,reference,
          status,source_type,created_by)
         VALUES ($1,$2,$3,$4,$5,$6,'draft','manual',$7) RETURNING id`,
        [COMPANY_ID, periodId, YEAR_END, YEAR_END, TITLES.get(reference), reference, ACTOR],
      );
      ensure(inserted.length === 1, `Osnutek ${reference} ni bil ustvarjen`);
      ids.push([reference, inserted[0].id]);
      for (const line of groups.get(reference)) {
        await client.query(
          `INSERT INTO journal_entry_lines
             (entry_id,account_id,side,amount,description,sequence)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [inserted[0].id, byCode.get(line.code).id, line.side,
            line.amount, line.name, line.sequence - 1],
        );
      }
    }
    const { rows: checked } = await client.query(
      `SELECT e.reference,e.status,e.posted_at,COUNT(l.id)::int AS n,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='debit'),0)::numeric AS debit,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='credit'),0)::numeric AS credit
         FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
        WHERE e.company_id=$1 AND e.reference=ANY($2::text[])
        GROUP BY e.id,e.reference,e.status,e.posted_at`,
      [COMPANY_ID, REFERENCES],
    );
    ensure(checked.length === 2, "Nepričakovano število osnutkov");
    for (const entry of checked) {
      const expected = EXPECTED.get(entry.reference);
      ensure(entry.status === "draft" && entry.posted_at === null
        && entry.n === expected.count
        && Math.round(Number(entry.debit) * 100) === expected.cents
        && Math.round(Number(entry.credit) * 100) === expected.cents,
      `Neujemanje vpisanega osnutka ${entry.reference}`);
    }
    const { rowCount: relocked } = await client.query(
      "UPDATE accounting_periods SET status='locked',updated_at=now() WHERE id=$1 AND status='open'",
      [periodId],
    );
    ensure(relocked === 1, "Obdobje ni ponovno zaklenjeno");
    await client.query("COMMIT");
    transactionOpen = false;
    console.log("SHRANJENO: 2 osnutka, 0 knjiženih; obdobje 2025 je zaklenjeno.");
    for (const [reference, id] of ids) console.log(`${reference}: ${id}`);
    console.log("Usklajena zahtevnost stroškovnega mesta na 8 kontih.");
  }
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}