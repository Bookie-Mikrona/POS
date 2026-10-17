import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";

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
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-journal-vat-links";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import express from "express";
import request from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  db, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, counterpartiesTable, documentsTable, invoicesTable,
  invoiceLinesTable, journalEntriesTable, journalEntryLinesTable,
  vatCodeTable, vatCodesTable, vatLedgerTable, enoteTable,
} from "@workspace/db";
import journalsRouter from "./journalEntries";
import invoicesRouter from "./invoices";
import documentsRouter from "./documents";
import { ustvariOsnutekErpPrejetegaRacuna } from "../lib/uvoz/uvoz-service";
import { prejemDtoSchema } from "../lib/uvoz/dto";

const app = express();
app.use(express.json(), journalsRouter, invoicesRouter, documentsRouter);
app.use((error: Error, _req: any, res: any, _next: any) => {
  res.status(500).json({ error: error.message });
});

let companyId: string, periodId: string, expenseId: string, payableId: string;
let supplierId: string, globalId: string, otherGlobalId: string, companyCodeId: string;
let unlinkedCodeId: string, foreignCodeId: string, enotaId: number;
let finish: (() => void) | undefined;
let transactionFinished: Promise<void>;
const rollback = new Error("Rollback VAT link fixtures");
const runId = randomUUID();

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
  const [company, foreignCompany] = await db.insert(companiesTable).values([
    { podjetjeDavcna: `TEST-VAT-${runId}`, naziv: "TEST VAT links" },
    { podjetjeDavcna: `TEST-VAT-FOREIGN-${runId}`, naziv: "TEST foreign VAT links" },
  ]).returning();
  companyId = company.id;
  await db.insert(accountingRolesTable).values({
    companyId, clerkUserId: "TEST-journal-vat-links", role: "owner",
  });
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const [expense, payable, inputVat] = await db.insert(accountsTable).values([
    { companyId, code: "4000000", name: "Expense", type: "expense" },
    { companyId, code: "2200000", name: "Payable", type: "liability" },
    { companyId, code: "1600000", name: "Input VAT", type: "asset" },
  ]).returning();
  expenseId = expense.id;
  payableId = payable.id;
  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId, name: "Test supplier", type: "supplier", country: "SI", kodaDrzave: "SI",
  }).returning();
  supplierId = supplier.id;
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: "TEST VAT unit" }).returning();
  enotaId = unit.id;
  const [globalCode] = await db.select().from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "P22"), eq(vatCodeTable.direction, "IN"))).limit(1);
  const [otherCode] = await db.select().from(vatCodeTable)
    .where(and(eq(vatCodeTable.code, "P95"), eq(vatCodeTable.direction, "IN"))).limit(1);
  if (!globalCode || !otherCode) throw new Error("Missing P22/P95 FURS fixtures");
  globalId = globalCode.id;
  otherGlobalId = otherCode.id;
  const [companyCode, unlinked, foreign] = await db.insert(vatCodesTable).values([
    { companyId, code: "LOCAL-P22", name: "Purchase", rate: "22", fursCodeId: globalId, accountInputId: inputVat.id },
    { companyId, code: "UNLINKED", name: "Unlinked", rate: "22" },
    { companyId: foreignCompany.id, code: "FOREIGN-P22", name: "Foreign", rate: "22", fursCodeId: globalId },
  ]).returning();
  companyCodeId = companyCode.id;
  unlinkedCodeId = unlinked.id;
  foreignCodeId = foreign.id;
  expect(companyCodeId).not.toBe(globalId);
});

afterAll(async () => {
  finish?.();
  await transactionFinished;
  isolation.tx = null;
  const leftovers = await isolation.root.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, `TEST-VAT-${runId}`));
  expect(leftovers).toEqual([]);
});

function proposalBody(vatLink: { companyVatCodeId?: string | null; vatCodeId?: string | null }) {
  return {
    periodId, entryDate: "2026-01-10", description: "Automatic document proposal",
    sourceType: "ai_suggestion",
    lines: [
      { accountId: expenseId, side: "debit", amount: 100, partnerId: supplierId, vatAmount: 22, ...vatLink },
      { accountId: payableId, side: "credit", amount: 100, partnerId: supplierId },
    ],
  };
}

async function entryVatLines(entryId: string) {
  return db.select({
    vatCodeId: journalEntryLinesTable.vatCodeId,
    companyVatCodeId: journalEntryLinesTable.companyVatCodeId,
  }).from(journalEntryLinesTable).where(and(
    eq(journalEntryLinesTable.entryId, entryId),
    eq(journalEntryLinesTable.accountId, expenseId),
  ));
}

describe.sequential("automatic journal VAT provenance", () => {
  it("resolves a company-only automatic proposal and preserves both IDs after reload", async () => {
    const created = await request(app).post(`/companies/${companyId}/entries`)
      .send(proposalBody({ companyVatCodeId: companyCodeId })).expect(201);
    expect(await entryVatLines(created.body.id)).toEqual([
      { vatCodeId: globalId, companyVatCodeId: companyCodeId },
    ]);
    const reloaded = await request(app).get(`/companies/${companyId}/entries/${created.body.id}`).expect(200);
    expect(reloaded.body.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ vatCodeId: globalId, companyVatCodeId: companyCodeId }),
    ]));
  });

  it("accepts matching pairs and legacy global-only or tax-free proposals", async () => {
    for (const vatLink of [
      { companyVatCodeId: companyCodeId, vatCodeId: globalId },
      { vatCodeId: globalId },
      {},
    ]) {
      const response = await request(app).post(`/companies/${companyId}/entries`)
        .send(proposalBody(vatLink)).expect(201);
      expect(await entryVatLines(response.body.id)).toEqual([{
        vatCodeId: "vatCodeId" in vatLink ? vatLink.vatCodeId : null,
        companyVatCodeId: "companyVatCodeId" in vatLink ? vatLink.companyVatCodeId : null,
      }]);
    }
  });

  it("rejects mismatched, foreign, missing and unlinked company codes without writing a journal", async () => {
    const before = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    for (const link of [
      { companyVatCodeId: companyCodeId, vatCodeId: otherGlobalId },
      { companyVatCodeId: foreignCodeId },
      { companyVatCodeId: randomUUID() },
      { companyVatCodeId: unlinkedCodeId },
    ]) {
      await request(app).post(`/companies/${companyId}/entries`).send(proposalBody(link)).expect(400);
    }
    const after = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(eq(journalEntriesTable.companyId, companyId));
    expect(after).toEqual(before);
  });

  it("keeps the selected tenant code from an imported received document through invoice posting and KPR", async () => {
    const line = {
      description: "Imported service", quantity: 1, unitPrice: 100, vatRate: 22,
      vatBase: 100, vatAmount: 22, accountId: expenseId, vatCodeId: globalId, confidence: 1,
    };
    const [document] = await db.insert(documentsTable).values({
      companyId, fileName: "vat-links.pdf", mimeType: "application/pdf",
      objectPath: `/objects/tests/${runId}/vat-links.pdf`, status: "done", documentType: "invoice_received",
      ocrResult: {
        rawText: "", confidence: 1, invoiceNumber: `IMPORTED-${runId}`,
        invoiceDate: "2026-01-10", currency: "EUR", suggestedDocumentType: "invoice_received", lines: [line],
      },
    }).returning();
    const confirmed = await request(app).post(`/companies/${companyId}/documents/${document.id}/confirm`)
      .send({
        documentType: "invoice_received", counterpartyId: supplierId, periodId,
        invoiceNumber: `IMPORTED-${runId}`, invoiceDate: "2026-01-10",
        createInvoice: true, arApAccountId: payableId, lines: [line],
      }).expect(200);
    const invoiceId = confirmed.body.linkedInvoiceId;
    const [importedLine] = await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, invoiceId));
    expect(importedLine.vatCodeId).toBe(companyCodeId);
    const posted = await request(app).post(`/companies/${companyId}/invoices/${invoiceId}/post`).expect(200);
    expect(await entryVatLines(posted.body.linkedEntryId)).toEqual([
      { vatCodeId: globalId, companyVatCodeId: companyCodeId },
    ]);
    const taxRows = await db.select({ vatCodeId: vatLedgerTable.vatCodeId }).from(vatLedgerTable)
      .where(eq(vatLedgerTable.journalEntryId, posted.body.linkedEntryId));
    expect(taxRows).toEqual([{ vatCodeId: globalId }]);
  });

  it("preserves VAT provenance and OUT classification for an ordinary non-AI issued invoice", async () => {
    const [revenue, receivable, outputVat] = await db.insert(accountsTable).values([
      { companyId, code: "7600000", name: "Revenue", type: "revenue" },
      { companyId, code: "1200000", name: "Receivable", type: "asset" },
      { companyId, code: "2600000", name: "Output VAT", type: "liability" },
    ]).returning();
    const [customer] = await db.insert(counterpartiesTable).values({
      companyId, name: "Test customer", type: "customer", country: "SI", kodaDrzave: "SI",
    }).returning();
    const [salesFurs] = await db.select().from(vatCodeTable)
      .where(and(eq(vatCodeTable.code, "S22"), eq(vatCodeTable.direction, "OUT"))).limit(1);
    if (!salesFurs) throw new Error("Missing S22 FURS fixture");
    const [salesCode] = await db.insert(vatCodesTable).values({
      companyId, code: "LOCAL-S22", name: "Sales VAT", rate: "22",
      fursCodeId: salesFurs.id, accountOutputId: outputVat.id,
    }).returning();
    const [invoice] = await db.insert(invoicesTable).values({
      companyId, type: "issued", counterpartyId: customer.id, periodId,
      invoiceNumber: `ISSUED-${runId}`, invoiceDate: "2026-01-10", status: "draft",
      arApAccountId: receivable.id, vatAccountId: outputVat.id,
      sourceType: "manual", createdBy: "TEST-journal-vat-links",
    }).returning();
    await db.insert(invoiceLinesTable).values({
      invoiceId: invoice.id, description: "Ordinary issued service", quantity: "1",
      unitPrice: "100", vatRate: "22", vatCodeId: salesCode.id, accountId: revenue.id, sequence: 0,
    });
    const posted = await request(app).post(`/companies/${companyId}/invoices/${invoice.id}/post`).expect(200);
    const reloaded = await request(app).get(`/companies/${companyId}/entries/${posted.body.linkedEntryId}`).expect(200);
    expect(reloaded.body.lines).toEqual(expect.arrayContaining([
      expect.objectContaining({
        accountId: revenue.id, side: "credit", amount: "100.00",
        companyVatCodeId: salesCode.id, vatCodeId: salesFurs.id, vatAmount: "22.00",
      }),
    ]));
    const taxRows = await db.select({
      vatCodeId: vatLedgerTable.vatCodeId, direction: vatLedgerTable.direction,
      baseAmount: vatLedgerTable.baseAmount, vatAmount: vatLedgerTable.vatAmount,
    }).from(vatLedgerTable).where(eq(vatLedgerTable.journalEntryId, posted.body.linkedEntryId));
    expect(taxRows).toEqual([{
      vatCodeId: salesFurs.id, direction: "OUT", baseAmount: "100.00", vatAmount: "22.00",
    }]);
  });

  it("maps an e-SLOG import to a tenant ID rather than writing a global ID into invoice_lines", async () => {
    const sessionId = randomUUID();
    await db.execute(sql`
      INSERT INTO uvoz_seja (id, enota_id, kanal, format, sha256, metapodatki)
      VALUES (${sessionId}, ${enotaId}, 'ROCNI_NALOG', 'ESLOG_2_0_RACUN', ${runId},
              '{"fixedAssetReviewRequired":true}'::jsonb)
    `);
    const dto = prejemDtoSchema.parse({
      dobaviteljDrzava: "AT", vrstaDokumenta: "RACUN", stDokumenta: `ESLOG-${runId}`,
      datumDokumenta: "2026-01-10",
      postavke: [{
        zap: 1, izvNaziv: "Laptop equipment", izvKolicina: 1, izvCena: 100,
        ddvStopnja: 22, ddvKoda: "P22", ddvOsnova: 100, ddvZnesek: 22,
      }],
    });
    const imported = await ustvariOsnutekErpPrejetegaRacuna(db as any, {
      enotaId, sejaId: sessionId, dobaviteljId: supplierId, dto,
      assetTypes: { 1: "OTHER_FA" }, actorSnapshot: "TEST-journal-vat-links",
    });
    const [line] = await db.select().from(invoiceLinesTable).where(eq(invoiceLinesTable.invoiceId, imported.invoiceId));
    expect(line.vatCodeId).toBe(companyCodeId);
    const [invoice] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, imported.invoiceId));
    expect(invoice.status).toBe("draft");
  });

  it("rolls back an e-SLOG draft if its global code has no unique active tenant mapping", async () => {
    const sessionId = randomUUID();
    await db.execute(sql`
      INSERT INTO uvoz_seja (id, enota_id, kanal, format, sha256, metapodatki)
      VALUES (${sessionId}, ${enotaId}, 'ROCNI_NALOG', 'ESLOG_2_0_RACUN', ${randomUUID()},
              '{"fixedAssetReviewRequired":true}'::jsonb)
    `);
    const dto = prejemDtoSchema.parse({
      dobaviteljDrzava: "AT", vrstaDokumenta: "RACUN", stDokumenta: `INVALID-${runId}`,
      datumDokumenta: "2026-01-10",
      postavke: [{
        zap: 1, izvNaziv: "Laptop equipment", izvKolicina: 1, izvCena: 100,
        ddvStopnja: 22, ddvKoda: "P22", ddvOsnova: 100, ddvZnesek: 22,
      }],
    });
    const before = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    const runImport = () => ustvariOsnutekErpPrejetegaRacuna(db as any, {
      enotaId, sejaId: sessionId, dobaviteljId: supplierId, dto,
      assetTypes: { 1: "OTHER_FA" }, actorSnapshot: "TEST-journal-vat-links",
    });
    await db.update(vatCodesTable).set({ isActive: false }).where(eq(vatCodesTable.id, companyCodeId));
    try {
      await expect(runImport()).rejects.toThrow("enolične veljavne povezave");
    } finally {
      await db.update(vatCodesTable).set({ isActive: true }).where(eq(vatCodesTable.id, companyCodeId));
    }
    const [duplicate] = await db.insert(vatCodesTable).values({
      companyId, code: "SECOND-P22", name: "Ambiguous mapping", rate: "22", fursCodeId: globalId,
    }).returning();
    try {
      await expect(runImport()).rejects.toThrow("enolične veljavne povezave");
    } finally {
      await db.delete(vatCodesTable).where(eq(vatCodesTable.id, duplicate.id));
    }
    const after = await db.select({ id: invoicesTable.id }).from(invoicesTable)
      .where(eq(invoicesTable.companyId, companyId));
    expect(after).toEqual(before);
    const session = await db.execute(sql`SELECT metapodatki FROM uvoz_seja WHERE id = ${sessionId}`);
    expect(session.rows[0].metapodatki).toEqual({ fixedAssetReviewRequired: true });
  });
});
