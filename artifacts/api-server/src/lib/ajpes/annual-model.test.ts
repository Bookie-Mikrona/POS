import { describe, expect, it } from "vitest";
import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";
import {
  annualXmlValues,
  buildAjpesAnnualReport,
  type AjpesSource,
} from "./annual-model";

const allConfirmedStatistics = Object.fromEntries(
  [
    ...AJPES_GD_AOP_CATALOG_2025.aops
      .filter((row) => !row.isAggregate && row.form === "IBD-BI")
      .map((row) => [row.id, "0.00"] as const),
    ["188", "0.00"],
    ["189", "0.00"],
  ],
);
const allPreviousEditableLeaves = Object.fromEntries(
  AJPES_GD_AOP_CATALOG_2025.aops
    .filter((row) => !row.isAggregate)
    .map((row) => [row.id, "0.00"] as const),
);

function fixture(overrides: Partial<AjpesSource> = {}): AjpesSource {
  return {
    year: 2025,
    company: {
      name: "Preskusno podjetje d.o.o.",
      street: "Preskusna ulica 1",
      postalCode: "1000",
      city: "Ljubljana",
      registrationNumber: "00000001",
      taxNumber: "SI00000000",
    },
    accounts: [
      {
        accountId: "cash-account",
        code: "1100000",
        name: "Denarna sredstva",
        currentBalance: "2866.75",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
      {
        accountId: "liability-account",
        code: "2200000",
        name: "Obveznosti",
        currentBalance: "-2866.75",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
    ],
    journals: [
      {
        id: "journal-current",
        number: "2025-1",
        date: "2025-12-31",
        reference: "",
        description: "Redni dnevnik",
      },
      {
        id: "journal-previous",
        number: "2024-1",
        date: "2024-12-31",
        reference: "",
        description: "Redni dnevnik",
      },
    ],
    settings: {
      mappings: {
        "cash-account": "052",
        "liability-account": "093",
      },
      mappingReasons: {},
      currentValues: { ...allConfirmedStatistics },
      previousValues: { ...allConfirmedStatistics },
      excludedEntryIds: [],
      metadata: { previousDataMode: "ledger" },
    },
    revision: 1,
    hasCurrent: true,
    hasPrevious: true,
    sourceVersion: "snapshot-v1",
    ...overrides,
  };
}

function reportWithReview(source: AjpesSource) {
  const draft = buildAjpesAnnualReport(source);
  return buildAjpesAnnualReport({
    ...source,
    reviewedFingerprint: draft.sourceFingerprint,
  });
}

describe("AJPES annual report model", () => {
  it("computes debit-credit account amounts into official AOPs and builds the exact JOLP summaries", () => {
    const report = reportWithReview(fixture());
    const currentByCode = new Map(report.aopRows.map((row) => [row.code, row.current]));

    expect(currentByCode.get("052")).toBe("2866.75");
    expect(currentByCode.get("032")).toBe("2866.75");
    expect(currentByCode.get("001")).toBe("2866.75");
    expect(currentByCode.get("093")).toBe("2866.75");
    expect(currentByCode.get("055")).toBe("2866.75");
    expect(report.balanceSheet).toHaveLength(46);
    expect(report.incomeStatement).toHaveLength(43);
    expect(report.issues).toEqual([]);
    expect(report.canExport).toBe(true);
    expect(report.canExportXml).toBe(true);
    expect(report.journals.map(({ id }) => id)).toEqual([
      "journal-current",
      "journal-previous",
    ]);
  });

  it("uses complete manual comparative values instead of prior GL measures", () => {
    const source = fixture();
    source.accounts.push({
      accountId: "historical-only",
      code: "9999999",
      name: "Zgodovinski konto brez preslikave",
      currentBalance: "0.00",
      previousBalance: "125.50",
      currentTurnover: "0.00",
      previousTurnover: "0.00",
    });
    source.settings.metadata.previousDataMode = "manual";
    source.settings.previousValues = { ...allPreviousEditableLeaves };

    const report = reportWithReview(source);

    expect(report.issues.filter((issue) =>
      issue.code === "unmapped_nonzero_account"
    )).toEqual([]);
    expect(report.issues).toEqual([]);
    expect(report.aopRows.every((row) => row.previous === "0.00")).toBe(true);
    expect(report.canExport).toBe(true);
  });

  it("uses a bare BS classification for the bank balance, not for its turnover, and balances profit/equity", () => {
    const source = fixture();
    source.accounts = [
      {
        accountId: "bank",
        code: "1100000",
        name: "Banka",
        currentBalance: "2866.75",
        previousBalance: "0.00",
        currentTurnover: "23948.52",
        previousTurnover: "0.00",
      },
      {
        accountId: "bank-credit-side",
        code: "1100001",
        name: "Banka - promet kredit",
        currentBalance: "0.00",
        previousBalance: "0.00",
        currentTurnover: "-21081.77",
        previousTurnover: "0.00",
      },
      {
        accountId: "capital",
        code: "8000000",
        name: "Osnovni kapital",
        currentBalance: "-2000.00",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
      {
        accountId: "period-profit",
        code: "7600000",
        name: "Čisti prihodki",
        currentBalance: "-866.75",
        previousBalance: "0.00",
        currentTurnover: "-866.75",
        previousTurnover: "0.00",
      },
    ];
    source.settings.mappings = {
      bank: "052",
      "bank-credit-side": "052",
      capital: "058",
      "period-profit": "180",
    };
    source.settings.currentValues["070"] = "866.75";

    const report = reportWithReview(source);
    const values = new Map(report.aopRows.map((row) => [row.code, row.current]));

    expect(values.get("052")).toBe("2866.75");
    expect(values.get("110")).toBe("0.00");
    expect(values.get("112")).toBe("0.00");
    expect(values.get("180")).toBe("866.75");
    expect(values.get("058")).toBe("2000.00");
    expect(values.get("070")).toBe("866.75");
    expect(values.get("001")).toBe("2866.75");
    expect(values.get("055")).toBe("2866.75");
    expect(report.issues.some((issue) => issue.code === "unmapped_nonzero_account")).toBe(false);
    expect(report.canExport).toBe(true);
  });

  it("preserves negative net loss in the merged JOLP line and keeps zero distinct", () => {
    const source = fixture();
    source.accounts.push(
      {
        accountId: "sales",
        code: "7600000",
        name: "Prihodki od prodaje",
        currentBalance: "-10.00",
        previousBalance: "0.00",
        currentTurnover: "-10.00",
        previousTurnover: "0.00",
      },
      {
        accountId: "expense",
        code: "4000000",
        name: "Stroški",
        currentBalance: "30.00",
        previousBalance: "0.00",
        currentTurnover: "30.00",
        previousTurnover: "0.00",
      },
    );
    source.settings.mappings.sales = "112";
    source.settings.mappings.expense = "129";

    const report = reportWithReview(source);
    const currentByCode = new Map(report.aopRows.map((row) => [row.code, row.current]));
    const netResult = report.incomeStatement.find((row) => row.code === "186-187");

    expect(currentByCode.get("186")).toBe("0.00");
    expect(currentByCode.get("187")).toBe("20.00");
    expect(netResult?.current).toBe("-20.00");
    expect(report.issues.some((issue) => issue.code === "unmapped_nonzero_account")).toBe(false);
    expect(report.canExport).toBe(true);
  });

  it("blocks unreviewed reports and makes review fingerprint-sensitive to source changes", () => {
    const source = fixture();
    const draft = buildAjpesAnnualReport(source);
    expect(draft.reviewed).toBe(false);
    expect(draft.canExport).toBe(false);

    const edited = {
      ...source,
      accounts: source.accounts.map((account, index) =>
        index === 0 ? { ...account, currentBalance: "2866.76" } : account,
      ),
      reviewedFingerprint: draft.sourceFingerprint,
    };
    const changed = buildAjpesAnnualReport(edited);
    expect(changed.reviewed).toBe(false);
    expect(changed.canExport).toBe(false);
  });

  it("blocks missing manual AOP values, invalid decimals, and unknown AOP inputs", () => {
    const source = fixture();
    delete source.settings.currentValues["200"];
    source.settings.currentValues["201"] = "not-a-number";
    source.settings.currentValues["999"] = "9.00";
    const report = reportWithReview(source);
    const codes = new Set(report.issues.map((issue) => issue.code));

    expect(codes).toContain("confirmed_manual_value_required");
    expect(codes).toContain("invalid_manual_amount");
    expect(codes).toContain("unknown_manual_aop");
    expect(report.canExport).toBe(false);
  });

  it("rejects parent-AOP mappings, foreign mappings, and nonzero unmapped account statistics", () => {
    const source = fixture();
    source.settings.mappings["cash-account"] = "032";
    source.settings.mappings["liability-account"] = "999";
    const report = reportWithReview(source);
    const codes = new Set(report.issues.map((issue) => issue.code));

    expect(codes).toContain("aggregate_aop_mapping");
    expect(codes).toContain("unknown_aop_mapping");
    expect(report.canExport).toBe(false);
  });

  it("reports one missing account classification, not a false balance-and-turnover double error", () => {
    const source = fixture();
    delete source.settings.mappings["cash-account"];
    const report = reportWithReview(source);
    const missingAccountIssues = report.issues.filter(
      (issue) => issue.code === "unmapped_nonzero_account",
    );

    expect(missingAccountIssues).toHaveLength(1);
    expect(missingAccountIssues[0].message).toContain("Denarna sredstva");
  });

  it("uses exact integer-cent sums for many fractional account amounts", () => {
    const source = fixture();
    source.accounts = [
      ...["0.10", "0.10", "0.10"].map((amount, index) => ({
        accountId: `cent-${index}`,
        code: `110000${index}`,
        name: "Preskusna denarna sredstva",
        currentBalance: amount,
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      })),
      {
        accountId: "cent-liability",
        code: "2200000",
        name: "Preskusna obveznost",
        currentBalance: "-0.30",
        previousBalance: "0.00",
        currentTurnover: "0.00",
        previousTurnover: "0.00",
      },
    ];
    source.settings.mappings = {
      "cent-0": "052",
      "cent-1": "052",
      "cent-2": "052",
      "cent-liability": "093",
    };
    const report = reportWithReview(source);

    expect(report.aopRows.find((row) => row.code === "052")?.current).toBe("0.30");
    expect(report.aopRows.find((row) => row.code === "001")?.current).toBe("0.30");
    expect(report.issues.some((issue) => issue.code === "balance_sheet_unbalanced")).toBe(false);
  });

  it("only exports the exact full official catalogue and excludes unknown manual keys", () => {
    const source = fixture();
    Object.defineProperty(source.settings.currentValues, "__proto__", {
      value: "99.99",
      enumerable: true,
    });
    const report = reportWithReview(source);
    const xmlValues = annualXmlValues(report);

    expect(report.aopRows).toHaveLength(263);
    expect(Object.keys(xmlValues.current)).toHaveLength(263);
    expect(Object.hasOwn(xmlValues.current, "__proto__")).toBe(false);
    expect(xmlValues.current["001"]).toBe("2866.75");
    expect(xmlValues.previous["001"]).toBe("0.00");
    expect(report.canExport).toBe(false);
  });

  it("requires an explicit safe treatment of a missing previous year", () => {
    const source = fixture({
      hasPrevious: false,
      settings: {
        ...fixture().settings,
        metadata: { previousDataMode: "no-activity" },
      },
    });
    const report = reportWithReview(source);
    expect(report.aopRows.find((row) => row.code === "001")?.previous).toBe("0.00");
    expect(report.canExport).toBe(true);

    const activityConflict = fixture({
      hasPrevious: false,
      accounts: fixture().accounts.map((account, index) =>
        index === 0
          ? { ...account, previousBalance: "1.00" }
          : account
      ),
      settings: {
        ...fixture().settings,
        metadata: { previousDataMode: "no-activity" },
      },
    });
    const conflictingReport = reportWithReview(activityConflict);
    expect(
      conflictingReport.issues.some(
        (issue) => issue.code === "previous_no_activity_conflict",
      ),
    ).toBe(true);
    expect(conflictingReport.canExport).toBe(false);

    const defaultLedger = reportWithReview(fixture({ hasPrevious: false }));
    expect(defaultLedger.issues.some((issue) => issue.code === "previous_fiscal_data_missing")).toBe(true);
    expect(defaultLedger.canExport).toBe(false);
  });
});