import "@testing-library/jest-dom";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ObracunUrPage from "./obracun-ur";

const state = vi.hoisted(() => ({
  activeCompany: {
    id: "company-selected-by-erp",
    naziv: "Izbrano ERP podjetje",
    role: "accountant",
  },
  useGetObracunUr: vi.fn(),
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetObracunUr: state.useGetObracunUr,
  getGetObracunUrQueryKey: (params: unknown) => ["/api/izmene/obracun-ur", params],
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.activeCompany }),
}));

describe("ERP obračun ur", () => {
  it("pošlje izbrano ERP družbo v request glavi", () => {
    state.useGetObracunUr.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    render(<ObracunUrPage />);

    expect(screen.getByRole("heading", { name: "Obračun ur" })).toBeInTheDocument();
    const [, options] = state.useGetObracunUr.mock.calls.at(-1)!;
    expect(options.request.headers["X-Company-Id"]).toBe("company-selected-by-erp");
  });
});