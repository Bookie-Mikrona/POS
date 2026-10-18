import "@testing-library/jest-dom";

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  getToken: vi.fn(),
  company: { id: "company-email-test", naziv: "Poročila d.o.o.", role: "accountant" },
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: state.getToken, userId: "email-test-user" }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@workspace/api-client-react", () => {
  const section = { sections: [], total: "0" };
  const query = { isLoading: false, isFetching: false, isError: false, error: null };
  return {
    useGetBalanceSheet: () => ({
      ...query, data: { current: { aktiva: section, pasiva: section } },
    }),
    useGetIncomeStatement: () => ({
      ...query, data: { current: { revenue: section, expenses: section, netResult: "0" } },
    }),
    useGetTrialBalance: () => ({
      ...query, data: { rows: [], totalTurnoverDebit: "0", totalTurnoverCredit: "0" },
    }),
  };
});

const reports = [
  { reportType: "balance-sheet", tab: "Bilanca stanja", dates: ["2026-06-30"], params: { asOf: "2026-06-30" } },
  {
    reportType: "income-statement", tab: "Izkaz poslovnega izida",
    dates: ["2026-01-01", "2026-06-30"],
    params: { dateFrom: "2026-01-01", dateTo: "2026-06-30" },
  },
  {
    reportType: "trial-balance", tab: "Bilanca kontov / zaključni račun",
    dates: ["2026-01-01", "2026-06-30"],
    params: { dateFrom: "2026-01-01", dateTo: "2026-06-30" },
  },
] as const;

const successMessage = "E-pošta je bila uspešno poslana!";
const historyWarning = "PDF je bil poslan, vendar zapis v zgodovino izvozov ni uspel. Ne pošiljajte ga ponovno.";

describe.each(reports)("$reportType – napake pošiljanja poročila", (report) => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let resolveResponse: (response: Response) => void;

  beforeEach(() => {
    localStorage.clear();
    state.getToken.mockResolvedValue("email-test-token");
    fetchMock = vi.fn(() => new Promise<Response>((resolve) => { resolveResponse = resolve; }));
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  function expectRequest(call: number, email: string) {
    expect(fetchMock).toHaveBeenNthCalledWith(call,
      `/api/companies/${state.company.id}/reports/export`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer email-test-token",
          "Idempotency-Key": expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
        },
        body: JSON.stringify({ reportType: report.reportType, email, ...report.params }),
      },
    );
  }

  async function startSending() {
    const user = userEvent.setup();
    const { container } = render(<Porocila />);
    const tab = screen.getByRole("tab", { name: report.tab });
    fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
    fireEvent.click(tab);
    const dates = container.querySelectorAll('input[type="date"]');
    report.dates.forEach((value, index) => fireEvent.change(dates[index], { target: { value } }));
    await user.click(screen.getByRole("button", { name: /^Prikaži( poročilo)?$/ }));
    await user.click(screen.getByTitle("Pošlji po e-pošti"));
    const dialog = screen.getByRole("dialog", { name: "Pošlji poročilo po e-pošti" });
    const input = within(dialog).getByRole("textbox", { name: "E-poštni naslov prejemnika" });
    const send = within(dialog).getByRole("button", { name: "Pošlji" });
    await user.type(input, "prvi@example.com");
    await user.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expectRequest(1, "prvi@example.com");
    expect(input).toBeDisabled();
    expect(send).toBeDisabled();
    expect(within(dialog).queryByText(successMessage)).not.toBeInTheDocument();
    return { user, dialog, input, send };
  }

  it("po 502 ohrani napako in naslov v odprtem oknu ter dovoli popravek in uspešen ponovni poskus", async () => {
    const { user, dialog, input, send } = await startSending();
    const message = "SMTP unavailable";
    await act(async () => resolveResponse(new Response(JSON.stringify({ error: message }), { status: 502 })));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(message);
    expect(dialog).toBeVisible();
    expect(input).toHaveValue("prvi@example.com");
    expect(input).toBeEnabled();
    expect(send).toBeEnabled();
    expect(within(dialog).queryByText(successMessage)).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();

    await user.clear(input);
    await user.type(input, "popravljen@example.com");
    expect(within(dialog).getByRole("alert")).toHaveTextContent(message);
    await user.click(send);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expectRequest(2, "popravljen@example.com");
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(successMessage)).not.toBeInTheDocument();
    expect(send).toBeDisabled();
    await act(async () => resolveResponse(new Response(JSON.stringify({ uspeh: true }), { status: 200 })));

    expect(await within(dialog).findByText(successMessage)).toBeVisible();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Pošlji" })).not.toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Zapri" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("ob napaki zgodovine pokaže, da je PDF že poslan, brez zavajajočega poziva k ponovnemu pošiljanju", async () => {
    const { user, dialog, input } = await startSending();
    await act(async () => resolveResponse(new Response(JSON.stringify({ error: historyWarning }), { status: 500 })));

    expect(await within(dialog).findByRole("alert")).toHaveTextContent(historyWarning);
    expect(dialog).toBeVisible();
    expect(input).toHaveValue("prvi@example.com");
    expect(within(dialog).queryByText(successMessage)).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/Poskusite znova|Pošiljanje ni uspelo/i)).not.toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await user.click(within(dialog).getByRole("button", { name: "Prekliči" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
