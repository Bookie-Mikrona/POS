import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const mocks = vi.hoisted(() => ({
  user: { id: 7, companyId: "company-a", enotaId: 4, vloga: "admin" },
  overview: vi.fn(),
  mutate: vi.fn(),
  invalidateQueries: vi.fn().mockResolvedValue(undefined),
  toast: vi.fn(),
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: mocks.user }) }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: mocks.invalidateQueries }) }));
vi.mock("@workspace/api-client-react", () => ({
  useGetVivaRefundAlertOverview: mocks.overview,
  getGetVivaRefundAlertOverviewQueryKey: () => ["/refund-alerts"],
  getListUnknownVivaRefundsQueryKey: () => ["/unknown-refunds"],
  useUpdateVivaRefundAlertSettings: () => ({ mutate: mocks.mutate, isPending: false }),
}));
import { VivaRefundAgeAlertBanner, VivaRefundAlertSettingsPanel } from "./VivaRefundAgeAlerts";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 7, companyId: "company-a", enotaId: 4, vloga: "admin" };
  mocks.overview.mockReturnValue({
    data: {
      settings: { overdueHours: 24, criticalHours: 72 },
      alerts: [
        { id: 1, refundId: 10, threshold: "overdue" },
        { id: 2, refundId: 10, threshold: "critical" },
        { id: 3, refundId: 11, threshold: "overdue" },
      ],
    },
  });
});
afterEach(cleanup);

describe("opozorila nejasnih vračil", () => {
  it("šteje vračila, ne podvoji eskaliranega primera, in ponudi arhiv", () => {
    render(<VivaRefundAgeAlertBanner />);
    expect(screen.getByRole("alert").textContent).toContain("2 zapadlih, od tega 1 kritičnih");
    expect(screen.getByRole("link", { name: "Odpri arhiv računov" }).getAttribute("href")).toBe("/racuni");
    expect(mocks.overview.mock.calls[0][0].query).toMatchObject({
      queryKey: ["/refund-alerts", 7, "company-a", 4], enabled: true, refetchInterval: 60_000,
    });
  });

  it("po zaprtju zadnjega opozorila odstrani pasico", () => {
    mocks.overview.mockReturnValue({ data: { alerts: [] } });
    render(<VivaRefundAgeAlertBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("po odvzemu administratorske vloge ne prikaže prej predpomnjenih opozoril", () => {
    mocks.user.vloga = "uporabnik";
    render(<VivaRefundAgeAlertBanner />);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("ob napaki ne prikaže lažnega stanja brez opozoril", () => {
    mocks.overview.mockReturnValue({ isError: true });
    render(<VivaRefundAgeAlertBanner />);
    expect(screen.getByRole("status").textContent).toContain("ni mogoče osvežiti");
  });

  it("navadnemu uporabniku ne vključi poizvedbe, vodji enote pa ne dovoli spremembe pragov", () => {
    mocks.user.vloga = "uporabnik";
    const view = render(<VivaRefundAlertSettingsPanel />);
    expect(mocks.overview.mock.calls.at(-1)?.[0].query.enabled).toBe(false);
    expect(screen.queryByRole("button")).toBeNull();
    mocks.user.vloga = "admin_enote";
    view.rerender(<VivaRefundAlertSettingsPanel />);
    expect(screen.getByText(/Opozorila nejasnih vračil/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shrani oba praga in osveži opozorila ter arhiv", async () => {
    render(<VivaRefundAlertSettingsPanel />);
    fireEvent.click(screen.getByText(/Opozorila nejasnih vračil/));
    fireEvent.change(screen.getByLabelText("Zapadlo po (h)"), { target: { value: "8" } });
    fireEvent.change(screen.getByLabelText("Kritično po (h)"), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani pragova podjetja" }));
    expect(mocks.mutate.mock.calls[0][0]).toEqual({ data: { overdueHours: 8, criticalHours: 12 } });
    await mocks.mutate.mock.calls[0][1].onSuccess();
    expect(mocks.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ["/refund-alerts"] }], [{ queryKey: ["/unknown-refunds"] }],
    ]);
  });

  it("ne dovoli shranjevanja kritičnega praga pred zapadlim", () => {
    render(<VivaRefundAlertSettingsPanel />);
    fireEvent.click(screen.getByText(/Opozorila nejasnih vračil/));
    fireEvent.change(screen.getByLabelText("Kritično po (h)"), { target: { value: "12" } });
    expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("kritični prag mora biti poznejši");
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
