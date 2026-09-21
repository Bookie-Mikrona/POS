import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const TEST_USER = "invoice-pos-match-test-user";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = TEST_USER;
    next();
  },
}));

import express from "express";
import request from "supertest";
import Decimal from "decimal.js";
import { and, eq, inArray } from "drizzle-orm";
import {
  accountingPeriodsTable,
  accountingRolesTable,
  accountsTable,
  auditLogTable,
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  invoiceLinesTable,
  invoicesTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posBookingSettingsTable,
  posInvoiceLinksTable,
  posReceiptBookingSourcesTable,
  prejemnicePostavkeTable,
  prejemniceTable,
  purchaseSourceDocumentsTable,
  vatCodeTable,
  vatLedgerTable,
} from "@workspace/db";
import invoicesRouter from "./invoices";

function app() {
  const instance = express();
  instance.use(express.json());
  instance.use(invoicesRouter);
  instance.use((error: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: error.message });
  });
  return instance;
}

const runId = Math.random().toString(36).slice(2, 10);
let companyId: string;
let otherCompanyId: string;
let supplierId: string;
let periodId: string;
let accountId: string;
let enotaId: number;
let invoiceId: string;
let otherInvoiceId: string;
let exactReceiptId: number;
let mismatchReceiptId: number;
let amountOnlyReceiptId: number;
let lowReceiptId1: number;
let lowReceiptId2: number;
let modeASourcedReceiptId: number | undefined;
let pos109AccountId: string;
let inputVat22AccountId: string;
let inventoryAccountId: string;
let inputVat22CodeId: string;

async function createCompany(label: string) {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI286${runId}${label}`,
    naziv: `Invoice POS test ${label}`,
  }).returning({ id: companiesTable.id });
  await db.insert(accountingRolesTable).values({
    companyId: company.id,
    clerkUserId: TEST_USER,
    role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId: company.id,
    name: `2026 ${label}`,
    startDate: "2026-01-01",
    endDate: "2026-12-31",
    status: "open",
  }).returning({ id: accountingPeriodsTable.id });
  const [account] = await db.insert(accountsTable).values({
    companyId: company.id,
    code: `220-${label}-${runId}`,
    name: "Obveznosti",
    type: "liability",
  }).returning({ id: accountsTable.id });
  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId: company.id,
    type: "supplier",
    name: `Supplier ${label}`,
  }).returning({ id: counterpartiesTable.id });
  const [enota] = await db.insert(enoteTable).values({
    companyId: company.id,
    ime: `Enota ${label}`,
  }).returning({ id: enoteTable.id });
  return { companyId: company.id, periodId: period.id, accountId: account.id, supplierId: supplier.id, enotaId: enota.id };
}

async function createAccount(code: string, type: "asset" | "expense") {
  const [row] = await db.insert(accountsTable).values({
    companyId,
    code: `${code}-${runId}`,
    name: code,
    type,
  }).returning({ id: accountsTable.id });
  return row.id;
}

async function createInvoice(opts: {
  companyId: string;
  supplierId: string;
  periodId: string;
  accountId: string;
  number: string;
  amount: string;
}) {
  const [invoice] = await db.insert(invoicesTable).values({
    companyId: opts.companyId,
    type: "received",
    counterpartyId: opts.supplierId,
    periodId: opts.periodId,
    invoiceNumber: opts.number,
    invoiceDate: "2026-02-10",
    status: "draft",
    arApAccountId: opts.accountId,
    createdBy: TEST_USER,
  }).returning({ id: invoicesTable.id });
  await db.insert(invoiceLinesTable).values({
    invoiceId: invoice.id,
    description: "Blago",
    quantity: "1.000",
    unitPrice: opts.amount,
    vatRate: "0.00",
    accountId: opts.accountId,
  });
  return invoice.id;
}

async function createReceipt(opts: {
  enotaId: number;
  supplierId: string;
  number: string;
  amount: string;
  date?: string;
}) {
  const [receipt] = await db.insert(prejemniceTable).values({
    enotaId: opts.enotaId,
    dobaviteljId: opts.supplierId,
    stevilka: `P-${opts.number}`,
    datum: new Date(`${opts.date ?? "2026-02-10"}T12:00:00.000Z`),
    stDokumenta: opts.number,
    datumDokumenta: opts.date ?? "2026-02-10",
    skupajVrednost: opts.amount,
  }).returning({ id: prejemniceTable.id });
  return receipt.id;
}

beforeAll(async () => {
  const main = await createCompany("MAIN");
  companyId = main.companyId;
  supplierId = main.supplierId;
  periodId = main.periodId;
  accountId = main.accountId;
  enotaId = main.enotaId;
  const other = await createCompany("OTHER");
  otherCompanyId = other.companyId;

  invoiceId = await createInvoice({
    companyId,
    supplierId,
    periodId,
    accountId,
    number: "INV-2026/01",
    amount: "100.0000",
  });
  otherInvoiceId = await createInvoice({
    companyId,
    supplierId,
    periodId,
    accountId,
    number: "OTHER-1",
    amount: "10.0000",
  });

  exactReceiptId = await createReceipt({ enotaId, supplierId, number: "inv 2026 01", amount: "100.00" });
  mismatchReceiptId = await createReceipt({ enotaId, supplierId, number: "INV-2026/01", amount: "99.00" });
  amountOnlyReceiptId = await createReceipt({ enotaId, supplierId, number: "DIFFERENT", amount: "100.00" });
  lowReceiptId1 = await createReceipt({ enotaId, supplierId, number: "LOW-A", amount: "7.00", date: "2026-02-12" });
  lowReceiptId2 = await createReceipt({ enotaId, supplierId, number: "LOW-B", amount: "8.00", date: "2026-02-12" });

  pos109AccountId = await createAccount("109", "asset");
  inputVat22AccountId = await createAccount("160", "asset");
  inventoryAccountId = await createAccount("310", "asset");
  await db.insert(posBookingSettingsTable).values({
    companyId,
    nabavaObracunAccountId: pos109AccountId,
    inputVat22AccountId,
  });
  const [p22] = await db.select({ id: vatCodeTable.id }).from(vatCodeTable)
    .where(and(eq(vatCodeTable.direction, "IN"), eq(vatCodeTable.rate, "22.00")))
    .limit(1);
  expect(p22).toBeDefined();
  inputVat22CodeId = p22.id;
});

afterAll(async () => {
  await db.delete(posInvoiceLinksTable).where(inArray(posInvoiceLinksTable.companyId, [companyId, otherCompanyId]));
  await db.delete(auditLogTable).where(inArray(auditLogTable.companyId, [companyId, otherCompanyId]));
  if (modeASourcedReceiptId) {
    await db.update(prejemniceTable).set({ sourceDocumentId: null })
      .where(eq(prejemniceTable.id, modeASourcedReceiptId));
  }
  const invoices = await db.select({ id: invoicesTable.id }).from(invoicesTable)
    .where(inArray(invoicesTable.companyId, [companyId, otherCompanyId]));
  await db.delete(invoiceLinesTable).where(inArray(invoiceLinesTable.invoiceId, invoices.map(row => row.id)));
  await db.delete(invoicesTable).where(inArray(invoicesTable.id, invoices.map(row => row.id)));
  const entries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
    .where(inArray(journalEntriesTable.companyId, [companyId, otherCompanyId]));
  if (entries.length > 0) {
    await db.delete(vatLedgerTable).where(inArray(vatLedgerTable.journalEntryId, entries.map(row => row.id)));
  }
  await db.delete(journalEntriesTable).where(inArray(journalEntriesTable.companyId, [companyId, otherCompanyId]));
  await db.delete(purchaseSourceDocumentsTable)
    .where(inArray(purchaseSourceDocumentsTable.companyId, [companyId, otherCompanyId]));
  await db.delete(companiesTable).where(inArray(companiesTable.id, [companyId, otherCompanyId]));
});

describe.sequential("invoice POS prejemnica matching", () => {
  it("uses canonical numbers and returns deterministic confidence-first candidates", async () => {
    const first = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .expect(200);
    const second = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .expect(200);

    expect(first.body.candidates.map((candidate: any) => candidate.prejemnicaId)).toEqual(
      second.body.candidates.map((candidate: any) => candidate.prejemnicaId),
    );
    expect(first.body.candidates[0]).toMatchObject({
      prejemnicaId: exactReceiptId,
      matchMethod: "exact",
      confidence: 1,
    });
    expect(first.body.candidates.map((candidate: any) => candidate.confidence)).toEqual([1, 0.85, 0.7, 0.35, 0.35]);
    const lowIds = first.body.candidates.slice(-2).map((candidate: any) => candidate.prejemnicaId);
    expect(lowIds).toEqual([Math.min(lowReceiptId1, lowReceiptId2), Math.max(lowReceiptId1, lowReceiptId2)]);
  });

  it("downgrades false exact server-side and persists complete linked history", async () => {
    const linked = await request(app())
      .put(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: mismatchReceiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "exact",
      })
      .expect(200);

    expect(linked.body.links).toHaveLength(1);
    expect(linked.body.links[0]).toMatchObject({
      prejemnicaId: mismatchReceiptId,
      matchMethod: "suggested",
      matchedBy: TEST_USER,
      status: "confirmed",
    });
    expect(new Date(linked.body.links[0].matchedAt).toString()).not.toBe("Invalid Date");
    expect(linked.body.matchHistory[0]).toMatchObject({
      action: "linked",
      status: "confirmed",
      prejemnicaId: mismatchReceiptId,
      changedBy: TEST_USER,
      mode: "invoice_with_delivery_notes",
      matchMethod: "suggested",
    });

    const [stored] = await db.select({
      method: posInvoiceLinksTable.matchMethod,
    }).from(posInvoiceLinksTable).where(eq(posInvoiceLinksTable.prejemnicaId, mismatchReceiptId));
    expect(stored.method).toBe("suggested");
    const [audit] = await db.select({ payload: auditLogTable.payload })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, invoiceId),
        eq(auditLogTable.action, "link_pos_prejemnica"),
      ));
    expect(audit.payload).toMatchObject({
      prejemnicaId: mismatchReceiptId,
      matchMethod: "suggested",
      requestedMatchMethod: "exact",
      canonicalNumberEqual: true,
      netAmountEqual: false,
      invoiceNetAmount: "100.00",
      receiptNetAmount: "99.00",
    });
  });

  it("scopes history to company and invoice", async () => {
    await db.insert(auditLogTable).values([
      {
        companyId,
        entityType: "invoice",
        entityId: otherInvoiceId,
        action: "link_pos_prejemnica",
        changedBy: "other-invoice-user",
        payload: { prejemnicaId: exactReceiptId, status: "confirmed" },
      },
      {
        companyId: otherCompanyId,
        entityType: "invoice",
        entityId: invoiceId,
        action: "link_pos_prejemnica",
        changedBy: "other-company-user",
        payload: { prejemnicaId: 999999, status: "confirmed" },
      },
    ]);
    const response = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .expect(200);
    expect(response.body.matchHistory).toHaveLength(1);
    expect(response.body.matchHistory[0].changedBy).toBe(TEST_USER);
  });

  it("returns 409 for a double link and creates neither a second link nor invoice journal", async () => {
    await request(app())
      .put(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: mismatchReceiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "exact",
      })
      .expect(409);

    const links = await db.select({ id: posInvoiceLinksTable.id })
      .from(posInvoiceLinksTable)
      .where(eq(posInvoiceLinksTable.prejemnicaId, mismatchReceiptId));
    expect(links).toHaveLength(1);
    const [invoice] = await db.select({ linkedEntryId: invoicesTable.linkedEntryId })
      .from(invoicesTable)
      .where(eq(invoicesTable.id, invoiceId));
    expect(invoice.linkedEntryId).toBeNull();
    const entries = await db.select({ id: journalEntriesTable.id })
      .from(journalEntriesTable)
      .where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, "INV-2026/01"),
      ));
    expect(entries).toHaveLength(0);
  });

  it("keeps immutable prior metadata after unlink while removing the active link", async () => {
    const before = await request(app())
      .get(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice`)
      .expect(200);
    const prior = before.body.links[0];

    const unlinked = await request(app())
      .delete(`/companies/${companyId}/invoices/${invoiceId}/pos-prejemnice/${mismatchReceiptId}`)
      .expect(200);

    expect(unlinked.body.links).toHaveLength(0);
    expect(unlinked.body.matchHistory.map((entry: any) => entry.action)).toEqual([
      "unlinked",
      "linked",
    ]);
    expect(unlinked.body.matchHistory[0]).toMatchObject({
      status: "unlinked",
      prejemnicaId: mismatchReceiptId,
      changedBy: TEST_USER,
      mode: prior.mode,
      matchMethod: prior.matchMethod,
    });
    const [unlinkAudit] = await db.select({ payload: auditLogTable.payload })
      .from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, invoiceId),
        eq(auditLogTable.action, "unlink_pos_prejemnica"),
      ));
    expect(unlinkAudit.payload).toMatchObject({
      prejemnicaId: mismatchReceiptId,
      mode: prior.mode,
      matchMethod: prior.matchMethod,
      matchedBy: prior.matchedBy,
      matchedAt: prior.matchedAt,
    });
  });

  it("rejects Mode A for a posted receipt without a source without mutating identity or audit", async () => {
    const number = `MODE-A-NULL-${runId}`;
    const modeAInvoiceId = await createInvoice({
      companyId,
      supplierId,
      periodId,
      accountId,
      number,
      amount: "10.0000",
    });
    const receiptId = await createReceipt({ enotaId, supplierId, number, amount: "10.00" });
    await db.update(prejemniceTable).set({
      ddvOsnova: "10.00",
      ddvZnesek: "0.00",
      brutoSkupaj: "10.00",
    }).where(eq(prejemniceTable.id, receiptId));
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: receiptId,
      kolicina: "1",
      cenaKos: "10.0000",
      skupaj: "10.00",
      netoZnesek: "10.00",
      ddvStopnja: "0.00",
      ddvOsnova: "10.00",
      ddvZnesek: "0.00",
    });
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: "2026-02-10",
      documentDate: "2026-02-10",
      description: "POS receipt booking",
      reference: `POS:NABAVA:${receiptId}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receiptId,
      journalEntryId: entry.id,
      netAmount: "10.00",
    });

    const response = await request(app())
      .put(`/companies/${companyId}/invoices/${modeAInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: receiptId,
        mode: "delivery_note_invoice",
        matchMethod: "exact",
      })
      .expect(409);
    expect(response.body.error).toContain("računovodska razrešitev");

    const [storedReceipt] = await db.select({ sourceDocumentId: prejemniceTable.sourceDocumentId })
      .from(prejemniceTable).where(eq(prejemniceTable.id, receiptId));
    const [storedInvoice] = await db.select({ sourceDocumentId: invoicesTable.sourceDocumentId })
      .from(invoicesTable).where(eq(invoicesTable.id, modeAInvoiceId));
    expect(storedReceipt.sourceDocumentId).toBeNull();
    expect(storedInvoice.sourceDocumentId).toBeNull();
    expect(await db.select({ id: posInvoiceLinksTable.id }).from(posInvoiceLinksTable)
      .where(eq(posInvoiceLinksTable.invoiceId, modeAInvoiceId))).toHaveLength(0);
    expect(await db.select({ id: auditLogTable.id }).from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, modeAInvoiceId),
        eq(auditLogTable.action, "link_pos_prejemnica"),
      ))).toHaveLength(0);
  });

  it("assigns an existing posted receipt source only to a source-less Mode A invoice", async () => {
    const number = `MODE-A-SOURCE-${runId}`;
    const [source] = await db.insert(purchaseSourceDocumentsTable).values({
      companyId,
      counterpartyId: supplierId,
      kind: "invoice",
      normalizedNumber: number.replaceAll("-", "").toUpperCase(),
      displayNumber: number,
      documentDate: "2026-02-10",
    }).returning({ id: purchaseSourceDocumentsTable.id });
    const modeAInvoiceId = await createInvoice({
      companyId,
      supplierId,
      periodId,
      accountId,
      number,
      amount: "10.0000",
    });
    await db.update(invoiceLinesTable)
      .set({ accountId: inventoryAccountId })
      .where(eq(invoiceLinesTable.invoiceId, modeAInvoiceId));
    modeASourcedReceiptId = await createReceipt({ enotaId, supplierId, number, amount: "10.00" });
    await db.update(prejemniceTable).set({
      ddvOsnova: "10.00",
      ddvZnesek: "0.00",
      brutoSkupaj: "10.00",
      sourceDocumentId: source.id,
      datumZapadlosti: "2026-03-12",
      dobaviteljIban: "SI56 0400 0027 9548 024",
      dobaviteljBic: "OTPVSI2X",
      placilniModel: "SI00",
      placilniSklic: "1003532025028",
      placilniNamen: "Plačilo računa za kavo",
    }).where(eq(prejemniceTable.id, modeASourcedReceiptId));
    await db.insert(prejemnicePostavkeTable).values({
      prejemnicaId: modeASourcedReceiptId,
      kolicina: "1",
      cenaKos: "10.0000",
      skupaj: "10.00",
      netoZnesek: "10.00",
      ddvStopnja: "0.00",
      ddvOsnova: "10.00",
      ddvZnesek: "0.00",
    });
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: "2026-02-10",
      documentDate: "2026-02-10",
      description: "POS receipt booking",
      reference: `POS:NABAVA:${modeASourcedReceiptId}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: modeASourcedReceiptId,
      journalEntryId: entry.id,
      netAmount: "10.00",
    });

    await request(app())
      .put(`/companies/${companyId}/invoices/${modeAInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: modeASourcedReceiptId,
        mode: "delivery_note_invoice",
        matchMethod: "exact",
      })
      .expect(200);

    const [storedReceipt] = await db.select({ sourceDocumentId: prejemniceTable.sourceDocumentId })
      .from(prejemniceTable).where(eq(prejemniceTable.id, modeASourcedReceiptId));
    const [storedInvoice] = await db.select({
      sourceDocumentId: invoicesTable.sourceDocumentId,
      dueDate: invoicesTable.dueDate,
      destinationIban: invoicesTable.destinationIban,
      destinationBic: invoicesTable.destinationBic,
      paymentModel: invoicesTable.paymentModel,
      paymentReference: invoicesTable.paymentReference,
      paymentPurpose: invoicesTable.paymentPurpose,
    })
      .from(invoicesTable).where(eq(invoicesTable.id, modeAInvoiceId));
    expect(storedReceipt.sourceDocumentId).toBe(source.id);
    expect(storedInvoice.sourceDocumentId).toBe(source.id);
    expect(storedInvoice).toMatchObject({
      dueDate: "2026-03-12",
      destinationIban: "SI56040000279548024",
      destinationBic: "OTPVSI2X",
      paymentModel: "SI00",
      paymentReference: "1003532025028",
      paymentPurpose: "Plačilo računa za kavo",
    });
    expect(await db.select({ id: posInvoiceLinksTable.id }).from(posInvoiceLinksTable)
      .where(eq(posInvoiceLinksTable.invoiceId, modeAInvoiceId))).toHaveLength(1);

    const posted = await request(app())
      .post(`/companies/${companyId}/invoices/${modeAInvoiceId}/post`);
    expect(posted.status, posted.body.error).toBe(200);
    const postedLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, posted.body.linkedEntryId));
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: inventoryAccountId, side: "debit", amount: "10.00" }),
      expect.objectContaining({ accountId, side: "credit", amount: "10.00" }),
    ]));
    expect(postedLines.some((line) => line.accountId === pos109AccountId)).toBe(false);
  });

  it("closes a full gross 109 booking without duplicating input VAT or VAT ledger", async () => {
    const [source] = await db.insert(purchaseSourceDocumentsTable).values({
      companyId,
      counterpartyId: supplierId,
      kind: "invoice",
      normalizedNumber: `FULL${runId.toUpperCase()}`,
      displayNumber: `FULL-${runId}`,
      documentDate: "2026-02-10",
    }).returning({ id: purchaseSourceDocumentsTable.id });
    const fullInvoiceId = await createInvoice({
      companyId,
      supplierId,
      periodId,
      accountId,
      number: `FULL-${runId}`,
      amount: "100.0000",
    });
    await db.update(invoiceLinesTable).set({ vatRate: "22.00" })
      .where(eq(invoiceLinesTable.invoiceId, fullInvoiceId));
    await db.update(invoicesTable).set({ sourceDocumentId: source.id })
      .where(eq(invoicesTable.id, fullInvoiceId));
    const fullReceiptId = await createReceipt({
      enotaId,
      supplierId,
      number: `FULL-${runId}`,
      amount: "100.00",
    });
    await db.update(prejemniceTable).set({
      ddvOsnova: "100.00",
      ddvZnesek: "22.00",
      brutoSkupaj: "122.00",
    }).where(eq(prejemniceTable.id, fullReceiptId));
    const [receiptEntry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: "2026-02-10",
      documentDate: "2026-02-10",
      description: "POS receipt booking",
      reference: `POS:NABAVA:${fullReceiptId}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values([
      {
        entryId: receiptEntry.id,
        accountId: inventoryAccountId,
        side: "debit",
        amount: "100.00",
        vatCodeId: inputVat22CodeId,
        vatAmount: "22.00",
        sequence: 0,
      },
      { entryId: receiptEntry.id, accountId: inputVat22AccountId, side: "debit", amount: "22.00", sequence: 1 },
      { entryId: receiptEntry.id, accountId: pos109AccountId, side: "credit", amount: "122.00", sequence: 2 },
    ]);
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: fullReceiptId,
      journalEntryId: receiptEntry.id,
      netAmount: "100.00",
    });

    await request(app())
      .put(`/companies/${companyId}/invoices/${fullInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: fullReceiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "exact",
      })
      .expect(200);
    const posted = await request(app())
      .post(`/companies/${companyId}/invoices/${fullInvoiceId}/post`)
      .expect(200);
    const invoiceEntryId = posted.body.linkedEntryId;
    const postedLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, invoiceEntryId));
    expect(postedLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: pos109AccountId, side: "debit", amount: "122.00" }),
      expect.objectContaining({ accountId, side: "credit", amount: "122.00" }),
    ]));
    expect(postedLines).toHaveLength(2);
    const vatLedger = await db.select({ id: vatLedgerTable.id }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, invoiceEntryId));
    expect(vatLedger).toHaveLength(0);
    const history = await request(app())
      .get(`/companies/${companyId}/invoices/${fullInvoiceId}/pos-prejemnice`)
      .expect(200);
    expect(history.body.links[0].status).toBe("closed109");
    expect(history.body.matchHistory[0]).toMatchObject({
      action: "closed109",
      status: "closed109",
      prejemnicaId: fullReceiptId,
    });
    await request(app()).post(`/companies/${companyId}/invoices/${fullInvoiceId}/post`).expect(400);
    const invoiceEntries = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, `FULL-${runId}`)));
    expect(invoiceEntries).toHaveLength(1);
  });

  async function createSourceAwarePostingInvoice(number: string) {
    const id = await createInvoice({
      companyId,
      supplierId,
      periodId,
      accountId,
      number,
      amount: "100.0000",
    });
    const [source] = await db.insert(purchaseSourceDocumentsTable).values({
      companyId,
      counterpartyId: supplierId,
      kind: "invoice",
      normalizedNumber: number.replaceAll("-", "").toUpperCase(),
      displayNumber: number,
      documentDate: "2026-02-10",
    }).returning({ id: purchaseSourceDocumentsTable.id });
    await db.update(invoicesTable).set({ sourceDocumentId: source.id })
      .where(eq(invoicesTable.id, id));
    await db.update(invoiceLinesTable).set({
      vatRate: "22.00",
      accountId: inventoryAccountId,
    }).where(eq(invoiceLinesTable.invoiceId, id));
    return id;
  }

  async function createAuthoritativeReceiptBooking(options: {
    receiptEnotaId: number;
    number: string;
    net: string;
    vat: string;
  }) {
    const receiptId = await createReceipt({
      enotaId: options.receiptEnotaId,
      supplierId,
      number: options.number,
      amount: options.net,
    });
    const gross = new Decimal(options.net).plus(options.vat).toFixed(2);
    await db.update(prejemniceTable).set({
      ddvOsnova: options.net,
      ddvZnesek: options.vat,
      brutoSkupaj: gross,
    }).where(eq(prejemniceTable.id, receiptId));
    const [entry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: "2026-02-10",
      documentDate: "2026-02-10",
      description: "POS receipt booking",
      reference: `POS:NABAVA:${receiptId}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values([
      {
        entryId: entry.id,
        accountId: inventoryAccountId,
        side: "debit",
        amount: options.net,
        vatCodeId: inputVat22CodeId,
        vatAmount: options.vat,
        sequence: 0,
      },
      {
        entryId: entry.id,
        accountId: inputVat22AccountId,
        side: "debit",
        amount: options.vat,
        sequence: 1,
      },
      {
        entryId: entry.id,
        accountId: pos109AccountId,
        side: "credit",
        amount: gross,
        sequence: 2,
      },
    ]);
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receiptId,
      journalEntryId: entry.id,
      netAmount: options.net,
    });
    return { receiptId, entryId: entry.id, gross };
  }

  async function postPartialScenario(
    suffix: string,
    receiptNet: string,
    receiptVat: string,
  ) {
    const number = `${suffix}-${runId}`;
    const scenarioInvoiceId = await createInvoice({
      companyId,
      supplierId,
      periodId,
      accountId,
      number,
      amount: "100.0000",
    });
    const [source] = await db.insert(purchaseSourceDocumentsTable).values({
      companyId,
      counterpartyId: supplierId,
      kind: "invoice",
      normalizedNumber: number.replaceAll("-", "").toUpperCase(),
      displayNumber: number,
      documentDate: "2026-02-10",
    }).returning({ id: purchaseSourceDocumentsTable.id });
    await db.update(invoicesTable).set({ sourceDocumentId: source.id })
      .where(eq(invoicesTable.id, scenarioInvoiceId));
    await db.update(invoiceLinesTable).set({
      vatRate: "22.00",
      accountId: inventoryAccountId,
    }).where(eq(invoiceLinesTable.invoiceId, scenarioInvoiceId));
    const receiptId = await createReceipt({
      enotaId,
      supplierId,
      number,
      amount: receiptNet,
    });
    const receiptGross = new Decimal(receiptNet).plus(receiptVat).toFixed(2);
    await db.update(prejemniceTable).set({
      ddvOsnova: receiptNet,
      ddvZnesek: receiptVat,
      brutoSkupaj: receiptGross,
    }).where(eq(prejemniceTable.id, receiptId));
    const [receiptEntry] = await db.insert(journalEntriesTable).values({
      companyId,
      periodId,
      entryDate: "2026-02-10",
      documentDate: "2026-02-10",
      description: "POS receipt booking",
      reference: `POS:NABAVA:${receiptId}`,
      status: "posted",
      sourceType: "document",
      createdBy: "pos-receipt-booking",
    }).returning({ id: journalEntriesTable.id });
    await db.insert(journalEntryLinesTable).values([
      {
        entryId: receiptEntry.id,
        accountId: inventoryAccountId,
        side: "debit",
        amount: receiptNet,
        vatCodeId: inputVat22CodeId,
        vatAmount: receiptVat,
        sequence: 0,
      },
      {
        entryId: receiptEntry.id,
        accountId: inputVat22AccountId,
        side: "debit",
        amount: receiptVat,
        sequence: 1,
      },
      {
        entryId: receiptEntry.id,
        accountId: pos109AccountId,
        side: "credit",
        amount: receiptGross,
        sequence: 2,
      },
    ]);
    await db.insert(posReceiptBookingSourcesTable).values({
      prejemnicaId: receiptId,
      journalEntryId: receiptEntry.id,
      netAmount: receiptNet,
    });
    await request(app())
      .put(`/companies/${companyId}/invoices/${scenarioInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: receiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "exact",
      })
      .expect(200);
    const posted = await request(app())
      .post(`/companies/${companyId}/invoices/${scenarioInvoiceId}/post`);
    expect(posted.status, JSON.stringify(posted.body)).toBe(200);
    return { invoiceId: scenarioInvoiceId, entryId: posted.body.linkedEntryId };
  }

  it("creates one VAT-ledger remainder for a normal partial 109 closure", async () => {
    const scenario = await postPartialScenario("PARTIAL", "60.00", "13.20");
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, scenario.entryId));
    expect(lines).toEqual(expect.arrayContaining([
      { accountId: pos109AccountId, side: "debit", amount: "73.20" },
      { accountId: inventoryAccountId, side: "debit", amount: "40.00" },
      { accountId: inputVat22AccountId, side: "debit", amount: "8.80" },
      { accountId, side: "credit", amount: "122.00" },
    ]));
    const ledger = await db.select({
      vatCodeId: vatLedgerTable.vatCodeId,
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, scenario.entryId));
    expect(ledger).toEqual([{
      vatCodeId: inputVat22CodeId,
      baseAmount: "40.00",
      vatAmount: "8.80",
    }]);
  });

  it("books and reports a one-cent VAT remainder without a remaining expense line", async () => {
    const scenario = await postPartialScenario("ROUNDING", "100.00", "21.99");
    const lines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, scenario.entryId));
    expect(lines).toEqual(expect.arrayContaining([
      { accountId: pos109AccountId, side: "debit", amount: "121.99" },
      { accountId: inputVat22AccountId, side: "debit", amount: "0.01" },
      { accountId, side: "credit", amount: "122.00" },
    ]));
    expect(lines).toHaveLength(3);
    const ledger = await db.select({
      vatCodeId: vatLedgerTable.vatCodeId,
      direction: vatLedgerTable.direction,
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
      documentNo: vatLedgerTable.documentNo,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, scenario.entryId));
    expect(ledger).toEqual([{
      vatCodeId: inputVat22CodeId,
      direction: "IN",
      baseAmount: "0.00",
      vatAmount: "0.01",
      documentNo: `ROUNDING-${runId}`,
    }]);
  });

  it("closes two authoritative receipts from different enote with one deterministic partial invoice posting", async () => {
    const number = `MULTI-ENOTA-${runId}`;
    const [secondEnota] = await db.insert(enoteTable).values({
      companyId,
      ime: `Druga enota ${runId}`,
    }).returning({ id: enoteTable.id });
    const scenarioInvoiceId = await createSourceAwarePostingInvoice(number);
    const receiptA = await createAuthoritativeReceiptBooking({
      receiptEnotaId: enotaId,
      number: `${number}-A`,
      net: "60.00",
      vat: "13.20",
    });
    const receiptB = await createAuthoritativeReceiptBooking({
      receiptEnotaId: secondEnota.id,
      number: `${number}-B`,
      net: "20.00",
      vat: "4.40",
    });
    for (const receipt of [receiptA, receiptB]) {
      await request(app())
        .put(`/companies/${companyId}/invoices/${scenarioInvoiceId}/pos-prejemnice`)
        .send({
          prejemnicaId: receipt.receiptId,
          mode: "invoice_with_delivery_notes",
          matchMethod: "manual",
        })
        .expect(200);
    }

    const posted = await request(app())
      .post(`/companies/${companyId}/invoices/${scenarioInvoiceId}/post`)
      .expect(200);
    const invoiceEntryId = posted.body.linkedEntryId;
    const invoiceLines = await db.select({
      accountId: journalEntryLinesTable.accountId,
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, invoiceEntryId));
    expect(invoiceLines).toEqual(expect.arrayContaining([
      { accountId: pos109AccountId, side: "debit", amount: "97.60" },
      { accountId: inventoryAccountId, side: "debit", amount: "20.00" },
      { accountId: inputVat22AccountId, side: "debit", amount: "4.40" },
      { accountId, side: "credit", amount: "122.00" },
    ]));
    expect(invoiceLines).toHaveLength(4);

    const targeted109 = await db.select({
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(and(
      eq(journalEntryLinesTable.accountId, pos109AccountId),
      inArray(journalEntryLinesTable.entryId, [receiptA.entryId, receiptB.entryId, invoiceEntryId]),
    ));
    const balance109 = targeted109.reduce(
      (sum, line) => sum.plus(line.side === "debit" ? line.amount : new Decimal(line.amount).negated()),
      new Decimal(0),
    );
    expect(balance109.toFixed(2)).toBe("0.00");

    const ledger = await db.select({
      direction: vatLedgerTable.direction,
      vatCodeId: vatLedgerTable.vatCodeId,
      baseAmount: vatLedgerTable.baseAmount,
      vatAmount: vatLedgerTable.vatAmount,
      documentNo: vatLedgerTable.documentNo,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, invoiceEntryId));
    expect(ledger).toEqual([{
      direction: "IN",
      vatCodeId: inputVat22CodeId,
      baseAmount: "20.00",
      vatAmount: "4.40",
      documentNo: number,
    }]);
    const closeAudits = await db.select({ id: auditLogTable.id }).from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, scenarioInvoiceId),
        eq(auditLogTable.action, "close_pos_109"),
      ));
    expect(closeAudits).toHaveLength(2);

    const ownership = await db.select({
      receiptId: prejemniceTable.id,
      enotaId: prejemniceTable.enotaId,
      companyId: enoteTable.companyId,
    }).from(prejemniceTable)
      .innerJoin(enoteTable, eq(enoteTable.id, prejemniceTable.enotaId))
      .where(inArray(prejemniceTable.id, [receiptA.receiptId, receiptB.receiptId]));
    expect(ownership).toEqual(expect.arrayContaining([
      { receiptId: receiptA.receiptId, enotaId, companyId },
      { receiptId: receiptB.receiptId, enotaId: secondEnota.id, companyId },
    ]));

    await request(app()).post(`/companies/${companyId}/invoices/${scenarioInvoiceId}/post`).expect(400);
    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, number))))
      .toHaveLength(1);
    expect(await db.select({ id: vatLedgerTable.id }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.documentNo, number))).toHaveLength(1);
    expect(await db.select({ id: auditLogTable.id }).from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, scenarioInvoiceId),
        eq(auditLogTable.action, "close_pos_109"),
      ))).toHaveLength(2);
  });

  it("keeps a source-aware invoice draft when a linked receipt has no posted 109 ownership", async () => {
    const number = `UNPOSTED-${runId}`;
    const scenarioInvoiceId = await createSourceAwarePostingInvoice(number);
    const receiptId = await createReceipt({
      enotaId,
      supplierId,
      number,
      amount: "60.00",
    });
    await db.update(prejemniceTable).set({
      ddvOsnova: "60.00",
      ddvZnesek: "13.20",
      brutoSkupaj: "73.20",
    }).where(eq(prejemniceTable.id, receiptId));
    await request(app())
      .put(`/companies/${companyId}/invoices/${scenarioInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: receiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "manual",
      })
      .expect(200);

    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${scenarioInvoiceId}/post`)
      .expect(400);
    expect(response.body.error).toContain("109");
    const [invoice] = await db.select({
      status: invoicesTable.status,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(eq(invoicesTable.id, scenarioInvoiceId));
    expect(invoice).toEqual({ status: "draft", linkedEntryId: null });
    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, number))))
      .toHaveLength(0);
    expect(await db.select({ id: vatLedgerTable.id }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.documentNo, number))).toHaveLength(0);
    expect(await db.select({ id: auditLogTable.id }).from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, scenarioInvoiceId),
        eq(auditLogTable.action, "close_pos_109"),
      ))).toHaveLength(0);
  });

  it("fails closed when mutable receipt net changes after linking to immutable booking facts", async () => {
    const number = `STALE-NET-${runId}`;
    const scenarioInvoiceId = await createSourceAwarePostingInvoice(number);
    const receipt = await createAuthoritativeReceiptBooking({
      receiptEnotaId: enotaId,
      number,
      net: "60.00",
      vat: "13.20",
    });
    await request(app())
      .put(`/companies/${companyId}/invoices/${scenarioInvoiceId}/pos-prejemnice`)
      .send({
        prejemnicaId: receipt.receiptId,
        mode: "invoice_with_delivery_notes",
        matchMethod: "manual",
      })
      .expect(200);
    await db.update(prejemniceTable).set({ skupajVrednost: "61.00" })
      .where(eq(prejemniceTable.id, receipt.receiptId));

    const response = await request(app())
      .post(`/companies/${companyId}/invoices/${scenarioInvoiceId}/post`);
    expect([400, 409]).toContain(response.status);
    expect(response.body.error).toMatch(/109|POS|spremen/i);
    const [invoice] = await db.select({
      status: invoicesTable.status,
      linkedEntryId: invoicesTable.linkedEntryId,
    }).from(invoicesTable).where(eq(invoicesTable.id, scenarioInvoiceId));
    expect(invoice).toEqual({ status: "draft", linkedEntryId: null });
    expect(await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, companyId), eq(journalEntriesTable.reference, number))))
      .toHaveLength(0);
    expect(await db.select({ id: vatLedgerTable.id }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.documentNo, number))).toHaveLength(0);
    expect(await db.select({ id: auditLogTable.id }).from(auditLogTable)
      .where(and(
        eq(auditLogTable.companyId, companyId),
        eq(auditLogTable.entityId, scenarioInvoiceId),
        eq(auditLogTable.action, "close_pos_109"),
      ))).toHaveLength(0);
    const [sourceEntry] = await db.select({ status: journalEntriesTable.status })
      .from(journalEntriesTable).where(eq(journalEntriesTable.id, receipt.entryId));
    expect(sourceEntry.status).toBe("posted");
    const source109 = await db.select({
      side: journalEntryLinesTable.side,
      amount: journalEntryLinesTable.amount,
    }).from(journalEntryLinesTable).where(and(
      eq(journalEntryLinesTable.entryId, receipt.entryId),
      eq(journalEntryLinesTable.accountId, pos109AccountId),
    ));
    expect(source109).toEqual([{ side: "credit", amount: "73.20" }]);
  });
});