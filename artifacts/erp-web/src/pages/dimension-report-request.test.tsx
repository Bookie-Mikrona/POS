import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGetDimensionReport } from "../../../../lib/api-client-react/src/dimensions-report";

const fetchReport = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api-client-react/src/custom-fetch", () => ({
  customFetch: fetchReport,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe("dimension report company scope", () => {
  it("explicitly sends the selected company rather than a legacy storage fallback", async () => {
    fetchReport.mockResolvedValue({ rows: [] });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useGetDimensionReport("selected-company", {
      dimensionType: "project", dateFrom: "2025-04-01", dateTo: "2025-09-30",
      accountId: "selected-account", groupBy: "account",
    }), {
      wrapper: ({ children }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchReport).toHaveBeenCalledExactlyOnceWith(
      "/api/companies/selected-company/reports/dimensions?dimensionType=project&dateFrom=2025-04-01&dateTo=2025-09-30&accountId=selected-account&groupBy=account",
      { signal: expect.any(AbortSignal), headers: { "X-Company-Id": "selected-company" } },
    );
    client.clear();
  });
});
