/**
 * Original Bookie Old GLAVNA/ZAPIRANJE provenance for Mikrona native GL lines.
 * Dry-run by default; --commit appends evidence metadata only.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import pg from "pg";

const COMPANY_ID = "80acfaf9-fd18-4e0a-8f03-bffbb2558893";
const PARTNER_ID = "e6e49e1e-21df-414a-b3f9-769357e97d6b";
const ACCOUNT_ID = "33089a8c-d55b-4db9-88f5-a3c6fa5d0030";
const exportScript = fileURLToPath(new URL("../../../scripts/bookie_old_native_ledger_evidence_export.py", import.meta.url));
const source = JSON.parse(execFileSync("python3", [exportScript], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8"));
const commit = process.argv.includes("--commit");
if (!process.env.DATABASE_URL || process.env.REPLIT_DEPLOYMENT ||
    !process.env.REPLIT_DEV_DOMAIN || !process.env.PGHOST ||
    new URL(process.env.DATABASE_URL).hostname !== process.env.PGHOST) {
  throw new Error("Dovoljena je samo razvojna baza");
}
if (source.companyOld !== "000001" || source.years !== "2020-2025" || !/^[0-9a-f]{64}$/.test(source.sourceDigest)) {
  throw new Error("Izvorni obseg, podjetje ali SHA-256 dokazila ni veljaven");
}

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
const client = await pool.connect();
const canonical = (value) => JSON.stringify(value, (_key, nested) =>
  nested && !Array.isArray(nested) && typeof nested === "object"
    ? Object.fromEntries(Object.entries(nested).sort(([left], [right]) => left.localeCompare(right)))
    : nested);
const amount = (value) => Number(value).toFixed(2);
const sourceLineId = (description) => description?.match(/\[Bookie Old GLAVNA #(\d+)/)?.[1] ?? null;
const sourceAccountCode = (description) => description?.match(/konto ([^,\]]+)/)?.[1]?.trim() ?? null;
const sourcePartnerCode = (description) =>
  description?.match(/(?:nerazrešen )?partner ([A-Za-z0-9_-]+)/)?.[1] ?? null;
const nativeReference = /^BOOKIE-OLD\/K2\/(2020|2021|2022|2023|2024|2025)\/([^/]+)\/(.+)$/;
const sameDate = (actual, expected) => actual == null ? expected == null : String(actual).slice(0, 10) === expected;

try {
  await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
  await client.query("SET LOCAL statement_timeout = '180s'");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('bookie-old-mikrona-native-ledger-evidence'))");
  const { rows: companies } = await client.query("SELECT naziv FROM companies WHERE id=$1", [COMPANY_ID]);
  if (companies.length !== 1 || !/mikrona/i.test(companies[0].naziv)) throw new Error("Napačno podjetje");
  const { rows: tableCheck } = await client.query(
    "SELECT to_regclass('public.bookie_old_native_ledger_evidence') IS NOT NULL AS present",
  );
  if (!tableCheck[0].present) throw new Error("Ciljna tabela manjka; pred uvozom uporabite migracijo 247");

  const { rows: nativeLines } = await client.query(
    `SELECT l.id AS native_line_id,l.side,l.amount::numeric(18,2)::text AS amount,
        l.partner_id,l.description,j.id AS entry_id,j.reference,j.status,
        j.document_date::text AS document_date,j.entry_date::text AS entry_date,j.tax_date::text AS tax_date,
        substring(l.description from 'GLAVNA #([0-9]+)') AS source_line_id
     FROM journal_entry_lines l
     JOIN journal_entries j ON j.id=l.entry_id
     WHERE j.company_id=$1
       AND j.reference ~ '^BOOKIE-OLD/K2/(2020|2021|2022|2023|2024|2025)/'
       AND j.status='posted'
       AND l.description ~ '\\[Bookie Old GLAVNA #[0-9]+'
     ORDER BY l.id`,
    [COMPANY_ID],
  );
  const { rows: nonPosted } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
     WHERE j.company_id=$1
       AND j.reference ~ '^BOOKIE-OLD/K2/(2020|2021|2022|2023|2024|2025)/'
       AND j.status<>'posted' AND l.description ~ '\\[Bookie Old GLAVNA #[0-9]+'`,
    [COMPANY_ID],
  );
  if (nonPosted[0].count !== 0) throw new Error(`V 2020–2025 je ${nonPosted[0].count} neknjiženih ali storniranih GL vrstic`);
  if (nativeLines.length !== source.nativeLines.length) {
    throw new Error(`Obseg se ne ujema: izvor=${source.nativeLines.length}, knjiženo=${nativeLines.length}`);
  }
  const bySource = new Map();
  const originalForLine = (id, side, lineAmount) => source.nativeLines.find((item) =>
    item.sourceLineId === id && item.side === side && item.amount === amount(lineAmount));
  for (const line of nativeLines) {
    const id = sourceLineId(line.description);
    if (!id || id !== line.source_line_id) throw new Error(`Manjka izvorna GLAVNA identiteta na vrstici ${line.native_line_id}`);
    const original = originalForLine(id, line.side, line.amount);
    if (!original) throw new Error(`Knjižena izvorna vrstica ${id} manjka v GLAVNA`);
    const reference = nativeReference.exec(line.reference);
    if (!reference || reference[1] !== original.year || reference[2] !== original.type || reference[3] !== original.voucherNumber) {
      throw new Error(`Številka/vrsta/leto knjižbe se ne ujema z GLAVNA: ${id}`);
    }
    if (line.side !== original.side || amount(line.amount) !== original.amount ||
        sourceAccountCode(line.description) !== original.accountCode ||
        !sameDate(line.document_date, original.documentDate) ||
        !sameDate(line.entry_date, original.postingDate) ||
        !sameDate(line.tax_date, original.taxDate)) {
      throw new Error(`Stran, znesek, konto ali datum knjižbe se ne ujema z GLAVNA: ${id}`);
    }
    const partnerCode = sourcePartnerCode(line.description);
    if ((original.partnerCode ?? null) !== (partnerCode ?? null)) {
      throw new Error(`Šifra partnerja se ne ujema z GLAVNA: ${id}`);
    }
    if (original.partnerCode && !line.partner_id && !line.description.includes(`nerazrešen partner ${original.partnerCode}`)) {
      throw new Error(`Izvorni partner ni povezan s knjiženo vrstico: ${id}`);
    }
    if (!original.partnerCode && line.partner_id) throw new Error(`Nepričakovan knjiženi partner na vrstici ${id}`);
    bySource.set(id, [...(bySource.get(id) ?? []), line]);
  }
  for (const original of source.nativeLines) {
    const matches = (bySource.get(original.sourceLineId) ?? []).filter((line) =>
      line.side === original.side && amount(line.amount) === original.amount);
    const expectedMatches = source.nativeLines.filter((item) =>
      item.sourceLineId === original.sourceLineId && item.side === original.side && item.amount === original.amount);
    if (matches.length !== expectedMatches.length) {
      throw new Error(`Število knjiženih native GL vrstic se ne ujema za ${original.sourceLineId}/${original.side}`);
    }
  }
  const nativeSourceIds = new Set(bySource.keys());
  let nativeCounterparts = 0;
  let unimportedHistoricalCounterparts = 0;
  const allSourceProofs = new Map(source.closings.flatMap((closing) => [
    [closing.sourceLineId, closing.sourceProof],
    [closing.otherSourceLineId, closing.counterpartProof],
  ]));
  for (const closing of source.closings) {
    const sourceProof = allSourceProofs.get(closing.sourceLineId);
    const counterpartProof = allSourceProofs.get(closing.otherSourceLineId);
    if (!sourceProof || !counterpartProof) throw new Error(`Manjka izvorni endpoint dokaz zapiranja ${closing.closingId}`);
    if (["2020", "2021", "2022", "2023", "2024", "2025"].includes(sourceProof.year) &&
        sourceProof.ledgerCode === "K2" && !nativeSourceIds.has(closing.sourceLineId)) {
      throw new Error(`Uvoženi izvorni ID ${closing.sourceLineId} nima knjižene native vrstice`);
    }
    if (nativeSourceIds.has(closing.sourceLineId)) nativeCounterparts++;
    if (nativeSourceIds.has(closing.otherSourceLineId)) nativeCounterparts++;
    else if (["2020", "2021", "2022", "2023", "2024", "2025"].includes(counterpartProof.year)
      && counterpartProof.ledgerCode === "K2") {
      throw new Error(`Uvoženi counterpart ${closing.otherSourceLineId} nima ujemajoče knjižene native vrstice`);
    } else unimportedHistoricalCounterparts++;
  }

  const records = nativeLines.map((line) => {
    const original = originalForLine(line.source_line_id, line.side, line.amount);
    if (!original) throw new Error(`Manjka izvorni dokaz vrstice ${line.source_line_id}/${line.side}`);
    return {
      company_id: COMPANY_ID,
      native_line_id: line.native_line_id,
      source_line_id: line.source_line_id,
      dur_date: original.durDate,
      original_document_number: original.documentNumber,
      original_gl_metadata: original,
      original_closings: source.byNativeSourceLine[line.source_line_id] ?? [],
      source_digest: source.sourceDigest,
    };
  });
  if (records.length !== source.nativeLines.length ||
      new Set(records.map((record) => record.native_line_id)).size !== records.length ||
      records.some((record) => !record.source_line_id || !record.source_digest)) {
    throw new Error("Nepričakovan obseg ali podvojena native evidenca");
  }

  const { rows: partnerCardScope } = await client.query(
    `SELECT COUNT(*)::int AS count
     FROM journal_entry_lines l JOIN journal_entries j ON j.id=l.entry_id
     WHERE j.company_id=$1 AND j.status='posted' AND l.partner_id=$2 AND l.account_id=$3
       AND COALESCE(j.document_date,j.entry_date)<='2025-12-31'
       AND j.reference ~ '^BOOKIE-OLD/K2/(2020|2021|2022|2023|2024|2025)/'
       AND j.reference !~ '/00/'`,
    [COMPANY_ID, PARTNER_ID, ACCOUNT_ID],
  );
  if (partnerCardScope[0].count !== 136) {
    throw new Error(`Pričakovanih 136 izvornih native vrstic ciljne kartice, najdeno ${partnerCardScope[0].count}`);
  }

  const { rows: prior } = await client.query(
    `SELECT native_line_id,source_line_id,dur_date::text,original_document_number,
        original_gl_metadata,original_closings,source_digest
     FROM bookie_old_native_ledger_evidence WHERE company_id=$1`,
    [COMPANY_ID],
  );
  if (prior.length && prior.length !== records.length) throw new Error(`Delni uvoz; ročni pregled pred ponovitvijo (${prior.length}/${records.length})`);
  if (prior.length) {
    const existing = new Map(prior.map((row) => [row.native_line_id, row]));
    for (const record of records) {
      const row = existing.get(record.native_line_id);
      if (!row || row.source_line_id !== record.source_line_id ||
          row.dur_date !== record.dur_date ||
          row.original_document_number !== record.original_document_number ||
          row.source_digest !== record.source_digest ||
          canonical(row.original_gl_metadata) !== canonical(record.original_gl_metadata) ||
          canonical(row.original_closings) !== canonical(record.original_closings)) {
        throw new Error(`Predhodno uvoženi izvorni dokaz se je spremenil: ${record.source_line_id}`);
      }
    }
  } else if (commit) {
    for (let index = 0; index < records.length; index += 250) {
      await client.query(
        `INSERT INTO bookie_old_native_ledger_evidence
           (company_id,native_line_id,source_line_id,dur_date,original_document_number,
            original_gl_metadata,original_closings,source_digest)
         SELECT r.company_id,r.native_line_id,r.source_line_id,r.dur_date,r.original_document_number,
                r.original_gl_metadata,r.original_closings,r.source_digest
         FROM jsonb_to_recordset($1::jsonb) AS r(
           company_id uuid,native_line_id uuid,source_line_id text,dur_date date,
           original_document_number text,original_gl_metadata jsonb,original_closings jsonb,source_digest text
         )`,
        [JSON.stringify(records.slice(index, index + 250))],
      );
    }
  }

  const { rows: check } = await client.query(
    `SELECT COUNT(*)::int AS count,COUNT(DISTINCT source_line_id)::int AS source_lines,
       COUNT(*) FILTER (WHERE jsonb_array_length(original_closings)>0)::int AS lines_with_closings,
       COALESCE(SUM(jsonb_array_length(original_closings)),0)::int AS anchored_closings,
       COUNT(DISTINCT source_digest)::int AS digests
     FROM bookie_old_native_ledger_evidence WHERE company_id=$1`,
    [COMPANY_ID],
  );
  const sourceLineCount = new Set(source.nativeLines.map((item) => item.sourceLineId)).size;
  if (commit && !prior.length && (check[0].count !== records.length || check[0].source_lines !== sourceLineCount ||
      check[0].digests !== 1 || check[0].anchored_closings !== records.reduce((sum, row) => sum + row.original_closings.length, 0))) {
    throw new Error("Kontrola dokazov po uvozu ni uspela");
  }
  process.stdout.write(JSON.stringify({
    mode: commit ? "commit" : "dry-run",
    company: companies[0].naziv,
    years: source.years,
    sourceDigest: source.sourceDigest,
    originalNativeLines: source.nativeLines.length,
    originalGlSourceIds: sourceLineCount,
    postedNativeLinesMatched: nativeLines.length,
    targetCardNonOpeningLinesMatched: partnerCardScope[0].count,
    originalZapClosings: source.closings.length,
    omittedZeroAmountZapRows: source.zeroClosings,
    omittedNegativeAmountZapRows: source.negativeClosings,
    nativeClosingEndpoints: nativeCounterparts,
    verifiedHistoricalCounterpartEndpoints: unimportedHistoricalCounterparts,
    nativeLinesWithClosings: records.filter((record) => record.original_closings.length > 0).length,
    anchoredOriginalClosings: records.reduce((sum, record) => sum + record.original_closings.length, 0),
    previousRows: prior.length,
    tableRowsAfter: commit ? check[0].count : prior.length,
  }) + "\n");
  await client.query(commit ? "COMMIT" : "ROLLBACK");
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}