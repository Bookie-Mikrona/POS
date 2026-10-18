import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, renderHook } from "@testing-library/react";
import { useSharedCompanyAccess } from "./CompanyContext";

const mocks = vi.hoisted(() => ({
  user: { id: "user-1" } as { id: string } | null,
  loaded: true,
  list: vi.fn(),
}));
vi.mock("@clerk/react", () => ({
  useUser: () => ({ user: mocks.user, isLoaded: mocks.loaded }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListCompanies: mocks.list,
}));

beforeEach(() => {
  mocks.user = { id: "user-1" };
  mocks.loaded = true;
  mocks.list.mockReset();
  mocks.list.mockReturnValue({
    data: { companies: [{ id: "company-1", naziv: "Dovoljeno", role: "viewer" }] },
    isFetchedAfterMount: true,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  });
});
afterEach(cleanup);

describe("shared report access", () => {
  it("resolves only server-authorized ERP companies, never URL or stored company names", () => {
    const { result, rerender } = renderHook(({ id }) => useSharedCompanyAccess(id), { initialProps: { id: "company-1" } });
    expect(result.current.company?.naziv).toBe("Dovoljeno");
    rerender({ id: "foreign" });
    expect(result.current.company).toBeNull();
    expect(mocks.list.mock.calls.at(-1)?.[0]).toMatchObject({
      query: { enabled: true, staleTime: 0, refetchOnMount: "always", retry: false },
      request: { cache: "no-store" },
    });
  });

  it.each(["pos_admin", "pos_natakar", "os_admin"])("rejects a %s membership without an ERP role", (role) => {
    mocks.list.mockReturnValue({
      data: { companies: [{ id: "company-1", role }] },
      isFetchedAfterMount: true, isFetching: false, isError: false,
    });
    expect(renderHook(() => useSharedCompanyAccess("company-1")).result.current.company).toBeNull();
  });

  it("waits for fresh access, not a cached selection", () => {
    mocks.list.mockReturnValue({
      data: { companies: [{ id: "company-1", role: "owner" }] },
      isFetchedAfterMount: false, isFetching: false, isError: false,
    });
    expect(renderHook(() => useSharedCompanyAccess("company-1")).result.current.checking).toBe(true);
  });

  it("scopes access checks to the signed-in user and URL company", () => {
    const { rerender } = renderHook(() => useSharedCompanyAccess("company-1"));
    const initialKey = mocks.list.mock.calls.at(-1)?.[0].query.queryKey;
    mocks.user = { id: "user-2" };
    rerender();
    const nextKey = mocks.list.mock.calls.at(-1)?.[0].query.queryKey;
    expect(nextKey).not.toEqual(initialKey);
    expect(nextKey).toContain("user-2");
    expect(nextKey).toContain("company-1");
  });

  it("does not request companies without a signed-in user or a shared link", () => {
    const { rerender } = renderHook(() => useSharedCompanyAccess(null));
    expect(mocks.list.mock.calls.at(-1)?.[0].query.enabled).toBe(false);
    mocks.user = null;
    rerender();
    expect(mocks.list.mock.calls.at(-1)?.[0].query.enabled).toBe(false);
  });
});
