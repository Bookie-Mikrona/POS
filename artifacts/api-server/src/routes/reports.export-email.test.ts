import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  values: vi.fn(),
  send: vi.fn(),
  pdf: vi.fn(),
  aggregates: [] as Record<string, unknown>[],
  aggregateBatches: [] as Record<string, unknown>[][],
  error: vi.fn(),
}));

vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: mocks.getUser } } }));

vi.mock("@workspace/db", () => ({
  db: { select: mocks.select, insert: mocks.insert },
  journalEntriesTable: {},
  journalEntryLinesTable: {},
  accountsTable: {},
  accountingRolesTable: {},
  companiesTable: {},
  costCentersTable: {},
  projectsTable: {},
  departmentsTable: {},
  reportExportsTable: {},
}));
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { clerkUserId: "exporter" });
    next();
  },
}));
vi.mock("../lib/report-pdf", () => ({
  generateBalanceSheetPdf: mocks.pdf,
  generateIncomeStatementPdf: mocks.pdf,
  generateTrialBalancePdf: mocks.pdf,
}));
vi.mock("../lib/erp-email", () => ({
  posljiPorociloPdf: mocks.send,
  getErpSmtp: vi.fn(),
}));
vi.mock("../lib/logger", () => ({ logger: { error: mocks.error } }));

import router from "./reports";

describe("report email export audit trail", () => {
  let server: ReturnType<express.Express["listen"]>;
  let url: string;
  const pdf = Buffer.from("%PDF-test");
  const saved: Record<string, unknown>[] = [];

  beforeEach(async () => {
    vi.resetAllMocks();
    mocks.getUser.mockResolvedValue({ firstName: " Ana ", lastName: " Novak ", emailAddresses: [] });
    saved.length = 0;
    mocks.aggregates.length = 0;
    mocks.aggregateBatches.length = 0;
    // Access, company and empty aggregate queries require no real tenant data.
    mocks.select.mockImplementation((fields: Record<string, unknown>) => {
      const query: Record<string, unknown> = {};
      for (const method of ["from", "where", "innerJoin", "groupBy"]) {
        query[method] = vi.fn(() => query);
      }
      query.limit = vi.fn(async () =>
        "role" in fields ? [{ role: "admin" }]
          : "naziv" in fields ? [{ naziv: "Test company", email: "sender@example.com" }]
            : [],
      );
      query.then = (resolve: (value: unknown[]) => void) =>
        resolve("total" in fields ? mocks.aggregateBatches.shift() ?? mocks.aggregates : []);
      return query;
    });
    mocks.insert.mockReturnValue({ values: mocks.values });
    mocks.values.mockImplementation(async (record: Record<string, unknown>) => {
      saved.push(record);
    });
    mocks.pdf.mockResolvedValue(pdf);
    mocks.send.mockResolvedValue({ uspeh: true });
    const app = express();
    app.use(express.json(), router);
    await new Promise<void>((resolve, reject) => {
      server = app.listen(0, "127.0.0.1", (error?: Error) => error ? reject(error) : resolve());
    });
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/companies/company-a/reports/export`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });

  function exportReport(email?: string, params: Record<string, string | undefined> = {}) {
    return fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportType: "income-statement", dateFrom: "2026-01-01", dateTo: "2026-12-31", email, ...params }),
    });
  }

  it("records one successful email only after SMTP has succeeded", async () => {
    mocks.send.mockImplementation(async () => {
      expect(mocks.insert).not.toHaveBeenCalled();
      return { uspeh: true };
    });
    const res = await exportReport("recipient@example.com");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ uspeh: true });
    expect(saved).toEqual([expect.objectContaining({
      companyId: "company-a",
      exportedBy: "exporter",
      exportedByName: "Ana Novak",
      emailSentTo: "recipient@example.com",
      pdfData: pdf,
      params: { dateFrom: "2026-01-01", dateTo: "2026-12-31" },
    })]);
    expect(mocks.send).toHaveBeenCalledOnce();
  });

  it.each(["balance-sheet", "income-statement", "trial-balance"])(
    "records %s email exports only after successful sending",
    async (reportType) => {
      mocks.send.mockImplementation(async () => {
        expect(mocks.insert).not.toHaveBeenCalled();
        return { uspeh: true };
      });
      const res = await exportReport("recipient@example.com", { reportType, asOf: "2026-12-31" });
      expect(res.status).toBe(200);
      expect(saved).toEqual([expect.objectContaining({ reportType, emailSentTo: "recipient@example.com", exportedByName: "Ana Novak" })]);
      const generated = mocks.pdf.mock.calls[0]?.[0];
      if (reportType === "balance-sheet") {
        expect(generated.current).toMatchObject({ aktiva: { total: "0.00" }, pasiva: { total: "0.00" } });
      } else if (reportType === "income-statement") {
        expect(generated.current).toMatchObject({ revenue: { total: "0.00" }, expenses: { total: "0.00" } });
      } else {
        expect(generated.rows).toEqual([]);
      }
    },
  );

  it("stores the primary email for downloads when there is no display name", async () => {
    mocks.getUser.mockResolvedValue({
      firstName: " ", lastName: null, primaryEmailAddressId: "primary",
      emailAddresses: [
        { id: "secondary", emailAddress: "other@example.test" },
        { id: "primary", emailAddress: " primary@example.test " },
      ],
    });
    expect((await exportReport()).status).toBe(200);
    expect(saved[0]).toMatchObject({ exportedBy: "exporter", exportedByName: "primary@example.test" });
    expect(mocks.getUser).toHaveBeenCalledExactlyOnceWith("exporter");
  });

  it.each(["unavailable", "missing identity"])("does not send or save an export with %s", async (reason) => {
    if (reason === "unavailable") mocks.getUser.mockRejectedValue(new Error("unavailable"));
    else mocks.getUser.mockResolvedValue({ firstName: null, lastName: null, emailAddresses: [] });
    expect((await exportReport("recipient@example.test")).status).toBe(502);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("uses filtered account rows and totals for a trial-balance attachment", async () => {
    mocks.aggregates.push(
      { accountId: "one", accountCode: "410", accountName: "Elektrika", accountType: "expense", side: "debit", total: "25.00" },
      { accountId: "two", accountCode: "420", accountName: "Telefon", accountType: "expense", side: "debit", total: "50.00" },
      { accountId: "three", accountCode: "110", accountName: "Denar", accountType: "asset", side: "debit", total: "75.00" },
    );
    const res = await exportReport("recipient@example.com", {
      reportType: "trial-balance", accountClass: "4", searchTerm: "elektrika",
    });
    expect(res.status).toBe(200);
    expect(mocks.pdf.mock.calls[0]?.[0]).toMatchObject({
      rows: [expect.objectContaining({ accountCode: "410", accountName: "Elektrika" })],
      totalTurnoverDebit: "25.00",
      totalBalanceDebit: "25.00",
    });
    expect(saved[0]?.params).toMatchObject({ accountClass: "4", searchTerm: "elektrika" });
  });

  it.each([
    {
      reportType: "balance-sheet",
      params: { asOf: "2026-12-31", compareAsOf: "2025-12-31" },
      codes: ["110", "120"],
      storedType: "expense",
      effectiveType: "asset",
      filename: "bilanca-stanja-2026-12-31.pdf",
    },
    {
      reportType: "income-statement",
      params: { dateFrom: "2026-01-01", dateTo: "2026-12-31", compareDateFrom: "2025-01-01", compareDateTo: "2025-12-31" },
      codes: ["410", "420"],
      storedType: "asset",
      effectiveType: "expense",
      filename: "izkaz-poslovnega-izida-2026-01-01-2026-12-31.pdf",
    },
  ])("preserves both periods' account type warnings in $reportType downloads and email attachments",
    async ({ reportType, params, codes, storedType, effectiveType, filename }) => {
      const warnings = codes.map((code, index) => ({
        accountId: `account-${index}`,
        code,
        name: index === 0 ? "Current period account" : "Comparison period account",
        storedType,
        effectiveType,
      }));
      const aggregates = warnings.map((warning, index) => [{
        accountId: warning.accountId,
        accountCode: warning.code,
        accountName: warning.name,
        accountType: warning.storedType,
        side: "debit",
        total: index === 0 ? "125.00" : "75.00",
      }]);

      // Exercise the real loaders with distinct accounts in each period, so
      // losing or reusing either period's diagnostics cannot pass unnoticed.
      mocks.aggregateBatches.push(...aggregates);
      const download = await exportReport(undefined, { reportType, ...params });
      expect(download.status).toBe(200);
      expect(download.headers.get("content-type")).toContain("application/pdf");
      expect(download.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
      expect(Buffer.from(await download.arrayBuffer())).toEqual(pdf);
      expect(mocks.send).not.toHaveBeenCalled();
      expect(mocks.pdf).toHaveBeenCalledOnce();
      const downloadInput = mocks.pdf.mock.calls[0]![0];
      expect(downloadInput.current.typeWarnings).toEqual([warnings[0]]);
      expect(downloadInput.compare.typeWarnings).toEqual([warnings[1]]);

      mocks.aggregateBatches.push(...aggregates);
      const email = await exportReport("recipient@example.test", { reportType, ...params });
      expect(email.status).toBe(200);
      expect(await email.json()).toMatchObject({ uspeh: true });
      expect(mocks.pdf).toHaveBeenCalledTimes(2);
      const emailInput = mocks.pdf.mock.calls[1]![0];
      expect(emailInput.current.typeWarnings).toEqual([warnings[0]]);
      expect(emailInput.compare.typeWarnings).toEqual([warnings[1]]);
      expect(emailInput).toEqual(downloadInput);
      expect(mocks.aggregateBatches).toHaveLength(0);
      expect(mocks.send).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({
          companyId: "company-a", prejemnik: "recipient@example.test", filename, pdfBuffer: pdf,
        }),
        expect.any(Object),
      );
      expect(saved).toHaveLength(2);
      expect(saved.map((record) => record.pdfData)).toEqual([pdf, pdf]);
    },
  );

  it.each(["balance-sheet", "income-statement", "trial-balance"])(
    "does not record a failed %s email",
    async (reportType) => {
      mocks.send.mockResolvedValue({ uspeh: false, napaka: "SMTP unavailable" });
      const res = await exportReport("recipient@example.com", { reportType, asOf: "2026-12-31" });
      expect(res.status).toBe(502);
      expect(mocks.insert).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["balance-sheet", "asOf=2026-12-31&compareAsOf=2025-12-31", "aktiva"],
    ["income-statement", "dateFrom=2026-01-01&dateTo=2026-12-31&compareDateFrom=2025-01-01", "revenue"],
  ])("keeps the %s report endpoint and comparison working", async (reportType, query, field) => {
    const res = await fetch(`${url.replace(/export$/, reportType)}?${query}`);
    expect(res.status).toBe(200);
    const report = await res.json() as { current: Record<string, unknown>; compare: Record<string, unknown> };
    expect(report.current).toHaveProperty(field);
    expect(report.compare).toHaveProperty(field);
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("shows SMTP failure without inserting a misleading export", async () => {
    mocks.send.mockResolvedValue({ uspeh: false, napaka: "SMTP unavailable" });
    const res = await exportReport("recipient@example.com");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "SMTP unavailable" });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("shows an explicit error when sending returns no error detail", async () => {
    mocks.send.mockResolvedValue({ uspeh: false });
    const res = await exportReport("recipient@example.com");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Pošiljanje ni uspelo." });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("does not insert an export if the mail helper throws", async () => {
    mocks.send.mockRejectedValue(new Error("Transport setup failed"));
    const res = await exportReport("recipient@example.com");
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "Pošiljanje ni uspelo." });
    expect(mocks.insert).not.toHaveBeenCalled();
  });

  it("creates only one history entry when a failed email is retried successfully", async () => {
    mocks.send.mockResolvedValueOnce({ uspeh: false, napaka: "SMTP unavailable" });
    expect((await exportReport("recipient@example.com")).status).toBe(502);
    expect((await exportReport("recipient@example.com")).status).toBe(200);
    expect(saved).toHaveLength(1);
    expect(saved[0]?.emailSentTo).toBe("recipient@example.com");
  });

  it.each([undefined, ""])("keeps PDF downloads recorded without an email recipient (%s)", async (email) => {
    const res = await exportReport(email);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/pdf");
    expect(Buffer.from(await res.arrayBuffer())).toEqual(pdf);
    expect(mocks.send).not.toHaveBeenCalled();
    expect(saved).toHaveLength(1);
    expect(saved[0]?.emailSentTo).toBeNull();
  });

  it("warns not to resend if history persistence fails after successful sending", async () => {
    mocks.values.mockRejectedValue(new Error("Database unavailable"));
    const res = await exportReport("recipient@example.com");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: expect.stringContaining("Ne pošiljajte ga ponovno.") });
    expect(mocks.send).toHaveBeenCalledOnce();
    expect(saved).toHaveLength(0);
  });

  it("does not download an unrecorded PDF if history persistence fails", async () => {
    mocks.values.mockRejectedValue(new Error("Database unavailable"));
    const res = await exportReport();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Zapis v zgodovino izvozov ni uspel. Poskusite znova." });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});
