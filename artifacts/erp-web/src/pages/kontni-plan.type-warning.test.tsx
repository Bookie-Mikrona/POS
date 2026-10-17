import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import KontniPlan from "./kontni-plan";

const state = vi.hoisted(() => ({
  accounts: [] as any[],
  create: vi.fn(), update: vi.fn(), seed: vi.fn(), invalidate: vi.fn(),
}));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock("@tanstack/react-query", () => ({ useQueryClient: () => ({ invalidateQueries: state.invalidate }) }));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: { id: "company", role: "accountant" } }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useListAccounts: () => ({ data: { accounts: state.accounts } }),
  useCreateAccount: () => ({ mutate: state.create, reset: vi.fn() }),
  useUpdateAccount: () => ({ mutate: state.update, reset: vi.fn() }),
  useSeedAccounts: () => ({ mutate: state.seed }),
  getListAccountsQueryKey: () => ["accounts"],
}));
vi.mock("@/components/ui/select", async () => {
  const React = await import("react");
  const Context = React.createContext({ value: "", onValueChange: (_value: string) => {} });
  return {
    Select: ({ value, onValueChange, children }: any) => <Context.Provider value={{ value, onValueChange }}>{children}</Context.Provider>,
    SelectTrigger: ({ children }: any) => <div>{children}</div>,
    SelectValue: () => null,
    SelectContent: ({ children }: any) => {
      const ctx = React.useContext(Context);
      return <select value={ctx.value} onChange={e => ctx.onValueChange(e.target.value)}>{children}</select>;
    },
    SelectItem: ({ value, children }: any) => <option value={value}>{children}</option>,
  };
});
const warning = { status: 422, data: { warnings: [{ message: "Konto 400: pričakovan tip Odhodek" }] } };
beforeEach(() => {
  vi.clearAllMocks();
  state.accounts = [];
  for (const mutate of [state.create, state.update, state.seed]) {
    mutate.mockImplementation((variables, options) => {
      if (!variables.data.confirmTypeException) options.onError(warning);
      else options.onSuccess();
    });
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe("chart save/import confirmation flows", () => {
  it("retries a manual create only after confirming the warning", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KontniPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Dodaj konto" }));
    fireEvent.change(screen.getByLabelText("Koda"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Ime konta"), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
    await waitFor(() => expect(state.create).toHaveBeenCalledTimes(2));
    expect(state.create.mock.calls[0][0].data.confirmTypeException).toBe(false);
    expect(state.create.mock.calls[1][0].data).toMatchObject({ code: "400", type: "asset", confirmTypeException: true });
    expect(state.invalidate).toHaveBeenCalled();
  });
  it("keeps a cancelled edit unsaved", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<KontniPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Dodaj konto" }));
    fireEvent.change(screen.getByLabelText("Koda"), { target: { value: "400" } });
    fireEvent.change(screen.getByLabelText("Ime konta"), { target: { value: "Test" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
    expect(state.create).toHaveBeenCalledTimes(1);
    expect(state.invalidate).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Shrani" })).toBeInTheDocument();
  });
  it("shows all import warnings and sends explicit acknowledgement on retry", () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KontniPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Uvozi standardni slovenski kontni plan" }));
    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("pričakovan tip Odhodek"));
    expect(state.seed).toHaveBeenCalledTimes(2);
    expect(state.seed.mock.calls[1][0].data.confirmTypeException).toBe(true);
  });
  it("sends the edited type and confirms against the existing account", () => {
    state.accounts = [{
      id: "existing", code: "400", name: "Test", type: "asset",
      parentId: null, isActive: true, allowsPosting: true,
    }];
    vi.spyOn(window, "confirm").mockReturnValue(true);
    render(<KontniPlan />);
    fireEvent.click(screen.getByRole("button", { name: "Uredi konto 400" }));
    fireEvent.change(screen.getAllByRole("combobox")[0], { target: { value: "revenue" } });
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));
    expect(state.update).toHaveBeenCalledTimes(2);
    expect(state.update.mock.calls[1][0]).toMatchObject({
      id: "existing", data: { type: "revenue", confirmTypeException: true },
    });
    expect(state.invalidate).toHaveBeenCalled();
  });
});
