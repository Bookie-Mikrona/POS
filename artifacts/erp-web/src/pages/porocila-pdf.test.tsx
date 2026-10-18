import "@testing-library/jest-dom";

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Porocila from "./porocila";

const state = vi.hoisted(() => ({
  getToken: vi.fn(),
  trackEvent: vi.fn(),
  company: { id: "company-pdf-test", naziv: "PDF preizkus d.o.o.", role: "accountant" },
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: state.getToken, userId: "pdf-test-user" }),
}));
vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({ activeCompany: state.company }),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: state.trackEvent }));
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
  {
    reportType: "balance-sheet",
    tab: "Bilanca stanja",
    dates: ["2026-06-30"],
    params: { asOf: "2026-06-30" },
    filename: "bilanca-stanja-2026-06-30.pdf",
    analyticsType: "balance_sheet",
  },
  {
    reportType: "income-statement",
    tab: "Izkaz poslovnega izida",
    dates: ["2026-01-01", "2026-06-30"],
    params: { dateFrom: "2026-01-01", dateTo: "2026-06-30" },
    filename: "izkaz-poslovnega-izida-2026-01-01-2026-06-30.pdf",
    analyticsType: "income_statement",
  },
  {
    reportType: "trial-balance",
    tab: "Bilanca kontov / zaključni račun",
    dates: ["2026-01-01", "2026-06-30"],
    params: { dateFrom: "2026-01-01", dateTo: "2026-06-30" },
    filename: "bruto-bilanca-2026-01-01-2026-06-30.pdf",
    analyticsType: "trial_balance",
  },
] as const;

function openReport(report: typeof reports[number]) {
  const { container } = render(<Porocila />);
  const tab = screen.getByRole("tab", { name: report.tab });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  const dates = container.querySelectorAll('input[type="date"]');
  report.dates.forEach((value, index) => {
    fireEvent.change(dates[index], { target: { value } });
  });
  fireEvent.click(screen.getByRole("button", { name: /^Prikaži( poročilo)?$/ }));
  return screen.getByRole("button", { name: "PDF" });
}

describe.each(reports)("$reportType – strežniški prenos PDF", (report) => {
  let resolveResponse: (response: Response) => void;
  let fetchMock: ReturnType<typeof vi.fn>;
  let anchorClick: ReturnType<typeof vi.spyOn>;
  let downloads: { href: string; filename: string }[];

  beforeEach(() => {
    localStorage.clear();
    state.getToken.mockResolvedValue("pdf-test-token");
    downloads = [];
    fetchMock = vi.fn(() => new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    }));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("URL", {
      createObjectURL: vi.fn().mockReturnValue("blob:report-pdf-test"),
      revokeObjectURL: vi.fn(),
    });
    vi.spyOn(window, "alert").mockImplementation(() => {});
    anchorClick = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push({ href: this.href, filename: this.download });
      });
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  async function startDownload() {
    const button = openReport(report);
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(state.getToken).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/companies/${state.company.id}/reports/export`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer pdf-test-token",
        },
        body: JSON.stringify({ reportType: report.reportType, ...report.params }),
      },
    );
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    return button;
  }

  it("prenese vrnjeni PDF s pravilnim imenom in sprosti začasni URL", async () => {
    const button = await startDownload();
    const response = new Response("%PDF-1.4\n%%EOF", {
      status: 200, headers: { "Content-Type": "application/pdf" },
    });
    const pdf = new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" });
    const readBlob = vi.spyOn(response, "blob").mockResolvedValue(pdf);
    resolveResponse(response);

    await waitFor(() => expect(button).toBeEnabled());
    expect(readBlob).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).toHaveBeenCalledExactlyOnceWith(pdf);
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([{ href: "blob:report-pdf-test", filename: report.filename }]);
    expect(URL.revokeObjectURL).toHaveBeenCalledExactlyOnceWith("blob:report-pdf-test");
    expect(window.alert).not.toHaveBeenCalled();
    expect(state.trackEvent).toHaveBeenCalledExactlyOnceWith("report_exported", {
      report_type: report.analyticsType, format: "pdf",
    });
  });

  it("ponovi e-poštni poskus z istim ključem po izgubi odgovora, nov izvoz pa dobi nov ključ", async () => {
    openReport(report);
    fetchMock.mockRejectedValueOnce(new TypeError("Povezava prekinjena"));
    fireEvent.click(screen.getByTitle("Pošlji po e-pošti"));
    fireEvent.change(screen.getByLabelText("E-poštni naslov prejemnika"), { target: { value: "test@example.test" } });
    fireEvent.click(screen.getByRole("button", { name: "Pošlji" }));
    await screen.findByText("Povezava prekinjena");
    const first = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const key = (first[1].headers as Record<string, string>)["Idempotency-Key"];
    expect(key).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(first[1].body as string)).toEqual({
      reportType: report.reportType, email: "test@example.test", ...report.params,
    });

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uspeh: true }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Pošlji" }));
    await screen.findByText("E-pošta je bila uspešno poslana!");
    const retry = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(retry[1]).toEqual(first[1]);

    fireEvent.click(screen.getByRole("button", { name: "Zapri" }));
    fireEvent.click(screen.getByTitle("Pošlji po e-pošti"));
    fireEvent.change(screen.getByLabelText("E-poštni naslov prejemnika"), { target: { value: "test@example.test" } });
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ uspeh: true }), { status: 200 }));
    fireEvent.click(screen.getByRole("button", { name: "Pošlji" }));
    await screen.findByText("E-pošta je bila uspešno poslana!");
    const next = fetchMock.mock.calls[2] as unknown as [string, RequestInit];
    expect((next[1].headers as Record<string, string>)["Idempotency-Key"]).not.toBe(key);
  });

  it.each([
    { status: 403, body: JSON.stringify({ error: "Nimate pravice za izvoz." }), message: "Nimate pravice za izvoz." },
    { status: 500, body: JSON.stringify({ error: "Izvoz trenutno ni na voljo." }), message: "Izvoz trenutno ni na voljo." },
    { status: 502, body: "<html>Bad Gateway</html>", message: "HTTP 502" },
  ])("pri HTTP $status pokaže napako brez datoteke in omogoči ponovni poskus", async ({ status, body, message }) => {
    const button = await startDownload();
    const response = new Response(body, { status });
    const readBlob = vi.spyOn(response, "blob");
    resolveResponse(response);

    await waitFor(() => expect(window.alert).toHaveBeenCalledExactlyOnceWith(
      `Napaka pri izvozu PDF: ${message}`,
    ));
    await waitFor(() => expect(button).toBeEnabled());
    expect(readBlob).not.toHaveBeenCalled();
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    expect(anchorClick).not.toHaveBeenCalled();
    expect(downloads).toEqual([]);
    expect(state.trackEvent).not.toHaveBeenCalled();

    // A failed export must not leave the real button stuck in its loading state.
    fireEvent.click(button);
    expect(button).toBeDisabled();
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    resolveResponse(new Response("%PDF-1.4\n%%EOF", {
      status: 200, headers: { "Content-Type": "application/pdf" },
    }));
    await waitFor(() => expect(button).toBeEnabled());
    expect(anchorClick).toHaveBeenCalledTimes(1);
    expect(downloads[0].filename).toBe(report.filename);
  });
});
