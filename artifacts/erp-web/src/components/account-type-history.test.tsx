import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AccountTypeHistory } from "./account-type-history";

const state = vi.hoisted(() => ({
  query: vi.fn(), response: {} as any,
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccountTypeConfirmations: (...args: unknown[]) => { state.query(...args); return state.response; },
  getListAccountTypeConfirmationsQueryKey: (company: string, id: string) => [company, id],
}));
afterEach(cleanup);
describe("account type confirmation history", () => {
  it("shows a loading state while fetching history", () => {
    state.response = { isLoading: true };
    render(<AccountTypeHistory companyId="a" accountId="b" />);
    expect(screen.getByRole("status")).toHaveTextContent("Nalaganje");
  });
  it("renders the saved identity, time, code, types and origin", () => {
    state.response = { data: [{
      id: "confirmation", actorId: "user-confirmed", confirmedAt: "2026-10-18T10:00:00Z",
      code: "4000000", selectedType: "asset", expectedType: "expense", source: "import",
    }] };
    render(<AccountTypeHistory companyId="company-a" accountId="account-a" />);
    expect(state.query).toHaveBeenLastCalledWith("company-a", "account-a", expect.anything());
    expect(screen.getByText("Uvoz · 4000000")).toBeInTheDocument();
    expect(screen.getByText(/Potrdil.*user-confirmed/)).toBeInTheDocument();
    expect(screen.getByText(/Izbrani tip: Sredstvo.*Pričakovani tip: Odhodek/)).toBeInTheDocument();
    expect(document.querySelector("time")).toHaveAttribute("datetime", "2026-10-18T10:00:00Z");
    expect(screen.getByText(/ne za prihodnje spremembe/)).toBeInTheDocument();
  });
  it("does not show an invented confirmation for old accounts", () => {
    state.response = { data: [] };
    render(<AccountTypeHistory companyId="a" accountId="b" />);
    expect(screen.getByText(/ni zabeleženih potrditev/)).toBeInTheDocument();
  });
  it("distinguishes errors from empty history", () => {
    state.response = { error: new Error("failed") };
    render(<AccountTypeHistory companyId="a" accountId="b" />);
    expect(screen.getByRole("alert")).toHaveTextContent("ni mogoče naložiti");
    expect(screen.queryByText(/ni zabeleženih/)).not.toBeInTheDocument();
  });
});
