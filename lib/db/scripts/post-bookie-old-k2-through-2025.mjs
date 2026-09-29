/**
 * Enkratno potrjevanje izključno zgodovinske Mikrona K2 GK za 2020–2025.
 * --commit izvede vse v eni transakciji; brez stikala naredi samo preveritev.
 *
 * Izrecna poslovna odločitev: zgodovinski računi se označijo kot posted brez
 * izdelave KIR/KPR, ker izvirnih listin ni. 2026 ostane nespremenjen.
 * Izjeme veljajo SAMO za ta preverjeni zgodovinski nabor: Mikrona ne uporablja
 * stroškovnih mest, zbirne otvoritve nimajo partnerjev in ena izvorna bančna
 * vrstica iz 2022 nima partnerjeve šifre (ohrani se kot takšna).
 */
import { createHash } from "node:crypto";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const ACTOR = "bookie-old-k2-historical-post";
const COUNTS = new Map([[2020, 490], [2021, 649], [2022, 597], [2023, 552], [2024, 526], [2025, 543], [2026, 288]]);
const TOTAL = 3357;
const LINKED_INVOICES = 2245;
const commit = process.argv.includes("--commit");
const simulate = process.argv.includes("--simulate");
if ((commit && simulate) || process.argv.some((arg) => arg.startsWith("--") && !["--commit", "--simulate"].includes(arg))) {
  throw new Error("Izberi največ eno od --simulate ali --commit");
}
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT) throw new Error("Dovoljena je samo razvojna baza");

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
await client.connect();
try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL lock_timeout = '15s'");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-k2-mikrona-post-through-2025'))");

  const { rows: companies } = await client.query(
    "SELECT naziv FROM companies WHERE id=$1 FOR UPDATE", [COMPANY_ID],
  );
  ensure(companies.length === 1 && /mikrona/i.test(companies[0].naziv), "Napačno podjetje");

  // Pred pregledom zakleni vse uvožene vrstice, glave, račune in obdobja.
  await client.query("SELECT id FROM accounting_periods WHERE company_id=$1 FOR UPDATE", [COMPANY_ID]);
  await client.query(
    "SELECT id FROM journal_entries WHERE company_id=$1 AND created_by='bookie-old-k2-import' FOR UPDATE",
    [COMPANY_ID],
  );
  await client.query(
    `SELECT id FROM journal_entry_lines WHERE entry_id IN
      (SELECT id FROM journal_entries WHERE company_id=$1 AND created_by='bookie-old-k2-import') FOR UPDATE`,
    [COMPANY_ID],
  );
  await client.query(
    "SELECT id FROM invoices WHERE company_id=$1 AND source_type='bookie-old' FOR UPDATE",
    [COMPANY_ID],
  );

  const { rows: periods } = await client.query(
    `SELECT id,start_date::text AS start_date,end_date::text AS end_date,status
     FROM accounting_periods WHERE company_id=$1 ORDER BY start_date`, [COMPANY_ID],
  );
  ensure(periods.length === 7, "Pričakovanih je 7 zgodovinskih obdobij");
  for (const [index, p] of periods.entries()) {
    const year = 2020 + index;
    ensure(
      p.start_date === `${year}-01-01` && p.end_date === `${year}-12-31` && p.status === "open",
      `Obdobje ${year} ni odprto letno obdobje`,
    );
  }

  const { rows: groups } = await client.query(
    `SELECT EXTRACT(YEAR FROM document_date)::int AS yr,status,COUNT(*)::int AS n
     FROM journal_entries WHERE company_id=$1 AND created_by='bookie-old-k2-import'
     GROUP BY 1,2 ORDER BY 1,2`, [COMPANY_ID],
  );
  ensure(groups.length === COUNTS.size, "Nepričakovan nabor zgodovinskih temeljnic");
  for (const group of groups) {
    ensure(group.status === "draft" && group.n === COUNTS.get(group.yr),
      `Napačen status/obseg temeljnic ${group.yr}`);
  }
  const { rows: entryCheck } = await client.query(
    `SELECT e.id,e.reference,EXTRACT(YEAR FROM e.document_date)::int AS yr,
            e.period_id,COUNT(l.id)::int AS line_count,
            COALESCE(SUM(l.amount) FILTER (WHERE l.side='debit'),0)::numeric AS debit,
            COALESCE(SUM(l.amount) FILTER (WHERE l.side='credit'),0)::numeric AS credit,
            COUNT(l.id) FILTER (WHERE l.amount<=0 OR l.side NOT IN ('debit','credit')
              OR a.id IS NULL OR a.company_id<>$1 OR NOT a.is_active OR NOT a.allows_posting
              OR (a.requires_project AND l.project_id IS NULL)
              OR (a.cost_center_policy='not_allowed' AND l.cost_center_id IS NOT NULL))::int AS invalid_lines,
            COUNT(l.id) FILTER (WHERE a.requires_partner AND l.partner_id IS NULL)::int AS missing_partner,
            COUNT(l.id) FILTER (WHERE (a.requires_cost_center OR a.cost_center_policy='required')
              AND l.cost_center_id IS NULL)::int AS configured_cost_center
     FROM journal_entries e
     JOIN accounting_periods p ON p.id=e.period_id
     LEFT JOIN journal_entry_lines l ON l.entry_id=e.id
     LEFT JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.created_by='bookie-old-k2-import'
       AND e.document_date<'2026-01-01'
     GROUP BY e.id ORDER BY e.reference`, [COMPANY_ID],
  );
  ensure(entryCheck.length === TOTAL, "Napačno število temeljnic 2020–2025");
  for (const e of entryCheck) {
    ensure(e.line_count >= 2 && e.invalid_lines === 0 && e.debit === e.credit,
      `Neveljavna/neuravnotežena temeljnica ${e.reference}`);
    ensure(periods[e.yr - 2020]?.id === e.period_id, `Napačno obdobje ${e.reference}`);
  }
  const missingPartner = entryCheck.reduce((sum, e) => sum + e.missing_partner, 0);
  const configuredCostCenter = entryCheck.reduce((sum, e) => sum + e.configured_cost_center, 0);
  ensure(missingPartner === 7 && configuredCostCenter === 681,
    `Nepričakovane dimenzije: partner ${missingPartner}, stroškovno mesto ${configuredCostCenter}`);
  const { rows: partnerExceptions } = await client.query(
    `SELECT e.reference,l.description FROM journal_entry_lines l
     JOIN journal_entries e ON e.id=l.entry_id JOIN accounts a ON a.id=l.account_id
     WHERE e.company_id=$1 AND e.created_by='bookie-old-k2-import'
       AND e.document_date<'2026-01-01' AND a.requires_partner AND l.partner_id IS NULL
     ORDER BY e.reference`, [COMPANY_ID],
  );
  ensure(partnerExceptions.length === 7
    && partnerExceptions.filter((r) => /\/00\/000001$/.test(r.reference)
      && r.description.startsWith("OTVORITEV [Bookie Old GLAVNA #")).length === 6
    && partnerExceptions.some((r) => r.reference === "BOOKIE-OLD/K2/2022/10/000103"
      && r.description.includes("Bookie Old GLAVNA #419114")),
  "Nepojasnjena vrstica brez partnerja");

  const { rows: invoiceCheck } = await client.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE linked_entry_id IS NULL)::int AS unlinked,
            COUNT(*) FILTER (WHERE status<>'draft')::int AS not_draft
     FROM invoices WHERE company_id=$1 AND source_type='bookie-old'
       AND invoice_date<'2026-01-01'`, [COMPANY_ID],
  );
  ensure(invoiceCheck[0].total === 2255 && invoiceCheck[0].unlinked === 10
    && invoiceCheck[0].not_draft === 0, "Napačen status/obseg zgodovinskih računov");
  const { rows: linkedCheck } = await client.query(
    `SELECT COUNT(*)::int AS n,
            COUNT(*) FILTER (WHERE i.company_id<>e.company_id
              OR EXTRACT(YEAR FROM i.invoice_date)<>EXTRACT(YEAR FROM e.document_date))::int AS wrong
     FROM invoices i JOIN journal_entries e ON e.id=i.linked_entry_id
     WHERE e.company_id=$1 AND e.created_by='bookie-old-k2-import'
       AND e.document_date<'2026-01-01'`, [COMPANY_ID],
  );
  ensure(linkedCheck[0].n === LINKED_INVOICES && linkedCheck[0].wrong === 0,
    "Računi niso povezani s pričakovanimi temeljnicami");
  const { rows: vatCheck } = await client.query(
    `SELECT COUNT(l.id) FILTER (WHERE l.vat_code_id IS NOT NULL)::int AS codes,
            (SELECT COUNT(*)::int FROM vat_ledger v
             JOIN journal_entries ve ON ve.id=v.journal_entry_id
             WHERE ve.company_id=$1 AND ve.document_date<'2026-01-01') AS ledger
     FROM journal_entry_lines l JOIN journal_entries e ON e.id=l.entry_id
     WHERE e.company_id=$1 AND e.created_by='bookie-old-k2-import'
       AND e.document_date<'2026-01-01'`, [COMPANY_ID],
  );
  ensure(vatCheck[0].codes === 0 && vatCheck[0].ledger === 0,
    "DDV podatki so se spremenili; prekinjeno");
  const fingerprint = createHash("sha256")
    .update(entryCheck.map((e) => `${e.id}|${e.reference}|${e.debit}|${e.credit}\n`).join(""))
    .digest("hex");
  console.log(JSON.stringify({
    mode: commit ? "commit" : simulate ? "simulate" : "dry-run", company: companies[0].naziv,
    years: "2020–2025", journalEntries: TOTAL,
    invoicesToPost: LINKED_INVOICES, invoicesWithoutLedger: 10,
    configuredCostCenterLines: configuredCostCenter, openingWithoutPartner: 6,
    bankWithoutPartner: 1, vatCodes: 0, vatLedgerRows: 0,
    year2026DraftsUnaffected: COUNTS.get(2026), fingerprint,
  }));

  if (!commit && !simulate) {
    await client.query("ROLLBACK");
  } else {
    const { rows: posted } = await client.query(
      `UPDATE journal_entries SET status='posted',posted_at=now(),approved_by=$2,
             updated_at=now()
       WHERE company_id=$1 AND created_by='bookie-old-k2-import'
         AND document_date>='2020-01-01' AND document_date<'2026-01-01'
         AND status='draft' RETURNING id`, [COMPANY_ID, ACTOR],
    );
    ensure(posted.length === TOTAL, "Del temeljnic ni bil poknjižen");
    const { rows: invoices } = await client.query(
      `UPDATE invoices i SET status='posted'
       FROM journal_entries e
       WHERE i.linked_entry_id=e.id AND i.company_id=$1 AND i.source_type='bookie-old'
         AND i.status='draft' AND e.company_id=$1 AND e.created_by='bookie-old-k2-import'
         AND e.document_date>='2020-01-01' AND e.document_date<'2026-01-01'
         AND e.status='posted' RETURNING i.id`, [COMPANY_ID],
    );
    ensure(invoices.length === LINKED_INVOICES, "Del povezanih računov ni bil potrjen");
    const { rows: locked } = await client.query(
      `UPDATE accounting_periods SET status='locked',updated_at=now()
       WHERE company_id=$1 AND start_date>='2020-01-01' AND end_date<'2026-01-01'
         AND status='open' RETURNING id`, [COMPANY_ID],
    );
    ensure(locked.length === 6, "Šest obdobij ni bilo zaklenjenih");
    const auditPayload = JSON.stringify({
      import: "bookie-old-k2", scope: "2020-2025",
      historicalPostingWithoutVatLedger: true,
      decision: "user-authorized historical GK and linked invoices without complete KIR/KPR",
      sourceFingerprint: fingerprint,
    });
    const { rowCount: entryAudit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       SELECT $1,'journal_entry',id,'post',$2,$3::jsonb
       FROM journal_entries WHERE company_id=$1 AND created_by='bookie-old-k2-import'
         AND document_date>='2020-01-01' AND document_date<'2026-01-01'`,
      [COMPANY_ID, ACTOR, auditPayload],
    );
    const { rowCount: invoiceAudit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       SELECT $1,'invoice',i.id,'post',$2,$3::jsonb
       FROM invoices i JOIN journal_entries e ON e.id=i.linked_entry_id
       WHERE i.company_id=$1 AND i.source_type='bookie-old'
         AND e.company_id=$1 AND e.created_by='bookie-old-k2-import'
         AND e.document_date>='2020-01-01' AND e.document_date<'2026-01-01'`,
      [COMPANY_ID, ACTOR, auditPayload],
    );
    const { rowCount: periodAudit } = await client.query(
      `INSERT INTO audit_log(company_id,entity_type,entity_id,action,changed_by,payload)
       SELECT $1,'period',id,'lock',$2,$3::jsonb FROM accounting_periods
       WHERE company_id=$1 AND start_date>='2020-01-01' AND end_date<'2026-01-01'`,
      [COMPANY_ID, ACTOR, auditPayload],
    );
    ensure(entryAudit === TOTAL && invoiceAudit === LINKED_INVOICES && periodAudit === 6,
      "Revizijska sled ni popolna");
    const { rows: after } = await client.query(
      `SELECT
         (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND
            created_by='bookie-old-k2-import' AND document_date<'2026-01-01' AND status='posted') AS posted,
         (SELECT COUNT(*)::int FROM journal_entries WHERE company_id=$1 AND
            created_by='bookie-old-k2-import' AND document_date>='2026-01-01' AND status='draft') AS drafts_2026,
         (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1 AND source_type='bookie-old'
            AND invoice_date<'2026-01-01' AND status='posted') AS posted_invoices,
         (SELECT COUNT(*)::int FROM invoices WHERE company_id=$1 AND source_type='bookie-old'
            AND invoice_date<'2026-01-01' AND status='draft') AS draft_invoices,
         (SELECT COUNT(*)::int FROM accounting_periods WHERE company_id=$1
            AND start_date<'2026-01-01' AND status='locked') AS locked_periods`,
      [COMPANY_ID],
    );
    ensure(after[0].posted === TOTAL && after[0].drafts_2026 === 288
      && after[0].posted_invoices === LINKED_INVOICES && after[0].draft_invoices === 10
      && after[0].locked_periods === 6, "Zaključno preverjanje ni uspelo");
    if (simulate) {
      await client.query("ROLLBACK");
      console.log(`SIMULACIJA RAZVELJAVLJENA: ${JSON.stringify(after[0])}`);
    } else {
      await client.query("COMMIT");
      console.log(`POTRJENO: ${JSON.stringify(after[0])}`);
    }
  }
} catch (error) {
  await client.query("ROLLBACK");
  console.error(error);
  process.exitCode = 1;
} finally {
  await client.end();
}