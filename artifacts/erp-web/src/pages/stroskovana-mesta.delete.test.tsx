import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import StroskovnaMestaPage from "./stroskovana-mesta";

const mocks = vi.hoisted(() => ({
  remove: vi.fn(),
  invalidate: vi.fn(),
  toast: vi.fn(),
  getToken: vi.fn().mockResolvedValue("test-token"),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: mocks.getToken }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company", role: "accountant" } }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useDeleteCostCenter: () => ({ mutateAsync: mocks.remove, isPending: false }),
  getListCostCentersQueryKey: (companyId: string) => [`/api/companies/${companyId}/cost-centers`],
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
// Keep unrelated edit-form selects out of the deletion tests.
vi.mock("@/components/ui/select", () => ({
  Select: () => null,
  SelectContent: () => null,
  SelectItem: () => null,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

const costCenter = {
  id: "cost-center", companyId: "company", code: "1000", name: "Kuhinja",
  isActive: true, createdAt: "", updatedAt: "",
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.remove.mockReset();
  vi.stubGlobal("fetch", vi.fn().mockImplementation(async () =>
    new Response(JSON.stringify({ costCenters: [costCenter] }), {
      headers: { "Content-Type": "application/json" },
    }),
  ));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

async function openConfirmation() {
  render(<StroskovnaMestaPage />);
  fireEvent.click(await screen.findByTitle("Odstrani / deaktiviraj"));
  expect(screen.getByText(/Če je SM v uporabi/)).toBeInTheDocument();
  expect(mocks.remove).not.toHaveBeenCalled();
}

describe("cost-center deletion", () => {
  it.each([
    { result: undefined, title: "Stroškovno mesto zbrisano" },
    { result: { deaktivirano: true, razlog: "temeljnice" }, title: "Stroškovno mesto deaktivirano" },
  ])("handles $title and refreshes the list", async ({ result, title }) => {
    mocks.remove.mockResolvedValue(result);
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Odstrani / Deaktiviraj" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title })));
    expect(mocks.remove).toHaveBeenCalledWith({ companyId: "company", id: "cost-center" });
    if (result) {
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({
        description: "SM je v uporabi (temeljnice) — zbrisano ni bilo, samo deaktivirano.",
      }));
    }
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(mocks.invalidate).toHaveBeenCalledWith({
      queryKey: ["/api/companies/company/cost-centers"],
    });
    // Only list reads use the local fetch helper; deletion goes through the hook.
    for (const [, options] of vi.mocked(fetch).mock.calls) {
      expect(options?.method).not.toBe("DELETE");
    }
  });

  it("keeps confirmation open and shows the error when deletion fails", async () => {
    mocks.remove.mockRejectedValue(new Error("Brisanje ni dovoljeno"));
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Odstrani / Deaktiviraj" }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Napaka", description: "Brisanje ni dovoljeno", variant: "destructive",
    }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });

  it("does not delete or refresh when confirmation is cancelled", async () => {
    await openConfirmation();
    fireEvent.click(screen.getByRole("button", { name: "Prekliči" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mocks.remove).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(mocks.invalidate).not.toHaveBeenCalled();
  });
});
