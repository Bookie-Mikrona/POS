/**
 * Real-database regression coverage for the partner-ledger / payment-batch /
 * bank-reconciliation journey. These tests create one uniquely named TEST
 * company and never touch business tenants or external services.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_CLERK_USER_ID = "test-user-ledger-bank-integration";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_CLERK_USER_ID;
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
  auditLogTable,
  accountsTable,
  bankAccountMetadataTable,
  bankStatementLinesTable,
  bankStatementsTable,
  bookieOldArSettlementsTable,
  bookieOldNativeLedgerEvidenceTable,
  companiesTable,
  counterpartiesTable,
  db,
  invoicesTable,
  invoiceLinesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  paymentAllocationsTable,
  paymentLedgerAllocationsTable,
  paymentBatchesTable,
  paymentBatchItemsTable,
  paymentsTable,
  pool,
  partnerSettlementEventsTable,
} from "@workspace/db";
import partnerLedgerRouter from "./partnerLedger";
import paymentsRouter from "./payments";
import bankStatementsRouter from "./bankStatements";

const app = express();
app.use(express.json());
app.use(partnerLedgerRouter);
app.use(paymentsRouter);
app.use(bankStatementsRouter);
app.use((error: any, _req: any, res: any, _next: any) =>
  res.status(error.status ?? error.statusCode ?? 500).json({ error: error.message }),
);

function expectStatus<T extends { status: number; body: unknown }>(response: T, status: number): T {
  expect(response.status, `HTTP ${response.status}: ${JSON.stringify(response.body)}`).toBe(status);
  return response;
}

function parsePdfBuffer(
  response: supertest.Response,
  callback: (error: Error | null, body: Buffer) => void,
) {
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer | string) =>
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
  );
  response.on("end", () => callback(null, Buffer.concat(chunks)));
  response.on("error", (error: Error) => callback(error, Buffer.alloc(0)));
}

const RUN_ID = `${Date.now()}_${Math.floor(Math.random() * 1_000_000)}`;
const companyTaxId = `TEST_LEDGER_${RUN_ID}`;

async function createAccount(companyId: string, code: string, type: "asset" | "liability" | "expense") {
  const [row] = await db.insert(accountsTable).values({
    companyId, code, name: `TEST account ${code}`, type,
  }).returning({ id: accountsTable.id });
  return row.id;
}

async function createPartner(companyId: string, name: string, type: "customer" | "supplier", extra: Record<string, unknown> = {}) {
  const [row] = await db.insert(counterpartiesTable).values({
    companyId, type, name, ...extra,
  } as any).returning({ id: counterpartiesTable.id });
  return row.id;
}

async function createJournalLine(opts: {
  companyId: string;
  periodId: string;
  accountId: string;
  partnerId: string;
  side: "debit" | "credit";
  amount: number;
  date: string;
  status?: "posted" | "draft";
  reference: string;
}) {
  const [entry] = await db.insert(journalEntriesTable).values({
    companyId: opts.companyId,
    periodId: opts.periodId,
    documentDate: opts.date,
    entryDate: opts.date,
    description: `TEST ${opts.reference}`,
    reference: opts.reference,
    status: opts.status ?? "posted",
    sourceType: "manual",
    createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: journalEntriesTable.id });
  const [line] = await db.insert(journalEntryLinesTable).values({
    entryId: entry.id,
    accountId: opts.accountId,
    partnerId: opts.partnerId,
    side: opts.side,
    amount: opts.amount.toFixed(2),
    description: opts.reference,
    sequence: 1,
  }).returning({ id: journalEntryLinesTable.id });
  return { entryId: entry.id, lineId: line.id };
}

async function createInvoice(opts: {
  companyId: string;
  partnerId: string;
  periodId: string;
  arApAccountId: string;
  expenseAccountId: string;
  number: string;
  amount: number;
  iban?: string;
}) {
  const [invoice] = await db.insert(invoicesTable).values({
    companyId,
    type: "received",
    counterpartyId: opts.partnerId,
    periodId: opts.periodId,
    invoiceNumber: opts.number,
    invoiceDate: "2025-03-01",
    dueDate: "2025-03-31",
    destinationIban: opts.iban ?? null,
    status: "posted",
    arApAccountId: opts.arApAccountId,
    createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invoice.id,
    description: `TEST ${opts.number}`,
    quantity: "1.000",
    unitPrice: opts.amount.toFixed(4),
    vatRate: "0.00",
    accountId: opts.expenseAccountId,
  });
  return invoice.id;
}

let companyId: string;
let periodId: string;
let arApAccountId: string;
let expenseAccountId: string;
let ledgerAccountId: string;
let secondLedgerAccountId: string;
let firstBankAccountId: string;
let selectedBankAccountId: string;
let customerId: string;
let supplierId: string;
let otherSupplierId: string;
let turnoverDebitLineId: string;
let turnoverCreditLineId: string;
let closeDebitLineId: string;
let closeCreditLineId: string;
let draftLedgerLineId: string;
let validInvoiceId: string;
let wrongSupplierInvoiceId: string;
let remainderInvoiceId: string;
let postedPaymentId: string;
let partialDraftPaymentId: string;
let reconcilePostedLineId: string;
let reconcileDraftLineId: string;
let postedJournalEntryId: string;
let externalReopenInvoiceId: string;
let externalReopenInvoiceLineId: string;
let externalReopenPaymentId: string;
let externalReopenPaymentEntryId: string;
let nativePayableAccountId: string;
let nativePayableLineId: string;
let nativeCounterLineId: string;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: companyTaxId,
    naziv: `TEST ledger-bank ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;

  await db.insert(accountingRolesTable).values({
    clerkUserId: TEST_CLERK_USER_ID,
    companyId,
    role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: `TEST period ${RUN_ID}`,
    startDate: "2025-01-01",
    endDate: "2025-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  arApAccountId = await createAccount(companyId, "2200", "liability");
  expenseAccountId = await createAccount(companyId, "6000", "expense");
  ledgerAccountId = await createAccount(companyId, "1200", "asset");
  secondLedgerAccountId = await createAccount(companyId, "1210", "asset");
  firstBankAccountId = await createAccount(companyId, "1100", "asset");
  selectedBankAccountId = await createAccount(companyId, "1101", "asset");
  customerId = await createPartner(companyId, `TEST customer ${RUN_ID}`, "customer");

  // Two independently configured TRRs make it possible to prove the selected
  // account, rather than whichever account appears first, drives SEPA export.
  await db.insert(bankAccountMetadataTable).values([
    {
      companyId, bankAccountId: firstBankAccountId, iban: "GB82WEST12345698765432",
      bic: "WESTGB2L", sepaProfile: "pain.001.001.03", updatedBy: TEST_CLERK_USER_ID,
    },
    {
      companyId, bankAccountId: selectedBankAccountId, iban: "GB29NWBK60161331926819",
      bic: "NWBKGB2L", sepaProfile: "pain.001.001.03", updatedBy: TEST_CLERK_USER_ID,
    },
  ]);

  supplierId = await createPartner(companyId, `TEST supplier ${RUN_ID}`, "supplier", {
    iban: "DE89370400440532013000",
    trr: [{ iban: "DE89370400440532013000", bic: "COBADEFFXXX" }],
  });
  otherSupplierId = await createPartner(companyId, `TEST other supplier ${RUN_ID}`, "supplier", {
    iban: "GB29NWBK60161331926819",
    trr: [{ iban: "GB29NWBK60161331926819", bic: "NWBKGB2L" }],
  });
  const [nativePayableAccount] = await db.insert(accountsTable).values({
    companyId, code: "2299", name: `TEST native payable ${RUN_ID}`, type: "liability", isOpenItem: true,
  }).returning({ id: accountsTable.id });
  nativePayableAccountId = nativePayableAccount.id;
  const nativePayable = await createJournalLine({
    companyId, periodId, accountId: nativePayableAccountId, partnerId: supplierId,
    side: "credit", amount: 120, date: "2025-03-01", reference: `TEST-NATIVE-${RUN_ID}`,
  });
  const nativeCounter = await createJournalLine({
    companyId, periodId, accountId: nativePayableAccountId, partnerId: supplierId,
    side: "debit", amount: 120, date: "2025-03-02", reference: `TEST-NATIVE-COUNTER-${RUN_ID}`,
  });
  nativePayableLineId = nativePayable.lineId;
  nativeCounterLineId = nativeCounter.lineId;

  const turnoverDebit = await createJournalLine({
    companyId, periodId, accountId: ledgerAccountId, partnerId: customerId,
    side: "debit", amount: 100, date: "2025-01-10", reference: "TEST-TURNOVER-OPEN",
  });
  const turnoverCredit = await createJournalLine({
    companyId, periodId, accountId: ledgerAccountId, partnerId: customerId,
    side: "credit", amount: 100, date: "2025-02-10", reference: "TEST-TURNOVER-PERIOD",
  });
  turnoverDebitLineId = turnoverDebit.lineId;
  turnoverCreditLineId = turnoverCredit.lineId;

  const closeDebit = await createJournalLine({
    companyId, periodId, accountId: secondLedgerAccountId, partnerId: customerId,
    side: "debit", amount: 60, date: "2025-01-15", reference: "TEST-MANUAL-CLOSE-DEBIT",
  });
  const closeCredit = await createJournalLine({
    companyId, periodId, accountId: secondLedgerAccountId, partnerId: customerId,
    side: "credit", amount: 60, date: "2025-01-20", reference: "TEST-MANUAL-CLOSE-CREDIT",
  });
  closeDebitLineId = closeDebit.lineId;
  closeCreditLineId = closeCredit.lineId;
  const draftLine = await createJournalLine({
    companyId, periodId, accountId: ledgerAccountId, partnerId: customerId,
    side: "debit", amount: 200, date: "2025-03-01", status: "draft", reference: "TEST-LEDGER-DRAFT",
  });
  draftLedgerLineId = draftLine.lineId;

  validInvoiceId = await createInvoice({
    companyId, partnerId: supplierId, periodId, arApAccountId, expenseAccountId,
    number: `TEST-VALID-${RUN_ID}`, amount: 100, iban: "DE89370400440532013000",
  });
  wrongSupplierInvoiceId = await createInvoice({
    companyId, partnerId: otherSupplierId, periodId, arApAccountId, expenseAccountId,
    number: `TEST-WRONG-SUPPLIER-${RUN_ID}`, amount: 40, iban: "GB29NWBK60161331926819",
  });
  remainderInvoiceId = await createInvoice({
    companyId, partnerId: supplierId, periodId, arApAccountId, expenseAccountId,
    number: `TEST-REMAINDER-${RUN_ID}`, amount: 100, iban: "DE89370400440532013000",
  });
  externalReopenInvoiceId = await createInvoice({
    companyId, partnerId: supplierId, periodId, arApAccountId, expenseAccountId,
    number: `TEST-EXTERNAL-REOPEN-${RUN_ID}`, amount: 100, iban: "DE89370400440532013000",
  });
  const [externalInvoiceEntry] = await db.insert(journalEntriesTable).values({
    companyId, periodId, documentDate: "2025-03-01", entryDate: "2025-03-01",
    description: "TEST invoice for external allocation reopen",
    reference: `TEST-EXTERNAL-REOPEN-${RUN_ID}`, status: "posted",
    sourceType: "manual", createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: journalEntriesTable.id });
  await db.insert(journalEntryLinesTable).values([
    { entryId: externalInvoiceEntry.id, accountId: expenseAccountId, side: "debit", amount: "100.00", sequence: 1 },
    { entryId: externalInvoiceEntry.id, accountId: arApAccountId, partnerId: supplierId, side: "credit", amount: "100.00", sequence: 2 },
  ]);
  const [externalInvoiceLine] = await db.select({ id: journalEntryLinesTable.id })
    .from(journalEntryLinesTable).where(and(
      eq(journalEntryLinesTable.entryId, externalInvoiceEntry.id),
      eq(journalEntryLinesTable.accountId, arApAccountId),
      eq(journalEntryLinesTable.partnerId, supplierId),
    ));
  externalReopenInvoiceLineId = externalInvoiceLine.id;
  await db.update(invoicesTable).set({ linkedEntryId: externalInvoiceEntry.id })
    .where(eq(invoicesTable.id, externalReopenInvoiceId));

  const [externalPaymentEntry] = await db.insert(journalEntriesTable).values({
    companyId, periodId, documentDate: "2025-03-10", entryDate: "2025-03-10",
    description: "TEST posted payment for external allocation reopen",
    reference: `TEST-EXTERNAL-PAYMENT-${RUN_ID}`, status: "posted",
    sourceType: "manual", createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: journalEntriesTable.id });
  externalReopenPaymentEntryId = externalPaymentEntry.id;
  const [externalPayment] = await db.insert(paymentsTable).values({
    companyId, counterpartyId: supplierId, periodId, direction: "outbound",
    paymentDate: "2025-03-10", amount: "60.00", reference: `TEST-EXTERNAL-PAYMENT-${RUN_ID}`,
    bankAccountId: firstBankAccountId, arApAccountId, status: "posted",
    linkedEntryId: externalReopenPaymentEntryId, createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: paymentsTable.id });
  externalReopenPaymentId = externalPayment.id;
  await db.insert(journalEntryLinesTable).values([
    { entryId: externalReopenPaymentEntryId, accountId: arApAccountId, partnerId: supplierId, side: "debit", amount: "60.00", sequence: 1 },
    { entryId: externalReopenPaymentEntryId, accountId: firstBankAccountId, side: "credit", amount: "60.00", sequence: 2 },
  ]);
  await db.insert(paymentAllocationsTable).values({
    paymentId: externalReopenPaymentId, invoiceId: externalReopenInvoiceId, allocatedAmount: "60.00",
  });

  // The registered statement lines below are actual DB fixtures; no bank
  // connector, file upload, or external institution is involved.
  const [statement] = await db.insert(bankStatementsTable).values({
    companyId,
    bankAccountId: firstBankAccountId,
    statementDate: "2025-03-15",
    periodFrom: "2025-03-01",
    periodTo: "2025-03-15",
    openingBalance: "1000.00",
    closingBalance: "880.00",
    currency: "EUR",
    sourceFilename: `TEST-${RUN_ID}.csv`,
    sourceSha256: `test-ledger-bank-${RUN_ID}`,
    createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: bankStatementsTable.id });
  await db.insert(bankStatementsTable).values({
    companyId,
    bankAccountId: selectedBankAccountId,
    sourceIban: "GB29NWBK60161331926819",
    statementNumber: `TEST-SELECTED-${RUN_ID}`,
    statementDate: "2025-03-15",
    periodFrom: "2025-03-01",
    periodTo: "2025-03-15",
    openingBalance: "1100.00",
    closingBalance: "1000.00",
    currency: "EUR",
    sourceFilename: `TEST-SELECTED-${RUN_ID}.csv`,
    sourceSha256: `test-ledger-bank-selected-${RUN_ID}`,
    createdBy: TEST_CLERK_USER_ID,
  });
  const [postedLine] = await db.insert(bankStatementLinesTable).values({
    statementId: statement.id,
    transactionKey: `posted-${RUN_ID}`,
    lineNumber: 1,
    bookingDate: "2025-03-10",
    amount: "-60.00",
    currency: "EUR",
    reference: "TEST-POSTED-RECON",
  }).returning({ id: bankStatementLinesTable.id });
  const [draftLineStatement] = await db.insert(bankStatementLinesTable).values({
    statementId: statement.id,
    transactionKey: `draft-${RUN_ID}`,
    lineNumber: 2,
    bookingDate: "2025-03-11",
    amount: "-60.00",
    currency: "EUR",
    reference: "TEST-DRAFT-RECON",
  }).returning({ id: bankStatementLinesTable.id });
  reconcilePostedLineId = postedLine.id;
  reconcileDraftLineId = draftLineStatement.id;

  const postedEntry = await db.insert(journalEntriesTable).values({
    companyId,
    periodId,
    documentDate: "2025-03-10",
    entryDate: "2025-03-10",
    description: "TEST already-posted supplier payment",
    reference: "TEST-POSTED-RECON",
    status: "posted",
    sourceType: "manual",
    createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: journalEntriesTable.id });
  postedJournalEntryId = postedEntry[0]!.id;
  await db.insert(journalEntryLinesTable).values([
    { entryId: postedJournalEntryId, accountId: firstBankAccountId, side: "credit", amount: "60.00", sequence: 1 },
    { entryId: postedJournalEntryId, accountId: arApAccountId, side: "debit", amount: "60.00", partnerId: supplierId, sequence: 2 },
  ]);
  const [postedPayment] = await db.insert(paymentsTable).values({
    companyId, counterpartyId: supplierId, periodId, direction: "outbound",
    paymentDate: "2025-03-10", amount: "60.00", reference: "TEST-POSTED-RECON",
    bankAccountId: firstBankAccountId, arApAccountId, status: "posted",
    linkedEntryId: postedJournalEntryId, createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: paymentsTable.id });
  postedPaymentId = postedPayment.id;

  const [draftPayment] = await db.insert(paymentsTable).values({
    companyId, counterpartyId: supplierId, periodId, direction: "outbound",
    paymentDate: "2025-03-11", amount: "100.00", reference: "TEST-DRAFT-RECON",
    bankAccountId: firstBankAccountId, arApAccountId, status: "draft",
    createdBy: TEST_CLERK_USER_ID,
  }).returning({ id: paymentsTable.id });
  partialDraftPaymentId = draftPayment.id;
  await db.insert(paymentAllocationsTable).values({
    paymentId: partialDraftPaymentId, invoiceId: remainderInvoiceId, allocatedAmount: "100.00",
  });
});

afterAll(async () => {
  // This tenant intentionally remains: partner-settlement events are
  // append-only/audited and must not be deleted or bypassed for test cleanup.
  // The unique TEST-only tenant is isolated from real company data.
  await db.delete(bookieOldArSettlementsTable)
    .where(eq(bookieOldArSettlementsTable.companyId, companyId));
  await pool.end();
});

describe("partner ledger through bank payment journey (real dev DB)", () => {
  it("rejects JSON and PDF requests without both concrete partner/account filters", async () => {
    for (const suffix of ["", "/pdf"]) {
      for (const query of [
        {}, { partnerId: customerId }, { accountId: ledgerAccountId },
        { partnerId: customerId, accountId: "all" },
        { partnerId: [customerId, supplierId], accountId: ledgerAccountId },
      ]) {
        const response = await supertest(app).get(`/companies/${companyId}/partner-ledger${suffix}`)
          .query(query).expect(400);
        expect(response.body.error).toContain("poslovnega partnerja in konto");
      }
    }
  });

  it("returns the selected partner/account chronologically, excluding drafts unless requested", async () => {
    const defaultAsOf = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger?partnerId=${customerId}&accountId=${ledgerAccountId}`)
      .expect(200);
    expect(defaultAsOf.body.asOfDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(defaultAsOf.body.mode).toBe("posted");
    expect(defaultAsOf.body.lines.some((line: any) => line.lineId === draftLedgerLineId)).toBe(false);
    expect(defaultAsOf.body.lines.map((line: any) => line.documentDate ?? line.postingDate)).toEqual(
      [...defaultAsOf.body.lines]
        .map((line: any) => line.documentDate ?? line.postingDate)
        .sort(),
    );
    expect(defaultAsOf.body.openingBalances).toHaveLength(1);
    expect(defaultAsOf.body.lines.some((line: any) => line.accountId === ledgerAccountId)).toBe(true);
    expect(defaultAsOf.body.lines.every((line: any) => line.accountId === ledgerAccountId)).toBe(true);

    const drafts = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger?partnerId=${customerId}&accountId=${ledgerAccountId}&dateTo=2025-12-31&mode=drafts`)
      .expect(200);
    expect(drafts.body.mode).toBe("drafts");
    expect(drafts.body.lines.map((line: any) => line.lineId)).toContain(draftLedgerLineId);
    expect(drafts.body.lines.some((line: any) => line.entryStatus !== "draft")).toBe(false);
    const [unchangedDraft] = await db.select({
      status: journalEntriesTable.status,
    }).from(journalEntriesTable)
      .innerJoin(journalEntryLinesTable, eq(journalEntryLinesTable.entryId, journalEntriesTable.id))
      .where(eq(journalEntryLinesTable.id, draftLedgerLineId));
    expect(unchangedDraft.status).toBe("draft");
  });

  it("matches legacy AR evidence to native GL source IDs for both invoice and bank counterpart", async () => {
    const invoiceSourceId = "900001";
    const bankSourceId = "900002";
    const [invoice] = await db.insert(invoicesTable).values({
      companyId, type: "issued", counterpartyId: customerId, periodId,
      invoiceNumber: `TEST-AR-PROVENANCE-${RUN_ID}`, invoiceDate: "2025-03-01",
      dueDate: "2025-03-31", status: "posted", arApAccountId: ledgerAccountId,
      createdBy: TEST_CLERK_USER_ID,
    }).returning({ id: invoicesTable.id });
    const [invoiceEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2025-03-01", entryDate: "2025-03-01",
      description: `TEST invoice [Bookie Old GLAVNA #${invoiceSourceId}]`,
      reference: `TEST-AR-INVOICE-${RUN_ID}`, status: "posted", sourceType: "manual",
      createdBy: TEST_CLERK_USER_ID,
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values([
      { entryId: invoiceEntry.id, accountId: ledgerAccountId, partnerId: customerId,
        side: "debit", amount: "61.00", description: `[Bookie Old GLAVNA #${invoiceSourceId}]`, sequence: 1 },
      { entryId: invoiceEntry.id, accountId: expenseAccountId,
        side: "credit", amount: "61.00", sequence: 2 },
    ]);
    await db.update(invoicesTable).set({ linkedEntryId: invoiceEntry.id })
      .where(eq(invoicesTable.id, invoice.id));
    const [bankEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2025-03-10", entryDate: "2025-03-10",
      description: `TEST bank receipt [Bookie Old GLAVNA #${bankSourceId}]`,
      reference: `TEST-AR-BANK-${RUN_ID}`, status: "posted", sourceType: "manual",
      createdBy: TEST_CLERK_USER_ID,
    }).returning({ id: journalEntriesTable.id });
    const bankLines = await db.insert(journalEntryLinesTable).values([
      { entryId: bankEntry.id, accountId: firstBankAccountId,
        side: "debit", amount: "61.00", sequence: 1 },
      { entryId: bankEntry.id, accountId: ledgerAccountId, partnerId: customerId,
        side: "credit", amount: "61.00", description: `[Bookie Old GLAVNA #${bankSourceId}]`, sequence: 2 },
    ]).returning({ id: journalEntryLinesTable.id, side: journalEntryLinesTable.side });
    const bankCredit = bankLines.find((line) => line.side === "credit")!;
    await db.insert(bookieOldArSettlementsTable).values({
      companyId, invoiceId: invoice.id, sourceLineId: invoiceSourceId,
      originalAmount: "61.00", closedAmount: "61.00", remainingAmount: "0.00",
      sourceAsOf: "2025-12-31",
      evidence: [{ closingId: `TEST-AR-CLOSE-${RUN_ID}`, otherLineId: bankSourceId,
        amount: "61.00", recordedDate: "3/10/2025" }],
      sourceSha256: `test-ar-provenance-${RUN_ID}`,
    });
    try {
      const snapshot = await db.select({
        sourceLineId: bookieOldArSettlementsTable.sourceLineId,
      }).from(bookieOldArSettlementsTable).where(and(
        eq(bookieOldArSettlementsTable.companyId, companyId),
        eq(bookieOldArSettlementsTable.invoiceId, invoice.id),
      ));
      expect(snapshot).toEqual([{ sourceLineId: invoiceSourceId }]);
      const card = await supertest(app)
        .get(`/companies/${companyId}/partner-ledger`)
        .query({ partnerId: customerId, accountId: ledgerAccountId, dateTo: "2025-12-31" })
        .expect(200);
      const invoiceLine = card.body.lines.find((line: any) =>
        line.description.includes(`#${invoiceSourceId}`));
      const bankLine = card.body.lines.find((line: any) => line.lineId === bankCredit.id);
      expect(invoiceLine?.openDebit).toBe("0.00");
      expect(bankLine?.openCredit).toBe("0.00");
      expect(invoiceLine.closings).toContainEqual(expect.objectContaining({
        source: "bookie_old_ar", oppositeLineId: bankCredit.id, warning: null,
      }));
      const bankClosing = bankLine.closings.find((closing: any) => closing.source === "bookie_old_ar");
      expect(bankClosing?.oppositeLineId).toBe(invoiceLine.lineId);
      expect(bankClosing).not.toHaveProperty("warning");
    } finally {
      await db.delete(bookieOldArSettlementsTable).where(and(
        eq(bookieOldArSettlementsTable.companyId, companyId),
        eq(bookieOldArSettlementsTable.invoiceId, invoice.id),
      ));
    }
  });

  it("applies original GLAVNA/ZAPIRANJE evidence once across reciprocated native lines", async () => {
    const sourceLineId = "993991";
    const otherSourceLineId = "993992";
    const reference = "BOOKIE-OLD/K2/2021/60/000273";
    const sourceDescription = `TEST native proof [Bookie Old GLAVNA #${sourceLineId}, konto 1200000, partner 100171 Test partner]`;
    const otherDescription = `TEST native proof [Bookie Old GLAVNA #${otherSourceLineId}, konto 1200000, partner 100171 Test partner]`;
    const createNativeLine = async (line: {
      description: string; side: "debit" | "credit";
    }) => {
      const [entry] = await db.insert(journalEntriesTable).values({
        companyId, periodId, documentDate: "2021-10-30", entryDate: "2021-10-30",
        description: "TEST original source proof", reference, status: "posted",
        sourceType: "manual", createdBy: TEST_CLERK_USER_ID,
      }).returning({ id: journalEntriesTable.id });
      const [native] = await db.insert(journalEntryLinesTable).values({
        entryId: entry.id, accountId: ledgerAccountId, partnerId: customerId,
        side: line.side, amount: "48.80", description: line.description, sequence: 1,
      }).returning({ id: journalEntryLinesTable.id });
      return native.id;
    };
    const sourceNativeId = await createNativeLine({
      description: sourceDescription, side: "debit",
    });
    const otherNativeId = await createNativeLine({
      description: otherDescription, side: "credit",
    });
    const proof = (id: string, side: "debit" | "credit") => ({
      sourceLineId: id, year: "2021", type: "60", voucherNumber: "000273",
      documentNumber: "000273", ledgerCode: "K2", accountCode: "1200000",
      partnerCode: "100171", partnerName: "Test partner", sides: [{ side, amount: "48.80" }],
      documentDate: "2021-10-30", postingDate: "2021-10-30", durDate: "2021-10-30",
    });
    const first = {
      closingId: "777771", sourceLineId, otherSourceLineId, amount: "48.80",
      recordedDate: "2021-10-30", sourceProof: proof(sourceLineId, "debit"),
      counterpartProof: proof(otherSourceLineId, "credit"),
    };
    const reciprocal = {
      closingId: "777772", sourceLineId: otherSourceLineId, otherSourceLineId: sourceLineId,
      amount: "48.80", recordedDate: "2021-10-30",
      sourceProof: proof(otherSourceLineId, "credit"), counterpartProof: proof(sourceLineId, "debit"),
    };
    await db.insert(bookieOldNativeLedgerEvidenceTable).values([
      {
        companyId, nativeLineId: sourceNativeId, sourceLineId,
        durDate: "2021-10-30", originalDocumentNumber: "000273",
        originalGlMetadata: { ...proof(sourceLineId, "debit"), side: "debit", amount: "48.80" },
        originalClosings: [{ ...first, anchorSide: "source" }, { ...reciprocal, anchorSide: "counterpart" }],
        sourceDigest: "a".repeat(64),
      },
      {
        companyId, nativeLineId: otherNativeId, sourceLineId: otherSourceLineId,
        durDate: "2021-10-30", originalDocumentNumber: "000273",
        originalGlMetadata: { ...proof(otherSourceLineId, "credit"), side: "credit", amount: "48.80" },
        originalClosings: [{ ...first, anchorSide: "counterpart" }, { ...reciprocal, anchorSide: "source" }],
        sourceDigest: "a".repeat(64),
      },
    ]);

    const response = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger?partnerId=${customerId}&accountId=${ledgerAccountId}&dateTo=2025-12-31`)
      .expect(200);
    const sourceLine = response.body.lines.find((line: any) => line.lineId === sourceNativeId);
    const otherLine = response.body.lines.find((line: any) => line.lineId === otherNativeId);
    expect(sourceLine).toMatchObject({
      openDebit: "0.00", durDate: "2021-10-30", originalDocumentNumber: "000273",
    });
    expect(otherLine).toMatchObject({
      openCredit: "0.00", durDate: "2021-10-30", originalDocumentNumber: "000273",
    });
    expect(sourceLine.closings.filter((closing: any) => closing.source === "bookie_old_native_gl_zap"))
      .toHaveLength(1);
    expect(otherLine.closings.filter((closing: any) => closing.source === "bookie_old_native_gl_zap"))
      .toHaveLength(1);
    expect(sourceLine.closings.find((closing: any) => closing.source === "bookie_old_native_gl_zap"))
      .toMatchObject({ closingId: "777771", originalClosingIds: ["777771", "777772"] });
  });

  it("groups historical open amounts into turnover for the requested period", async () => {
    const close = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`)
      .send({
        allocations: [{ sourceLineId: turnoverDebitLineId, targetLineId: turnoverCreditLineId, amount: 25 }],
        effectiveDate: "2025-02-20",
        idempotencyKey: `turnover-close-${RUN_ID}`,
        reason: "TEST historical open balance",
      }), 201);
    expect(close.body.events).toHaveLength(1);

    const response = await supertest(app)
      .get(`/companies/${companyId}/partner-turnover?partnerId=${customerId}&dateFrom=2025-02-01&dateTo=2025-02-28`)
      .expect(200);
    const row = response.body.rows.find((item: any) => item.accountId === ledgerAccountId && item.partnerId === customerId);
    expect(row).toBeDefined();
    expect(row.debit).toBe("0.00");
    expect(row.credit).toBe("100.00");
    // The pre-period debit remains represented after the historical partial close.
    expect(row.openDebit).toBe("75.00");
    expect(row.openCredit).toBe("75.00");
  });

  it("supports partial close/reopen idempotent retries and rejects over-close/reopen caps", async () => {
    const closeRequest = {
      allocations: [{ sourceLineId: closeDebitLineId, targetLineId: closeCreditLineId, amount: 30 }],
      effectiveDate: "2025-02-01",
      idempotencyKey: `manual-close-${RUN_ID}`,
      reason: "TEST partial close",
    };
    const firstClose = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`).send(closeRequest), 201);
    expect(firstClose.body.events).toHaveLength(1);
    const closeId = firstClose.body.events[0].id as string;
    expect(closeId).toMatch(/^[0-9a-f-]{36}$/i);

    const duplicateClose = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`).send(closeRequest);
    expect([200, 201]).toContain(duplicateClose.status);
    expect(duplicateClose.body.events?.[0]?.id ?? duplicateClose.body.event?.id).toBe(closeId);
    const activeEventsAfterRetry = await db.select({ id: partnerSettlementEventsTable.id })
      .from(partnerSettlementEventsTable)
      .where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        eq(partnerSettlementEventsTable.idempotencyKey, `${closeRequest.idempotencyKey}:0`),
      ));
    expect(activeEventsAfterRetry).toHaveLength(1);

    const overClose = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`)
      .send({
        ...closeRequest,
        allocations: [{ sourceLineId: closeDebitLineId, targetLineId: closeCreditLineId, amount: 31 }],
        idempotencyKey: `over-close-${RUN_ID}`,
      });
    expect(overClose.status).toBe(409);

    const reopenRequest = {
      amount: 10,
      effectiveDate: "2025-02-05",
      idempotencyKey: `manual-reopen-${RUN_ID}`,
      reason: "TEST partial reopen",
    };
    const firstReopen = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${closeId}/reopen`)
      .send(reopenRequest), 201);
    const reopenId = firstReopen.body.event.id as string;
    const duplicateReopen = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${closeId}/reopen`)
      .send(reopenRequest);
    expect([200, 201]).toContain(duplicateReopen.status);
    expect(duplicateReopen.body.event?.id).toBe(reopenId);
    const reopenCount = await db.select({ id: partnerSettlementEventsTable.id })
      .from(partnerSettlementEventsTable)
      .where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        eq(partnerSettlementEventsTable.closeEventId, closeId),
      ));
    expect(reopenCount).toHaveLength(1);

    const tooMuchReopen = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${closeId}/reopen`)
      .send({ ...reopenRequest, amount: 21, idempotencyKey: `too-much-reopen-${RUN_ID}` });
    expect(tooMuchReopen.status).toBe(409);
    const futureClose = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`)
      .send({
        allocations: [{ sourceLineId: closeDebitLineId, targetLineId: closeCreditLineId, amount: 20 }],
        effectiveDate: "2025-02-10",
        idempotencyKey: `future-close-${RUN_ID}`,
        reason: "TEST future-effective close",
      }), 201);
    expect(futureClose.body.events).toHaveLength(1);
    const beforeFutureEffectiveDate = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger?partnerId=${customerId}&accountId=${secondLedgerAccountId}&dateTo=2025-02-08`)
      .expect(200);
    expect(beforeFutureEffectiveDate.body.lines.find((line: any) => line.lineId === closeDebitLineId).openDebit).toBe("40.00");
    const ledger = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger?partnerId=${customerId}&accountId=${secondLedgerAccountId}&dateTo=2025-02-11`)
      .expect(200);
    const source = ledger.body.lines.find((line: any) => line.lineId === closeDebitLineId);
    expect(source.openDebit).toBe("20.00");
    expect(source.closings.some((event: any) => event.type === "reopen" && event.amount === "10.00")).toBe(true);
  });

  it("atomically rejects an invalid second supplier, then creates and replays a valid batch on the selected TRR", async () => {
    const journalIdsBeforeBatch = (await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))).map(row => row.id).sort();
    const base = {
      bankAccountId: selectedBankAccountId,
      periodId,
      paymentDate: "2025-03-20",
      idempotencyKey: `atomic-proposal-${RUN_ID}`,
    };
    const invalidBatch = await supertest(app)
      .post(`/companies/${companyId}/payment-batches`)
      .send({
        ...base,
        proposedPayments: [
          { counterpartyId: supplierId, arApAccountId, allocations: [{ invoiceId: validInvoiceId, amount: 100 }] },
          // Deliberately assign a different supplier's real invoice to supplier 1.
          { counterpartyId: supplierId, arApAccountId, allocations: [{ invoiceId: wrongSupplierInvoiceId, amount: 40 }] },
        ],
      });
    expect(invalidBatch.status).toBe(409);
    const afterRollback = await db.select({ id: paymentsTable.id }).from(paymentsTable)
      .where(eq(paymentsTable.companyId, companyId));
    expect(afterRollback).toHaveLength(3); // posted/reconciliation and external-allocation fixtures
    const noBatchAfterRollback = await db.select({ id: paymentBatchesTable.id }).from(paymentBatchesTable)
      .where(eq(paymentBatchesTable.companyId, companyId));
    expect(noBatchAfterRollback).toHaveLength(0);

    const validProposal = {
      ...base,
      proposedPayments: [{
        counterpartyId: supplierId,
        arApAccountId,
        allocations: [{ invoiceId: validInvoiceId, amount: 100 }],
      }],
    };
    const created = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/payment-batches`).send(validProposal), 201);
    expect(created.body.batch.bankAccountId).toBe(selectedBankAccountId);
    expect(created.body.payments).toHaveLength(1);
    expect(created.body.payments[0].status).toBe("draft");
    const replay = await supertest(app)
      .post(`/companies/${companyId}/payment-batches`).send(validProposal).expect(200);
    expect(replay.body.replayed).toBe(true);
    expect(replay.body.batch.id).toBe(created.body.batch.id);
    expect(replay.body.payments.map((payment: any) => payment.id)).toEqual(
      created.body.payments.map((payment: any) => payment.id),
    );

    const xml = await supertest(app)
      .get(`/companies/${companyId}/payment-batches/${created.body.batch.id}/sepa.xml`)
      .expect(200);
    expect(xml.text).toContain("<DbtrAcct><Id><IBAN>GB29NWBK60161331926819</IBAN></Id></DbtrAcct>");
    expect(xml.text).not.toContain("<IBAN>GB82WEST12345698765432</IBAN>");
    const [stillDraft] = await db.select({
      status: paymentsTable.status,
      linkedEntryId: paymentsTable.linkedEntryId,
    }).from(paymentsTable).where(eq(paymentsTable.id, created.body.payments[0].id));
    expect(stillDraft).toEqual({ status: "draft", linkedEntryId: null });
    const [exportedBatch] = await db.select({
      status: paymentBatchesTable.status,
      exportedAt: paymentBatchesTable.exportedAt,
    }).from(paymentBatchesTable).where(eq(paymentBatchesTable.id, created.body.batch.id));
    expect(exportedBatch.status).toBe("exported");
    expect(exportedBatch.exportedAt).not.toBeNull();
    expect(xml.text).toContain("<CdtrAcct><Id><IBAN>DE89370400440532013000</IBAN></Id></CdtrAcct>");
    expect(xml.text).not.toContain("<IBAN>GB82WEST12345698765432</IBAN>");
    const entriesAfterExport = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    expect(entriesAfterExport.map(row => row.id)).toContain(postedJournalEntryId);
    expect(entriesAfterExport.map(row => row.id).sort()).toEqual(journalIdsBeforeBatch);

    const openItemsBeforeRelease = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .query({ counterpartyId: supplierId, type: "received", asOfDate: "2025-03-31" })
      .expect(200);
    const batchedInvoice = openItemsBeforeRelease.body.items.find((item: any) => item.invoiceId === validInvoiceId);
    expect(batchedInvoice?.activePaymentBatchId).toBe(created.body.batch.id);

    const released = await supertest(app)
      .post(`/companies/${companyId}/payment-batches/${created.body.batch.id}/lifecycle`)
      .send({
        action: "cancel",
        reason: "TEST release exported instruction for fixture reuse",
        confirmExportedRisk: true,
      }).expect(200);
    expect(released.body).toMatchObject({
      batchId: created.body.batch.id,
      status: "cancelled",
      paymentIds: [created.body.payments[0].id],
      releasedForRepackaging: [created.body.payments[0].id],
      monetaryReversal: false,
    });
    const auditedRelease = await db.select({ action: auditLogTable.action, payload: auditLogTable.payload })
      .from(auditLogTable).where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityType, "payment_batch"),
        eq(auditLogTable.entityId, created.body.batch.id),
        eq(auditLogTable.action, "cancel"),
      ));
    expect(auditedRelease).toHaveLength(1);
    expect(auditedRelease[0]?.payload).toMatchObject({
      reason: "TEST release exported instruction for fixture reuse",
      exported: true,
      exportedRiskConfirmed: true,
      monetaryReversal: false,
    });
    const openItemsAfterRelease = await supertest(app)
      .get(`/companies/${companyId}/open-items`)
      .query({ counterpartyId: supplierId, type: "received", asOfDate: "2025-03-31" })
      .expect(200);
    const releasedInvoice = openItemsAfterRelease.body.items.find((item: any) => item.invoiceId === validInvoiceId);
    expect(releasedInvoice).toBeDefined();
    expect(releasedInvoice.activePaymentBatchId).toBeNull();
  });

  it("reconciles a registered line to an existing posted payment without duplicate journals, and splits a draft remainder", async () => {
    const entriesBefore = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    const paymentsBeforeReconcile = await db.select({ id: paymentsTable.id })
      .from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const postedBefore = await supertest(app)
      .post(`/companies/${companyId}/bank-statements/lines/${reconcilePostedLineId}/reconcile`)
      .send({ paymentId: postedPaymentId }).expect(200);
    expect(postedBefore.body.status).toBe("posted");
    expect(postedBefore.body.requiresExplicitPosting).toBe(false);
    const [attachedPosted] = await db.select({
      bankStatementLineId: paymentsTable.bankStatementLineId,
      linkedEntryId: paymentsTable.linkedEntryId,
    }).from(paymentsTable).where(eq(paymentsTable.id, postedPaymentId));
    expect(attachedPosted).toEqual({
      bankStatementLineId: reconcilePostedLineId,
      linkedEntryId: postedJournalEntryId,
    });
    const entriesAfter = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    expect(entriesAfter.map(row => row.id)).toEqual(entriesBefore.map(row => row.id));
    const paymentsAfterPostedReconcile = await db.select({ id: paymentsTable.id })
      .from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    expect(paymentsAfterPostedReconcile).toHaveLength(paymentsBeforeReconcile.length);
    expect(paymentsAfterPostedReconcile.map(payment => payment.id).sort()).toEqual(
      paymentsBeforeReconcile.map(payment => payment.id).sort(),
    );

    const partial = await supertest(app)
      .post(`/companies/${companyId}/bank-statements/lines/${reconcileDraftLineId}/reconcile`)
      .send({ paymentId: partialDraftPaymentId }).expect(200);
    expect(partial.body.actualAmount).toBe("60.00");
    expect(partial.body.status).toBe("draft");
    expect(partial.body.requiresExplicitPosting).toBe(true);
    const payments = await db.select({
      id: paymentsTable.id,
      amount: paymentsTable.amount,
      status: paymentsTable.status,
      bankStatementLineId: paymentsTable.bankStatementLineId,
    }).from(paymentsTable).where(eq(paymentsTable.companyId, companyId));
    const remainder = payments.find(payment => payment.id !== postedPaymentId && payment.id !== partialDraftPaymentId
      && payment.amount === "40.00");
    expect(remainder).toBeDefined();
    expect(remainder?.status).toBe("draft");
    expect(remainder?.bankStatementLineId).toBeNull();
    const original = payments.find(payment => payment.id === partialDraftPaymentId);
    expect(original?.amount).toBe("60.00");
    expect(original?.bankStatementLineId).toBe(reconcileDraftLineId);
    const allocations = await db.select({
      paymentId: paymentAllocationsTable.paymentId,
      amount: paymentAllocationsTable.allocatedAmount,
      invoiceId: paymentAllocationsTable.invoiceId,
    }).from(paymentAllocationsTable);
    expect(allocations.find(row => row.paymentId === partialDraftPaymentId)?.amount).toBe("60.00");
    expect(allocations.find(row => row.paymentId === remainder?.id)?.amount).toBe("40.00");
    const finalEntries = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    expect(finalEntries.map(row => row.id)).toEqual(entriesBefore.map(row => row.id));
  });

  it("partially reopens a posted-payment allocation by its stable external closing ID without changing payment or journal", async () => {
    const asOfBefore = "2025-03-31";
    const asOfAfter = "2025-04-01";
    const getOpenItem = async (asOfDate: string) => {
      const response = await supertest(app)
        .get(`/companies/${companyId}/open-items`)
        .query({ counterpartyId: supplierId, type: "received", asOfDate })
        .expect(200);
      return response.body.items.find((item: any) => item.invoiceId === externalReopenInvoiceId);
    };
    const openBefore = await getOpenItem(asOfBefore);
    expect(openBefore?.remainingAmount).toBe("40.00");

    const cardBefore = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: arApAccountId, dateTo: asOfBefore })
      .expect(200);
    const invoiceCardLine = cardBefore.body.lines.find((line: any) => line.lineId === externalReopenInvoiceLineId);
    expect(invoiceCardLine).toBeDefined();
    const allocationClosing = invoiceCardLine.closings.find((closing: any) =>
      closing.source === "posted_payment_allocation" && closing.effectiveDate === "2025-03-10");
    expect(allocationClosing).toBeDefined();
    const externalClosingId = `payment-allocation:${(await db.select({
      id: paymentAllocationsTable.id,
    }).from(paymentAllocationsTable).where(and(
      eq(paymentAllocationsTable.paymentId, externalReopenPaymentId),
      eq(paymentAllocationsTable.invoiceId, externalReopenInvoiceId),
    )))[0]!.id}`;
    expect(allocationClosing.id).toBe(externalClosingId);

    const paymentBefore = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.id, externalReopenPaymentId));
    const journalBefore = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, externalReopenPaymentEntryId));
    const journalLinesBefore = await db.select().from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, externalReopenPaymentEntryId))
      .orderBy(journalEntryLinesTable.sequence);
    const reopenRequest = {
      amount: 20,
      effectiveDate: asOfAfter,
      idempotencyKey: `external-payment-reopen-${RUN_ID}`,
      reason: "TEST partial reopening of posted allocation",
    };
    const reopened = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${externalClosingId}/reopen`)
      .send(reopenRequest), 201);
    expect(reopened.body.event.externalClosingId).toBe(externalClosingId);
    expect(reopened.body.event.amount).toBe("20.00");
    expect(reopened.body.event.reason).toBe(reopenRequest.reason);

    const replay = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${externalClosingId}/reopen`)
      .send(reopenRequest), 201);
    expect(replay.body.event.id).toBe(reopened.body.event.id);
    const externalReopenRows = await db.select({ id: partnerSettlementEventsTable.id })
      .from(partnerSettlementEventsTable).where(and(
        eq(partnerSettlementEventsTable.companyId, companyId),
        eq(partnerSettlementEventsTable.externalClosingId, externalClosingId),
        eq(partnerSettlementEventsTable.eventType, "reopen"),
      ));
    expect(externalReopenRows).toHaveLength(1);

    const tooMuch = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements/${externalClosingId}/reopen`)
      .send({ ...reopenRequest, amount: 41, idempotencyKey: `external-over-reopen-${RUN_ID}` });
    expectStatus(tooMuch, 409);

    const openAfter = await getOpenItem(asOfAfter);
    expect(openAfter?.remainingAmount).toBe("60.00");
    expect(Number(openAfter.remainingAmount) - Number(openBefore.remainingAmount)).toBe(20);
    const cardAfter = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: arApAccountId, dateTo: asOfAfter })
      .expect(200);
    const invoiceLineAfter = cardAfter.body.lines.find((line: any) => line.lineId === externalReopenInvoiceLineId);
    expect(invoiceLineAfter.openCredit).toBe("60.00");
    expect(invoiceLineAfter.closings.some((closing: any) =>
      closing.type === "reopen" && closing.externalClosingId === externalClosingId && closing.amount === "20.00",
    )).toBe(true);

    const paymentAfter = await db.select().from(paymentsTable)
      .where(eq(paymentsTable.id, externalReopenPaymentId));
    const journalAfter = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, externalReopenPaymentEntryId));
    const journalLinesAfter = await db.select().from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, externalReopenPaymentEntryId))
      .orderBy(journalEntryLinesTable.sequence);
    expect(paymentAfter).toEqual(paymentBefore);
    expect(paymentAfter[0]?.status).toBe("posted");
    expect(paymentAfter[0]?.linkedEntryId).toBe(externalReopenPaymentEntryId);
    expect(journalAfter).toEqual(journalBefore);
    expect(journalLinesAfter).toEqual(journalLinesBefore);
  });

  it("allows direct-DB close of opposite effective sides when both raw lines are debit, preserving the negative debit", async () => {
    const positive = await createJournalLine({
      companyId, periodId, accountId: secondLedgerAccountId, partnerId: customerId,
      side: "debit", amount: 50, date: "2025-05-01", reference: "TEST-EFFECTIVE-SIDE-POSITIVE-DEBIT",
    });
    const negative = await createJournalLine({
      companyId, periodId, accountId: secondLedgerAccountId, partnerId: customerId,
      side: "debit", amount: -30, date: "2025-05-02", reference: "TEST-EFFECTIVE-SIDE-NEGATIVE-DEBIT",
    });
    const [event] = await db.insert(partnerSettlementEventsTable).values({
      companyId,
      partnerId: customerId,
      accountId: secondLedgerAccountId,
      sourceLineId: positive.lineId,
      targetLineId: negative.lineId,
      eventType: "close",
      amount: "20.00",
      effectiveDate: "2025-05-03",
      idempotencyKey: `direct-negative-debit-close-${RUN_ID}`,
      reason: "TEST effective-side direct DB close",
      actorId: TEST_CLERK_USER_ID,
    }).returning();
    expect(event.eventType).toBe("close");

    const rawLines = await db.select({
      id: journalEntryLinesTable.id,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(and(
      eq(journalEntryLinesTable.id, positive.lineId),
    ));
    const negativeRaw = await db.select({
      id: journalEntryLinesTable.id,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.id, negative.lineId));
    expect(rawLines[0]).toMatchObject({ id: positive.lineId, side: "debit", amount: "50.00" });
    expect(negativeRaw[0]).toMatchObject({ id: negative.lineId, side: "debit", amount: "-30.00" });

    const card = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: customerId, accountId: secondLedgerAccountId, dateTo: "2025-05-04" })
      .expect(200);
    const positiveLine = card.body.lines.find((line: any) => line.lineId === positive.lineId);
    const negativeLine = card.body.lines.find((line: any) => line.lineId === negative.lineId);
    expect(positiveLine).toMatchObject({ debit: "50.00", openDebit: "30.00" });
    expect(negativeLine).toMatchObject({ debit: "-30.00", openCredit: "10.00" });
  });

  it("hides opening documents and uses the first baseline only, without changing stored postings", async () => {
    const partnerId = await createPartner(companyId, `TEST openings ${RUN_ID}`, "customer");
    const accountId = await createAccount(companyId, "1200999", "asset");
    const first = await createJournalLine({
      companyId, periodId, accountId, partnerId, side: "debit", amount: 100,
      date: "2025-01-01", reference: "BOOKIE-OLD/K2/2025/00/000001",
    });
    const invoice = await createJournalLine({
      companyId, periodId, accountId, partnerId, side: "debit", amount: 40,
      date: "2025-02-01", reference: "BOOKIE-OLD/K2/2025/10/000001",
    });
    const [nextPeriod] = await db.insert(accountingPeriodsTable).values({
      companyId, name: "TEST 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    }).returning({ id: accountingPeriodsTable.id });
    const carry = await createJournalLine({
      companyId, periodId: nextPeriod.id, accountId, partnerId, side: "debit", amount: 140,
      date: "2026-01-01", reference: "BOOKIE-OLD/K2/2026/00/000001",
    });
    const response = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId, accountId, dateTo: "2026-01-02" }).expect(200);
    expect(response.body.lines.map((line: any) => line.lineId)).toEqual([invoice.lineId]);
    expect(response.body).toMatchObject({ openingBalance: "100.00", closingBalance: "140.00" });
    expect(response.body.lines[0]).toMatchObject({ runningBalance: "140.00", openDebit: "40.00" });
    const periodCard = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId, accountId, dateFrom: "2026-01-01", dateTo: "2026-01-02" }).expect(200);
    expect(periodCard.body).toMatchObject({ openingBalance: "140.00", closingBalance: "140.00", lines: [] });
    const stored = await db.select({ id: journalEntryLinesTable.id, amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable).where(inArray(journalEntryLinesTable.id, [first.lineId, carry.lineId]));
    expect(stored).toHaveLength(2);
    expect(stored.map(line => line.amount).sort()).toEqual(["100.00", "140.00"]);
  });

  it("serves valid partner-ledger and turnover PDFs with the same 2025 filters and JSON totals", async () => {
    const ledgerFilters = { partnerId: customerId, accountId: ledgerAccountId, dateTo: "2025-12-31" };
    const ledgerJson = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger`)
      .query(ledgerFilters)
      .expect(200);
    expect(ledgerJson.body.asOfDate).toBe(ledgerFilters.dateTo);
    expect(ledgerJson.body.mode).toBe("posted");
    const ledgerDebitTotal = ledgerJson.body.lines.reduce((sum: number, line: any) => sum + Number(line.debit), 0);
    const ledgerCreditTotal = ledgerJson.body.lines.reduce((sum: number, line: any) => sum + Number(line.credit), 0);
    expect(ledgerDebitTotal).toBe(209.8); // 100 + AR/native 61 + standalone native 48.80 fixtures
    expect(ledgerCreditTotal).toBe(209.8);

    const ledgerPdf = await supertest(app)
      .get(`/companies/${companyId}/partner-ledger/pdf`)
      .query(ledgerFilters)
      .buffer(true)
      .parse(parsePdfBuffer)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    expect(Buffer.isBuffer(ledgerPdf.body)).toBe(true);
    expect(ledgerPdf.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");

    const turnoverFilters = {
      partnerId: customerId,
      dateFrom: "2025-01-01",
      dateTo: "2025-12-31",
    };
    const turnoverJson = await supertest(app)
      .get(`/companies/${companyId}/partner-turnover`)
      .query(turnoverFilters)
      .expect(200);
    expect(turnoverJson.body).toMatchObject({
      dateFrom: turnoverFilters.dateFrom,
      dateTo: turnoverFilters.dateTo,
    });
    expect(turnoverJson.body.totals).toMatchObject({
      debit: "241.00", // includes the 61 EUR native AR fixture in 2025
      credit: "221.00",
      periodBalance: "20.00",
    });

    const turnoverPdf = await supertest(app)
      .get(`/companies/${companyId}/partner-turnover/pdf`)
      .query(turnoverFilters)
      .buffer(true)
      .parse(parsePdfBuffer)
      .expect(200)
      .expect("Content-Type", /application\/pdf/);
    expect(Buffer.isBuffer(turnoverPdf.body)).toBe(true);
    expect(turnoverPdf.body.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });

  it("prepares, exports, partially executes, posts, voids and reserves a native GL payable", async () => {
    const nativeReference = `TEST-NATIVE-${RUN_ID}`;
    const [mixedInvoice] = await db.insert(invoicesTable).values({
      companyId,
      type: "received",
      counterpartyId: supplierId,
      periodId,
      invoiceNumber: `TEST-MIXED-${RUN_ID}`,
      invoiceDate: "2025-03-01",
      dueDate: "2025-03-31",
      destinationIban: "DE89370400440532013000",
      paymentReference: nativeReference,
      // Match the native source's remittance purpose so both allocations form
      // one legitimate SEPA instruction/payment in direct batch preparation.
      paymentPurpose: nativeReference,
      status: "posted",
      arApAccountId: nativePayableAccountId,
      createdBy: TEST_CLERK_USER_ID,
    }).returning({ id: invoicesTable.id });
    await db.insert(invoiceLinesTable).values({
      invoiceId: mixedInvoice.id,
      description: "TEST mixed native batch invoice",
      quantity: "1.000",
      unitPrice: "50.0000",
      vatRate: "0.00",
      accountId: expenseAccountId,
    });
    const batchResponse = expectStatus(await supertest(app)
      .post(`/companies/${companyId}/payment-batches`)
      .send({
        bankAccountId: selectedBankAccountId,
        periodId,
        paymentDate: "2025-03-12",
        idempotencyKey: `native-batch-${RUN_ID}`,
        proposedPayments: [{
          counterpartyId: supplierId,
          arApAccountId: nativePayableAccountId,
          allocations: [
            { invoiceId: mixedInvoice.id, amount: 50 },
            { journalLineId: nativePayableLineId, amount: 50 },
          ],
        }],
      }), 201);
    const batchId = batchResponse.body.batchId as string;
    expect(batchResponse.body.payments).toHaveLength(1);
    const firstPaymentId = batchResponse.body.payments[0].id as string;
    expect(batchResponse.body.payments.reduce(
      (sum: number, payment: any) => sum + Number(payment.amount),
      0,
    )).toBe(100);
    expect(batchResponse.body.payments[0].ledgerAllocations).toMatchObject([
      { journalLineId: nativePayableLineId, allocatedAmount: "50.00" },
    ]);
    expect(batchResponse.body.payments[0].allocations).toMatchObject([
      { invoiceId: mixedInvoice.id, allocatedAmount: "50.00" },
    ]);

    const exported = await supertest(app)
      .get(`/companies/${companyId}/payment-batches/${batchId}/sepa.xml`)
      .expect(200)
      .expect("Content-Type", /application\/xml/);
    expect(exported.text).toContain("DE89370400440532013000");
    expect(exported.text).toContain(nativeReference);

    const reservedClose = await supertest(app)
      .post(`/companies/${companyId}/partner-settlements`)
      .send({
        allocations: [{ sourceLineId: nativePayableLineId, targetLineId: nativeCounterLineId, amount: 80 }],
        effectiveDate: "2025-03-12",
        idempotencyKey: `native-reservation-close-${RUN_ID}`,
        reason: "TEST close must preserve native payment reservation",
      });
    expectStatus(reservedClose, 409);

    const [statement] = await db.insert(bankStatementsTable).values({
      companyId,
      bankAccountId: selectedBankAccountId,
      sourceIban: "GB29NWBK60161331926819",
      statementNumber: `TEST-NATIVE-EXEC-${RUN_ID}`,
      statementDate: "2025-03-12",
      periodFrom: "2025-03-12",
      periodTo: "2025-03-12",
      openingBalance: "1000.00",
      closingBalance: "925.00",
      currency: "EUR",
      sourceFilename: `TEST-NATIVE-EXEC-${RUN_ID}.csv`,
      sourceSha256: `test-native-exec-${RUN_ID}`,
      createdBy: TEST_CLERK_USER_ID,
    }).returning({ id: bankStatementsTable.id });
    const [bankLine] = await db.insert(bankStatementLinesTable).values({
      statementId: statement.id,
      transactionKey: `native-exec-${RUN_ID}`,
      lineNumber: 1,
      bookingDate: "2025-03-12",
      amount: "-75.00",
      currency: "EUR",
      reference: nativeReference,
    }).returning({ id: bankStatementLinesTable.id });
    await supertest(app)
      .post(`/companies/${companyId}/bank-statements/lines/${bankLine.id}/reconcile`)
      .send({ paymentId: firstPaymentId })
      .expect(200);

    const batchItems = await db.select({
      paymentId: paymentBatchItemsTable.paymentId,
      lifecycleStatus: paymentBatchItemsTable.lifecycleStatus,
    }).from(paymentBatchItemsTable).where(eq(paymentBatchItemsTable.batchId, batchId));
    const remainderItem = batchItems.find(item => item.paymentId !== firstPaymentId);
    expect(batchItems.find(item => item.paymentId === firstPaymentId)?.lifecycleStatus).toBe("partially_executed");
    expect(remainderItem).toBeDefined();
    const partialLedger = await db.select({
      paymentId: paymentLedgerAllocationsTable.paymentId,
      allocatedAmount: paymentLedgerAllocationsTable.allocatedAmount,
    }).from(paymentLedgerAllocationsTable).where(inArray(
      paymentLedgerAllocationsTable.paymentId,
      [firstPaymentId, remainderItem!.paymentId],
    ));
    expect(partialLedger.find(row => row.paymentId === firstPaymentId)?.allocatedAmount).toBe("25.00");
    expect(partialLedger.find(row => row.paymentId === remainderItem!.paymentId)?.allocatedAmount).toBe("25.00");
    const splitInvoiceAllocations = await db.select({
      paymentId: paymentAllocationsTable.paymentId,
      allocatedAmount: paymentAllocationsTable.allocatedAmount,
    }).from(paymentAllocationsTable).where(inArray(paymentAllocationsTable.paymentId, [firstPaymentId, remainderItem!.paymentId]));
    expect(splitInvoiceAllocations.find(row => row.paymentId === firstPaymentId)?.allocatedAmount).toBe("50.00");
    expect(splitInvoiceAllocations.find(row => row.paymentId === remainderItem!.paymentId)).toBeUndefined();

    await supertest(app).post(`/companies/${companyId}/payments/${firstPaymentId}/post`).send({}).expect(200);
    const closeEvents = await db.select().from(partnerSettlementEventsTable).where(and(
      eq(partnerSettlementEventsTable.companyId, companyId),
      eq(partnerSettlementEventsTable.sourceLineId, nativePayableLineId),
      eq(partnerSettlementEventsTable.eventType, "close"),
    ));
    expect(closeEvents.some(event => event.amount === "25.00" && event.targetLineId !== null)).toBe(true);
    await supertest(app).post(`/companies/${companyId}/payments/${firstPaymentId}/void`)
      .send({ reason: "TEST native posted payment reversal", periodId }).expect(200);
    const reopenEvents = await db.select().from(partnerSettlementEventsTable).where(and(
      eq(partnerSettlementEventsTable.companyId, companyId),
      eq(partnerSettlementEventsTable.sourceLineId, nativePayableLineId),
      eq(partnerSettlementEventsTable.eventType, "reopen"),
    ));
    expect(reopenEvents).toHaveLength(1);

    await supertest(app).post(`/companies/${companyId}/payment-batches/${batchId}/lifecycle`)
      .send({
        action: "cancel",
        reason: "TEST release native unexecuted remainder",
        paymentIds: [remainderItem!.paymentId],
        confirmExportedRisk: true,
      }).expect(200);
    const released = await supertest(app)
      .post(`/companies/${companyId}/payment-batches`)
      .send({
        bankAccountId: selectedBankAccountId,
        periodId,
        paymentDate: "2025-03-12",
        cutoffDate: "2025-03-12",
        idempotencyKey: `native-released-capacity-${RUN_ID}`,
        proposedPayments: [{
          counterpartyId: supplierId,
          arApAccountId: nativePayableAccountId,
          allocations: [{ journalLineId: nativePayableLineId, amount: 80 }],
        }],
      });
    expectStatus(released, 201);
    const finalCard = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: nativePayableAccountId, dateTo: "9999-12-31" }).expect(200);
    const sourceLine = finalCard.body.lines.find((line: any) => line.lineId === nativePayableLineId);
    expect(sourceLine.openCredit).toBe("120.00");
    expect(sourceLine.closings.some((event: any) => event.type === "reopen" && event.amount === "25.00")).toBe(true);
    const [postedMixed] = await db.select({
      linkedEntryId: paymentsTable.linkedEntryId,
    }).from(paymentsTable).where(eq(paymentsTable.id, firstPaymentId));
    const [mixedReversal] = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(eq(journalEntriesTable.reversalOf, postedMixed.linkedEntryId!));
    const mixedPairLines = await db.select({ id: journalEntryLinesTable.id })
      .from(journalEntryLinesTable).where(and(
        inArray(journalEntryLinesTable.entryId, [postedMixed.linkedEntryId!, mixedReversal.id]),
        eq(journalEntryLinesTable.accountId, nativePayableAccountId),
        eq(journalEntryLinesTable.partnerId, supplierId),
      ));
    expect(mixedPairLines).toHaveLength(2);
    expect(mixedPairLines.every(({ id }) => {
      const line = finalCard.body.lines.find((cardLine: any) => cardLine.lineId === id);
      return line && line.openDebit === "0.00" && line.openCredit === "0.00";
    })).toBe(true);
    const previousDate = new Date(`${reopenEvents[0]!.effectiveDate}T00:00:00.000Z`);
    previousDate.setUTCDate(previousDate.getUTCDate() - 1);
    const previousAsOfDate = previousDate.toISOString().slice(0, 10);
    const mixedAsOfExecution = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: nativePayableAccountId, dateTo: previousAsOfDate }).expect(200);
    const expectedHistoricalSourceOpen = previousAsOfDate >= "2025-03-12" ? "95.00" : "120.00";
    expect(mixedAsOfExecution.body.lines.find((line: any) => line.lineId === nativePayableLineId).openCredit)
      .toBe(expectedHistoricalSourceOpen);
    const unifiedOpenItems = await supertest(app).get(`/companies/${companyId}/open-items`)
      .query({ counterpartyId: supplierId, accountId: nativePayableAccountId, type: "received", asOfDate: "9999-12-31" })
      .expect(200);
    expect(unifiedOpenItems.body.items.find((item: any) => item.journalLineId === nativePayableLineId)?.remainingAmount).toBe("120.00");
    expect(unifiedOpenItems.body.items.some((item: any) => mixedPairLines.some(line => line.id === item.journalLineId))).toBe(false);

    const fullNativeSource = await createJournalLine({
      companyId, periodId, accountId: nativePayableAccountId, partnerId: supplierId,
      side: "credit", amount: 40, date: "2025-03-06", reference: `TEST-NATIVE-FULL-${RUN_ID}`,
    });
    const fullPayment = await supertest(app).post(`/companies/${companyId}/payments`).send({
      counterpartyId: supplierId,
      periodId,
      direction: "outbound",
      paymentDate: "2025-03-12",
      amount: 40,
      bankAccountId: selectedBankAccountId,
      arApAccountId: nativePayableAccountId,
      reference: `TEST-NATIVE-FULL-${RUN_ID}`,
      ledgerAllocations: [{ journalLineId: fullNativeSource.lineId, allocatedAmount: 40 }],
    }).expect(201);
    const fullPaymentId = fullPayment.body.id as string;
    await supertest(app).post(`/companies/${companyId}/payments/${fullPaymentId}/post`).send({}).expect(200);
    const fullPostedCard = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: nativePayableAccountId, dateTo: "2025-03-12" }).expect(200);
    expect(fullPostedCard.body.lines.find((line: any) => line.lineId === fullNativeSource.lineId).openCredit).toBe("0.00");
    await supertest(app).post(`/companies/${companyId}/payments/${fullPaymentId}/void`)
      .send({ reason: "TEST fully allocated native payment reversal", periodId }).expect(200);
    const fullVoidedCard = await supertest(app).get(`/companies/${companyId}/partner-ledger`)
      .query({ partnerId: supplierId, accountId: nativePayableAccountId, dateTo: "9999-12-31" }).expect(200);
    const fullSourceBalance = fullVoidedCard.body.lines.find((line: any) => line.lineId === fullNativeSource.lineId);
    expect(fullSourceBalance.openCredit).toBe("40.00");
    const fullOpenItems = await supertest(app).get(`/companies/${companyId}/open-items`)
      .query({ counterpartyId: supplierId, accountId: nativePayableAccountId, type: "received", asOfDate: "9999-12-31" })
      .expect(200);
    expect(fullOpenItems.body.items.find((item: any) => item.journalLineId === fullNativeSource.lineId)?.remainingAmount)
      .toBe(fullSourceBalance.openCredit);
  });

  it("serializes concurrent native draft reservations on the same GL source", async () => {
    const source = await createJournalLine({
      companyId, periodId, accountId: nativePayableAccountId, partnerId: supplierId,
      side: "credit", amount: 50, date: "2025-03-05", reference: `TEST-NATIVE-RACE-${RUN_ID}`,
    });
    const requests = ["A", "B"].map(label => supertest(app)
      .post(`/companies/${companyId}/payments`)
      .send({
        counterpartyId: supplierId,
        periodId,
        direction: "outbound",
        paymentDate: "2025-03-12",
        amount: 40,
        bankAccountId: selectedBankAccountId,
        arApAccountId: nativePayableAccountId,
        reference: `TEST-NATIVE-RACE-${label}-${RUN_ID}`,
        ledgerAllocations: [{ journalLineId: source.lineId, allocatedAmount: 40 }],
      }));
    const results = await Promise.all(requests);
    expect(results.map(result => result.status).sort()).toEqual([201, 409]);
  });
});