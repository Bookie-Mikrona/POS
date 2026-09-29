import { beforeEach, describe, expect, it, vi } from "vitest";

const dbState = vi.hoisted(() => ({
  selectResults: [] as unknown[][],
}));

vi.mock("@workspace/db", () => {
  const table = new Proxy({}, { get: (_target, property) => String(property) });

  return {
    db: {
      select: () => {
        const result = Promise.resolve(dbState.selectResults.shift() ?? []);
        const chain = {
          from: () => chain,
          innerJoin: () => chain,
          where: () => chain,
          groupBy: () => result,
          then: result.then.bind(result),
        };
        return chain;
      },
    },
    counterpartiesTable: table,
    invoicesTable: table,
    bookieOldArSettlementsTable: table,
    invoiceLinesTable: table,
    paymentAllocationsTable: table,
    paymentsTable: table,
    accountingRolesTable: table,
    accountsTable: table,
    accountingPeriodsTable: table,
  };
});

describe("zgodovinska zapiranja pri predlogih banke", () => {
  const oldInvoice = {
    id: "old-invoice", invoiceNumber: "2025-100", invoiceDate: "2025-01-01",
    dueDate: "2025-02-01", type: "issued", counterpartyId: "partner-1",
    counterpartyName: "Partner", counterpartyIban: null,
  };

  it("ne predlaga že zaprtega računa in pri delnem zapiranju upošteva le ostanek", async () => {
    dbState.selectResults = [
      [], [oldInvoice], [{ invoiceId: oldInvoice.id, gross: "12.00" }], [],
      [{ invoiceId: oldInvoice.id, closed: "12.00" }],
    ];
    const closed = await buildMatchSuggestions("company-1", [transactions[0]]);
    expect(closed[0].suggestions).toEqual([]);

    dbState.selectResults = [
      [], [oldInvoice], [{ invoiceId: oldInvoice.id, gross: "12.00" }], [],
      [{ invoiceId: oldInvoice.id, closed: "9.00" }],
    ];
    const partial = await buildMatchSuggestions("company-1", [{ ...transactions[0], amount: 3 }]);
    expect(partial[0].suggestions[0]?.invoiceId).toBe(oldInvoice.id);
  });
});

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  eq: vi.fn((...values: unknown[]) => values),
  inArray: vi.fn((...values: unknown[]) => values),
  sql: vi.fn(),
}));

import { buildMatchSuggestions, type BankTransaction } from "./bankStatements";

const transactions: BankTransaction[] = [
  {
    id: "tx-1",
    date: "2026-09-01",
    amount: 12,
    reference: null,
    counterpartyName: null,
    counterpartyIban: null,
    description: null,
    currency: "EUR",
  },
  {
    id: "tx-2",
    date: "2026-09-02",
    amount: -8,
    reference: null,
    counterpartyName: null,
    counterpartyIban: null,
    description: null,
    currency: "EUR",
  },
];

describe("pretočno iskanje ujemanj brez računov", () => {
  beforeEach(() => {
    dbState.selectResults = [
      [], // obstoječa plačila
      [], // računi
    ];
  });

  it("oddá en dogodek napredka za vsako transakcijo", async () => {
    const events: Array<{ id: string; current: number; total: number }> = [];

    const result = await buildMatchSuggestions(
      "company-1",
      transactions,
      (suggestion, current, total) => {
        events.push({ id: suggestion.transaction.id, current, total });
      },
    );

    expect(result).toHaveLength(2);
    expect(result.every(item => item.suggestions.length === 0)).toBe(true);
    expect(events).toEqual([
      { id: "tx-1", current: 1, total: 2 },
      { id: "tx-2", current: 2, total: 2 },
    ]);
  });
});