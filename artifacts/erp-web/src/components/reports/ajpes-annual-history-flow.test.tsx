// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ reserve: vi.fn(), record: vi.fn(), fetchHist: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({
  getGetAjpesAnnualHistoryQueryKey: (c: string, y: number, p: object) => [`/api/companies/${c}/reports/ajpes/${y}/history`, p],
  useGetAjpesAnnualHistory: (c: string, y: number, p: object) => useQuery({ queryKey: [`/api/companies/${c}/reports/ajpes/${y}/history`, p], queryFn: async () => h.fetchHist(c, y, p), staleTime: 0 }),
  useRequestAjpesEvidenceUpload: () => ({ mutateAsync: h.reserve }),
  useRecordAjpesSubmission: () => ({ mutateAsync: h.record }),
  getDownloadAjpesAnnualArchiveUrl: () => "/a",
  getDownloadAjpesSubmissionEvidenceUrl: () => "/s",
  customFetch: vi.fn(),
}));
import { AjpesAnnualHistoryTab, ATTEST_TEXT } from "./ajpes-annual-history-tab";

const ex = { id: "e1", format: "xml", purpose: "statistics", revision: 1, fingerprint: "fp", rulesVersion: "v", publicationReviewed: false, sha256: "a".repeat(64), byteSize: 10, filename: "x.xml", mime: "application/xml", createdBy: "u", createdAt: "2026-01-01T00:00:00Z" };
const hist = { exports: [ex], submissions: [], currentFingerprint: "fp", nextOffset: null };
const putFetch = vi.fn();

beforeEach(() => {
  h.reserve.mockReset(); h.record.mockReset(); h.fetchHist.mockReset(); putFetch.mockReset();
  h.fetchHist.mockResolvedValue(hist);
  h.reserve.mockResolvedValue({ id: "up1", uploadURL: "https://store/put" });
  h.record.mockResolvedValue({});
  putFetch.mockResolvedValue({ ok: true, status: 200 });
  vi.stubGlobal("fetch", putFetch);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const pdf = (name = "r.pdf") => new File(["abc"], name, { type: "application/pdf", lastModified: 1 });
async function fill(f: File = pdf()) {
  render(<QueryClientProvider client={new QueryClient()}><AjpesAnnualHistoryTab companyId="c1" year={2025} viewer={false} /></QueryClientProvider>);
  fireEvent.change(await screen.findByTestId("select-export"), { target: { value: "e1" } });
  fireEvent.change(screen.getByTestId("input-date"), { target: { value: "2026-02-01" } });
  fireEvent.change(screen.getByTestId("input-reference"), { target: { value: "R1" } });
  fireEvent.change(screen.getByTestId("input-file"), { target: { files: [f] } });
  fireEvent.click(screen.getByTestId("check-attest"));
}
const save = () => fireEvent.click(screen.getByTestId("button-record"));

describe("evidence flow", () => {
  it("reserve, direct PUT, record, then fresh history; form cleared", async () => {
    await fill();
    const before = h.fetchHist.mock.calls.length;
    save();
    await waitFor(() => expect(screen.getByTestId("evidence-msg").textContent).toContain("shranjeno"));
    expect(h.reserve.mock.calls[0][0]).toEqual({ companyId: "c1", year: 2025, data: { exportId: "e1", filename: "r.pdf", mime: "application/pdf", byteSize: 3 } });
    expect(putFetch.mock.calls[0][0]).toBe("https://store/put");
    expect(putFetch.mock.calls[0][1].method).toBe("PUT");
    expect(putFetch.mock.calls[0][1].headers["Content-Type"]).toBe("application/pdf");
    expect(h.record.mock.calls[0][0].data).toEqual({ uploadId: "up1", outcome: "submitted", submittedOn: "2026-02-01", reference: "R1", note: "", attested: true, supersedesId: null });
    await waitFor(() => expect(h.fetchHist.mock.calls.length).toBeGreaterThan(before));
    expect((screen.getByTestId("input-reference") as HTMLInputElement).value).toBe("");
    expect((screen.getByTestId("check-attest") as HTMLInputElement).checked).toBe(false);
  });
  it("unchanged retry after failed record uploads once; any edit forces new upload", async () => {
    await fill();
    h.record.mockRejectedValueOnce(new Error("boom"));
    save();
    await waitFor(() => expect(screen.getByTestId("evidence-msg").textContent).toContain("boom"));
    fireEvent.click(screen.getByTestId("check-attest")); // not a semantic edit when re-confirming? it was kept checked -> toggles off
    fireEvent.click(screen.getByTestId("check-attest"));
    save();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(2));
    expect(h.reserve).toHaveBeenCalledTimes(1);
    expect(putFetch).toHaveBeenCalledTimes(1);
    expect(h.record.mock.calls[1][0].data.uploadId).toBe("up1");
  });
  it("edits clear attestation; identical-metadata new file gets fresh upload", async () => {
    await fill();
    h.record.mockRejectedValueOnce(new Error("boom"));
    save();
    await waitFor(() => expect(screen.getByTestId("evidence-msg").textContent).toContain("boom"));
    h.reserve.mockResolvedValueOnce({ id: "up2", uploadURL: "https://store/put2" });
    fireEvent.change(screen.getByTestId("input-file"), { target: { files: [pdf()] } });
    expect((screen.getByTestId("check-attest") as HTMLInputElement).checked).toBe(false);
    fireEvent.click(screen.getByTestId("check-attest"));
    save();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(2));
    expect(h.reserve).toHaveBeenCalledTimes(2);
    expect(h.record.mock.calls[1][0].data.uploadId).toBe("up2");
  });
  it("410 expired reservation clears frozen id", async () => {
    await fill();
    h.record.mockRejectedValueOnce(Object.assign(new Error("expired"), { status: 410 }));
    save();
    await waitFor(() => expect(screen.getByTestId("evidence-msg").textContent).toContain("expired"));
    h.reserve.mockResolvedValueOnce({ id: "up3", uploadURL: "https://store/p3" });
    save();
    await waitFor(() => expect(h.record).toHaveBeenCalledTimes(2));
    expect(h.reserve).toHaveBeenCalledTimes(2);
  });
  it("rejected requires reason; fields locked while busy; label shows sha", async () => {
    await fill();
    expect(screen.getByTestId("select-export").textContent).toContain("aaaaaaaa");
    expect(screen.getByTestId("select-export").textContent).toContain("trenutno");
    fireEvent.change(screen.getByTestId("select-outcome"), { target: { value: "rejected" } });
    fireEvent.click(screen.getByTestId("check-attest"));
    expect((screen.getByTestId("button-record") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByTestId("input-note"), { target: { value: "razlog" } });
    fireEvent.click(screen.getByTestId("check-attest"));
    h.reserve.mockImplementationOnce(() => new Promise(() => {}));
    save();
    await waitFor(() => expect((screen.getByTestId("evidence-fields") as HTMLFieldSetElement).disabled).toBe(true));
  });
});
