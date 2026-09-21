import { afterEach, describe, expect, it, vi } from "vitest";

import { matchTransactions } from "./bancni-izpis";

const transactions = [
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

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson" },
  });
}

function suggestionEvent(index: number) {
  return JSON.stringify({
    type: "suggestion",
    current: index + 1,
    total: transactions.length,
    suggestion: {
      transaction: transactions[index],
      suggestions: [],
    },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pretočno iskanje ujemanj", () => {
  it("pravilno sestavi razdrobljene NDJSON dogodke in napredek", async () => {
    const payload = `${suggestionEvent(0)}\n${suggestionEvent(1)}\n${JSON.stringify({
      type: "complete",
      total: transactions.length,
    })}\n`;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      payload.slice(0, 17),
      payload.slice(17, 83),
      payload.slice(83),
    ])));
    const progress = vi.fn();

    const result = await matchTransactions("company-1", transactions, progress);

    expect(result.suggestions.map(item => item.transaction.id)).toEqual(["tx-1", "tx-2"]);
    expect(progress.mock.calls).toEqual([[1, 2], [2, 2]]);
  });

  it("zavrne tok brez zaključnega dogodka", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      `${suggestionEvent(0)}\n${suggestionEvent(1)}\n`,
    ])));

    await expect(matchTransactions("company-1", transactions, vi.fn()))
      .rejects.toThrow("Iskanje ujemanj se je predčasno prekinilo");
  });

  it("zavrne zaključek, če manjka rezultat transakcije", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(responseFromChunks([
      `${suggestionEvent(0)}\n${JSON.stringify({ type: "complete", total: transactions.length })}\n`,
    ])));

    await expect(matchTransactions("company-1", transactions, vi.fn()))
      .rejects.toThrow("Iskanje ujemanj se je predčasno prekinilo");
  });
});