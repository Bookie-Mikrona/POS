import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AjpesAnnualReportTab } from "./ajpes-annual-report-tab";
import { normalizeAmount } from "./ajpes-annual-report-model";

const s = vi.hoisted(() => ({
  useGet: vi.fn(),
  mutateAsync: vi.fn(),
  company: { id: "c1", naziv: "Test", role: "accountant" } as { id: string; naziv: string; role: string } | null,
}));

vi.mock("@workspace/api-client-react", () => ({
  useGetAjpesAnnualReport: s.useGet,
  useSaveAjpesAnnualReport: () => ({ mutateAsync: s.mutateAsync }),
  getGetAjpesAnnualReportQueryKey: (c: string, y: number) => ["ajpes", c, y],
}));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: s.company }) }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: vi.fn().mockResolvedValue("tok") }) }));

function mkReport(over: Record<string, unknown> = {}) {
  return {
    year: 2025,
    company: { name: "X", street: "", postalCode: "", city: "", registrationNumber: "1234567000", taxNumber: "" },
    settings: { mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {}, excludedEntryIds: [], metadata: {} },
    revision: 3, sourceFingerprint: "fp-1", reviewed: true, canExport: true, canExportXml: true, supportedXmlYears: [2025],
    balanceSheet: [{ code: "", label: "SREDSTVA", bold: true, current: "10.00", previous: "5.00" }],
    incomeStatement: [],
    aopRows: [{ code: "125", label: "Prihodki", section: "IPI", editable: true, current: "", previous: "" }],
    accounts: [], journals: [], issues: [],
    ...over,
  };
}

function renderTab() {
  const qc = new QueryClient();
  return render(<QueryClientProvider client={qc}><AjpesAnnualReportTab /></QueryClientProvider>);
}
function setData(r: unknown) {
  s.useGet.mockReturnValue({ data: r, isLoading: false, isError: false, error: null, refetch: vi.fn() });
}

describe("AJPES letno poročilo", () => {
  beforeEach(() => {
    s.company = { id: "c1", naziv: "Test", role: "accountant" };
    s.mutateAsync.mockReset();
    s.useGet.mockReset();
    vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("normalizes Slovenian numbers strictly", () => {
    expect(normalizeAmount("1234,50")).toBe("1234.50");
    expect(normalizeAmount("-12.5")).toBe("-12.5");
    expect(normalizeAmount("12abc")).toBeNull();
    expect(normalizeAmount("1,2,3")).toBeNull();
  });

  it("does not call the hook without an active company", () => {
    s.company = null;
    renderTab();
    expect(s.useGet).not.toHaveBeenCalled();
  });

  it("save sends revision, settings and null reviewedFingerprint", async () => {
    setData(mkReport());
    s.mutateAsync.mockResolvedValue(mkReport({ revision: 4, reviewed: false }));
    renderTab();
    fireEvent.change(screen.getByLabelText("Odgovorna oseba"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /Shrani osnutek/ }));
    await waitFor(() => expect(s.mutateAsync).toHaveBeenCalled());
    const arg = s.mutateAsync.mock.calls[0][0];
    expect(arg.companyId).toBe("c1");
    expect(arg.data.revision).toBe(3);
    expect(arg.data.reviewedFingerprint).toBeNull();
    expect(arg.data.settings.metadata.accountablePerson).toBe("Ana");
  });

  it("review saves first then confirms with the saved fingerprint, even with stale blocking issues", async () => {
    setData(mkReport({ reviewed: false, issues: [{ code: "x", message: "stara napaka", blocking: true }] }));
    s.mutateAsync
      .mockResolvedValueOnce(mkReport({ revision: 4, sourceFingerprint: "fp-2", reviewed: false }))
      .mockResolvedValueOnce(mkReport({ revision: 5, sourceFingerprint: "fp-2", reviewed: true }));
    renderTab();
    fireEvent.change(screen.getByLabelText("Odgovorna oseba"), { target: { value: "Ana" } });
    fireEvent.click(screen.getByRole("button", { name: /potrdi pregled/ }));
    await waitFor(() => expect(s.mutateAsync).toHaveBeenCalledTimes(2));
    expect(s.mutateAsync.mock.calls[0][0].data.reviewedFingerprint).toBeNull();
    expect(s.mutateAsync.mock.calls[1][0].data.reviewedFingerprint).toBe("fp-2");
    expect(s.mutateAsync.mock.calls[1][0].data.revision).toBe(4);
  });

  it("keeps unsaved input when a refetch delivers new data", () => {
    setData(mkReport());
    const { rerender } = renderTab();
    fireEvent.change(screen.getByLabelText("Odgovorna oseba"), { target: { value: "Ana" } });
    setData(mkReport({ sourceFingerprint: "fp-9" }));
    rerender(<QueryClientProvider client={new QueryClient()}><AjpesAnnualReportTab /></QueryClientProvider>);
    expect(screen.getByLabelText("Odgovorna oseba")).toHaveValue("Ana");
  });

  async function openExport() {
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Izvoz" }), { button: 0 });
    fireEvent.click(screen.getByRole("tab", { name: "Izvoz" }));
  }

  it("exports binary with auth headers and server filename", async () => {
    setData(mkReport());
    const fetchMock = vi.fn().mockResolvedValue(new Response(new Blob(["x"]), { status: 200, headers: { "Content-Disposition": 'attachment; filename="ajpes-2025.xlsx"' } }));
    vi.stubGlobal("fetch", fetchMock);
    renderTab();
    await openExport();
    fireEvent.click(await screen.findByRole("button", { name: "XLSX" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/companies/c1/reports/ajpes/2025/export");
    expect(init.method).toBe("POST");
    expect(init.headers["X-Company-Id"]).toBe("c1");
    expect(init.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(init.body)).toEqual({ format: "xlsx", sourceFingerprint: "fp-1" });
    await waitFor(() => expect(screen.getByText(/Preneseno: ajpes-2025.xlsx/)).toBeInTheDocument());
  });

  it.each([[409, /ponovno preglejte/], [422, /Izvoz ni dovoljen: Blokirano/]])("status %i shows error and downloads nothing", async (status, re) => {
    setData(mkReport());
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: status === 409 ? "Zastarelo" : "Blokirano" }), { status })));
    renderTab();
    await openExport();
    fireEvent.click(await screen.findByRole("button", { name: "PDF" }));
    await waitFor(() => expect(screen.getByText(re)).toBeInTheDocument());
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
