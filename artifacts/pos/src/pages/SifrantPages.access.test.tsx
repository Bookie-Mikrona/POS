import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const mocks = vi.hoisted(() => {
  const mutation = () => ({ mutate: vi.fn(), isPending: false });
  return {
    user: { vloga: "admin", companyId: "company-1" } as { vloga: string; companyId?: string } | null,
    listCostCenters: vi.fn(() => ({
      data: { costCenters: [] },
      isLoading: false,
      error: null,
    })),
    listAccounts: vi.fn(() => ({
      data: { accounts: [] },
      isLoading: false,
      error: null,
    })),
    createCostCenter: vi.fn(mutation),
    updateCostCenter: vi.fn(mutation),
    deleteCostCenter: vi.fn(mutation),
    createAccount: vi.fn(mutation),
    updateAccount: vi.fn(mutation),
    seedAccounts: vi.fn(mutation),
    posFetch: vi.fn(),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/pos-auth-headers", () => ({
  posFetch: mocks.posFetch,
}));

vi.mock("@workspace/api-client-react", () => ({
  useListCostCenters: mocks.listCostCenters,
  useCreateCostCenter: mocks.createCostCenter,
  useUpdateCostCenter: mocks.updateCostCenter,
  useDeleteCostCenter: mocks.deleteCostCenter,
  getListCostCentersQueryKey: (companyId: string, params?: unknown) => [
    `/api/companies/${companyId}/cost-centers`,
    params,
  ],
  useListAccounts: mocks.listAccounts,
  useCreateAccount: mocks.createAccount,
  useUpdateAccount: mocks.updateAccount,
  useSeedAccounts: mocks.seedAccounts,
  getListAccountsQueryKey: (companyId: string, params?: unknown) => [
    `/api/companies/${companyId}/accounts`,
    params,
  ],
}));

import StroskovnaMestaPage from "./StroskovnaMesta";
import KontniPlanPage from "./KontniPlan";

function renderPage(page: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      {page}
    </QueryClientProvider>,
  );
}

function expectLastQueryDisabled(mock: ReturnType<typeof vi.fn>) {
  expect(mock).toHaveBeenLastCalledWith(
    expect.any(String),
    { includeInactive: true },
    expect.objectContaining({
      query: expect.objectContaining({ enabled: false }),
    }),
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = { vloga: "admin", companyId: "company-1" };
});

describe("zaščita notranjih POS strani šifrantov", () => {
  it.each(["admin_enote", "uporabnik", "superadmin"])(
    "vloga %s ne more odpreti stroškovnih mest ali kontnega plana",
    (vloga) => {
      mocks.user = { vloga, companyId: "company-1" };

      renderPage(<StroskovnaMestaPage />);
      expect(screen.getByText("Nimate dodeljene pravice")).toBeDefined();
      expectLastQueryDisabled(mocks.listCostCenters);

      cleanup();
      renderPage(<KontniPlanPage />);
      expect(screen.getByText("Nimate dodeljene pravice")).toBeDefined();
      expectLastQueryDisabled(mocks.listAccounts);
    },
  );

  it("admin podjetja odpre obe strani in omogoči company-scoped poizvedbi", () => {
    renderPage(<StroskovnaMestaPage />);
    expect(screen.getByRole("heading", { name: "Stroškovna mesta" })).toBeDefined();
    expect(mocks.listCostCenters).toHaveBeenLastCalledWith(
      "company-1",
      { includeInactive: true },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );

    cleanup();
    renderPage(<KontniPlanPage />);
    expect(screen.getByRole("heading", { name: "Kontni plan" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Prenesi PDF" })).toBeDefined();
    expect(mocks.listAccounts).toHaveBeenLastCalledWith(
      "company-1",
      { includeInactive: true },
      expect.objectContaining({
        query: expect.objectContaining({ enabled: true }),
      }),
    );
  });

  it("POS kontni plan prenese PDF izbranega podjetja", async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    const createObjectURL = vi.fn(() => "blob:kontni-plan");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });
    mocks.posFetch.mockResolvedValueOnce(new Response(new Blob(["%PDF-1.7"], { type: "application/pdf" }), { status: 200 }));
    try {
      renderPage(<KontniPlanPage />);
      fireEvent.click(screen.getByRole("button", { name: "Prenesi PDF" }));
      await waitFor(() => expect(mocks.posFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/companies/company-1/accounts/export/pdf"),
      ));
      await waitFor(() => expect(click).toHaveBeenCalled());
      expect(createObjectURL).toHaveBeenCalled();
    } finally {
      click.mockRestore();
      vi.unstubAllGlobals();
    }
  });

  it("seznama imata flex višino in notranji navpični/horizontalni scroll", () => {
    renderPage(<StroskovnaMestaPage />);
    expect(screen.getByTestId("stm-list-scroll").className).toEqual(
      expect.stringContaining("flex-1 min-h-0 min-w-0 overflow-auto"),
    );
    expect(screen.getByTestId("stm-list-scroll").querySelector("table")?.className).toContain("min-w-max");

    cleanup();
    renderPage(<KontniPlanPage />);
    expect(screen.getByTestId("account-list-scroll").className).toEqual(
      expect.stringContaining("flex-1 min-h-0 min-w-0 overflow-auto"),
    );
    expect(screen.getByTestId("account-list-scroll").querySelector("table")?.className).toContain("min-w-max");
  });

  it("urejevalna dialoga imata drseče telo in fiksno nogo z gumbi", () => {
    renderPage(<StroskovnaMestaPage />);
    fireEvent.click(screen.getByTestId("btn-add-stm"));
    expect(screen.getByTestId("stm-edit-dialog-scroll-body").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("stm-edit-dialog-footer").className).toContain("shrink-0");
    expect(screen.getByTestId("btn-save-stm")).toBeDefined();

    cleanup();
    renderPage(<KontniPlanPage />);
    fireEvent.click(screen.getByTestId("btn-add-account"));
    expect(screen.getByTestId("account-edit-dialog-scroll-body").className).toContain("overflow-y-auto");
    expect(screen.getByTestId("account-edit-dialog-footer").className).toContain("shrink-0");
    expect(screen.getByTestId("btn-save-acc")).toBeDefined();
  });

  it("admin brez companyId vidi napako, poizvedbi pa ostaneta onemogočeni", () => {
    mocks.user = { vloga: "admin" };

    renderPage(<StroskovnaMestaPage />);
    expect(screen.getByTestId("error-stm-company")).toBeDefined();
    expectLastQueryDisabled(mocks.listCostCenters);

    cleanup();
    renderPage(<KontniPlanPage />);
    expect(screen.getByTestId("error-accounts-company")).toBeDefined();
    expectLastQueryDisabled(mocks.listAccounts);
  });
});