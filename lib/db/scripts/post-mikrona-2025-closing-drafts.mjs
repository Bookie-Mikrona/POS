/**
 * One-time authorization-scoped posting of two specifically prepared Mikrona
 * closing drafts. Dry-run by default; --simulate runs all writes then rolls
 * back; --commit posts both atomically and leaves 2025 OPEN as requested.
 * Uses a named administrative actor, never impersonates a Clerk user.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const PERIOD_ID = "fca01b11-b118-44af-abc1-973c766c3dfd";
const ACTOR = "replit-agent-mikrona-2025-closing-post";
const CREATED_BY = "replit-agent-mikrona-2025-closing-import";
const REFS = ["ZT-2025-01", "ZT-2025-02"];
const IDS = new Map([
  [REFS[0], "0469f2c6-378f-476c-97be-6ba532d311cb"],
  [REFS[1], "88d3ab16-950b-40a3-b120-a22424cb712d"],
]);
const REQUIRED = new Map([
  [REFS[0], { lines: 20, cents: 1770375 }],
  [REFS[1], { lines: 3, cents: 241411 }],
]);
const args = process.argv.slice(2);
if (args.length > 1 || (args.length && !["--simulate", "--commit"].includes(args[0]))) {
  throw new Error("Uporabi brez argumentov za predkontrolo, --simulate ali --commit");
}
const mode = args[0] ?? "dry-run";
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Dovoljena je samo razvojna baza");
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function cents(value) {
  ensure(/^-?\d+\.\d{2}$/.test(String(value)), `Neveljaven denarni znesek: ${value}`);
  const negative = String(value).startsWith("-");
  const [whole, decimal] = String(value).replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(decimal);
  return negative ? -result : result;
}

const file = fileURLToPath(
  new URL("../../../reports/mikrona-2025-predlog-zakljucnih-temeljnic.csv", import.meta.url),
);
const raw = readFileSync(file);
const fingerprint = createHash("sha256").update(raw).digest("hex");
const rows = raw.toString("utf8").replace(/^\uFEFF/, "").trimEnd().split(/\r?\n/);
ensure(rows.shift() === "Temeljnica;Datum;Vrstica;Konto;Naziv;Breme EUR;Dobro EUR;Status;Vir",
  "Predlog CSV nima pričakovane glave");
const expected = new Map(REFS.map((ref) => [ref, []]));
for (const row of rows) {
  const cells = row.split(";");
  ensure(cells.length === 9, "Nepričakovano število CSV stolpcev");
  const [ref, date, ordinal, code, name, debit, credit, status] = cells;
  ensure(expected.has(ref) && date === "2025-12-31" && status === "PREDLOG - NI KNJIŽENO",
    "Nepričakovan sklic/datum/status v CSV");
  ensure(/^\d{7}$/.test(code) && Number(ordinal) === expected.get(ref).length + 1,
    `Napačen vrstni red ali konto: ${code}`);
  const dr = cents(debit), cr = cents(credit);
  ensure((dr > 0) !== (cr > 0), `Vrstica ${code} nima ene pozitivne strani`);
  expected.get(ref).push({
    sequence: Number(ordinal) - 1, code, name,
    side: dr ? "debit" : "credit",
    amount: (Math.max(dr, cr) / 100).toFixed(2),
    netCents: dr - cr,
  });
}
for (const [ref, lines] of expected) {
  const required = REQUIRED.get(ref);
  ensure(lines.length === required.lines
    && lines.reduce((sum, line) => sum + (line.netCents > 0 ? line.netCents : 0), 0) === required.cents
    && lines.reduce((sum, line) => sum + (line.netCents < 0 ? -line.netCents : 0), 0) === required.cents,
  `Predlog ${ref} ni uravnotežen`);
}
ensure(expected.get(REFS[1]).map((l) => `${l.code}:${l.side}:${l.amount}`).join("|")
  === "9320000:debit:2414.11|9310000:credit:2295.11|9200000:credit:119.00",
"Kapitalska temeljnica ne ustreza AJPES razporeditvi");

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let transactionOpen = false;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '90s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mikrona-2025-closing-post'))");

  const { rows: company } = await client.query(
    "SELECT naziv,maticna_stevilka FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID],
  );
  ensure(company.length === 1 && company[0].maticna_stevilka === "5711053000"
    && /mikrona/i.test(company[0].naziv), "Napačno podjetje");
  const { rows: period } = await client.query(
    "SELECT start_date::text,end_date::text,status FROM accounting_periods WHERE id=$1 AND company_id=$2 FOR UPDATE",
    [PERIOD_ID, COMPANY_ID],
  );
  ensure(period.length === 1 && period[0].start_date === "2025-01-01"
    && period[0].end_date === "2025-12-31" && period[0].status === "locked",
  "Leto 2025 ni več zaklenjeno");

  const { rows: entries } = await client.query(
    `SELECT id,reference,description,status,entry_date::text,document_date::text,
            period_id,posted_at,approved_by,created_by,source_type
       FROM journal_entries
      WHERE company_id=$1 AND reference=ANY($2::text[])
      ORDER BY reference FOR UPDATE`,
    [COMPANY_ID, REFS],
  );
  ensure(entries.length === 2, "Temeljnici manjkata ali imata podvojen sklic");
  for (const entry of entries) {
    ensure(entry.id === IDS.get(entry.reference)
      && entry.status === "draft" && entry.posted_at === null
      && entry.approved_by === null && entry.created_by === CREATED_BY
      && entry.period_id === PERIOD_ID
      && entry.entry_date === "2025-12-31"
      && entry.document_date === "2025-12-31"
      && entry.source_type === "manual"
      && entry.description.includes("Zaključna temeljnica 2025"),
    `Osnutek ${entry.reference} je bil spremenjen`);
  }
  const ids = entries.map((entry) => entry.id);
  const { rows: lines } = await client.query(
    `SELECT l.entry_id,l.sequence,l.side,l.amount::text,l.description,
            l.partner_id,l.cost_center_id,l.project_id,l.department_id,
            l.vat_code_id,l.company_vat_code_id,l.vat_amount::text,
            a.id AS account_id,a.company_id,a.code,a.is_active,a.allows_posting,
            a.requires_partner,a.requires_cost_center,a.cost_center_policy,a.requires_project
       FROM journal_entry_lines l JOIN accounts a ON a.id=l.account_id
      WHERE l.entry_id=ANY($1::uuid[]) ORDER BY l.entry_id,l.sequence FOR UPDATE OF l,a`,
    [ids],
  );
  ensure(lines.length === 23, "Nepričakovano število vrstic osnutkov");
  for (const entry of entries) {
    const actual = lines.filter((line) => line.entry_id === entry.id);
    const wanted = expected.get(entry.reference);
    ensure(actual.length === wanted.length, `Spremenjen obseg ${entry.reference}`);
    for (let index = 0; index < wanted.length; index += 1) {
      const a = actual[index], w = wanted[index];
      ensure(a.sequence === w.sequence && a.code === w.code && a.side === w.side
        && a.amount === w.amount && a.description === w.name
        && a.company_id === COMPANY_ID && a.is_active && a.allows_posting
        && !a.requires_partner && !a.requires_cost_center && !a.requires_project
        && a.cost_center_policy !== "required"
        && a.partner_id === null && a.cost_center_id === null && a.project_id === null
        && a.department_id === null && a.vat_code_id === null
        && a.company_vat_code_id === null && cents(a.vat_amount ?? "0.00") === 0,
      `Spremenjena/neveljavna vrstica ${entry.reference} / ${w.code}`);
    }
  }
  const { rows: related } = await client.query(
    `SELECT
      (SELECT COUNT(*)::int FROM invoices WHERE linked_entry_id=ANY($1::uuid[])) invoices,
      (SELECT COUNT(*)::int FROM pos_receipt_booking_sources WHERE journal_entry_id=ANY($1::uuid[])) receipts`,
    [ids],
  );
  ensure(related[0].invoices === 0 && related[0].receipts === 0,
    "Osnutka sta naknadno povezana z listinami; uporabi običajni ERP tok");
  const { rows: statusCounts } = await client.query(
    `SELECT status,COUNT(*)::int n FROM journal_entries
      WHERE company_id=$1 AND period_id=$2 GROUP BY status`,
    [COMPANY_ID, PERIOD_ID],
  );
  ensure(statusCounts.find((row) => row.status === "posted")?.n === 543
    && statusCounts.find((row) => row.status === "draft")?.n === 2
    && statusCounts.length === 2,
  "Mikronina GK 2025 je bila po pripravi spremenjena");

  // The first draft must EXACTLY negate the existing posted account balances.
  const nominalCodes = expected.get(REFS[0]).map((line) => line.code);
  const { rows: nominalBalances } = await client.query(
    `SELECT a.code,
            SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END)::numeric(18,2)::text net
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id=l.entry_id
       JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND e.period_id=$2 AND e.status='posted'
        AND a.code=ANY($3::text[])
      GROUP BY a.code`,
    [COMPANY_ID, PERIOD_ID, nominalCodes],
  );
  const nominalMap = new Map(nominalBalances.map((row) => [row.code, cents(row.net)]));
  ensure(nominalMap.size === nominalCodes.length, "Manjka knjiženi saldo prihodkov/odhodkov");
  for (const line of expected.get(REFS[0])) {
    ensure(nominalMap.get(line.code) === -line.netCents,
      `Saldo konta ${line.code} se je od predloga spremenil`);
  }
  const { rows: equity } = await client.query(
    `SELECT a.code,
            SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END)::numeric(18,2)::text net
       FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id
       JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND e.period_id=$2 AND e.status='posted'
        AND a.code=ANY($3::text[]) GROUP BY a.code`,
    [COMPANY_ID, PERIOD_ID, ["9200000", "9310000", "9320000"]],
  );
  const capital = new Map(equity.map((row) => [row.code, cents(row.net)]));
  ensure(capital.size === 3
    && capital.get("9200000") === -75731
    && capital.get("9310000") === 229511
    && capital.get("9320000") === -247476,
  "Kapitalski saldi ne ustrezajo izvirnemu izpisu in AJPES");
  console.log(`PREDKONTROLA: ${entries.length} osnutka, 23 nespremenjenih vrstic, vseh 20 kontov se zapre.`);
  console.log(`2025 zaklenjeno; kapital 920=-757,31; 931=+2.295,11; 932=-2.474,76; vir SHA256 ${fingerprint.slice(0, 16)}…`);

  if (mode === "dry-run") {
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("Samo preverjanje. GK in obdobje nista spremenjena.");
  } else {
    const { rowCount: unlocked } = await client.query(
      "UPDATE accounting_periods SET status='open',updated_at=now() WHERE id=$1 AND company_id=$2 AND status='locked'",
      [PERIOD_ID, COMPANY_ID],
    );
    ensure(unlocked === 1, "Leta ni bilo mogoče odkleniti");
    const { rows: posted } = await client.query(
      `UPDATE journal_entries
          SET status='posted',posted_at=now(),approved_by=$3,updated_at=now()
        WHERE company_id=$1 AND id=ANY($2::uuid[]) AND period_id=$4
          AND status='draft' AND posted_at IS NULL AND approved_by IS NULL
        RETURNING id,reference`,
      [COMPANY_ID, ids, ACTOR, PERIOD_ID],
    );
    ensure(posted.length === 2, "Oba osnutka nista bila poknjižena");
    const payload = JSON.stringify({
      reason: "User-authorized closing of Mikrona 2025",
      source: "verified closing proposals and AJPES JOLP 2025",
      sourceSha256: fingerprint,
      administrativePosting: true,
    });
    const { rowCount: journalAudit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
        SELECT $1,'journal_entry',id,'post',$3,$4::jsonb
          FROM journal_entries WHERE company_id=$1 AND id=ANY($2::uuid[])`,
      [COMPANY_ID, ids, ACTOR, payload],
    );
    const { rowCount: periodAudit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       VALUES ($1,'period',$2,'unlock',$3,$4::jsonb)`,
      [COMPANY_ID, PERIOD_ID, ACTOR, payload],
    );
    ensure(journalAudit === 2 && periodAudit === 1, "Manjka revizijska sled");

    const { rows: state } = await client.query(
      `SELECT (SELECT status FROM accounting_periods WHERE id=$2 AND company_id=$1) period_status,
              (SELECT COUNT(*)::int FROM journal_entries
                WHERE company_id=$1 AND id=ANY($3::uuid[]) AND status='posted'
                  AND posted_at IS NOT NULL AND approved_by=$4) posted_count`,
      [COMPANY_ID, PERIOD_ID, ids, ACTOR],
    );
    ensure(state[0].period_status === "open" && state[0].posted_count === 2,
      "Končni status obdobja ali temeljnic ni pravilen");
    if (mode === "--simulate") {
      await client.query("ROLLBACK");
      transactionOpen = false;
      console.log("SIMULACIJA USPELA, SPREMEMBE RAZVELJAVLJENE.");
    } else {
      await client.query("COMMIT");
      transactionOpen = false;
      console.log("POKNJIŽENO: obe temeljnici. Leto 2025 ostaja ODKLENJENO.");
    }
  }
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}