import express from "express";
import supertest from "supertest";
import ExcelJS from "exceljs";
import { and, eq, inArray } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ userId: "ajpes-report-owner-test" }));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = authState.userId;
    req.log = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    next();
  },
}));

import {
  accountingPeriodsTable,
  accountingRolesTable,
  accountsTable,
  annualReportsTable,
  auditLogTable,
  companiesTable,
  db,
  journalEntriesTable,
  journalEntryLinesTable,
} from "@workspace/db";
import { AJPES_GD_AOP_CATALOG_2025 } from "../lib/ajpes/aopCatalog2025";
import router from "./ajpesAnnualReports";

const roles = {
  owner: "ajpes-report-owner-test",
  accountant: "ajpes-report-accountant-test",
  viewer: "ajpes-report-viewer-test",
};
const runId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const companyName = `Fiktivno podjetje letno poročilo ${runId}`;
const routePath = (id: string, year: number | string) =>
  `/companies/${id}/reports/ajpes/${year}`;
const app = express();
app.use(express.json());
app.use(router);

let companyId: string;
let foreignCompanyId: string;
let periodIds: Record<number, string> = {};
let foreignPeriodId: string;
let accountIds: Record<"bank" | "capital" | "revenue" | "expense", string>;
let foreignAccountId: string;
let foreignEntryId: string;
let closeEntryIds: Record<2024 | 2025, string>;
let reviewedReport: any;
let settings: any;
let expenseAop: string;
let revenueAop: string;
let bankAop: string;
let capitalAop: string;
let changedLineId: string;
let changedLineAmount: string;

function confirmedProfile(year: number) {
  return {
    legalForm: "doo",
    framework: "SRS",
    size: "small",
    periodStart: `${year}-01-01`,
    periodEnd: `${year}-12-31`,
    currentCriteria: { assets: "2866.75", revenue: "0.00", employees: "1" },
    previousCriteria: { assets: "10.00", revenue: "0.00", employees: "1" },
    sizeBasis: "Majhna družba potrjena po presoji meril za tekoče in predhodno poslovno leto.",
    previousYearException: "",
    microRegime: "no",
    auditRequired: "no",
    groupMember: "no",
    consolidationRequired: "no",
    simplifiedSubmission: "no",
    foreignOperations: "no",
    sfrRequired: "no",
    cppsRequired: "no",
    listed: "no",
    specialRegime: "no",
    confirmationBasis: "Dokumentacija za obe poslovni leti pregledana; računovodja izrecno potrjuje profil.",
    confirmed: true,
  };
}

function asOwner() {
  authState.userId = roles.owner;
}

function asAccountant() {
  authState.userId = roles.accountant;
}

function asViewer() {
  authState.userId = roles.viewer;
}

function insertEntry(
  targetCompanyId: string,
  periodId: string,
  date: string,
  reference: string,
  description: string,
  lines: Array<{ accountId: string; side: "debit" | "credit"; amount: string }>,
) {
  return db.transaction(async (tx) => {
    const [entry] = await tx.insert(journalEntriesTable).values({
      companyId: targetCompanyId,
      periodId,
      entryDate: date,
      documentDate: date,
      description,
      reference,
      status: "posted",
      postedAt: new Date(),
      createdBy: roles.owner,
      approvedBy: roles.owner,
    }).returning({ id: journalEntriesTable.id });
    await tx.insert(journalEntryLinesTable).values(lines.map((line, sequence) => ({
      entryId: entry!.id,
      accountId: line.accountId,
      side: line.side,
      amount: line.amount,
      sequence,
    })));
    return entry!.id;
  });
}

async function cleanupCompany(id: string | undefined) {
  if (!id) return;
  const entries = await db.select({ id: journalEntriesTable.id })
    .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, id));
  if (entries.length) {
    await db.delete(journalEntryLinesTable)
      .where(inArray(journalEntryLinesTable.entryId, entries.map((entry) => entry.id)));
    await db.delete(journalEntriesTable)
      .where(inArray(journalEntriesTable.id, entries.map((entry) => entry.id)));
  }
  await db.delete(annualReportsTable).where(eq(annualReportsTable.companyId, id));
  await db.delete(auditLogTable).where(eq(auditLogTable.companyId, id));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, id));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, id));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, id));
  await db.delete(companiesTable).where(eq(companiesTable.id, id));
}

function requestedManualValues(
  issues: Array<{ code: string; message: string }>,
  previousYear: number,
) {
  const currentValues: Record<string, string> = {};
  const previousValues: Record<string, string> = {};
  for (const issue of issues) {
    if (issue.code !== "confirmed_manual_value_required") continue;
    const aop = issue.message.match(/AOP (\d{3,4})/)?.[1];
    if (!aop) throw new Error(`Cannot identify required manual AOP: ${issue.message}`);
    const periodYear = issue.message.match(/v obdobju (\d{4})/)?.[1];
    const destination = Number(periodYear) === previousYear
      ? previousValues
      : currentValues;
    destination[aop] = "0";
  }
  return { currentValues, previousValues };
}

function binaryParser(
  response: supertest.Response,
  callback: (error: Error | null, body: any) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error: Error) => callback(error, null));
}

beforeAll(async () => {
  const numericSuffix = String(Math.floor(Math.random() * 90_000_000) + 10_000_000);
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI${numericSuffix}`,
    naziv: companyName,
    naslov: "Testna ulica 1",
    ulica: "Testna ulica 1",
    postnaStevika: "1000",
    kraj: "Ljubljana",
    maticnaStevilka: "1111111000",
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  await db.insert(accountingRolesTable).values([
    { companyId, clerkUserId: roles.owner, role: "owner" },
    { companyId, clerkUserId: roles.accountant, role: "accountant" },
    { companyId, clerkUserId: roles.viewer, role: "viewer" },
  ]);

  const [foreignCompany] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`,
    naziv: `Drugo fiktivno podjetje ${runId}`,
    maticnaStevilka: "2222222000",
  }).returning({ id: companiesTable.id });
  foreignCompanyId = foreignCompany!.id;

  const periods = await db.insert(accountingPeriodsTable).values(
    [2024, 2025, 2026].map((year) => ({
      companyId,
      name: `Fiktivno letno obdobje ${year} ${runId}`,
      startDate: `${year}-01-01`,
      endDate: `${year}-12-31`,
      status: "open" as const,
    })),
  ).returning({ id: accountingPeriodsTable.id, startDate: accountingPeriodsTable.startDate });
  periodIds = Object.fromEntries(periods.map((period) => [
    Number(period.startDate.slice(0, 4)), period.id,
  ])) as Record<number, string>;
  const [foreignPeriod] = await db.insert(accountingPeriodsTable).values({
    companyId: foreignCompanyId,
    name: `Tuji fiktivni period ${runId}`,
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  foreignPeriodId = foreignPeriod!.id;

  const accounts = await db.insert(accountsTable).values([
    { companyId, code: "1100000", name: "Testna banka", type: "asset", isCash: true },
    { companyId, code: "9000000", name: "Testni osnovni kapital", type: "equity" },
    { companyId, code: "7600000", name: "Testni prihodek za zapiranje IPI", type: "revenue" },
    { companyId, code: "4100000", name: "Testni odhodek za zapiranje IPI", type: "expense" },
  ]).returning({ id: accountsTable.id, code: accountsTable.code });
  accountIds = {
    bank: accounts.find((account) => account.code === "1100000")!.id,
    capital: accounts.find((account) => account.code === "9000000")!.id,
    revenue: accounts.find((account) => account.code === "7600000")!.id,
    expense: accounts.find((account) => account.code === "4100000")!.id,
  };
  const [foreignAccount] = await db.insert(accountsTable).values({
    companyId: foreignCompanyId,
    code: "1100000",
    name: "Tuji testni konto",
    type: "asset",
  }).returning({ id: accountsTable.id });
  foreignAccountId = foreignAccount!.id;

  const catalog = AJPES_GD_AOP_CATALOG_2025.aops;
  bankAop = catalog.find((row) => row.form === "BS" && !row.isAggregate && row.label === "Denarna sredstva")!.id;
  capitalAop = catalog.find((row) => row.form === "BS" && !row.isAggregate && row.label === "Osnovni kapital")!.id;
  revenueAop = catalog.find((row) =>
    row.form === "IPI" && !row.isAggregate && row.accountCodes === "del 76" && row.label === "DRUGI POSLOVNI PRIHODKI")!.id;
  expenseAop = catalog.find((row) =>
    row.form === "IPI" && !row.isAggregate && row.accountCodes === "del 41" && row.label === "drugi stroški storitev")!.id;

  // Fiscal opening snapshots plus exact posted transactions. 2025 opening is
  // zero, so the two specified 2025 postings yield exactly EUR 2,866.75.
  await insertEntry(companyId, periodIds[2024]!, "2024-01-01", "OTV-2024-01", "Začetno stanje 2024", [
    { accountId: accountIds.bank, side: "debit", amount: "10.00" },
    { accountId: accountIds.capital, side: "credit", amount: "10.00" },
  ]);
  const close2024 = await insertEntry(
    companyId, periodIds[2024]!, "2024-12-31", "ZAKL-IPI-2024-01",
    "Zaključek IPI 2024 (fiktivni testni vnos)", [
      { accountId: accountIds.expense, side: "debit", amount: "50.00" },
      { accountId: accountIds.revenue, side: "credit", amount: "50.00" },
    ],
  );
  closeEntryIds = { 2024: close2024, 2025: "" };
  await insertEntry(companyId, periodIds[2025]!, "2025-01-01", "OTV-2025-01", "Začetno stanje 2025", [
    { accountId: accountIds.bank, side: "debit", amount: "0.00" },
    { accountId: accountIds.capital, side: "credit", amount: "0.00" },
  ]);
  await insertEntry(companyId, periodIds[2025]!, "2025-03-10", "TEST-2025-BANK-IN", "Testna uravnotežena temeljnica 1", [
    { accountId: accountIds.bank, side: "debit", amount: "23948.52" },
    { accountId: accountIds.capital, side: "credit", amount: "23948.52" },
  ]);
  await insertEntry(companyId, periodIds[2025]!, "2025-11-20", "TEST-2025-BANK-OUT", "Testna uravnotežena temeljnica 2", [
    { accountId: accountIds.capital, side: "debit", amount: "21081.77" },
    { accountId: accountIds.bank, side: "credit", amount: "21081.77" },
  ]);
  closeEntryIds[2025] = await insertEntry(
    companyId, periodIds[2025]!, "2025-12-31", "ZAKL-IPI-2025-01",
    "Zaključek IPI 2025 (fiktivni testni vnos)", [
      { accountId: accountIds.expense, side: "debit", amount: "100.00" },
      { accountId: accountIds.revenue, side: "credit", amount: "100.00" },
    ],
  );
  await insertEntry(companyId, periodIds[2026]!, "2026-01-01", "OTV-2026-01", "Začetno stanje 2026", [
    { accountId: accountIds.bank, side: "debit", amount: "2866.75" },
    { accountId: accountIds.capital, side: "credit", amount: "2866.75" },
  ]);

  const [foreignEntry] = await db.insert(journalEntriesTable).values({
    companyId: foreignCompanyId,
    periodId: foreignPeriodId,
    entryDate: "2025-12-31",
    description: "Tuja fiktivna zaključna temeljnica",
    reference: "ZAKL-IPI-2025-FOREIGN",
    status: "posted",
    createdBy: roles.owner,
  }).returning({ id: journalEntriesTable.id });
  foreignEntryId = foreignEntry!.id;
  await db.insert(journalEntryLinesTable).values([
    { entryId: foreignEntryId, accountId: foreignAccountId, side: "debit", amount: "1.00" },
    { entryId: foreignEntryId, accountId: foreignAccountId, side: "credit", amount: "1.00" },
  ]);
});

afterAll(async () => {
  await cleanupCompany(companyId);
  await cleanupCompany(foreignCompanyId);
});

describe.sequential("AJPES annual reports routes and JOLP export", () => {
  it("rejects invalid years, foreign IDs and malformed amounts without saving a draft", async () => {
    asOwner();
    await supertest(app).get(routePath(companyId, "2025.5")).expect(400);
    await supertest(app).get(routePath(companyId, 1999)).expect(400);

    const initial = await supertest(app).get(routePath(companyId, 2025)).expect(200);
    expect(initial.body.balanceSheet).toHaveLength(46);
    expect(initial.body.incomeStatement).toHaveLength(43);
    expect(initial.body.journals.map((journal: any) => journal.id))
      .toEqual(expect.arrayContaining([closeEntryIds[2024], closeEntryIds[2025]]));

    const manualValues = requestedManualValues(initial.body.issues, 2024);
    settings = {
      mappings: {
        [accountIds.bank]: bankAop,
        [accountIds.capital]: capitalAop,
        [accountIds.revenue]: revenueAop,
        [accountIds.expense]: expenseAop,
      },
      mappingReasons: {},
      ...manualValues,
      excludedEntryIds: [closeEntryIds[2024], closeEntryIds[2025]],
      metadata: {
        previousDataMode: "ledger",
        accountablePerson: "Testna odgovorna oseba",
        phone: "+38610000000",
        contactEmail: "test@example.invalid",
        portalEmail: "test@example.invalid",
        manager: "Testni direktor",
      },
      profile: confirmedProfile(2025),
    };
    const body = { revision: 0, settings, reviewedFingerprint: null };

    await supertest(app).put(routePath(companyId, 2025))
      .send({ ...body, settings: { ...settings, excludedEntryIds: [...settings.excludedEntryIds, foreignEntryId] } })
      .expect(400);
    await supertest(app).put(routePath(companyId, 2025))
      .send({ ...body, settings: { ...settings, mappings: { ...settings.mappings, [foreignAccountId]: bankAop } } })
      .expect(400);
    await supertest(app).put(routePath(companyId, 2025))
      .send({ ...body, settings: { ...settings, currentValues: { ...settings.currentValues, "005": "1.001" } } })
      .expect(400);
    await supertest(app).put(routePath(companyId, 2025))
      .send({
        ...body,
        settings: { ...settings, profile: { ...confirmedProfile(2025), legalForm: "company" } },
      })
      .expect(400);
    const noDraft = await db.select({ id: annualReportsTable.id })
      .from(annualReportsTable).where(and(
        eq(annualReportsTable.companyId, companyId),
        eq(annualReportsTable.year, 2025),
      ));
    expect(noDraft).toHaveLength(0);
    await supertest(app).get(routePath(foreignCompanyId, 2025)).expect(403);
  });

  it("handles concurrent revision writes, reviews the source fingerprint and exports JOLP XLSX/PDF and official XML", async () => {
    asOwner();
    const payload = { revision: 0, settings, reviewedFingerprint: null };
    const initialWrites = await Promise.all([
      supertest(app).put(routePath(companyId, 2025)).send(payload),
      supertest(app).put(routePath(companyId, 2025)).send(payload),
    ]);
    expect(initialWrites.map((response) => response.status).sort()).toEqual([200, 409]);
    const saved = initialWrites.find((response) => response.status === 200)!;
    expect(saved.body.revision).toBe(1);
    const staleWrites = await Promise.all([
      supertest(app).put(routePath(companyId, 2025)).send(payload),
      supertest(app).put(routePath(companyId, 2025)).send(payload),
    ]);
    expect(staleWrites.map((response) => response.status)).toEqual([409, 409]);
    const [persisted] = await db.select({
      revision: annualReportsTable.revision,
      settings: annualReportsTable.settings,
    }).from(annualReportsTable).where(and(
      eq(annualReportsTable.companyId, companyId),
      eq(annualReportsTable.year, 2025),
    ));
    expect(persisted).toMatchObject({ revision: 1, settings });
    expect(saved.body.settings).toMatchObject(settings);
    expect(saved.body.aopRows).toHaveLength(263);
    expect(saved.body.aopRows.find((row: any) => row.code === bankAop)).toMatchObject({
      current: "2866.75",
      previous: "10.00",
    });
    expect(saved.body.aopRows.find((row: any) => row.code === capitalAop)).toMatchObject({
      current: "2866.75",
      previous: "10.00",
    });
    expect(saved.body.aopRows.find((row: any) => row.code === revenueAop)).toMatchObject({
      current: "0.00",
      previous: "0.00",
    });
    expect(saved.body.aopRows.find((row: any) => row.code === expenseAop)).toMatchObject({
      current: "0.00",
      previous: "0.00",
    });
    expect(saved.body.issues.filter((issue: any) => issue.blocking)).toEqual([]);

    const confirmed = await supertest(app).put(routePath(companyId, 2025)).send({
      revision: 1,
      settings,
      reviewedFingerprint: saved.body.sourceFingerprint,
    }).expect(200);
    expect(confirmed.body).toMatchObject({ revision: 2, reviewed: true, canExport: true, canExportXml: true });
    expect(confirmed.body.settings.excludedEntryIds).toEqual([closeEntryIds[2024], closeEntryIds[2025]]);
    reviewedReport = confirmed.body;

    asAccountant();
    await supertest(app).put(routePath(companyId, 2025)).send(payload).expect(409);
    asViewer();
    await supertest(app).get(routePath(companyId, 2025)).expect(200);

    const xlsx = await supertest(app).post(`${routePath(companyId, 2025)}/export`)
      .buffer().parse(binaryParser).send({
        format: "xlsx",
        sourceFingerprint: reviewedReport.sourceFingerprint,
      }).expect(200);
    expect(xlsx.headers["content-type"]).toContain("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    expect(xlsx.headers["content-disposition"]).toContain('filename="ajpes-2025-numeric-preview.xlsx"');
    expect(xlsx.headers["x-ajpes-export-notice"]).toContain("not a complete annual report");
    const workbook = new ExcelJS.Workbook();
    const xlsxBytes = Uint8Array.from(xlsx.body as Buffer);
    await workbook.xlsx.load(xlsxBytes.buffer as ArrayBuffer);
    expect(workbook.worksheets.map((sheet) => sheet.name))
      .toEqual(["Bilanca stanja", "Izkaz poslovnega izida"]);
    const balanceSheet = workbook.getWorksheet("Bilanca stanja")!;
    const cashRow = Array.from({ length: balanceSheet.rowCount }, (_, index) => index + 1)
      .find((row) => String(balanceSheet.getCell(row, 1).value).endsWith("Denarna sredstva"));
    expect(cashRow).toBeDefined();
    expect(balanceSheet.getCell(cashRow!, 2).value).toBe(2866.75);
    expect(balanceSheet.getCell(cashRow!, 3).value).toBe(10);

    const pdf = await supertest(app).post(`${routePath(companyId, 2025)}/export`)
      .buffer().parse(binaryParser).send({
        format: "pdf",
        sourceFingerprint: reviewedReport.sourceFingerprint,
      }).expect(200);
    expect(pdf.headers["content-type"]).toContain("application/pdf");
    expect(pdf.headers["content-disposition"]).toContain('filename="ajpes-2025-numeric-preview.pdf"');
    expect(pdf.headers["x-ajpes-export-notice"]).toContain("not a complete annual report");
    expect((pdf.body as Buffer).subarray(0, 5).toString()).toBe("%PDF-");

    const xml = await supertest(app).post(`${routePath(companyId, 2025)}/export`)
      .buffer().parse(binaryParser).send({
        format: "xml",
        sourceFingerprint: reviewedReport.sourceFingerprint,
      }).expect(200);
    expect(xml.headers["content-type"]).toContain("application/xml");
    expect(xml.headers["content-disposition"]).toContain('filename="ajpes-2025.xml"');
    const xmlText = (xml.body as Buffer).toString("utf8");
    expect(xmlText).toContain("<OSN_Maticna_stevilka>1111111000</OSN_Maticna_stevilka>");
    expect(xmlText).toContain("<OSN_Racunovodimo>2</OSN_Racunovodimo>");
    expect(xmlText).toContain("<OSN_Velikost>3</OSN_Velikost>");
    const exportedAops = [...xmlText.matchAll(/<AOP ID="(\d+)">/g)].map((match) => match[1]);
    expect(exportedAops).toEqual(AJPES_GD_AOP_CATALOG_2025.aops.map((row) => row.id));
    expect(xmlText).toContain(`<AOP ID="${bankAop}"><PODATEK TIP="T">2866.75</PODATEK><PODATEK TIP="P">10.00</PODATEK></AOP>`);

    // Another fake fiscal year has a confirmed draft: XLSX/PDF remain supported,
    // while the route must not claim the official XML has been verified for it.
    asOwner();
    const nextYear = await supertest(app).get(routePath(companyId, 2026)).expect(200);
    const nextYearSettings = {
      ...settings,
      excludedEntryIds: [closeEntryIds[2025]],
      ...requestedManualValues(nextYear.body.issues, 2025),
      profile: confirmedProfile(2026),
    };
    const nextSaved = await supertest(app).put(routePath(companyId, 2026)).send({
      revision: 0,
      settings: nextYearSettings,
      reviewedFingerprint: null,
    }).expect(200);
    const nextConfirmed = await supertest(app).put(routePath(companyId, 2026)).send({
      revision: 1,
      settings: nextYearSettings,
      reviewedFingerprint: nextSaved.body.sourceFingerprint,
    }).expect(200);
    expect(nextConfirmed.body.canExport).toBe(true);
    expect(nextConfirmed.body.canExportXml).toBe(false);
    for (const format of ["xlsx", "pdf"] as const) {
      const response = await supertest(app).post(`${routePath(companyId, 2026)}/export`)
        .buffer().parse(binaryParser).send({
          format,
          sourceFingerprint: nextConfirmed.body.sourceFingerprint,
        }).expect(200);
      expect(response.headers["content-disposition"]).toContain(`filename="ajpes-2026-numeric-preview.${format}"`);
    }
    await supertest(app).post(`${routePath(companyId, 2026)}/export`)
      .send({ format: "xml", sourceFingerprint: nextConfirmed.body.sourceFingerprint }).expect(400);
  });

  it("rejects stale exports when only a fixture journal line changes after review", async () => {
    asOwner();
    const [line] = await db.select({
      id: journalEntryLinesTable.id,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable)
      .innerJoin(journalEntriesTable, eq(journalEntriesTable.id, journalEntryLinesTable.entryId))
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, "TEST-2025-BANK-IN"),
        eq(journalEntryLinesTable.accountId, accountIds.bank),
      ));
    changedLineId = line!.id;
    changedLineAmount = line!.amount;
    await db.update(journalEntryLinesTable).set({ amount: "23948.53" })
      .where(eq(journalEntryLinesTable.id, changedLineId));

    const fresh = await supertest(app).get(routePath(companyId, 2025)).expect(200);
    expect(fresh.body.canExport).toBe(false);
    expect(fresh.body.reviewed).toBe(false);
    await supertest(app).post(`${routePath(companyId, 2025)}/export`).send({
      format: "xlsx",
      sourceFingerprint: reviewedReport.sourceFingerprint,
    }).expect(409);
    await db.update(journalEntryLinesTable).set({ amount: changedLineAmount })
      .where(eq(journalEntryLinesTable.id, changedLineId));
    changedLineId = "";
  });
});