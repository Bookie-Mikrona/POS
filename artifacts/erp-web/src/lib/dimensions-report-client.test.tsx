import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGetDimensionReport } from "../../../../lib/api-client-react/src/dimensions-report";
import { customFetch } from "../../../../lib/api-client-react/src/custom-fetch";

vi.mock("../../../../lib/api-client-react/src/custom-fetch", () => ({
  customFetch: vi.fn(),
}));
afterEach(() => { cleanup(); vi.resetAllMocks(); });

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return ({ children }: { children: React.ReactNode }) =>
    <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("dimension report paginated client", () => {
  it("sends page, filters, company header and signal, with separate cache entries per page/company", async () => {
    vi.mocked(customFetch).mockImplementation(async (url) => ({ marker: String(url) }) as any);
    const filters = {
      dimensionType: "project" as const, dateFrom: "2026-01-01", dateTo: "2026-12-31",
      accountId: "account-1", groupBy: "account" as const, untaggedPageSize: 20,
    };
    const { result, rerender } = renderHook(
      ({ companyId, page }) => useGetDimensionReport(companyId, { ...filters, untaggedPage: page }),
      { wrapper: setup(), initialProps: { companyId: "company-1", page: 1 } },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const [url, options] = vi.mocked(customFetch).mock.calls[0];
    const parsed = new URL(String(url), "http://test");
    expect(Object.fromEntries(parsed.searchParams)).toEqual({
      ...filters, untaggedPage: "1", untaggedPageSize: "20",
    });
    expect(options?.headers).toEqual({ "X-Company-Id": "company-1" });
    expect(options?.signal).toBeInstanceOf(AbortSignal);
    const first = result.current.data;
    rerender({ companyId: "company-1", page: 2 });
    // Never display cached page 1 as if it were page 2.
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(customFetch).toHaveBeenCalledTimes(2);
    expect(result.current.data).not.toEqual(first);
    rerender({ companyId: "company-2", page: 1 });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(vi.mocked(customFetch).mock.calls[2][1]?.headers).toEqual({ "X-Company-Id": "company-2" });
  });

  it("cancels the previous request when the company changes", async () => {
    vi.mocked(customFetch).mockImplementation(() => new Promise(() => {}));
    const { rerender } = renderHook(
      ({ companyId }) => useGetDimensionReport(companyId, { untaggedPage: 2 }),
      { wrapper: setup(), initialProps: { companyId: "company-1" } },
    );
    await waitFor(() => expect(customFetch).toHaveBeenCalledTimes(1));
    const signal = vi.mocked(customFetch).mock.calls[0][1]?.signal;
    rerender({ companyId: "company-2" });
    expect(signal?.aborted).toBe(true);
    await waitFor(() => expect(customFetch).toHaveBeenCalledTimes(2));
  });
});
