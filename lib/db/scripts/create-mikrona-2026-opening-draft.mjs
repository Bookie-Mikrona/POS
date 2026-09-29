/**
 * One-time, UNPOSTED 2026 opening based only on the 2025 posted period balances
 * after the two closing vouchers. Never add earlier years again: the 2025
 * period already includes its own opening. Dry-run by default.
 *
 * Historical aggregate opening lines have no invented counterparties. The
 * ordinary entry API rejects such lines on accounts 120/220; a subsequent
 * posting would need a separately reviewed, authorized exception.
 */
import { createHash } from "node:crypto";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const PRIOR_PERIOD_ID = "fca01b11-b118-44af-abc1-973c766c3dfd";
const PERIOD_ID = "c210ee40-6ae1-434f-97fc-2c4d640aacc2";
const REF = "OTV-2026-01";
const ACTOR = "replit-agent-mikrona-2026-opening-draft";
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--commit")) {
  throw new Error("Brez argumentov preveri; --commit shrani osnutek");
}
const commit = args[0] === "--commit";
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) {
  throw new Error("Dovoljena je samo razvojna baza");
}

function ensure(ok, message) {
  if (!ok) throw new Error(message);
}
function cents(value) {
  ensure(/^-?\d+\.\d{2}$/.test(String(value)), `Neveljaven znesek: ${value}`);
  const negative = String(value).startsWith("-");
  const [whole, fraction] = String(value).replace("-", "").split(".");
  const result = Number(whole) * 100 + Number(fraction);
  return negative ? -result : result;
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
let transactionOpen = false;
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '10s'");
  await client.query("SET LOCAL statement_timeout = '60s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('mikrona-2026-opening'))");

  const { rows: company } = await client.query(
    "SELECT naziv,maticna_stevilka FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID],
  );
  ensure(company.length === 1 && company[0].maticna_stevilka === "5711053000"
    && /mikrona/i.test(company[0].naziv), "Napačno podjetje");
  const { rows: periods } = await client.query(
    `SELECT id,start_date::text,end_date::text,status
       FROM accounting_periods WHERE company_id=$1 AND id=ANY($2::uuid[])
       ORDER BY start_date FOR UPDATE`,
    [COMPANY_ID, [PRIOR_PERIOD_ID, PERIOD_ID]],
  );
  ensure(periods.length === 2
    && periods[0].id === PRIOR_PERIOD_ID && periods[0].status === "locked"
    && periods[0].start_date === "2025-01-01" && periods[0].end_date === "2025-12-31"
    && periods[1].id === PERIOD_ID && periods[1].status === "open"
    && periods[1].start_date === "2026-01-01" && periods[1].end_date === "2026-12-31",
  "Obdobji 2025/2026 nista v pričakovanem stanju");
  const { rows: closed } = await client.query(
    `SELECT reference,status FROM journal_entries WHERE company_id=$1
       AND period_id=$2 AND reference=ANY($3::text[]) ORDER BY reference`,
    [COMPANY_ID, PRIOR_PERIOD_ID, ["ZT-2025-01", "ZT-2025-02"]],
  );
  ensure(closed.length === 2 && closed.every((row) => row.status === "posted"),
    "Zaključni temeljnici 2025 nista obe knjiženi");
  const { rows: yearCounts } = await client.query(
    `SELECT period_id,status,COUNT(*)::int n FROM journal_entries
      WHERE company_id=$1 AND period_id=ANY($2::uuid[])
      GROUP BY period_id,status`,
    [COMPANY_ID, [PRIOR_PERIOD_ID, PERIOD_ID]],
  );
  ensure(yearCounts.length === 2
    && yearCounts.some((r) => r.period_id === PRIOR_PERIOD_ID && r.status === "posted" && r.n === 545)
    && yearCounts.some((r) => r.period_id === PERIOD_ID && r.status === "draft" && r.n === 288),
  "Zgodovinska GK ali osnutki 2026 so se spremenili");
  const { rows: existingOpening } = await client.query(
    `SELECT id,reference FROM journal_entries
      WHERE company_id=$1 AND period_id=$2
        AND (reference=$3 OR reference ILIKE '%/2026/00/%'
          OR reference ILIKE 'OTV-%' OR description ILIKE '%otvor%')
      LIMIT 2`,
    [COMPANY_ID, PERIOD_ID, REF],
  );
  ensure(existingOpening.length === 0, "Otvoritvena temeljnica 2026 že obstaja");

  // Sum the 2025 period alone: it already has the 2025 opening and both closings.
  const { rows: balances } = await client.query(
    `SELECT a.id,a.code,a.name,a.type,a.company_id,a.is_active,a.allows_posting,
            a.requires_partner,a.requires_cost_center,a.cost_center_policy,a.requires_project,
            SUM(CASE WHEN l.side='debit' THEN l.amount ELSE -l.amount END)::numeric(18,2)::text net
       FROM journal_entry_lines l
       JOIN journal_entries e ON e.id=l.entry_id
       JOIN accounts a ON a.id=l.account_id
      WHERE e.company_id=$1 AND e.period_id=$2 AND e.status='posted'
      GROUP BY a.id ORDER BY a.code`,
    [COMPANY_ID, PRIOR_PERIOD_ID],
  );
  const nonzero = balances.filter((row) => cents(row.net) !== 0);
  ensure(nonzero.length === 27, "Neničelni saldi 2025 niso več na 27 kontih");
  ensure(balances.every((row) => cents(row.net) === 0
    || ["asset", "liability", "equity"].includes(row.type)),
  "Po zaključku ostaja saldo na prihodkovnem ali odhodkovnem kontu");
  const exceptionCodes = nonzero.filter((row) => row.requires_partner).map((row) => row.code);
  ensure(exceptionCodes.join(",") === "1200000,2200000",
    "Nepričakovana zahteva po partnerju v zbirni otvoritvi");
  ensure(nonzero.every((row) =>
    row.company_id === COMPANY_ID && row.is_active && row.allows_posting
    && !row.requires_cost_center && row.cost_center_policy !== "required"
    && !row.requires_project),
  "Konto ni aktiven, knjižljiv ali zahteva drugo dimenzijo");
  const opening = nonzero.map((row) => {
    const signed = cents(row.net);
    return {
      ...row,
      side: signed > 0 ? "debit" : "credit",
      amount: (Math.abs(signed) / 100).toFixed(2),
    };
  });
  const debit = opening.reduce((total, row) =>
    total + (row.side === "debit" ? cents(row.amount) : 0), 0);
  const credit = opening.reduce((total, row) =>
    total + (row.side === "credit" ? cents(row.amount) : 0), 0);
  // The contra-asset account 050 carries a credit balance of 58,100.77 EUR.
  // Gross debits/credits therefore exceed the net assets of 32,184.06 EUR.
  ensure(debit === 9028483 && credit === 9028483,
    "Otvoritev ni uravnotežena na preverjenih bruto 90.284,83 EUR");
  const capital = new Map(nonzero.filter((row) => row.type === "equity")
    .map((row) => [row.code, cents(row.net)]));
  ensure(capital.size === 3 && capital.get("9030000") === -876314
    && capital.get("9200000") === -87631 && capital.get("9320000") === -6065,
  "Kapital ne ustreza potrjenemu zaključku 2025");
  const sourceFingerprint = createHash("sha256").update(JSON.stringify(
    opening.map((row) => [row.code, row.side, row.amount]),
  )).digest("hex");
  console.log(`Preverjeno: 2025 zaklenjeno, 2026 odprto; 27 bilančnih vrstic.`);
  console.log("Otvoritev 2026: breme = dobro = 90.284,83 EUR (neto sredstva 32.184,06 EUR); 120/220 brez izmišljenih partnerjev.");
  console.log(`Vir: samo knjižena GK 2025; odtis saldov ${sourceFingerprint.slice(0, 16)}…`);

  if (!commit) {
    await client.query("ROLLBACK");
    transactionOpen = false;
    console.log("Samo pregled, brez sprememb.");
  } else {
    const { rows: inserted } = await client.query(
      `INSERT INTO journal_entries
        (company_id,period_id,document_date,entry_date,description,reference,
         status,source_type,created_by)
       VALUES ($1,$2,'2026-01-01','2026-01-01',$3,$4,'draft','manual',$5)
       RETURNING id`,
      [COMPANY_ID, PERIOD_ID,
        "Otvoritvena temeljnica 2026 – prenos knjiženih zaključnih saldov 2025 (osnutek)",
        REF, ACTOR],
    );
    ensure(inserted.length === 1, "Osnutek otvoritve ni bil ustvarjen");
    const entryId = inserted[0].id;
    for (const [sequence, row] of opening.entries()) {
      await client.query(
        `INSERT INTO journal_entry_lines
          (entry_id,account_id,side,amount,description,sequence)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [entryId, row.id, row.side, row.amount,
          `Prenos salda 31. 12. 2025 – ${row.name}`, sequence],
      );
    }
    const payload = JSON.stringify({
      reason: "User-authorized 2026 opening draft after locking 2025",
      sourcePeriodId: PRIOR_PERIOD_ID,
      source: "posted 2025 closing balances, including closing entries",
      balancesSha256: sourceFingerprint,
      aggregatePartnerException: ["1200000", "2200000"],
      posted: false,
    });
    const { rowCount: audit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       VALUES ($1,'journal_entry',$2,'create',$3,$4::jsonb)`,
      [COMPANY_ID, entryId, ACTOR, payload],
    );
    ensure(audit === 1, "Revizijski zapis ni bil ustvarjen");
    const { rows: result } = await client.query(
      `SELECT e.reference,e.status,e.posted_at,
              COUNT(l.id)::int n,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='debit'),0)::numeric(18,2)::text debit,
              COALESCE(SUM(l.amount) FILTER (WHERE l.side='credit'),0)::numeric(18,2)::text credit,
              COUNT(l.partner_id)::int with_partner
       FROM journal_entries e JOIN journal_entry_lines l ON l.entry_id=e.id
       WHERE e.id=$1 AND e.company_id=$2
       GROUP BY e.id`,
      [entryId, COMPANY_ID],
    );
    ensure(result.length === 1 && result[0].reference === REF
      && result[0].status === "draft" && result[0].posted_at === null
      && result[0].n === 27 && result[0].with_partner === 0
      && cents(result[0].debit) === debit && cents(result[0].credit) === credit,
    "Shranjena otvoritev ni uravnotežen neknjižen osnutek");
    await client.query("COMMIT");
    transactionOpen = false;
    console.log(`USTVARJEN OSNUTEK: ${REF} (${entryId}); 2025 ostaja zaklenjeno.`);
  }
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK");
  throw error;
} finally {
  await client.end();
}