import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PorocilaAnalitika from "./porocila-dimenzije";

const mocks = vi.hoisted(() => ({ report: vi.fn() }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company-1" } }),
  useSharedCompanyAccess: () => ({
    checking: false, failed: false, company: { id: "company-1" },
  }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: [] } }),
  useGetDimensionReport: mocks.report,
}));
afterEach(cleanup);

describe("invalid shared dates with the actual localized date controls", () => {
  it.each(["2025-02-30", "not-a-date"])("allows correcting %s and restores warnings on Back", async (value) => {
    window.history.replaceState(null, "", `/porocila/dimenzije?dimensionType=project&dateFrom=${value}&dateTo=`);
    mocks.report.mockReturnValue({ data: undefined, isLoading: false, error: null });
    render(<PorocilaAnalitika />);
    const input = screen.getByLabelText("Obdobje od") as HTMLInputElement;
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Neveljavni filtri poročila")).toBeTruthy();
    fireEvent.change(input, { target: { value: "28.02.2025" } });
    expect(input.value).toBe("28.02.2025");
    expect(new URLSearchParams(window.location.search).get("dateFrom")).toBe("2025-02-28");
    expect(mocks.report.mock.calls.at(-1)![2].query.enabled).toBe(true);
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByText("Neveljavni filtri poročila")).toBeTruthy());
    expect(mocks.report.mock.calls.at(-1)![2].query.enabled).toBe(false);
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(input.value).toBe("28.02.2025"));
    expect(screen.queryByText("Neveljavni filtri poročila")).toBeNull();
    fireEvent.change(input, { target: { value: "" } });
    expect(new URLSearchParams(window.location.search).get("dateFrom")).toBe("");
    expect(mocks.report.mock.calls.at(-1)![1].dateFrom).toBeUndefined();
    expect(mocks.report.mock.calls.at(-1)![2].query.enabled).toBe(true);
  });
});
