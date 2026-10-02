// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { AjpesAnnualReport } from "@workspace/api-client-react";

const h = vi.hoisted(() => ({ server: null as unknown, mutate: null as unknown }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => "t" }) }));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: { id: "c1", role: "admin" } }) }));
vi.mock("@workspace/api-client-react", () => ({
  getGetAjpesAnnualReportQueryKey: (c: string, y: number) => ["ajpes", c, y],
  useGetAjpesAnnualReport: (c: string, y: number) =>
    useQuery({ queryKey: ["ajpes", c, y], queryFn: async () => h.server as AjpesAnnualReport, staleTime: 0 }),
  useSaveAjpesAnnualReport: () => ({ mutateAsync: (a: unknown) => (h.mutate as (a: unknown) => unknown)(a) }),
}));
import { AjpesAnnualReportTab } from "./ajpes-annual-report-tab";

afterEach(cleanup);
const base = (over: Partial<AjpesAnnualReport> = {}): AjpesAnnualReport => ({
  year: 2025, company: { name: "A", street: "", postalCode: "", city: "", registrationNumber: "123", taxNumber: "" },
  settings: { mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {}, excludedEntryIds: [], metadata: {} },
  revision: 1, sourceFingerprint: "fp1", reviewed: false, canExport: false, canExportXml: false, supportedXmlYears: [2025],
  balanceSheet: [], incomeStatement: [], aopRows: [], accounts: [], journals: [], issues: [], ...over,
});

describe("AjpesAnnualReportTab", () => {
  it("keeps saved draft and shows fresh blocking issues when review fails", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    vi.useRealTimers();
    h.server = base();
    const calls: any[] = [];
    h.mutate = async (a: any) => {
      calls.push(a);
      return base({ revision: 2, sourceFingerprint: "fp2", settings: a.data.settings, issues: [{ code: "X", message: "Blokada po shranjevanju", blocking: true }] });
    };
    render(<QueryClientProvider client={new QueryClient()}><AjpesAnnualReportTab /></QueryClientProvider>);
    fireEvent.change(await screen.findByLabelText("Poslovno leto"), { target: { value: "2025" } });
    const tab = await screen.findByRole("tab", { name: "Profil" });
    fireEvent.mouseDown(tab, { button: 0 });
    fireEvent.change(await screen.findByTestId("profile-legalForm"), { target: { value: "doo" } });
    fireEvent.click(screen.getByRole("button", { name: /Shrani in potrdi pregled/ }));
    await waitFor(() => expect(screen.getByText("Blokada po shranjevanju")).toBeTruthy());
    expect(calls.length).toBe(1);
    expect(calls[0].data.settings.profile.legalForm).toBe("doo");
    expect(calls[0].data.settings.metadata.size).toBeUndefined();
    expect(calls[0].data.reviewedFingerprint).toBeNull();
    expect(screen.queryByText("Neshranjene spremembe")).toBeNull();
    expect((screen.getByTestId("profile-legalForm") as HTMLSelectElement).value).toBe("doo");
    expect(screen.getByRole("status").textContent).toContain("Osnutek je shranjen");
  });
});
