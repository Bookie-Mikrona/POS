import { createHash } from "node:crypto";
import { and, eq, gte, lte, or, sql } from "drizzle-orm";
import {
  accountsTable, annualReportsTable, companiesTable, db,
  journalEntriesTable, journalEntryLinesTable,
} from "@workspace/db";
import { SaveAjpesAnnualReportBody } from "@workspace/api-zod";
import { buildAjpesAnnualReport, type AjpesSource } from "./annual-model";

type Reader = Pick<typeof db, "select">;
export class AjpesReportError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

export const emptyAjpesSettings = () => ({
  mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {},
  excludedEntryIds: [] as string[], metadata: {} as Record<string, string>,
});

/** Consistent, tenant-scoped source snapshot. Call inside a repeatable-read transaction. */
export async function loadAjpesSource(
  reader: Reader, companyId: string, year: number,
  override?: { settings: AjpesSource["settings"]; revision: number; reviewedFingerprint?: string | null },
): Promise<AjpesSource> {
  const [company] = await reader.select({
    name: companiesTable.naziv, street: companiesTable.ulica, address: companiesTable.naslov,
    postalCode: companiesTable.postnaStevika, city: companiesTable.kraj,
    registrationNumber: companiesTable.maticnaStevilka, taxNumber: companiesTable.podjetjeDavcna,
  }).from(companiesTable).where(eq(companiesTable.id, companyId));
  if (!company) throw new AjpesReportError(404, "Podjetje ne obstaja.");
  const [draft] = await reader.select().from(annualReportsTable)
    .where(and(eq(annualReportsTable.companyId, companyId), eq(annualReportsTable.year, year)));
  // Never silently discard a damaged saved draft.
  const settings = override?.settings ?? (draft
    ? SaveAjpesAnnualReportBody.shape.settings.parse(draft.settings)
    : emptyAjpesSettings());
  const firstDay = `${year - 1}-01-01`;
  const lastDay = `${year}-12-31`;
  const posted = or(eq(journalEntriesTable.status, "posted"), eq(journalEntriesTable.status, "reversed"))!;
  const headers = await reader.select({
    id: journalEntriesTable.id, number: journalEntriesTable.reference,
    date: journalEntriesTable.entryDate, reference: journalEntriesTable.reference,
    description: journalEntriesTable.description, status: journalEntriesTable.status,
    updatedAt: journalEntriesTable.updatedAt,
  }).from(journalEntriesTable).where(and(
    eq(journalEntriesTable.companyId, companyId), posted,
    gte(journalEntriesTable.entryDate, firstDay), lte(journalEntriesTable.entryDate, lastDay),
  )).orderBy(journalEntriesTable.entryDate, journalEntriesTable.id);
  const [olderOpening] = await reader.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId), posted,
      sql`${journalEntriesTable.entryDate} < ${firstDay}`,
      or(sql`${journalEntriesTable.reference} LIKE 'BOOKIE-OLD/K2/%/00/%'`,
        sql`${journalEntriesTable.reference} LIKE 'OTV-%-01'`),
    )).limit(1);

  const warnings: string[] = [];
  const openingIds: string[] = [];
  const starts = new Map<number, string | null>();
  for (const y of [year - 1, year]) {
    const openings = headers.filter(h => h.date.startsWith(`${y}-`) && (
      h.reference?.startsWith(`BOOKIE-OLD/K2/${y}/00/`) || h.reference === `OTV-${y}-01`
    ));
    openingIds.push(...openings.map(h => h.id));
    const earlierKnownOpening = !!olderOpening || headers.some(h =>
      h.date < `${y}-01-01` && (
        /^BOOKIE-OLD\/K2\/\d{4}\/00\//.test(h.reference ?? "") ||
        /^OTV-\d{4}-01$/.test(h.reference ?? "")
      ));
    const usesLedgerYear = y === year || settings.metadata.previousDataMode !== "manual";
    if (usesLedgerYear && openings.length > 1) warnings.push(`Za leto ${y} obstaja več knjiženih otvoritev.`);
    if (usesLedgerYear && !openings.length && earlierKnownOpening) {
      warnings.push(`Manjka potrjena otvoritev za leto ${y}; zgodovinskih let ni dovoljeno sešteti.`);
    }
    starts.set(y, openings.length || earlierKnownOpening ? `${y}-01-01` : null);
  }
  const headerIds = new Set(headers.map(h => h.id));
  if (settings.excludedEntryIds.some(id => !headerIds.has(id))) {
    throw new AjpesReportError(400, "Izločena temeljnica ne pripada temu podjetju in izbranima letoma.");
  }
  const excluded = [...new Set([...openingIds, ...settings.excludedEntryIds])];
  const notExcluded = excluded.length
    ? sql`${journalEntriesTable.id} NOT IN (${sql.join(excluded.map(id => sql`${id}::uuid`), sql`, `)})`
    : sql`true`;
  const signed = sql`CASE WHEN ${journalEntryLinesTable.side} = 'debit'
    THEN ${journalEntryLinesTable.amount}::numeric ELSE -${journalEntryLinesTable.amount}::numeric END`;
  const balanceFor = (y: number) => {
    const start = starts.get(y);
    return sql<string>`COALESCE(SUM(CASE WHEN ${journalEntriesTable.entryDate} <= ${`${y}-12-31`}
      AND ${start ? sql`${journalEntriesTable.entryDate} >= ${start}` : sql`true`}
      THEN ${signed} ELSE 0 END), 0)::text`;
  };
  const turnoverFor = (y: number) => sql<string>`COALESCE(SUM(CASE WHEN
    ${journalEntriesTable.entryDate} >= ${`${y}-01-01`} AND ${journalEntriesTable.entryDate} <= ${`${y}-12-31`}
    AND ${notExcluded} THEN ${signed} ELSE 0 END), 0)::text`;
  const rows = await reader.select({
    accountId: accountsTable.id, code: accountsTable.code, name: accountsTable.name,
    currentBalance: balanceFor(year), previousBalance: balanceFor(year - 1),
    currentTurnover: turnoverFor(year), previousTurnover: turnoverFor(year - 1),
  }).from(journalEntryLinesTable)
    .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
    .innerJoin(accountsTable, eq(accountsTable.id, journalEntryLinesTable.accountId))
    .where(and(eq(journalEntriesTable.companyId, companyId), eq(accountsTable.companyId, companyId),
      posted, lte(journalEntriesTable.entryDate, lastDay)))
    .groupBy(accountsTable.id, accountsTable.code, accountsTable.name)
    .orderBy(accountsTable.code);
  const accountIds = new Set(rows.map(r => r.accountId));
  const mappingAccountId = (key: string) => key.replace(/^(?:balance|turnover):/, "");
  if (Object.keys(settings.mappings).some(key => !accountIds.has(mappingAccountId(key)))) {
    throw new AjpesReportError(400, "Preslikava vsebuje konto brez knjižb v tem podjetju do izbranega leta.");
  }
  const relevant = rows.filter(r => [r.accountId, `balance:${r.accountId}`, `turnover:${r.accountId}`]
    .some(key => Object.hasOwn(settings.mappings, key)) ||
    [r.currentBalance, r.previousBalance, r.currentTurnover, r.previousTurnover].some(v => Number(v) !== 0));
  // Bind approval to source entries, not just a coincidentally unchanged total.
  const sourceVersion = createHash("sha256").update(JSON.stringify(headers)).digest("hex");
  return {
    year,
    company: {
      name: company.name, street: company.street ?? company.address ?? "",
      postalCode: company.postalCode ?? "", city: company.city ?? "",
      registrationNumber: company.registrationNumber ?? "", taxNumber: company.taxNumber.replace(/^SI/i, ""),
    },
    accounts: relevant,
    journals: headers.filter(h => !openingIds.includes(h.id)).map(h => ({
      id: h.id, number: h.number ?? h.id, date: h.date, reference: h.reference ?? "", description: h.description,
    })),
    settings,
    revision: override?.revision ?? draft?.revision ?? 0,
    reviewedFingerprint: override ? override.reviewedFingerprint ?? null : draft?.reviewedFingerprint ?? null,
    sourceWarnings: warnings,
    hasCurrent: headers.some(h => h.date.startsWith(`${year}-`)),
    hasPrevious: headers.some(h => h.date.startsWith(`${year - 1}-`)),
    sourceVersion,
  };
}

export async function loadAjpesAnnualReport(reader: Reader, companyId: string, year: number) {
  return buildAjpesAnnualReport(await loadAjpesSource(reader, companyId, year));
}