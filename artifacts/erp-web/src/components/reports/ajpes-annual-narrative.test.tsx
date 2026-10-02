// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { AjpesAnnualReport } from "@workspace/api-client-react";
import { defaultProfile } from "./ajpes-annual-profile-model";
import { changeNarrative, emptyNarrative, cleanSettings } from "./ajpes-annual-report-model";

const h = vi.hoisted(() => ({ server: null as unknown, mutate: null as unknown, role: "admin" }));
vi.mock("@clerk/react", () => ({ useAuth: () => ({ getToken: async () => "t" }) }));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: { id: "c1", role: h.role } }) }));
vi.mock("@workspace/api-client-react", () => ({
  getGetAjpesAnnualReportQueryKey: (c: string, y: number) => ["ajpes", c, y],
  useGetAjpesAnnualReport: (c: string, y: number) => useQuery({ queryKey: ["ajpes", c, y], queryFn: async () => h.server as AjpesAnnualReport, staleTime: 0 }),
  useSaveAjpesAnnualReport: () => ({ mutateAsync: (a: unknown) => (h.mutate as (a: unknown) => unknown)(a) }),
}));
import { AjpesAnnualReportTab } from "./ajpes-annual-report-tab";

afterEach(cleanup);
const pa = (o: object = {}) => ({ rulesVersion: "v", supported: true, mode: "notes", ready: true, reviewed: false, canExport: false, contentFingerprint: "cf1", documents: [{ code: "notes", label: "Pojasnila", status: "missing" }], sections: [], issues: [], ...o });
const base = (over: Partial<AjpesAnnualReport> = {}, narrative?: object, profile?: object): AjpesAnnualReport => ({
  year: 2025, company: { name: "A", street: "", postalCode: "", city: "", registrationNumber: "123", taxNumber: "" },
  settings: { mappings: {}, mappingReasons: {}, currentValues: {}, previousValues: {}, excludedEntryIds: [], metadata: {}, narrative, profile } as never,
  revision: 1, sourceFingerprint: "fp1", reviewed: false, canExport: true, canExportXml: false, supportedXmlYears: [2025],
  balanceSheet: [], incomeStatement: [], aopRows: [], accounts: [], journals: [], issues: [], publicationAssessment: pa() as never, ...over,
});
const open = async () => {
  render(<QueryClientProvider client={new QueryClient()}><AjpesAnnualReportTab /></QueryClientProvider>);
  fireEvent.change(await screen.findByLabelText("Poslovno leto"), { target: { value: "2025" } });
  fireEvent.mouseDown(await screen.findByRole("tab", { name: "Besedila" }), { button: 0 });
};

describe("narrative model", () => {
  it("defaults are unconfirmed and edits reset adoption", () => {
    const e = emptyNarrative();
    expect(e.profitDecision.adopted).toBe(false);
    expect(e.simplifiedStatement.confirmed).toBe(false);
    let s = changeNarrative({ ...base().settings }, { decision: { adopted: true } });
    expect(s.narrative!.profitDecision.adopted).toBe(true);
    s = changeNarrative(s, { decision: { reference: "x" } });
    expect(s.narrative!.profitDecision.adopted).toBe(false);
    s = changeNarrative(s, { statement: { confirmed: true } });
    s = changeNarrative(s, { statement: { date: "2026-01-01" } });
    expect(s.narrative!.simplifiedStatement.confirmed).toBe(false);
  });
  it("cleanSettings strips publicationReview and keeps narrative", () => {
    const c = cleanSettings({ ...base().settings, narrative: emptyNarrative(), publicationReview: { fingerprint: "a", reviewedBy: "b", reviewedAt: "c" } });
    expect(c.publicationReview).toBeUndefined();
    expect(c.narrative).toBeTruthy();
  });
});

describe("narrative tab", () => {
  it("shows ordinary notes vs special micro disclosures and conditional simplified statement", async () => {
    h.role = "admin";
    h.server = base({}, undefined, { ...defaultProfile(), microRegime: "no", simplifiedSubmission: "no" });
    await open();
    expect(await screen.findByTestId("nar-accountingPolicies")).toBeTruthy();
    expect(screen.queryByTestId("nar-disclosure4")).toBeNull();
    expect(screen.queryByTestId("simplified-section")).toBeNull();
    cleanup();
    h.server = base({}, undefined, { ...defaultProfile(), microRegime: "yes", simplifiedSubmission: "yes" });
    await open();
    expect(await screen.findByTestId("nar-disclosure10")).toBeTruthy();
    expect(screen.queryByTestId("nar-accountingPolicies")).toBeNull();
    expect(screen.getByTestId("simplified-section")).toBeTruthy();
    expect((screen.getByTestId("nar-historicalCostConfirmed") as HTMLInputElement).checked).toBe(false);
  });
  it("viewer inputs are read only", async () => {
    h.role = "viewer";
    h.server = base({}, undefined, { ...defaultProfile(), microRegime: "no" });
    await open();
    expect((await screen.findByTestId("nar-accountingPolicies") as HTMLTextAreaElement).disabled).toBe(true);
    expect((screen.getByTestId("button-pub-review") as HTMLButtonElement).disabled).toBe(true);
  });
  it("publication approval sends fresh fingerprints and keeps saved draft on second failure", async () => {
    h.role = "admin";
    h.server = base({}, undefined, { ...defaultProfile(), microRegime: "no" });
    const calls: any[] = [];
    h.mutate = async (a: any) => {
      calls.push(a);
      if (calls.length === 1) return base({ revision: 2, sourceFingerprint: "fp2", publicationAssessment: pa({ contentFingerprint: "cf2" }) as never, settings: { ...a.data.settings } });
      throw Object.assign(new Error("fail"), { status: 500 });
    };
    await open();
    fireEvent.change(await screen.findByTestId("nar-accountingPolicies"), { target: { value: "Besedilo" } });
    fireEvent.click(screen.getByTestId("button-pub-review"));
    await waitFor(() => expect(screen.getByRole("status").textContent).toContain("potrditev besedilnega paketa ni uspela"));
    expect(calls[0].data.reviewedFingerprint).toBeNull();
    expect(calls[1].data.revision).toBe(2);
    expect(calls[1].data.reviewedFingerprint).toBe("fp2");
    expect(calls[1].data.publicationReviewedFingerprint).toBe("cf2");
    expect((screen.getByTestId("nar-accountingPolicies") as HTMLTextAreaElement).value).toBe("Besedilo");
  });
  it("gates publication export but numeric export still works without publication", async () => {
    h.role = "admin";
    h.server = base({ publicationAssessment: undefined });
    await open();
    fireEvent.mouseDown(await screen.findByRole("tab", { name: "Izvoz" }), { button: 0 });
    expect((await screen.findByTestId("button-publication-pdf") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /XLSX/ }) as HTMLButtonElement).disabled).toBe(false);
  });
});
