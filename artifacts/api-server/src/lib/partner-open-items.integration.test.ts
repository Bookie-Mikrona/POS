import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountsTable,
  companiesTable,
  counterpartiesTable,
  db,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  partnerSettlementEventsTable,
  paymentBatchItemsTable,
  paymentBatchesTable,
  paymentLedgerAllocationsTable,
  paymentsTable,
  pool,
} from "@workspace/db";
import { loadUnifiedOpenItems } from "./partner-open-items";

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string | undefined;
let periodId: string;
let supplierId: string;
let assetAccountId: string;
let payableAccountId: string;
let expenseAccountId: string;
let bankAccountId: string;
let duplicateEntryId: string;
let duplicateSourceLineId: string;
let closedInvoiceId: string;
let nativeLineId: string;
let batchId: string;

describe("shared open-item read model with fixture company data", () => {
  beforeAll(async () => {
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `OP${runId}`,
      naziv: `Open items fixture ${runId}`,
    }).returning({ id: companiesTable.id });
    companyId = company.id;
    const [period] = await db.insert(accountingPeriodsTable).values({
      companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    }).returning({ id: accountingPeriodsTable.id });
    periodId = period.id;
    const [supplier] = await db.insert(counterpartiesTable).values({
      companyId, type: "supplier", name: `Fixture supplier ${runId}`,
    }).returning({ id: counterpartiesTable.id });
    supplierId = supplier.id;
    const [asset] = await db.insert(accountsTable).values({
      companyId, code: `12${runId}`, name: "Fixture receivable", type: "asset", isOpenItem: true,
    }).returning({ id: accountsTable.id });
    assetAccountId = asset.id;
    const [payable] = await db.insert(accountsTable).values({
      companyId, code: `22${runId}`, name: "Fixture payable", type: "liability", isOpenItem: true,
    }).returning({ id: accountsTable.id });
    payableAccountId = payable.id;
    const [expense] = await db.insert(accountsTable).values({
      companyId, code: `6${runId}`, name: "Fixture expense", type: "expense",
    }).returning({ id: accountsTable.id });
    expenseAccountId = expense.id;
    const [bank] = await db.insert(accountsTable).values({
      companyId, code: `11${runId}`, name: "Fixture bank", type: "asset",
    }).returning({ id: accountsTable.id });
    bankAccountId = bank.id;

    const [duplicateEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2026-03-10", entryDate: "2026-03-11",
      description: "Two invoices sharing one source balance", status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: journalEntriesTable.id });
    duplicateEntryId = duplicateEntry.id;
    const [duplicateSourceLine] = await db.insert(journalEntryLinesTable).values([
      { entryId: duplicateEntryId, accountId: payableAccountId, partnerId: supplierId, side: "credit", amount: "60.00" },
    ]).returning({ id: journalEntryLinesTable.id });
    duplicateSourceLineId = duplicateSourceLine.id;
    await db.insert(journalEntryLinesTable).values({
      entryId: duplicateEntryId, accountId: expenseAccountId, side: "debit", amount: "60.00",
    });
    for (const suffix of ["A", "B"]) {
      const [invoice] = await db.insert(invoicesTable).values({
        companyId, type: "received", counterpartyId: supplierId, periodId,
        invoiceNumber: `SHARED-${runId}-${suffix}`, invoiceDate: "2026-03-10",
        arApAccountId: payableAccountId, linkedEntryId: duplicateEntryId,
        status: "posted", createdBy: "open-items-fixture",
      }).returning({ id: invoicesTable.id });
      await db.insert(invoiceLinesTable).values({
        invoiceId: invoice.id, description: "Invoice half", quantity: "1", unitPrice: "24.59",
        vatRate: "22.00", vatBase: "24.59", vatAmount: "5.41", accountId: expenseAccountId,
      });
    }
    const [sharedCloseEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2026-04-10", entryDate: "2026-04-10",
      description: "One actual close against shared source", status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: journalEntriesTable.id });
    const [sharedCloseTarget] = await db.insert(journalEntryLinesTable).values([
      { entryId: sharedCloseEntry.id, accountId: payableAccountId, partnerId: supplierId, side: "debit", amount: "10.00" },
      { entryId: sharedCloseEntry.id, accountId: bankAccountId, side: "credit", amount: "10.00" },
    ]).returning({ id: journalEntryLinesTable.id });
    await db.insert(partnerSettlementEventsTable).values({
      companyId, partnerId: supplierId, accountId: payableAccountId, sourceLineId: duplicateSourceLineId,
      targetLineId: sharedCloseTarget.id,
      eventType: "close", amount: "10.00", effectiveDate: "2026-04-10",
      idempotencyKey: `fixture-shared-close-${runId}`, actorId: "open-items-fixture",
    });

    const [closedEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2026-02-01", entryDate: "2026-02-02",
      description: "Partially closed invoice", status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: journalEntriesTable.id });
    const [closedLine] = await db.insert(journalEntryLinesTable).values({
      entryId: closedEntry.id, accountId: payableAccountId, partnerId: supplierId,
      side: "credit", amount: "100.00",
    }).returning({ id: journalEntryLinesTable.id });
    const [closedInvoice] = await db.insert(invoicesTable).values({
      companyId, type: "received", counterpartyId: supplierId, periodId,
      invoiceNumber: `CLOSE-${runId}`, invoiceDate: "2026-02-01", dueDate: "2026-03-01",
      arApAccountId: payableAccountId, linkedEntryId: closedEntry.id,
      status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: invoicesTable.id });
    closedInvoiceId = closedInvoice.id;
    await db.insert(invoiceLinesTable).values({
      invoiceId: closedInvoiceId, description: "Closed invoice", quantity: "1", unitPrice: "100.00",
      vatRate: "0.00", vatBase: "100.00", vatAmount: "0.00", accountId: expenseAccountId,
    });
    const [closingCounterpart] = await db.insert(journalEntryLinesTable).values({
      entryId: closedEntry.id, accountId: payableAccountId, partnerId: supplierId,
      side: "debit", amount: "25.00", description: "Fixture closing counterpart", sequence: 1,
    }).returning({ id: journalEntryLinesTable.id });
    await db.insert(partnerSettlementEventsTable).values({
      companyId, partnerId: supplierId, accountId: payableAccountId, sourceLineId: closedLine.id,
      targetLineId: closingCounterpart.id,
      eventType: "close", amount: "25.00", effectiveDate: "2026-02-15",
      idempotencyKey: `fixture-close-${runId}`, actorId: "open-items-fixture",
    });

    const [nativeEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2026-04-01", entryDate: "2026-04-02",
      description: "Native supplier balance", status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: journalEntriesTable.id });
    const [nativeLine] = await db.insert(journalEntryLinesTable).values({
      entryId: nativeEntry.id, accountId: payableAccountId, partnerId: supplierId,
      side: "credit", amount: "80.00",
    }).returning({ id: journalEntryLinesTable.id });
    nativeLineId = nativeLine.id;
    await db.insert(journalEntryLinesTable).values({
      entryId: nativeEntry.id, accountId: expenseAccountId, side: "debit", amount: "80.00",
    });
    const [oppositeEntry] = await db.insert(journalEntriesTable).values({
      companyId, periodId, documentDate: "2026-05-01", entryDate: "2026-05-02",
      description: "Opposite-side receivable", status: "posted", createdBy: "open-items-fixture",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values([
      { entryId: oppositeEntry.id, accountId: assetAccountId, partnerId: supplierId, side: "credit", amount: "15.00" },
      { entryId: oppositeEntry.id, accountId: expenseAccountId, side: "debit", amount: "15.00" },
    ]);

    const [payment] = await db.insert(paymentsTable).values({
      companyId, counterpartyId: supplierId, periodId, direction: "outbound",
      paymentDate: "2026-04-02", amount: "10.00", bankAccountId,
      arApAccountId: payableAccountId, status: "draft", createdBy: "open-items-fixture",
    }).returning({ id: paymentsTable.id });
    const [batch] = await db.insert(paymentBatchesTable).values({
      companyId, bankAccountId, executionDate: "2026-04-15",
      idempotencyKey: `fixture-batch-${runId}`, status: "ready",
      transactionCount: "1", controlSum: "10.00", createdBy: "open-items-fixture",
    }).returning({ id: paymentBatchesTable.id });
    batchId = batch.id;
    await db.insert(paymentBatchItemsTable).values({
      batchId, paymentId: payment.id, instruction: { amount: "10.00" }, lifecycleStatus: "ready",
    });
    await db.insert(paymentLedgerAllocationsTable).values({
      paymentId: payment.id, journalLineId: nativeLineId, allocatedAmount: "10.00",
    });
  });

  afterAll(async () => {
    if (companyId) await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
    await pool.end();
  });

  it("applies GL account-role type and document-date filters to native rows", async () => {
    const received = await loadUnifiedOpenItems(companyId!, {
      asOfDate: "2026-06-30", type: "received", invoiceDateFrom: "2026-04-01", invoiceDateTo: "2026-04-30",
    });
    expect(received.items.map(item => item.journalLineId)).toContain(nativeLineId);
    expect(received.items.filter(item => item.sourceKind === "ledger")).toHaveLength(1);
    expect(received.items.find(item => item.journalLineId === nativeLineId)).toMatchObject({
      type: "received", side: "credit", paymentDirection: "outbound", dueDate: null,
      activePaymentBatchId: batchId,
    });

    const issued = await loadUnifiedOpenItems(companyId!, {
      asOfDate: "2026-06-30", type: "issued",
    });
    const opposite = issued.items.find(item => item.sourceKind === "ledger" && item.accountId === assetAccountId);
    expect(opposite).toMatchObject({
      type: "issued", side: "credit", paymentDirection: null, openDebit: "0.00", openCredit: "15.00",
    });
  });

  it("guards shared-invoice fallback against double-applying one GL close", async () => {
    let result: Awaited<ReturnType<typeof loadUnifiedOpenItems>>;
    try {
      result = await loadUnifiedOpenItems(companyId!, { asOfDate: "2026-06-30", type: "received" });
    } catch (error) {
      expect(error).toMatchObject({
        status: 409,
        code: "AMBIGUOUS_INVOICE_GL_BALANCE_MISMATCH",
      });
      expect((error as Error).message).toContain("Verify the invoice linkage and closing evidence");
      return;
    }
    const sharedInvoices = result.items.filter(item => item.sourceKind === "invoice"
      && item.entryId === duplicateEntryId);
    expect(sharedInvoices).toHaveLength(2);
    expect(sharedInvoices.reduce((sum, item) => sum + Number(item.remainingAmount), 0)).toBe(50);
    expect(result.items.filter(item => item.sourceKind === "ledger" && item.entryId === duplicateEntryId)).toHaveLength(0);
  });

  it("applies historical closes only at or before the requested as-of date", async () => {
    const before = await loadUnifiedOpenItems(companyId!, {
      asOfDate: "2026-02-14", type: "received",
    });
    const after = await loadUnifiedOpenItems(companyId!, {
      asOfDate: "2026-02-15", type: "received",
    });
    expect(before.items.find(item => item.invoiceId === closedInvoiceId)?.remainingAmount).toBe("100.00");
    expect(after.items.find(item => item.invoiceId === closedInvoiceId)?.remainingAmount).toBe("75.00");
  });
});