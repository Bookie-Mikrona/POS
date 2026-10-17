import React, { type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  useGetOsAmortizacijaObracuni,
  usePostOsAmortizacijaObracun,
  usePostOsAmortizacijaStorno,
} from "@workspace/api-client-react";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function harness() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return { client, wrapper: ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider> };
}
const head = { id: "saved", leto: 2025, doMeseca: 12, status: "zakljucen", skupajAmortizacija: "100.00", updatedAt: "2026-01-02T12:00:00Z" };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { "Content-Type": "application/json" } });

describe("archive query freshness", () => {
  it("refreshes saved totals after calculation and removes a reversed run", async () => {
    let archive = [head];
    const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        archive = input.endsWith("/storno") ? [] : [{ ...head, skupajAmortizacija: "200.00" }];
        return json({});
      }
      return json(archive);
    });
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = harness();
    const { result } = renderHook(() => ({
      archive: useGetOsAmortizacijaObracuni("company-a"),
      run: usePostOsAmortizacijaObracun("company-a"),
      reverse: usePostOsAmortizacijaStorno("company-a"),
    }), { wrapper });
    await waitFor(() => expect(result.current.archive.data?.[0]?.skupajAmortizacija).toBe("100.00"));
    await act(async () => { await result.current.run.mutateAsync({ leto: 2025, doMeseca: 12 }); });
    await waitFor(() => expect(result.current.archive.data?.[0]?.skupajAmortizacija).toBe("200.00"));
    await act(async () => { await result.current.reverse.mutateAsync({ leto: 2025 }); });
    await waitFor(() => expect(result.current.archive.data).toEqual([]));
    expect(fetchMock.mock.calls.every(([url]) => url.startsWith("/api/os/company-a/amortizacija/obracun"))).toBe(true);
  });

  it("does not retain the previous company's archive and disables requests with no selected company", async () => {
    const fetchMock = vi.fn(async (url: string) => json(url.includes("company-a") ? [head] : []));
    vi.stubGlobal("fetch", fetchMock);
    const { wrapper } = harness();
    const { result, rerender } = renderHook(({ companyId }) => useGetOsAmortizacijaObracuni(companyId), {
      wrapper, initialProps: { companyId: "" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    rerender({ companyId: "company-a" });
    await waitFor(() => expect(result.current.data).toEqual([head]));
    rerender({ companyId: "company-b" });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.data).toEqual([]));
  });
});
