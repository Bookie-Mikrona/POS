import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  db, companiesTable, accountingPeriodsTable, accountsTable, counterpartiesTable,
  journalEntriesTable, journalEntryLinesTable, invoicesTable, paymentsTable,
  paymentAllocationsTable, auditLogTable,
} from "@workspace/db";
import {
  deleteDraftJournalEntry, getJournalEntryDeletionFailure, JournalEntryDeletionError,
} from "./journalEntryDeletion";

const runId = randomUUID();
let companyId = "";
let periodId = "";
let accountId = "";
let counterpartyId = "";

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TEST_DELETE_${runId}`, naziv: `Journal deletion test ${runId}`,
  }).returning();
  companyId = company.id;
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "Test 2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const [account] = await db.insert(accountsTable).values({
    companyId, code: "2200000", name: "Test account", type: "liability",
  }).returning();
  accountId = account.id;
  const [counterparty] = await db.insert(counterpartiesTable).values({
    companyId, name: "Test supplier", type: "supplier",
  }).returning();
  counterpartyId = counterparty.id;
});

afterAll(async () => {
  // Only this test's isolated tenant; never touch existing user data.
  if (!companyId) return;
  const payments = await db.select({ id: paymentsTable.id }).from(paymentsTable)
    .where(eq(paymentsTable.companyId, companyId));
  for (const payment of payments) {
    await db.delete(paymentAllocationsTable).where(eq(paymentAllocationsTable.paymentId, payment.id));
  }
  await db.delete(paymentsTable).where(eq(paymentsTable.companyId, companyId));
  await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(auditLogTable).where(eq(auditLogTable.companyId, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

async function fixture(invoiceStatus: "draft" | "posted" = "draft") {
  const [entry] = await db.insert(journalEntriesTable).values({
    companyId, periodId, entryDate: "2026-01-05", documentDate: "2026-01-05",
    description: "Historical import draft", reference: randomUUID(), createdBy: "bookie-old-k2-import",
  }).returning();
  await db.insert(journalEntryLinesTable).values({
    entryId: entry.id, accountId, side: "credit", amount: "33.78", sequence: 0,
  });
  const [invoice] = await db.insert(invoicesTable).values({
    companyId, periodId, counterpartyId, arApAccountId: accountId,
    invoiceNumber: randomUUID(), invoiceDate: "2026-01-05", type: "received",
    status: invoiceStatus, linkedEntryId: entry.id, sourceType: "bookie-old",
    historicalNet: "31.66", historicalVat: "2.12", historicalGross: "33.78",
    historicalReference: entry.reference, createdBy: "bookie-old-k2-import",
  }).returning();
  return { entry, invoice };
}

async function payment(linkedEntryId: string | null = null) {
  const [row] = await db.insert(paymentsTable).values({
    companyId, periodId, counterpartyId, direction: "outbound", paymentDate: "2026-01-05",
    amount: "33.78", bankAccountId: accountId, arApAccountId: accountId,
    linkedEntryId, createdBy: "test",
  }).returning();
  return row;
}

describe("draft journal deletion with invoice links", () => {
  it("detaches a historical draft invoice but preserves its identity and amounts, removes lines and audits", async () => {
    const { entry, invoice } = await fixture();
    await deleteDraftJournalEntry(companyId, entry.id, "test-actor");
    const [remaining] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(remaining).toEqual({
      ...invoice, linkedEntryId: null, updatedAt: expect.any(Date),
    });
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id))).toHaveLength(0);
    expect(await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id))).toHaveLength(0);
    const [audit] = await db.select().from(auditLogTable).where(and(
      eq(auditLogTable.entityId, entry.id), eq(auditLogTable.action, "delete_draft"),
    ));
    expect(audit.changedBy).toBe("test-actor");
    expect(audit.payload).toMatchObject({
      detachedDraftInvoices: [{ id: invoice.id, invoiceNumber: invoice.invoiceNumber }],
    });
  });

  it("does not detach a posted invoice", async () => {
    const { entry, invoice } = await fixture("posted");
    await expect(deleteDraftJournalEntry(companyId, entry.id, "test")).rejects.toMatchObject({
      code: "LINKED_INVOICE",
    });
    const [remaining] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(remaining).toEqual(invoice);
    expect(await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entry.id))).toHaveLength(1);
  });

  it("does not detach a draft invoice with a payment allocation", async () => {
    const { entry, invoice } = await fixture();
    const pay = await payment();
    await db.insert(paymentAllocationsTable).values({
      paymentId: pay.id, invoiceId: invoice.id, allocatedAmount: "33.78",
    });
    await expect(deleteDraftJournalEntry(companyId, entry.id, "test")).rejects.toMatchObject({
      code: "LINKED_PAYMENT",
    });
    const [remaining] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(remaining).toEqual(invoice);
  });

  it("rolls back invoice detachment and line deletion if another protected FK blocks deletion", async () => {
    const { entry, invoice } = await fixture();
    await payment(entry.id);
    await expect(deleteDraftJournalEntry(companyId, entry.id, "test")).rejects.toMatchObject({
      cause: { code: "23503" },
    });
    const [remaining] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(remaining).toEqual(invoice);
    expect(await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id))).toHaveLength(1);
    expect(await db.select().from(auditLogTable).where(eq(auditLogTable.entityId, entry.id))).toHaveLength(0);
  });

  it.each(["posted", "reversed"] as const)("still protects %s journal entries", async status => {
    const { entry } = await fixture();
    await db.update(journalEntriesTable).set({ status }).where(eq(journalEntriesTable.id, entry.id));
    await expect(deleteDraftJournalEntry(companyId, entry.id, "test")).rejects.toMatchObject({
      code: "NOT_DELETABLE",
    });
  });

  it("does not delete another tenant's journal", async () => {
    const { entry, invoice } = await fixture();
    expect(await deleteDraftJournalEntry(randomUUID(), entry.id, "test")).toBeNull();
    const [remaining] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(remaining).toEqual(invoice);
  });
});

describe("safe deletion API failures", () => {
  it("recognizes a Drizzle-wrapped FK error instead of leaking HTML/SQL", () => {
    expect(getJournalEntryDeletionFailure(new Error("Failed query: DELETE", {
      cause: { code: "23503" },
    }))).toMatchObject({ status: 409, message: expect.stringContaining("zaščitenim") });
  });
  it("maps financial guard failures to safe conflicts", () => {
    expect(getJournalEntryDeletionFailure(new JournalEntryDeletionError("REPORTED_VAT")).status).toBe(409);
    expect(getJournalEntryDeletionFailure(new JournalEntryDeletionError("LINKED_INVOICE")).status).toBe(409);
    expect(getJournalEntryDeletionFailure(new JournalEntryDeletionError("LINKED_PAYMENT")).status).toBe(409);
  });
  it("does not leak unknown database errors", () => {
    const result = getJournalEntryDeletionFailure(new Error("secret query and SQLSTATE"));
    expect(result.status).toBe(500);
    expect(result.message).not.toMatch(/secret|SQLSTATE/);
  });
});
