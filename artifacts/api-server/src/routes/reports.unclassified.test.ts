/**
 * reports.unclassified.test.ts
 *
 * Preveri, da konti z manjkajočim ali nestandardnim tipom ne izginejo tiho
 * iz računovodskih poročil, ampak pristanejo v explicit "unclassifiedAccounts".
 */

import { vi, describe, it, expect } from "vitest";

// ── Mocks (morajo biti pred importom routes modula) ────────────────────────────

vi.mock("@workspace/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        innerJoin: vi.fn().mockReturnValue({
          innerJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue([]),
            }),
          }),
          leftJoin: vi.fn().mockReturnValue({
            where: vi.fn().mockReturnValue({
              groupBy: vi.fn().mockResolvedValue([]),
            }),
          }),
          where: vi.fn().mockReturnValue({
            groupBy: vi.fn().mockResolvedValue([]),
            orderBy: vi.fn().mockResolvedValue([]),
          }),
        }),
      }),
    }),
  },
  journalEntriesTable:    { companyId: "companyId", status: "status", entryDate: "entryDate" },
  journalEntryLinesTable: { accountId: "accountId", side: "side", amount: "amount",
                            costCenterId: "costCenterId", projectId: "projectId", departmentId: "departmentId" },
  accountsTable:          { id: "id", code: "code", name: "name", type: "type" },
  accountingRolesTable:   { clerkUserId: "clerkUserId", companyId: "companyId", role: "role" },
  costCentersTable:       { id: "id", code: "code", name: "name", companyId: "companyId" },
  projectsTable:          { id: "id", code: "code", name: "name", companyId: "companyId" },
  departmentsTable:       { id: "id", code: "code", name: "name", companyId: "companyId" },
  auditLogTable:          {},
  reportExportsTable:     { companyId: "companyId", reportType: "reportType", exportedAt: "exportedAt",
                            exportedBy: "exportedBy", params: "params", format: "format",
                            storageObjectPath: "storageObjectPath" },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: vi.fn((_req: unknown, _res: unknown, next: () => void) => next()),
}));

vi.mock("../lib/report-pdf", () => ({
  generateReportPdf: vi.fn(),
  posljiPorociloPdf: vi.fn(),
}));

vi.mock("../lib/erp-email", () => ({
  posljiPorociloPdf: vi.fn(),
  getErpSmtp: vi.fn(),
}));

// ── Import čistih funkcij po mockih ───────────────────────────────────────────

import { resolveEffectiveType, buildBalanceSheet, buildIncomeStatement } from "./reports";

// ── Pomožna funkcija ──────────────────────────────────────────────────────────

function makeAccount(
  code: string,
  type: string | null,
  debit = 1000,
  credit = 0,
) {
  return {
    accountId: `id-${code}`,
    code,
    name: `Konto ${code}`,
    type: type as string,   // cast: AccountBalance.type je string, DB pa vrne null
    debit,
    credit,
    balance: debit - credit,
  };
}

// ── resolveEffectiveType ───────────────────────────────────────────────────────

describe("resolveEffectiveType — pravila 1/2/3", () => {

  it("Pravilo 1: SRS override za numerično kodo z napačnim tipom", () => {
    expect(resolveEffectiveType(makeAccount("100", "liability"))).toBe("asset");
    expect(resolveEffectiveType(makeAccount("200", "asset"))).toBe("liability");
    expect(resolveEffectiveType(makeAccount("400", "asset"))).toBe("expense");
    expect(resolveEffectiveType(makeAccount("700", "expense"))).toBe("revenue");
    expect(resolveEffectiveType(makeAccount("900", "asset"))).toBe("equity");
  });

  it("Pravilo 1: SRS override deluje tudi za null tip z numerično kodo", () => {
    expect(resolveEffectiveType(makeAccount("100", null))).toBe("asset");
    expect(resolveEffectiveType(makeAccount("400", null))).toBe("expense");
    expect(resolveEffectiveType(makeAccount("700", null))).toBe("revenue");
    expect(resolveEffectiveType(makeAccount("900", null))).toBe("equity");
  });

  it("Pravilo 1: SRS override deluje za 'cost'/'income' z numerično kodo", () => {
    // Unknown legacy types follow the same rules as the approved chart.
    expect(resolveEffectiveType(makeAccount("400", "cost"))).toBe("expense");
    expect(resolveEffectiveType(makeAccount("500", "cost"))).toBe("liability");
    // income na kodi 7 → SRS override → revenue
    expect(resolveEffectiveType(makeAccount("700", "income"))).toBe("revenue");
  });

  it("Pravilo 2: veljavni tipi z ujemajočo SRS kodo se vrnejo nespremenjeni", () => {
    expect(resolveEffectiveType(makeAccount("100", "asset"))).toBe("asset");
    expect(resolveEffectiveType(makeAccount("200", "liability"))).toBe("liability");
    expect(resolveEffectiveType(makeAccount("300", "asset"))).toBe("asset");
    expect(resolveEffectiveType(makeAccount("400", "expense"))).toBe("expense");
    expect(resolveEffectiveType(makeAccount("700", "revenue"))).toBe("revenue");
    expect(resolveEffectiveType(makeAccount("900", "equity"))).toBe("equity");
  });

  it("Pravilo 3: null tip z ne-numerično kodo → 'unclassified' (ne tiha izguba)", () => {
    expect(resolveEffectiveType(makeAccount("X100", null))).toBe("unclassified");
    expect(resolveEffectiveType(makeAccount("", null))).toBe("unclassified");
    expect(resolveEffectiveType(makeAccount("ABC", null))).toBe("unclassified");
  });

  it("Pravilo 3: nestandardni tip z ne-numerično kodo → 'unclassified'", () => {
    expect(resolveEffectiveType(makeAccount("X100", "cost"))).toBe("unclassified");
    expect(resolveEffectiveType(makeAccount("MISC", "income"))).toBe("unclassified");
    expect(resolveEffectiveType(makeAccount("ZZ", "contra"))).toBe("unclassified");
    expect(resolveEffectiveType(makeAccount("ZZ", "popolnoma_neznan"))).toBe("unclassified");
  });

  it("Pravilo 3: veljavni tip z ne-numerično kodo SE uvrsti normalno (Pravilo 2)", () => {
    // Koda se ne začne s cifro, ampak tip je veljaven — sprejemamo po Pravilu 2
    expect(resolveEffectiveType(makeAccount("X100", "asset"))).toBe("asset");
    expect(resolveEffectiveType(makeAccount("MISC", "revenue"))).toBe("revenue");
  });
});

// ── buildBalanceSheet ─────────────────────────────────────────────────────────

describe("buildBalanceSheet — tiha izguba preprečena", () => {

  it("konto z null tipom in ne-numerično kodo pristane v unclassifiedAccounts", () => {
    const accounts = [
      makeAccount("100", "asset",      1000, 0),
      makeAccount("200", "liability",  0,    1000),
      makeAccount("X99", null,         500,  0),   // ← mora pristati v unclassified
    ];
    const result = buildBalanceSheet(accounts);

    expect(result.unclassifiedAccounts).toHaveLength(1);
    expect(result.unclassifiedAccounts[0].code).toBe("X99");
    expect(result.unclassifiedAccounts[0].debit).toBe(500);
    expect(result.unclassifiedAccounts[0].credit).toBe(0);
    expect(result.unclassifiedAccounts[0].net).toBe(500);

    // Ne sme biti v aktivi ali pasivi
    const reportedCodes = [
      ...result.aktiva.sections.flatMap((s) => s.items.map((i) => i.accountCode)),
      ...result.pasiva.sections.flatMap((s) => s.items.map((i) => i.accountCode)),
    ];
    expect(reportedCodes).not.toContain("X99");
  });

  it("konto z numerično kodo in null tipom dobi SRS override — NI unclassified", () => {
    const accounts = [makeAccount("100", null, 1000, 0)];
    const result = buildBalanceSheet(accounts);

    expect(result.unclassifiedAccounts).toHaveLength(0);
    expect(result.aktiva.sections.length).toBeGreaterThan(0);
  });

  it("unclassifiedAccounts je prazen, ko ni problematičnih kontov", () => {
    const accounts = [
      makeAccount("100", "asset",     500, 0),
      makeAccount("200", "liability", 0,   500),
    ];
    const result = buildBalanceSheet(accounts);

    expect(result.unclassifiedAccounts).toHaveLength(0);
    expect(result.typeWarnings).toHaveLength(0);
  });

  it("typeWarnings zajema prerazvrščene konte, unclassifiedAccounts pa izpuščene", () => {
    const accounts = [
      makeAccount("100", "liability", 500, 0),  // napačen tip → typeWarning
      makeAccount("X99", null,        200, 0),  // ne-numerična koda → unclassified
    ];
    const result = buildBalanceSheet(accounts);

    // 100 dobi SRS override asset→asset, prikaz v aktivi, a typeWarning ker stored≠effective
    expect(result.typeWarnings).toHaveLength(1);
    expect(result.typeWarnings[0].code).toBe("100");

    // X99 pristane v unclassified, ne pa v aktivi/pasivi
    expect(result.unclassifiedAccounts).toHaveLength(1);
    expect(result.unclassifiedAccounts[0].code).toBe("X99");
  });

  it("konti z nič prometom se ne pojavijo v unclassifiedAccounts", () => {
    const accounts = [makeAccount("X99", null, 0, 0)];
    const result = buildBalanceSheet(accounts);
    expect(result.unclassifiedAccounts).toHaveLength(0);
  });
});

// ── buildIncomeStatement ──────────────────────────────────────────────────────

describe("buildIncomeStatement — tiha izguba preprečena", () => {

  it("konto z ne-numerično kodo pristane v unclassifiedAccounts, ne v prihodkih/odhodkih", () => {
    const accounts = [
      makeAccount("700", "revenue", 0,   1000),
      makeAccount("400", "expense", 600, 0),
      makeAccount("MISC", "income", 200, 0),  // ← ne-numerična koda + "income" ni v VALID_REPORT_TYPES
    ];
    const result = buildIncomeStatement(accounts);

    expect(result.unclassifiedAccounts).toHaveLength(1);
    expect(result.unclassifiedAccounts[0].code).toBe("MISC");

    const reportedCodes = [
      ...result.revenue.sections.flatMap((s) => s.items.map((i) => i.accountCode)),
      ...result.expenses.sections.flatMap((s) => s.items.map((i) => i.accountCode)),
    ];
    expect(reportedCodes).not.toContain("MISC");
  });

  it("unclassifiedAccounts je prazen za standardna poročila", () => {
    const accounts = [
      makeAccount("700", "revenue", 0,   1000),
      makeAccount("400", "expense", 600, 0),
    ];
    const result = buildIncomeStatement(accounts);
    expect(result.unclassifiedAccounts).toHaveLength(0);
  });

  it("netResult se NE popravi za unclassified (ker ne vemo, ali so prihodki ali odhodki)", () => {
    const accounts = [
      makeAccount("700", "revenue", 0,   1000),
      makeAccount("400", "expense", 400, 0),
      makeAccount("X99", null,      200, 0),   // unclassified — ne vpliva na netResult
    ];
    const result = buildIncomeStatement(accounts);

    // netResult = prihodki − odhodki, brez unclassified
    expect(parseFloat(result.netResult)).toBeCloseTo(600, 1);
    expect(result.unclassifiedAccounts).toHaveLength(1);
  });

  it("unclassifiedAccounts skupaj pokrije vse knjižbe, ki bi sicer izginile", () => {
    const accounts = [
      makeAccount("700", "revenue", 0,   1000),
      makeAccount("400", "expense", 600, 0),
      makeAccount("X99", null,      100, 50),  // net = 50
    ];
    const result = buildIncomeStatement(accounts);

    expect(result.unclassifiedAccounts[0].debit).toBe(100);
    expect(result.unclassifiedAccounts[0].credit).toBe(50);
    expect(result.unclassifiedAccounts[0].net).toBe(50);
  });
});
