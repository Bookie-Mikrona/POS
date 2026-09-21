import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER_ID = "test-user-pos-ar";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_USER_ID;
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
  accountsTable,
  companiesTable,
  costCentersTable,
  counterpartiesTable,
  db,
  enoteTable,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  narocilaTable,
  paymentAllocationsTable,
  paymentsTable,
  pool,
  posBookingSettingsTable,
  postavkeTable,
  racuniTable,
  vatCodeTable,
  vatLedgerTable,
} from "@workspace/db";
import paymentsRouter from "../routes/payments";
import { syncPosBookingForDay } from "./posSyncBooking";

const DATE = "2026-08-20";
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use(paymentsRouter);
  app.use((err: any, _req: any, res: any, _next: any) => {
    res.status(err.status ?? err.statusCode ?? 500).json({ error: err.message });
  });
  return app;
}

let companyId = "";
let periodId = "";
let unitId = 0;
let costCenterId = "";
let customerId = "";
let bankAccountId = "";
let arAccountId = "";
let otherPaymentAccountId = "";
let revenueAccountId = "";
let vatAccountId = "";
let payablesAccountId = "";
let vatCode22Id = "";

async function createAccount(code: string, type: "asset" | "liability" | "revenue") {
  const [account] = await db.insert(accountsTable).values({
    companyId,
    code: `${code}-${RUN_ID}`,
    name: `Test konto ${code}`,
    type,
  }).returning({ id: accountsTable.id });
  return account.id;
}

async function createReceipt(params: {
  number: string;
  amount: string;
  customer?: boolean;
  delayDays?: number;
}) {
  const [order] = await db.insert(narocilaTable).values({
    enotaId: unitId,
    status: "zakljuceno",
    skupaj: params.amount,
  }).returning({ id: narocilaTable.id });
  const [receipt] = await db.insert(racuniTable).values({
    enotaId: unitId,
    narociloId: order.id,
    stevilkaRacuna: params.number,
    skupaj: params.amount,
    osnova: (Number(params.amount) / 1.22).toFixed(2),
    ddv: (Number(params.amount) - Number(params.amount) / 1.22).toFixed(2),
    placilnaNacin: "negotovinsko",
    status: "poslan",
    datumCas: new Date(`${DATE}T10:00:00+02:00`),
    znesekGotovina: "0.00",
    znesekKartica: "0.00",
    znesekBon: "0.00",
    znesekBonPica: "0.00",
    znesekNegotovinsko: params.amount,
    kupecCpId: params.customer ? customerId : null,
    kupecDavcnaStevilka: params.customer ? "12345678" : null,
    kupecNaziv: params.customer ? "Kupec A-računa" : null,
    dniOdloga: params.delayDays ?? null,
  }).returning({ id: racuniTable.id });
  await db.insert(postavkeTable).values({
    narociloId: order.id,
    racunId: receipt.id,
    ime: "Testna storitev",
    kolicina: 1,
    cenaKos: params.amount,
    skupaj: params.amount,
    davek: "22.00",
    vrstaArtikla: "storitev",
  });
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_POS_AR_${RUN_ID}`,
    naziv: `POS A-računi ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company.id;
  const [vatCode22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "S22"), eq(vatCodeTable.direction, "OUT")))
    .limit(1);
  vatCode22Id = vatCode22?.id ?? "";
  expect(vatCode22Id, "Globalna FURS DDV koda S22 mora biti na voljo za KIR test").toBeTruthy();
  await db.insert(accountingRolesTable).values({
    clerkUserId: TEST_USER_ID,
    companyId,
    role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId,
    name: "Test 2026",
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  periodId = period.id;

  [bankAccountId, arAccountId, otherPaymentAccountId, revenueAccountId, vatAccountId, payablesAccountId] = await Promise.all([
    createAccount("110", "asset"),
    createAccount("120", "asset"),
    createAccount("165", "asset"),
    createAccount("760", "revenue"),
    createAccount("260", "liability"),
    createAccount("220", "liability"),
  ]);
  const [center] = await db.insert(costCentersTable).values({
    companyId,
    code: `BIFE-${RUN_ID}`,
    name: "Bife",
    isActive: true,
  }).returning({ id: costCentersTable.id });
  costCenterId = center.id;
  const [unit] = await db.insert(enoteTable).values({
    companyId,
    ime: "Bife",
    costCenterId,
  }).returning({ id: enoteTable.id });
  unitId = unit.id;
  const [customer] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "customer",
    name: "Kupec A-računa",
    taxId: "12345678",
  }).returning({ id: counterpartiesTable.id });
  customerId = customer.id;
  await db.insert(posBookingSettingsTable).values({
    companyId,
    cashAccountId: bankAccountId,
    otherPaymentAccountId,
    kirArAccountId: arAccountId,
    revenueService22AccountId: revenueAccountId,
    vat22AccountId: vatAccountId,
    vat22VatCodeId: vatCode22Id,
    payablesAccountId,
    nabavaObracunAccountId: payablesAccountId,
  });
  await createReceipt({ number: `AR-${RUN_ID}`, amount: "122.00", customer: true, delayDays: 8 });
  await createReceipt({ number: `SODEXO-${RUN_ID}`, amount: "24.40" });
});

afterAll(async () => {
  if (!companyId) return;
  const payments = await db.select({ id: paymentsTable.id }).from(paymentsTable)
    .where(eq(paymentsTable.companyId, companyId));
  const paymentIds = payments.map(payment => payment.id);
  if (paymentIds.length > 0) {
    await db.delete(paymentAllocationsTable).where(inArray(paymentAllocationsTable.paymentId, paymentIds));
  }
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  const entryIds = entries.map(entry => entry.id);
  if (entryIds.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, entryIds));
  }
  const receipts = await db.select({ id: racuniTable.id, narociloId: racuniTable.narociloId }).from(racuniTable)
    .where(eq(racuniTable.enotaId, unitId));
  const receiptIds = receipts.map(receipt => receipt.id);
  if (receiptIds.length > 0) {
    await db.delete(postavkeTable).where(inArray(postavkeTable.racunId, receiptIds));
  }
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  if (entryIds.length > 0) {
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId, entryIds));
  }
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(racuniTable).where(eq(racuniTable.enotaId, unitId));
  await db.delete(narocilaTable).where(eq(narocilaTable.enotaId, unitId));
  await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await db.delete(enoteTable).where(eq(enoteTable.id, unitId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(costCentersTable).where(eq(costCentersTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("POS A-račun kot odprta terjatev", () => {
  it("izloči A-račun iz zbirnika, ustvari odprto terjatev in jo poravna prek plačila", async () => {
    const sync = await syncPosBookingForDay(companyId, DATE);
    expect(sync.skipped).toEqual([]);

    const [dailyEntry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unitId}`),
      ));
    const dailyLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, dailyEntry.id));
    expect(dailyLines).toContainEqual({
      accountId: otherPaymentAccountId,
      side: "debit",
      amount: "24.40",
    });
    expect(dailyLines.some(line => line.amount === "122.00")).toBe(false);

    const [invoice] = await db.select({
      id: invoicesTable.id,
      counterpartyId: invoicesTable.counterpartyId,
      dueDate: invoicesTable.dueDate,
      status: invoicesTable.status,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, `POS-AR-${RUN_ID}`),
    ));
    expect(invoice).toMatchObject({
      counterpartyId: customerId,
      dueDate: "2026-08-28",
      status: "posted",
    });
    expect(invoice.linkedEntryId).toBeTruthy();

    const arLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      partnerId: journalEntryLinesTable.partnerId,
      costCenterId: journalEntryLinesTable.costCenterId,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, invoice.linkedEntryId!));
    expect(arLines).toContainEqual(expect.objectContaining({
      accountId: arAccountId,
      side: "debit",
      amount: "122.00",
      partnerId: customerId,
      costCenterId: null,
    }));
    expect(arLines).toContainEqual(expect.objectContaining({
      accountId: revenueAccountId,
      side: "credit",
      amount: "100.00",
      costCenterId,
    }));
    expect(arLines).toContainEqual(expect.objectContaining({
      accountId: vatAccountId,
      side: "credit",
      amount: "22.00",
      costCenterId,
    }));
    const vatLedgerLines = await db.select({
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
      invoiceId: vatLedgerTable.invoiceId,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.invoiceId, invoice.id));
    expect(vatLedgerLines).toContainEqual({
      baseAmount: "100.00",
      vatAmount: "22.00",
      invoiceId: invoice.id,
    });

    const app = buildApp();
    const openBefore = await supertest(app).get(`/companies/${companyId}/open-items`).expect(200);
    expect(openBefore.body.items).toContainEqual(expect.objectContaining({
      invoiceId: invoice.id,
      remainingAmount: "122.00",
    }));
    const agedBefore = await supertest(app)
      .get(`/companies/${companyId}/aged-analysis?type=issued&asOfDate=2026-09-10`)
      .expect(200);
    expect(agedBefore.body.rows).toContainEqual(expect.objectContaining({
      counterpartyName: "Kupec A-računa",
      total: "122.00",
    }));

    const payment = await supertest(app).post(`/companies/${companyId}/payments`).send({
      counterpartyId: customerId,
      periodId,
      direction: "inbound",
      paymentDate: "2026-08-25",
      amount: 122,
      bankAccountId,
      arApAccountId: arAccountId,
      reference: `PLACILO-${RUN_ID}`,
      allocations: [{ invoiceId: invoice.id, allocatedAmount: 122 }],
    }).expect(201);
    await supertest(app).post(`/companies/${companyId}/payments/${payment.body.id}/post`).expect(200);

    const [paidInvoice] = await db.select({ status: invoicesTable.status }).from(invoicesTable)
      .where(eq(invoicesTable.id, invoice.id));
    expect(paidInvoice.status).toBe("paid");
    const [paymentEntry] = await db.select({ linkedEntryId: paymentsTable.linkedEntryId }).from(paymentsTable)
      .where(eq(paymentsTable.id, payment.body.id));
    const paymentLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
      partnerId: journalEntryLinesTable.partnerId,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, paymentEntry.linkedEntryId!));
    expect(paymentLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: bankAccountId, side: "debit", amount: "122.00" }),
      expect.objectContaining({
        accountId: arAccountId,
        side: "credit",
        amount: "122.00",
        partnerId: customerId,
      }),
    ]));
    const openAfter = await supertest(app).get(`/companies/${companyId}/open-items`).expect(200);
    expect(openAfter.body.items.find((item: any) => item.invoiceId === invoice.id)).toBeUndefined();

    // Drugi sync ne sme podvojiti niti A-računa niti njegove potrjene temeljnice,
    // tudi če se na izvornem POS računu pozneje izbriše kupec in bi sicer postal
    // anonimen takojšnji negotovinski promet.
    await db.update(racuniTable).set({
      kupecCpId: null,
      kupecDavcnaStevilka: null,
      kupecNaziv: null,
      dniOdloga: null,
    }).where(and(
      eq(racuniTable.enotaId, unitId),
      eq(racuniTable.stevilkaRacuna, `AR-${RUN_ID}`),
    ));
    await syncPosBookingForDay(companyId, DATE);
    const arInvoices = await db.select({
      id: invoicesTable.id,
      status: invoicesTable.status,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, `POS-AR-${RUN_ID}`),
    ));
    expect(arInvoices).toHaveLength(1);
    expect(arInvoices[0]).toMatchObject({
      id: invoice.id,
      status: "paid",
      linkedEntryId: invoice.linkedEntryId,
    });
    const allocations = await db.select({ id: paymentAllocationsTable.id })
      .from(paymentAllocationsTable).where(eq(paymentAllocationsTable.invoiceId, invoice.id));
    expect(allocations).toHaveLength(1);
    const arEntries = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable).where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:AR:AR-${RUN_ID}`),
        eq(journalEntriesTable.status, "posted"),
      ));
    expect(arEntries).toEqual([{ id: invoice.linkedEntryId }]);
    const [repeatDailyEntry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unitId}`),
      ));
    const repeatDailyLines = await db.select({ amount: journalEntryLinesTable.amount })
      .from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, repeatDailyEntry.id));
    expect(repeatDailyLines.some(line => line.amount === "122.00")).toBe(false);
  });

  it("ob manjkajočem AR kontu ne izpusti identificirane negotovinske prodaje", async () => {
    await db.update(posBookingSettingsTable).set({ kirArAccountId: null })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    await createReceipt({ number: `BREZ-AR-${RUN_ID}`, amount: "12.20", customer: true, delayDays: 8 });

    const sync = await syncPosBookingForDay(companyId, DATE);
    expect(sync.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:KIR:${DATE}`,
      reason: "KIR AR konto (terjatve do kupcev) ni nastavljen — KIR preskočen",
    }));
    const [dailyEntry] = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unitId}`),
      ));
    const dailyLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, dailyEntry.id));
    expect(dailyLines).toContainEqual(expect.objectContaining({
      accountId: otherPaymentAccountId,
      side: "debit",
      amount: "36.60",
    }));
    const omittedInvoice = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, `POS-BREZ-AR-${RUN_ID}`),
    ));
    expect(omittedInvoice).toHaveLength(0);
  });

  it("ob že potrjenem dnevnem zbirniku ne podvoji prihodkov z novo A-terjatvijo", async () => {
    await db.update(posBookingSettingsTable).set({ kirArAccountId: arAccountId })
      .where(eq(posBookingSettingsTable.companyId, companyId));
    await db.update(journalEntriesTable).set({ status: "posted" }).where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unitId}`),
    ));

    const sync = await syncPosBookingForDay(companyId, DATE);
    expect(sync.skipped).toContainEqual(expect.objectContaining({
      ref: `POS:AR:BREZ-AR-${RUN_ID}`,
      reason: expect.stringContaining("Potrjena dnevna temeljnica prodaje"),
    }));
    const historicInvoice = await db.select({ id: invoicesTable.id }).from(invoicesTable).where(and(
      eq(invoicesTable.companyId, companyId),
      eq(invoicesTable.invoiceNumber, `POS-BREZ-AR-${RUN_ID}`),
    ));
    expect(historicInvoice).toHaveLength(0);
    const historicArEntries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, companyId),
      eq(journalEntriesTable.reference, `POS:AR:BREZ-AR-${RUN_ID}`),
    ));
    expect(historicArEntries).toHaveLength(0);
  });
});