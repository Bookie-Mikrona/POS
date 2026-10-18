import express from "express";
import type multerType from "multer";
import request from "supertest";
import { XMLParser } from "fast-xml-parser";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  roles: [] as Array<{ role: string }>,
  select: vi.fn(),
  where: vi.fn(),
  upload: vi.fn(),
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { clerkUserId: "statement-user" });
    next();
  },
}));

vi.mock("../lib/native-payment-allocations", () => ({
  lockNativeSourceLines: vi.fn(),
  validateNativeAllocations: vi.fn(),
}));

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_target, key) => String(key) });
  return {
    db: { select: state.select },
    counterpartiesTable: table,
    invoicesTable: table,
    bookieOldArSettlementsTable: table,
    bookieOldBankApClosingsTable: table,
    invoiceLinesTable: table,
    paymentAllocationsTable: table,
    paymentLedgerAllocationsTable: table,
    paymentsTable: table,
    accountingRolesTable: table,
    accountsTable: table,
    accountingPeriodsTable: table,
    bankStatementsTable: table,
    bankStatementLinesTable: table,
    bankAccountMetadataTable: table,
    paymentBatchesTable: table,
    paymentBatchItemsTable: table,
    journalEntriesTable: table,
    journalEntryLinesTable: table,
    auditLogTable: table,
  };
});

vi.mock("drizzle-orm", () => ({
  and: (...conditions: unknown[]) => conditions,
  eq: (column: unknown, value: unknown) => [column, value],
  asc: vi.fn(),
  desc: vi.fn(),
  inArray: vi.fn(),
  isNull: vi.fn(),
  sql: vi.fn(),
}));

// Observe execution, but keep the real multipart parser and memory storage.
vi.mock("multer", async (importOriginal) => {
  const { default: multer } = await importOriginal<{ default: typeof multerType }>();
  const observed = Object.assign(
    (...args: Parameters<typeof multer>) => {
      const upload = multer(...args);
      const single = upload.single.bind(upload);
      upload.single = (field) => {
        const middleware = single(field);
        return (req, res, next) => {
          state.upload();
          middleware(req, res, next);
        };
      };
      return upload;
    },
    multer,
  );
  return { default: observed };
});

import router from "./bankStatements";

const app = express();
app.use(router);
const endpoint = "/companies/foreign-company/bank-statements/parse";
const accessCamt = `<Document><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">42.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-09-10</Dt></BookgDt>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

beforeEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  state.roles = [{ role: "owner" }];
  const chain = {
    from: () => chain,
    where: state.where,
    limit: async () => state.roles,
  };
  state.where.mockReturnValue(chain);
  state.select.mockReturnValue(chain);
});

describe("bank statement multipart access contract", () => {
  beforeEach(() => {
    state.roles = [];
  });
  it("rejects a foreign company before upload or transaction parsing", async () => {
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    const response = await request(app)
      .post(endpoint)
      .attach("file", Buffer.from(accessCamt), "statement.xml");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Dostop do tega podjetja ni dovoljen" });
    for (const field of ["transactions", "totalRows", "skippedRows"]) {
      expect(response.body).not.toHaveProperty(field);
    }
    expect(state.select).toHaveBeenCalledTimes(1);
    expect(state.where).toHaveBeenCalledWith([
      ["clerkUserId", "statement-user"],
      ["companyId", "foreign-company"],
    ]);
    expect(state.upload).not.toHaveBeenCalled();
    expect(parse).not.toHaveBeenCalled();
  });

  it("returns access denial before multipart errors for an unexpected file field", async () => {
    const response = await request(app)
      .post(endpoint)
      .attach("unexpected", Buffer.from(accessCamt), "statement.xml");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Dostop do tega podjetja ni dovoljen" });
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("still uploads and parses the statement when the user has a company role", async () => {
    state.roles = [{ role: "accountant" }];
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    const response = await request(app)
      .post(endpoint)
      .attach("file", Buffer.from(accessCamt), "statement.xml");

    expect(response.status).toBe(200);
    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0]).toMatchObject({ amount: 42, date: "2026-09-10" });
    expect(response.body.skippedRows).toEqual([]);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(state.select.mock.invocationCallOrder[0]).toBeLessThan(state.upload.mock.invocationCallOrder[0]);
  });
});

const mt940 = (entries: string[]) => [
  ":20:STATEMENT",
  ":25:SI56020100012345678",
  ":28C:00001/001",
  ":60F:C261001EUR100,00",
  ...entries,
  ":62F:C261002EUR124,50",
].join("\r\n");
const validMt940 = ":61:261002C24,50NTRFNONREF";
const invalidMt940 = ":61:not-a-transaction";

const camt = (entries: string[]) => `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt><Stmt><Id>STATEMENT</Id>
    <Acct><Id><IBAN>SI56020100012345678</IBAN></Id><Ccy>EUR</Ccy></Acct>
    ${entries.join("\n")}
  </Stmt></BkToCstmrStmt>
</Document>`;
const validCamt = `<Ntry><Amt Ccy="EUR">24.50</Amt><CdtDbtInd>CRDT</CdtDbtInd>
  <BookgDt><Dt>2026-10-02</Dt></BookgDt></Ntry>`;
const invalidCamt = `<Ntry><Amt Ccy="EUR">10.00</Amt><CdtDbtInd>INVALID</CdtDbtInd>
  <BookgDt><Dt>2026-10-02</Dt></BookgDt></Ntry>`;

describe("bank-statement-parse-contract: multipart HTTP row counts", () => {
  // Test both filename and content detection, without calling parsers directly.
  it.each(["statement.mt940", "statement.sta", "statement.940", "statement.txt"])(
    "counts valid and skipped :61: records in %s",
    async (filename) => {
      const response = await request(app).post(endpoint).attach(
        "file",
        Buffer.from(mt940([validMt940, ":86:Payment details", invalidMt940])),
        { filename, contentType: "text/plain" },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        count: 1,
        totalRows: 2,
        sourceFilename: filename,
        transactions: [{ id: "mt940-0", date: "2026-10-02", amount: 24.5 }],
        skippedRows: [{ lineNumber: 7, reason: "Vrstica :61: ni v prepoznavnem formatu" }],
      });
      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.skippedRows).toHaveLength(1);
    },
  );

  it.each(["statement.xml", "statement.txt"])(
    "counts valid and invalid CAMT.053 entries in %s",
    async (filename) => {
      const response = await request(app).post(endpoint).attach(
        "file", Buffer.from(camt([validCamt, invalidCamt])),
        { filename, contentType: "application/xml" },
      );

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        count: 1,
        totalRows: 2,
        transactions: [{ date: "2026-10-02", amount: 24.5 }],
        skippedRows: [{
          lineNumber: 2,
          reason: "CAMT knjižba nima veljavnega datuma, zneska ali smeri CRDT/DBIT",
        }],
      });
      expect(response.body.transactions).toHaveLength(1);
      expect(response.body.skippedRows).toHaveLength(1);
    },
  );

  it.each([
    {
      filename: "invalid.mt940",
      content: mt940([invalidMt940, ":61:261002C0,00NTRFNONREF"]),
      reasons: ["Vrstica :61: ni v prepoznavnem formatu", "Znesek je 0"],
    },
    {
      filename: "invalid.xml",
      content: camt([invalidCamt, invalidCamt]),
      reasons: Array(2).fill("CAMT knjižba nima veljavnega datuma, zneska ali smeri CRDT/DBIT"),
    },
  ])("preserves all skipped rows in 422 for $filename", async ({ filename, content, reasons }) => {
    const response = await request(app).post(endpoint).attach("file", Buffer.from(content), filename);

    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: "Vse vrstice so bile preskočene. Preverite format datoteke.",
      totalRows: 2,
    });
    expect(response.body.skippedRows.map((row: { reason: string }) => row.reason)).toEqual(reasons);
    expect(response.body.skippedRows.map((row: { lineNumber: number }) => row.lineNumber))
      .toEqual(filename.endsWith(".xml") ? [1, 2] : [5, 6]);
  });

  it("also preserves the CSV HTTP counting contract", async () => {
    const response = await request(app).post(endpoint).attach(
      "file", Buffer.from("Datum;Znesek\n02.10.2026;24,50\ninvalid;10,00\n"), "statement.csv",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ count: 1, totalRows: 2 });
    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.skippedRows).toHaveLength(1);
  });

  it("still accepts CSV mislabeled as MT940 when no :61: records exist", async () => {
    const response = await request(app).post(endpoint).attach(
      "file", Buffer.from("Datum;Znesek\n02.10.2026;24,50\n"), "statement.mt940",
    );
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ count: 1, totalRows: 1, skippedRows: [] });
  });

  it.each([
    { filename: "empty.xml", content: camt([]) },
    { filename: "empty.mt940", content: "" },
  ])("returns a zero-row 422 contract for $filename", async ({ filename, content }) => {
    const response = await request(app).post(endpoint).attach("file", Buffer.from(content), filename);
    expect(response.status).toBe(422);
    expect(response.body).toEqual({
      error: "V datoteki ni bilo najdenih transakcij. Preverite format.",
      totalRows: 0,
      skippedRows: [],
    });
  });
});
