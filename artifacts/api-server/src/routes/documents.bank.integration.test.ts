import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountsTable, accountingPeriodsTable,
  counterpartiesTable, documentsTable, invoicesTable, journalEntriesTable, journalEntryLinesTable,
  bankStatementsTable, bankStatementLinesTable, auditLogTable,
} from "@workspace/db";
import { parseScannedBankStatement } from "../lib/scannedBankStatement";

let user = "scanned-bank-test-owner";
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.clerkUserId = user; next(); },
}));
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn().mockResolvedValue({ firstName: "Test", lastName: "Owner", emailAddresses: [] }) } } }));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    async getObjectEntityFile(path: string) { return { download: async () => [Buffer.from(path)] }; }
  },
}));
import documentsRouter from "./documents";

const app = express();
app.use(express.json());
app.use((req: any, _res, next) => { req.log = { error: vi.fn() }; next(); });
app.use(documentsRouter);
const request = supertest(app);
const run = Math.random().toString(36).slice(2, 9);
const tax = `${Math.floor(10000000 + Math.random() * 80000000)}`;
let companyId: string, periodId: string, bankId: string, arId: string, apId: string, partnerId: string;
let repairedDoc: string, replacedInvoice: string, entryId: string;

function text(number = "1", outgoing = false) {
  return `OTP banka
Transakcijski račun: SI56 0400 1000 0000 001
Datum izpiska: 06.01.2026
Štev. izpiska: ${number}
Valuta: EUR (978)
ID za DDV: SI${tax}
Predhodno stanje: 2.866,75
Skupaj dobro: ${outgoing ? "0,00" : "400,00"}
Skupaj breme: ${outgoing ? "400,00" : "0,00"}
Novo stanje: ${outgoing ? "2.466,75" : "3.266,75"}
Dat. valute: 06.01.2026
ID transakcije: TX-${number}
${outgoing ? "Prejemnik" : "Plačnik"}: BANK, SI56040010000000002, BORUT STANIČ, S.P., TESTNA ULICA 2, 3270 LAŠKO
Opis nakazila: Plačilo računov SI99
Znesek ${outgoing ? "odliva" : "priliva"} v EUR: 400,00
REKAPITULACIJA IZPISKA
Skupaj nalogov: 1 v znesku: 400,00 EUR`;
}
async function document(number: string, linkedInvoiceId?: string, rawText = text(number)) {
  const [doc] = await db.insert(documentsTable).values({
    companyId, fileName: `${run}-${number}.pdf`, mimeType: "application/pdf",
    objectPath: `/objects/test-bank/${run}/${number}`, status: linkedInvoiceId ? "confirmed" : "done",
    linkedInvoiceId, ocrResult: { rawText, confidence: 1, lines: [], suggestedDocumentType: "invoice_received" },
  }).returning();
  return doc.id;
}
function body(number: string, extra: object = {}) {
  return { periodId, bankAccountId: bankId,
    transactions: [{ transactionId: `TX-${number}`, counterAccountId: arId, counterpartyId: partnerId }], ...extra };
}
const url = (id: string) => `/companies/${companyId}/documents/${id}/confirm-bank`;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({ naziv: `Bank regression ${run}`, podjetjeDavcna: tax }).returning();
  companyId = company.id;
  await db.insert(accountingRolesTable).values([
    { companyId, clerkUserId: user, role: "owner" },
    { companyId, clerkUserId: "scanned-bank-test-viewer", role: "viewer" },
  ]);
  const [period] = await db.insert(accountingPeriodsTable).values({
    companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
  }).returning();
  periodId = period.id;
  const accounts = await db.insert(accountsTable).values([
    { companyId, code: "1100000", name: "TRR", type: "asset", allowsPosting: true },
    { companyId, code: "1200000", name: "Kupci", type: "asset", allowsPosting: true, requiresPartner: true },
    { companyId, code: "2200000", name: "Dobavitelji", type: "liability", allowsPosting: true, requiresPartner: true },
  ]).returning();
  [bankId, arId, apId] = accounts.map(a => a.id);
  const [partner] = await db.insert(counterpartiesTable).values({
    companyId, name: "TEHNOS BORUT STANIČ, S.P.", type: "both", iban: "SI56040010000000002",
  }).returning();
  partnerId = partner.id;
});

afterAll(async () => {
  if (companyId) {
    await db.delete(documentsTable).where(eq(documentsTable.companyId, companyId));
    await db.delete(invoicesTable).where(eq(invoicesTable.companyId, companyId));
    await db.delete(bankStatementsTable).where(eq(bankStatementsTable.companyId, companyId));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    await db.delete(auditLogTable).where(eq(auditLogTable.companyId, companyId));
    await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
    await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
    await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
    await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
  await pool.end();
});

describe("scanned statements never become invoices", () => {
  it("parses full bank evidence and refuses incomplete, inconsistent or duplicate transactions", () => {
    const parsed = parseScannedBankStatement(text())!;
    expect(parsed.errors).toEqual([]);
    expect(parsed.transactions[0]).toMatchObject({ amount: 400, counterpartyName: "BORUT STANIČ, S.P." });
    expect(parseScannedBankStatement(text().replace("3.266,75", "3.200,00"))!.errors.length).toBeGreaterThan(0);
    expect(parseScannedBankStatement(text().replace("Skupaj nalogov: 1", "Skupaj nalogov: 2"))!.errors.length).toBeGreaterThan(0);
    expect(parseScannedBankStatement(text().replace(/(?:Predhodno|Novo) stanje: [^\n]+\n/g, ""))!.errors)
      .toContain("Manjka začetno ali končno stanje.");
    expect(parseScannedBankStatement("RAČUN: 1\nTRR: SI56040010000000001")).toBeUndefined();
  });
  it("shows a bank-specific review and blocks the legacy invoice endpoint", async () => {
    const id = await document("legacy");
    const get = await request.get(`/companies/${companyId}/documents/${id}`);
    expect(get.status).toBe(200);
    expect(get.body.bankStatement.transactions[0].suggestedCounterpartyId).toBe(partnerId);
    const response = await request.post(`/companies/${companyId}/documents/${id}/confirm`).send({ createInvoice: true });
    expect(response.status).toBe(400);
    expect(response.body.code).toBe("BANK_STATEMENT_NOT_INVOICE");
  });
  it("atomically replaces only an unpaid, unposted invoice and creates balanced non-VAT bank evidence", async () => {
    const [invoice] = await db.insert(invoicesTable).values({
      companyId, periodId, counterpartyId: partnerId, type: "received", status: "draft",
      invoiceNumber: "TX-1", invoiceDate: "2026-01-06", arApAccountId: apId, createdBy: user,
    }).returning();
    replacedInvoice = invoice.id;
    repairedDoc = await document("1", invoice.id);
    expect((await request.post(url(repairedDoc)).send(body("1"))).status).toBe(409);
    const response = await request.post(url(repairedDoc)).send(body("1", { replaceDraftInvoice: true }));
    expect(response.status).toBe(200);
    entryId = response.body.journalEntryId;
    expect(response.body.replacedInvoiceId).toBe(invoice.id);
    const [entry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, entryId));
    expect(entry.status).toBe("draft");
    expect(entry.postedAt).toBeNull();
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entryId));
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: bankId, side: "debit", amount: "400.00", vatCodeId: null }),
      expect.objectContaining({ accountId: arId, side: "credit", amount: "400.00", partnerId, vatCodeId: null }),
    ]));
    const [old] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(old.status).toBe("void");
    const evidence = await db.select().from(bankStatementLinesTable).where(eq(bankStatementLinesTable.statementId, response.body.statementId));
    expect(evidence).toHaveLength(1);
    const replay = await request.post(url(repairedDoc)).send(body("1", { replaceDraftInvoice: true }));
    expect(replay.body).toEqual(response.body);
  });
  it("rejects a second copy and rolls back without another draft or invoice change", async () => {
    const id = await document("copy", undefined, text("1"));
    const response = await request.post(url(id)).send(body("1"));
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/že v evidenci/);
    const [doc] = await db.select().from(documentsTable).where(eq(documentsTable.id, id));
    expect(doc.status).toBe("done");
  });
  it("serializes concurrent confirmation of one document", async () => {
    const id = await document("parallel");
    const responses = await Promise.all([request.post(url(id)).send(body("parallel")), request.post(url(id)).send(body("parallel"))]);
    expect(responses.map(r => r.status)).toEqual([200, 200]);
    expect(responses[0].body).toEqual(responses[1].body);
  });
  it("preserves a draft linked to a ledger entry and rejects invalid accounts or periods", async () => {
    const [invoice] = await db.insert(invoicesTable).values({
      companyId, periodId, counterpartyId: partnerId, type: "received", status: "draft", linkedEntryId: entryId,
      invoiceNumber: "unsafe", invoiceDate: "2026-01-06", arApAccountId: apId, createdBy: user,
    }).returning();
    const id = await document("unsafe", invoice.id);
    const response = await request.post(url(id)).send(body("unsafe", { replaceDraftInvoice: true }));
    expect(response.status).toBe(409);
    expect(response.body.error).toMatch(/knjižbo/);
    const [unchanged] = await db.select().from(invoicesTable).where(eq(invoicesTable.id, invoice.id));
    expect(unchanged.status).toBe("draft");
    const invalid = await document("invalid");
    expect((await request.post(url(invalid)).send(body("invalid", { bankAccountId: apId }))).status).toBe(400);
    await db.update(accountingPeriodsTable).set({ status: "locked" }).where(eq(accountingPeriodsTable.id, periodId));
    expect((await request.post(url(invalid)).send(body("invalid"))).status).toBe(400);
    await db.update(accountingPeriodsTable).set({ status: "open" }).where(eq(accountingPeriodsTable.id, periodId));
  });
  it("records outflows with the inverse sides and blocks foreign ownership and viewers", async () => {
    const id = await document("out", undefined, text("out", true));
    const response = await request.post(url(id)).send(body("out", {
      transactions: [{ transactionId: "TX-out", counterAccountId: apId, counterpartyId: partnerId }],
    }));
    expect(response.status).toBe(200);
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, response.body.journalEntryId));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: bankId, side: "credit", amount: "400.00" }),
      expect.objectContaining({ accountId: apId, side: "debit", amount: "400.00" }),
    ]));
    const foreign = await document("foreign", undefined, text("foreign").replace(`SI${tax}`, "SI00000000"));
    expect((await request.post(url(foreign)).send(body("foreign"))).status).toBe(403);
    user = "scanned-bank-test-viewer";
    expect((await request.post(url(foreign)).send(body("foreign"))).status).toBe(403);
    user = "scanned-bank-test-outsider";
    expect((await request.get(`/companies/${companyId}/documents/${foreign}`)).status).toBe(403);
    user = "scanned-bank-test-owner";
  });
});
