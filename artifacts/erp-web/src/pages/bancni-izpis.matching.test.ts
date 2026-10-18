import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { useBankPostingRefresh } from "@/hooks/use-bank-posting-refresh";

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
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("osveževanje opozoril brez ponovnega odpiranja strani", () => {
  it.each(["focus", "visibilitychange"])("odstrani opozorilo po dogodku %s", async event => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "payment-1", status: "draft" }));
    vi.stubGlobal("fetch", fetchMock);
    const { result } = renderHook(() => {
      const [warnings, setWarnings] = useState(["payment-1"]);
      // Stable callbacks are used by the actual page as well.
      const [resolve] = useState(() => (posted: Set<string>) =>
        setWarnings(current => current.filter(id => !posted.has(id))));
      useBankPostingRefresh("user", "company", warnings, resolve);
      return warnings;
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(result.current).toEqual(["payment-1"]);
    fetchMock.mockResolvedValue(Response.json({ id: "payment-1", status: "posted" }));
    act(() => (event === "focus" ? window : document).dispatchEvent(new Event(event)));
    await waitFor(() => expect(result.current).toEqual([]));
    expect(fetchMock).toHaveBeenLastCalledWith("/api/companies/company/payments/payment-1",
      expect.objectContaining({ cache: "no-store" }));
  });

  it("poveže zahteve z uporabnikom in podjetjem ter zavrne zastarel odgovor", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const pending: Array<{ resolve: (response: Response) => void; signal: AbortSignal }> = [];
    vi.stubGlobal("fetch", vi.fn((_url, options) => new Promise<Response>(resolve => {
      pending.push({ resolve, signal: options.signal });
    })));
    const resolved = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ user, company }) => useBankPostingRefresh(user, company, ["payment-1", "payment-1"], resolved),
      { initialProps: { user: "user-a" as string | undefined, company: "company-a" } },
    );
    act(() => window.dispatchEvent(new Event("focus")));
    expect(pending[0].signal.aborted).toBe(true);
    rerender({ user: "user-b", company: "company-b" });
    expect(pending[1].signal.aborted).toBe(true);
    await act(async () => {
      pending[0].resolve(Response.json({ id: "payment-1", status: "posted" }));
      pending[1].resolve(Response.json({ id: "payment-1", status: "posted" }));
    });
    expect(resolved).not.toHaveBeenCalled();
    rerender({ user: undefined, company: "company-b" });
    expect(pending[2].signal.aborted).toBe(true);
    act(() => window.dispatchEvent(new Event("focus")));
    expect(pending).toHaveLength(3);
    unmount();
  });

  it("ne preverja skritega dokumenta in ohrani opozorila ob neuspešnem preverjanju", async () => {
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ error: "Forbidden" }, { status: 403 }))
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(Response.json({ id: "other-payment", status: "posted" }));
    vi.stubGlobal("fetch", fetchMock);
    const resolved = vi.fn();
    const { unmount } = renderHook(() =>
      useBankPostingRefresh("user", "company", ["a", "b", "c", "a"], resolved));
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).not.toHaveBeenCalled();
    visibility.mockReturnValue("visible");
    await act(async () => document.dispatchEvent(new Event("visibilitychange")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(resolved).not.toHaveBeenCalled();
    unmount();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
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