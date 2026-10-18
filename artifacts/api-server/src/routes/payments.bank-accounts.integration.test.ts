import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const USER = "TEST-bank-per-line-account";
const isolation = vi.hoisted(() => ({ root: null as any, tx: null as any }));
vi.mock("@workspace/db", async () => {
  const actual = await vi.importActual<any>("@workspace/db");
  isolation.root = actual.db;
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(_target, key) {
        const executor = isolation.tx ?? actual.db;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = USER; next(); },
}));
import express from "express";
import request from "supertest";
import { and, eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, invoicesTable, invoiceLinesTable,
  journalEntriesTable, journalEntryLinesTable, bankStatementsTable, bankStatementLinesTable,
  bankAccountMetadataTable, paymentBatchItemsTable, paymentsTable, paymentBatchesTable,
  paymentAllocationsTable,
  costCentersTable, projectsTable,
} from "@workspace/db";
import router from "./payments";
import journalsRouter from "./journalEntries";
import partnerLedgerRouter from "./partnerLedger";
import bankStatementsRouter from "./bankStatements";

const app = express();
app.use(express.json(), router, journalsRouter, partnerLedgerRouter, bankStatementsRouter);
app.use((err: any, _req: any, res: any, _next: any) => res.status(err.statusCode ?? 500).json({ error: err.message }));
let companyId: string, periodId: string, partnerId: string, bankId: string, statementId: string;
let wageId: string, vatId: string, feeId: string, supplierId: string, disabledId: string, groupId: string, dimensionId: string, invoiceId: string;
let seq = 0;
let finish!: () => void;
let transactionFinished: Promise<void>;
const rollback = new Error("TEST transaction rollback");

beforeAll(async () => {
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  transactionFinished = isolation.root.transaction(async (tx: any) => {
    isolation.tx = tx;
    ready();
    await new Promise<void>(resolve => { finish = resolve; });
    throw rollback;
  }).catch((error: unknown) => { if (error !== rollback) throw error; });
  await started;
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_BANK_ACCOUNTS_${Date.now()}`, naziv: "TEST bank per-line accounting",
  }).returning();
  companyId = company.id;
  await db.insert(accountingRolesTable).values({ companyId, clerkUserId: USER, role: "owner" });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "TEST bank", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const rows = await db.insert(accountsTable).values([
    { companyId, code: "1100000", name: "TRR", type: "asset" as const },
    { companyId, code: "2500000", name: "Plače", type: "liability" as const },
    { companyId, code: "2600000", name: "DDV", type: "liability" as const },
    { companyId, code: "4150000", name: "Bančne provizije", type: "expense" as const },
    { companyId, code: "2200000", name: "Dobavitelji", type: "liability" as const },
    { companyId, code: "2500001", name: "Neaktiven", type: "liability" as const, isActive: false },
    { companyId, code: "250", name: "Skupinski", type: "liability" as const, allowsPosting: false },
    { companyId, code: "4150001", name: "Zahteva projekt", type: "expense" as const, requiresProject: true },
  ]).returning();
  [bankId, wageId, vatId, feeId, supplierId, disabledId, groupId, dimensionId] = rows.map(row => row.id);
  const [partner] = await db.insert(counterpartiesTable).values({ companyId, type: "supplier", name: "TEST prejemnik" }).returning();
  partnerId = partner.id;
  const [statement] = await db.insert(bankStatementsTable).values({
    companyId, bankAccountId: bankId, statementDate: "2026-10-05", sourceFilename: "TEST.csv",
    sourceSha256: "f".repeat(64), closingBalance: "10000.00", createdBy: USER,
  }).returning();
  statementId = statement.id;
  const [invoice] = await db.insert(invoicesTable).values({
    companyId, periodId, counterpartyId: partnerId, type: "received", invoiceNumber: "TEST-bank-1",
    invoiceDate: "2026-10-05", status: "posted", historicalGross: "25.00",
    arApAccountId: supplierId, createdBy: USER,
  }).returning();
  invoiceId = invoice.id;
  await db.insert(invoiceLinesTable).values({
    invoiceId, accountId: feeId, description: "TEST račun", quantity: "1",
    unitPrice: "25.00", vatRate: "0.00", sequence: 1,
  });
});

afterAll(async () => {
  // Real route transactions become savepoints; roll back the outer fixture
  // rather than deleting protected, append-only financial audit events.
  finish?.();
  await transactionFinished;
  isolation.tx = null;
  await pool.end();
});

async function payload(accountId: string, amount = 25) {
  const [line] = await db.insert(bankStatementLinesTable).values({
    statementId, transactionKey: `TEST-${++seq}`, lineNumber: seq, bookingDate: "2026-10-05",
    amount: (-amount).toFixed(2), currency: "EUR",
  }).returning();
  return {
    direction: "outbound", counterpartyId: partnerId, periodId, paymentDate: "2026-10-05",
    amount, reference: `TEST-${seq}`, bankAccountId: bankId, arApAccountId: accountId,
    bankStatementLineId: line.id, allocations: [],
  };
}

describe("bank statement per-transaction accounting", () => {
  it("lists only active postable analytical bank accounts and rejects metadata on groups", async () => {
    const excluded = await db.insert(accountsTable).values([
      { companyId, code: "110", name: "TRR sintetični", type: "asset" as const, allowsPosting: false },
      { companyId, code: "111", name: "Depoziti sintetični", type: "asset" as const, allowsPosting: true },
      { companyId, code: "1109000", name: "Neaktiven TRR", type: "asset" as const, isActive: false },
      { companyId, code: "1108000", name: "Neknjižljiv TRR", type: "asset" as const, allowsPosting: false },
    ]).returning();
    const list = await request(app).get(`/companies/${companyId}/bank-statements/accounts`).expect(200);
    expect(list.body.bankAccounts.map((a: any) => a.id)).toEqual([bankId]);
    for (const account of excluded) {
      await request(app).put(`/companies/${companyId}/bank-statements/accounts/${account.id}/metadata`)
        .send({ iban: "SI56191000000123438", bic: "HDELSI22" }).expect(404);
    }
  });
  it("posts wages, VAT and fees to different accounts without inventing invoices", async () => {
    for (const accountId of [wageId, vatId, feeId]) {
      const created = await request(app).post(`/companies/${companyId}/payments`).send(await payload(accountId)).expect(201);
      const posted = await request(app).post(`/companies/${companyId}/payments/${created.body.id}/post`).expect(200);
      const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, posted.body.linkedEntryId));
      expect(lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId, side: "debit", amount: "25.00" }),
        expect.objectContaining({ accountId: bankId, side: "credit", amount: "25.00" }),
      ]));
      expect(posted.body.allocations ?? []).toHaveLength(0);
    }
    expect(await db.select().from(invoicesTable).where(eq(invoicesTable.companyId, companyId))).toHaveLength(1);
  });
  it("blocks linking a supplier invoice to the wage account", async () => {
    const response = await request(app).post(`/companies/${companyId}/payments`).send({
      ...await payload(wageId), allocations: [{ invoiceId, allocatedAmount: 25 }],
    }).expect(400);
    expect(response.body.error).toMatch(/Protikonto plačila/);
  });
  it("blocks inactive and non-postable accounts", async () => {
    for (const accountId of [disabledId, groupId]) {
      const response = await request(app).post(`/companies/${companyId}/payments`).send(await payload(accountId)).expect(400);
      expect(response.body.error).toMatch(/Protikonto ni aktiven/);
    }
  });
  it("does not allow a different amount from the bank statement line", async () => {
    const data = await payload(vatId);
    const response = await request(app).post(`/companies/${companyId}/payments`).send({ ...data, amount: 30 }).expect(400);
    expect(response.body.error).toMatch(/vrstici bančnega izpiska/);
  });
  it("blocks a standalone entry that would omit required accounting dimensions", async () => {
    const response = await request(app).post(`/companies/${companyId}/payments`).send(await payload(dimensionId)).expect(400);
    expect(response.body.error).toMatch(/obvezno stroškovno mesto in projekt/);
  });
  it("persists independent bank/counter dimensions, reloads them and posts them for both directions", async () => {
    const centers = await db.insert(costCentersTable).values([
      { companyId, code: "TEST-B", name: "TEST bank center" },
      { companyId, code: "TEST-C", name: "TEST counter center" },
    ]).returning();
    const projects = await db.insert(projectsTable).values([
      { companyId, code: "TEST-B", name: "TEST bank project" },
      { companyId, code: "TEST-C", name: "TEST counter project" },
    ]).returning();
    const dimensions = {
      bankCostCenterId: centers[0].id, bankProjectId: projects[0].id,
      counterCostCenterId: centers[1].id, counterProjectId: projects[1].id,
    };
    await db.update(accountsTable).set({ costCenterPolicy: "required", requiresProject: true })
      .where(eq(accountsTable.id, bankId));
    await db.update(accountsTable).set({ requiresCostCenter: true })
      .where(eq(accountsTable.id, dimensionId));
    try {
    for (const direction of ["outbound", "inbound"] as const) {
      const input = { ...await payload(dimensionId, direction === "outbound" ? 28 : 29), direction, ...dimensions };
      if (direction === "inbound") {
        await db.update(bankStatementLinesTable).set({ amount: "29.00" }).where(eq(bankStatementLinesTable.id, input.bankStatementLineId));
      }
      const created = await request(app).post(`/companies/${companyId}/payments`).send(input).expect(201);
      expect(created.body).toMatchObject(dimensions);
      const url = `/companies/${companyId}/payments/${created.body.id}`;
      const read = await request(app).get(url).expect(200);
      expect(read.body).toMatchObject(dimensions);
      const list = await request(app).get(`/companies/${companyId}/payments`).expect(200);
      expect(list.body.payments.find((p: any) => p.id === created.body.id)).toMatchObject(dimensions);
      const posted = await request(app).post(`${url}/post`).expect(200);
      const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, posted.body.linkedEntryId));
      expect(lines).toEqual(expect.arrayContaining([
        expect.objectContaining({ accountId: bankId, costCenterId: centers[0].id, projectId: projects[0].id }),
        expect.objectContaining({ accountId: dimensionId, costCenterId: centers[1].id, projectId: projects[1].id }),
      ]));
      await request(app).patch(url).send({ bankProjectId: null }).expect(409);
    }
    } finally {
      await db.update(accountsTable).set({ costCenterPolicy: "allowed", requiresProject: false })
        .where(eq(accountsTable.id, bankId));
      await db.update(accountsTable).set({ requiresCostCenter: false })
        .where(eq(accountsTable.id, dimensionId));
    }
  });
  it("edits draft dimensions with explicit clearing and rejects foreign, inactive and malformed IDs", async () => {
    const [foreign] = await db.insert(companiesTable).values({
      podjetjeDavcna: "TEST_FOREIGN_DIMENSION", naziv: "TEST foreign dimensions",
    }).returning();
    const [ownCenter, foreignCenter, inactiveCenter] = await db.insert(costCentersTable).values([
      { companyId, code: "TEST-P", name: "TEST own" },
      { companyId: foreign.id, code: "TEST-P", name: "TEST foreign" },
      { companyId, code: "TEST-I", name: "TEST inactive", isActive: false },
    ]).returning();
    const [ownProject, foreignProject, inactiveProject] = await db.insert(projectsTable).values([
      { companyId, code: "TEST-P", name: "TEST own" },
      { companyId: foreign.id, code: "TEST-P", name: "TEST foreign" },
      { companyId, code: "TEST-I", name: "TEST inactive", isActive: false },
    ]).returning();
    const created = await request(app).post(`/companies/${companyId}/payments`).send(await payload(feeId, 31)).expect(201);
    const url = `/companies/${companyId}/payments/${created.body.id}`;
    await request(app).patch(url).send({ bankCostCenterId: ownCenter.id, counterProjectId: ownProject.id }).expect(200);
    const read = await request(app).get(url).expect(200);
    expect(read.body).toMatchObject({ bankCostCenterId: ownCenter.id, counterProjectId: ownProject.id });
    for (const bad of [
      { bankCostCenterId: foreignCenter.id }, { counterCostCenterId: foreignCenter.id },
      { bankProjectId: foreignProject.id }, { counterProjectId: foreignProject.id },
      { bankCostCenterId: inactiveCenter.id }, { counterProjectId: inactiveProject.id },
      { bankProjectId: "not-a-uuid" },
    ]) {
      await request(app).patch(url).send(bad).expect(400);
      await request(app).post(`/companies/${companyId}/payments`).send({ ...await payload(feeId, 32), ...bad }).expect(400);
    }
    await request(app).patch(`/companies/${foreign.id}/payments/${created.body.id}`).send({ bankCostCenterId: null }).expect(403);
    await request(app).patch(url).send({ bankCostCenterId: null }).expect(200);
    const cleared = await request(app).get(url).expect(200);
    expect(cleared.body).toMatchObject({ bankCostCenterId: null, counterProjectId: ownProject.id });
  });
  it("blocks posting after required counter dimensions are cleared and allows posting after correction", async () => {
    const [center] = await db.insert(costCentersTable).values({ companyId, code: "TEST-REQ", name: "TEST required" }).returning();
    const [project] = await db.insert(projectsTable).values({ companyId, code: "TEST-REQ", name: "TEST required" }).returning();
    const [account] = await db.insert(accountsTable).values({
      companyId, code: "4150002", name: "TEST required dimensions", type: "expense",
      costCenterPolicy: "required", requiresProject: true,
    }).returning();
    const dimensions = { counterCostCenterId: center.id, counterProjectId: project.id };
    const created = await request(app).post(`/companies/${companyId}/payments`)
      .send({ ...await payload(account.id, 33), ...dimensions }).expect(201);
    const url = `/companies/${companyId}/payments/${created.body.id}`;
    for (const [key, message] of [
      ["counterCostCenterId", /obvezno stroškovno mesto/],
      ["counterProjectId", /obvezen projekt/],
    ] as const) {
      await request(app).patch(url).send({ [key]: null }).expect(200);
      const failed = await request(app).post(`${url}/post`).expect(400);
      expect(failed.body.error).toMatch(message);
      const [draft] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, created.body.id));
      expect(draft).toMatchObject({ status: "draft", linkedEntryId: null });
      await request(app).patch(url).send(dimensions).expect(200);
    }
    await request(app).post(`${url}/post`).expect(200);
  });
  it("enforces required dimensions on the bank line too", async () => {
    const [center] = await db.insert(costCentersTable).values({ companyId, code: "TEST-BREQ", name: "TEST bank required" }).returning();
    const [project] = await db.insert(projectsTable).values({ companyId, code: "TEST-BREQ", name: "TEST bank required" }).returning();
    await db.update(accountsTable).set({ requiresCostCenter: true, requiresProject: true }).where(eq(accountsTable.id, bankId));
    try {
      const dimensions = { bankCostCenterId: center.id, bankProjectId: project.id };
      const created = await request(app).post(`/companies/${companyId}/payments`)
        .send({ ...await payload(feeId, 34), ...dimensions }).expect(201);
      const url = `/companies/${companyId}/payments/${created.body.id}`;
      for (const key of ["bankCostCenterId", "bankProjectId"] as const) {
        await request(app).patch(url).send({ [key]: null }).expect(200);
        const failed = await request(app).post(`${url}/post`).expect(400);
        expect(failed.body.error).toContain("Konto 1100000");
        await request(app).patch(url).send(dimensions).expect(200);
      }
      await request(app).post(`${url}/post`).expect(200);
    } finally {
      await db.update(accountsTable).set({ requiresCostCenter: false, requiresProject: false }).where(eq(accountsTable.id, bankId));
    }
  });
  it("rejects prohibited cost centers on creation, editing and posting on either line", async () => {
    const [center] = await db.insert(costCentersTable).values({ companyId, code: "TEST-NO", name: "TEST forbidden" }).returning();
    const created = await request(app).post(`/companies/${companyId}/payments`).send(await payload(feeId, 35)).expect(201);
    const url = `/companies/${companyId}/payments/${created.body.id}`;
    for (const [accountId, field] of [[bankId, "bankCostCenterId"], [feeId, "counterCostCenterId"]] as const) {
      await db.update(accountsTable).set({ costCenterPolicy: "not_allowed" }).where(eq(accountsTable.id, accountId));
      try {
        const bad = { [field]: center.id };
        const rejectedCreate = await request(app).post(`/companies/${companyId}/payments`)
          .send({ ...await payload(feeId, 36), ...bad }).expect(400);
        expect(rejectedCreate.body.error).toMatch(/stroškovno mesto ni dovoljeno/);
        await request(app).patch(url).send(bad).expect(400);
        // Simulate a draft saved before its account policy was changed.
        await db.update(paymentsTable).set(bad).where(eq(paymentsTable.id, created.body.id));
        const rejectedPost = await request(app).post(`${url}/post`).expect(400);
        expect(rejectedPost.body.error).toMatch(/stroškovno mesto ni dovoljeno/);
        const [draft] = await db.select().from(paymentsTable).where(eq(paymentsTable.id, created.body.id));
        expect(draft).toMatchObject({ status: "draft", linkedEntryId: null });
        await request(app).patch(url).send({ [field]: null }).expect(200);
      } finally {
        await db.update(accountsTable).set({ costCenterPolicy: "allowed" }).where(eq(accountsTable.id, accountId));
      }
    }
  });
  it("accepts an invoice link with the invoice's own account", async () => {
    const response = await request(app).post(`/companies/${companyId}/payments`).send({
      ...await payload(supplierId), allocations: [{ invoiceId, allocatedAmount: 25 }],
    }).expect(201);
    expect(response.body.arApAccountId).toBe(supplierId);
    expect(response.body.allocations).toEqual(expect.arrayContaining([expect.objectContaining({ invoiceId })]));
  });
  it("pays partner-labelled wage and VAT journal liabilities in one XML without a supplier or saldakonto flag", async () => {
    const [recipient] = await db.insert(counterpartiesTable).values({
      companyId, type: "customer", name: "TEST delavec ali davčni organ",
      iban: "SI56191000000123438",
    }).returning();
    await db.insert(bankAccountMetadataTable).values({
      companyId, bankAccountId: bankId, iban: "SI56191000000123438",
      bic: "HDELSI22", updatedBy: USER,
    });
    const journal = await request(app).post(`/companies/${companyId}/entries`).send({
      periodId, entryDate: "2026-10-05", documentDate: "2026-10-05",
      reference: "TEST-OBVEZNOSTI", description: "TEST obračun obveznosti", autoPost: true,
      lines: [
        { accountId: feeId, side: "debit", amount: 100 },
        { accountId: wageId, partnerId: recipient.id, side: "credit", amount: 40 },
        { accountId: vatId, partnerId: recipient.id, side: "credit", amount: 60 },
      ],
    });
    expect(journal.status, JSON.stringify(journal.body)).toBe(201);
    expect(journal.body.status).toBe("posted");
    const sourceLines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, journal.body.id));
    const sources = sourceLines.filter(line => line.partnerId === recipient.id);
    expect(sources).toHaveLength(2);
    const open = () => request(app).get(`/companies/${companyId}/open-items`).query({
      counterpartyId: recipient.id, type: "received", asOfDate: "2026-10-06",
    });
    const before = await open().expect(200);
    expect(before.body.items).toEqual(expect.arrayContaining(sources.map(line => expect.objectContaining({
      sourceKind: "ledger", journalLineId: line.id, accountId: line.accountId,
      counterpartyId: recipient.id, paymentDirection: "outbound", remainingAmount: line.amount,
    }))));
    const prepared = await request(app).post(`/companies/${companyId}/payment-batches`).send({
      bankAccountId: bankId, periodId, paymentDate: "2026-10-06",
      idempotencyKey: "TEST-partner-liabilities",
      proposedPayments: sources.map(line => ({
        counterpartyId: recipient.id, arApAccountId: line.accountId,
        allocations: [{ journalLineId: line.id, amount: Number(line.amount) }],
      })),
    });
    expect(prepared.status, JSON.stringify(prepared.body)).toBe(201);
    const xml = await request(app).get(`/companies/${companyId}/payment-batches/${prepared.body.batchId}/sepa.xml`);
    expect(xml.status, JSON.stringify(xml.body)).toBe(200);
    expect(xml.text.match(/<CdtTrfTxInf>/g)).toHaveLength(2);
    expect(xml.text).toContain("<CtrlSum>100.00</CtrlSum>");
    expect((await open()).body.totalRemaining).toBe("100.00");
    const packageItems = await db.select().from(paymentBatchItemsTable).where(eq(paymentBatchItemsTable.batchId, prepared.body.batchId));
    for (const item of packageItems) {
      const posted = await request(app).post(`/companies/${companyId}/payments/${item.paymentId}/post`);
      expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    }
    const after = await open().expect(200);
    expect(after.body.totalRemaining).toBe("0.00");
    expect(after.body.items.filter((item: any) => sources.some(line => line.id === item.journalLineId))).toHaveLength(0);
  });
  it("registers statement evidence and all lines atomically without creating or changing payments or journals", async function registersEvidenceWithoutAccountingWrites() {
    const priorPayments = await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const priorJournals = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    const evidenceInput = {
      bankAccountId: bankId, sourceFilename: "TEST-evidence.csv", sourceSha256: "b".repeat(64),
      metadata: {
        statementNumber: "TEST-10", statementDate: "2026-10-04",
        periodFrom: "2026-10-03", periodTo: "2026-10-04",
        openingBalance: 0, closingBalance: 80, currency: "EUR",
      },
      transactions: [
        { id: "income", date: "2026-10-03", amount: 100, currency: "EUR", reference: "IN",
          counterpartyName: "Test income", counterpartyIban: null, description: "Income evidence" },
        { id: "expense", date: "2026-10-04", amount: -20, currency: "EUR", reference: "OUT",
          counterpartyName: "Test expense", counterpartyIban: null, description: "Expense evidence" },
      ],
    };
    const evidenceResponse = await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(evidenceInput).expect(201);
    expect(evidenceResponse.body).toEqual({
      statementId: expect.any(String), lineIds: { income: expect.any(String), expense: expect.any(String) },
    });
    const [evidenceHeader] = await db.select().from(bankStatementsTable)
      .where(eq(bankStatementsTable.id, evidenceResponse.body.statementId));
    expect(evidenceHeader).toMatchObject({
      companyId, bankAccountId: bankId, sourceFilename: evidenceInput.sourceFilename,
      sourceSha256: evidenceInput.sourceSha256, statementNumber: "TEST-10",
      statementDate: "2026-10-04", periodFrom: "2026-10-03", periodTo: "2026-10-04",
      openingBalance: "0.00", closingBalance: "80.00", currency: "EUR", createdBy: USER,
    });
    const evidenceLines = await db.select().from(bankStatementLinesTable)
      .where(eq(bankStatementLinesTable.statementId, evidenceHeader.id)).orderBy(bankStatementLinesTable.lineNumber);
    expect(evidenceLines).toEqual(evidenceInput.transactions.map((transaction, index) => expect.objectContaining({
      id: evidenceResponse.body.lineIds[transaction.id], transactionKey: transaction.id,
      statementId: evidenceHeader.id, lineNumber: index + 1, bookingDate: transaction.date,
      amount: transaction.amount.toFixed(2), currency: transaction.currency,
      reference: transaction.reference, counterpartyName: transaction.counterpartyName,
      counterpartyIban: transaction.counterpartyIban, description: transaction.description,
    })));
    expect(await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId))).toEqual(priorPayments);
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).toEqual(priorJournals);
  });

  it("resumes a partial import using saved registered line IDs instead of registering the same hash twice", async () => {
    const transactions = [37.13, 38.19].map((amount, index) => ({
      id: `resume-${index}`, date: "2026-10-07", amount: -amount,
      reference: `TEST-RESUME-${index}`, counterpartyName: "TEST prejemnik",
      counterpartyIban: null, description: null, currency: "EUR",
    }));
    const registration = {
      bankAccountId: bankId, sourceFilename: "TEST-resume.csv", sourceSha256: "e".repeat(64),
      metadata: { currency: "EUR" }, transactions,
    };
    const paymentsBefore = await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const registered = await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration).expect(201);
    // This is the recovery data stored by the browser before creating any payments.
    const saved = JSON.parse(JSON.stringify(registered.body)) as {
      statementId: string; lineIds: Record<string, string>;
    };
    expect(Object.keys(saved.lineIds).sort()).toEqual(["resume-0", "resume-1"]);
    expect(new Set(Object.values(saved.lineIds)).size).toBe(2);
    expect(await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId))).toEqual(paymentsBefore);
    const [storedStatement] = await db.select().from(bankStatementsTable)
      .where(eq(bankStatementsTable.id, saved.statementId));
    expect(storedStatement).toMatchObject({
      companyId, bankAccountId: bankId, sourceSha256: registration.sourceSha256,
      sourceFilename: "TEST-resume.csv", statementDate: "2026-10-07", createdBy: USER,
    });
    await request(app).get(`/companies/${companyId}/bank-statements/detail/${saved.statementId}`).expect(200);
    const create = (index: number) => request(app).post(`/companies/${companyId}/payments`).send({
      direction: "outbound", counterpartyId: partnerId, periodId,
      paymentDate: transactions[index].date, amount: Math.abs(transactions[index].amount),
      reference: transactions[index].reference, bankAccountId: bankId,
      arApAccountId: feeId, allocations: [], bankStatementLineId: saved.lineIds[transactions[index].id],
    });
    const first = await create(0).expect(201);

    // A real duplicate registration is rejected, so recovery must bypass it.
    await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration).expect(409);
    const second = await create(1).expect(201);
    expect(second.body.id).not.toBe(first.body.id);
    const payments = await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const resumedPayments = payments.filter(payment => Object.values(saved.lineIds).includes(payment.bankStatementLineId ?? ""));
    expect(resumedPayments).toHaveLength(2);
    expect(resumedPayments).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: first.body.id, bankStatementLineId: saved.lineIds["resume-0"] }),
        expect.objectContaining({ id: second.body.id, bankStatementLineId: saved.lineIds["resume-1"] }),
      ]));
    const lines = await db.select().from(bankStatementLinesTable)
      .where(eq(bankStatementLinesTable.statementId, saved.statementId));
    expect(lines).toHaveLength(2);
  });

  it("rolls back the statement header when inserting its lines fails", async () => {
    const registration = {
      bankAccountId: bankId, sourceFilename: "TEST-invalid-lines.csv", sourceSha256: "d".repeat(64),
      metadata: { currency: "EUR" },
      transactions: [1, 2].map(amount => ({
        id: "duplicate-key", date: "2026-10-07", amount: -amount, currency: "EUR",
        reference: null, counterpartyName: null, counterpartyIban: null, description: null,
      })),
    };
    await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration).expect(409);
    expect(await db.select().from(bankStatementsTable)
      .where(and(eq(bankStatementsTable.companyId, companyId),
        eq(bankStatementsTable.sourceSha256, registration.sourceSha256)))).toHaveLength(0);
    // The rolled-back hash can still be registered after correcting the rows.
    registration.transactions[1].id = "second-key";
    const retry = await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration).expect(201);
    expect(Object.keys(retry.body.lineIds).sort()).toEqual(["duplicate-key", "second-key"]);
  });

  it.each(["draft", "posted"] as const)("rejects a real duplicate %s payment atomically and returns the correct supplier's detail ID", async function rejectsDuplicateSupplierBatch(status) {
    await db.insert(bankAccountMetadataTable).values({
      companyId, bankAccountId: bankId, iban: "SI56191000000123438", bic: "HDELSI22", updatedBy: USER,
    }).onConflictDoNothing();
    const suppliers = await db.insert(counterpartiesTable).values(["A", "B"].map(name => ({
      companyId, type: "supplier" as const, name: `TEST duplicate ${status} ${name}`, iban: "SI56191000000123438",
    }))).returning();
    const invoices = await db.insert(invoicesTable).values(suppliers.map((supplier, index) => ({
      companyId, periodId, counterpartyId: supplier.id, type: "received" as const,
      invoiceNumber: `DUP-${status}-${index}`, invoiceDate: "2026-10-01",
      historicalGross: index === 0 ? "100.00" : "250.00", status: "posted" as const,
      arApAccountId: supplierId, createdBy: USER,
    }))).returning();
    // A different supplier with the same date and amount must never be returned.
    const [decoy, duplicate] = await db.insert(paymentsTable).values(suppliers.map(supplier => ({
      companyId, periodId, counterpartyId: supplier.id, bankAccountId: bankId, arApAccountId: supplierId,
      direction: "outbound" as const, paymentDate: "2026-10-09", amount: "250.00", status,
      reference: `dup ${status} 1`, createdBy: USER,
    }))).returning();
    const requestBody = {
      bankAccountId: bankId, periodId, paymentDate: "2026-10-09", idempotencyKey: `TEST-duplicate-${status}`,
      proposedPayments: suppliers.map((supplier, index) => ({
        counterpartyId: supplier.id, arApAccountId: supplierId,
        allocations: [{ invoiceId: invoices[index].id, amount: index === 0 ? 100 : 250 }],
      })),
    };
    const beforePayments = await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const beforeBatches = await db.select().from(paymentBatchesTable).where(eq(paymentBatchesTable.companyId, companyId));
    const conflict = await request(app).post(`/companies/${companyId}/payment-batches`).send(requestBody).expect(409);
    expect(conflict.body).toEqual({
      error: "Plačilo z istim datumom, zneskom in sklicem za tega prejemnika že obstaja.",
      duplicateOf: { paymentId: duplicate.id },
    });
    expect(conflict.body.duplicateOf.paymentId).not.toBe(decoy.id);
    expect(await db.select().from(paymentsTable).where(eq(paymentsTable.companyId, companyId))).toEqual(beforePayments);
    expect(await db.select().from(paymentBatchesTable).where(eq(paymentBatchesTable.companyId, companyId))).toEqual(beforeBatches);
    for (const invoice of invoices) {
      expect(await db.select().from(paymentAllocationsTable).where(eq(paymentAllocationsTable.invoiceId, invoice.id))).toHaveLength(0);
    }
    const detail = await request(app).get(`/companies/${companyId}/payments/${conflict.body.duplicateOf.paymentId}`).expect(200);
    expect(detail.body).toMatchObject({
      id: duplicate.id, counterpartyId: suppliers[1].id, counterpartyName: suppliers[1].name,
      paymentDate: "2026-10-09", amount: "250.00", reference: `dup ${status} 1`,
    });
    // A different execution date is a distinct payment. Replaying that successful
    // request must return the same batch, not collide with its own newly saved drafts.
    const nextDay = { ...requestBody, paymentDate: "2026-10-10" };
    const created = await request(app).post(`/companies/${companyId}/payment-batches`).send(nextDay).expect(201);
    const replay = await request(app).post(`/companies/${companyId}/payment-batches`).send(nextDay).expect(200);
    expect(replay.body.batchId).toBe(created.body.batchId);
    expect(replay.body.replayed).toBe(true);
    expect(created.body.payments).toHaveLength(2);
  });
});
