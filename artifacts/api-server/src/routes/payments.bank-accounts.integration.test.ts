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
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, invoicesTable, invoiceLinesTable,
  journalEntryLinesTable, bankStatementsTable, bankStatementLinesTable,
  bankAccountMetadataTable, paymentBatchItemsTable, paymentsTable,
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
    expect(response.body.error).toMatch(/zahteva stroškovno mesto ali projekt/);
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
    const registered = await request(app).post(`/companies/${companyId}/bank-statements/register`)
      .send(registration).expect(201);
    // This is the recovery data stored by the browser before creating any payments.
    const saved = JSON.parse(JSON.stringify(registered.body)) as {
      statementId: string; lineIds: Record<string, string>;
    };
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
});
