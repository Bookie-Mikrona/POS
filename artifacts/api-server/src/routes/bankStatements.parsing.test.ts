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
const camt = `<Document><BkToCstmrStmt><Stmt>
  <Ntry><Amt Ccy="EUR">42.00</Amt><CdtDbtInd>CRDT</CdtDbtInd>
    <BookgDt><Dt>2026-09-10</Dt></BookgDt>
  </Ntry>
</Stmt></BkToCstmrStmt></Document>`;

describe("bank statement multipart access contract", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    state.roles = [];
    const chain = {
      from: () => chain,
      where: state.where,
      limit: async () => state.roles,
    };
    state.where.mockReturnValue(chain);
    state.select.mockReturnValue(chain);
  });

  it("rejects a foreign company before upload or transaction parsing", async () => {
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    const response = await request(app)
      .post(endpoint)
      .attach("file", Buffer.from(camt), "statement.xml");

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
      .attach("unexpected", Buffer.from(camt), "statement.xml");

    expect(response.status).toBe(403);
    expect(response.body).toEqual({ error: "Dostop do tega podjetja ni dovoljen" });
    expect(state.upload).not.toHaveBeenCalled();
  });

  it("still uploads and parses the statement when the user has a company role", async () => {
    state.roles = [{ role: "accountant" }];
    const parse = vi.spyOn(XMLParser.prototype, "parse");
    const response = await request(app)
      .post(endpoint)
      .attach("file", Buffer.from(camt), "statement.xml");

    expect(response.status).toBe(200);
    expect(response.body.transactions).toHaveLength(1);
    expect(response.body.transactions[0]).toMatchObject({ amount: 42, date: "2026-09-10" });
    expect(response.body.skippedRows).toEqual([]);
    expect(state.upload).toHaveBeenCalledTimes(1);
    expect(parse).toHaveBeenCalledTimes(1);
    expect(state.select.mock.invocationCallOrder[0]).toBeLessThan(state.upload.mock.invocationCallOrder[0]);
  });
});
