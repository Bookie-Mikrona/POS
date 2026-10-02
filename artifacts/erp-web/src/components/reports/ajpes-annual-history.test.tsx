// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";

const h = vi.hoisted(() => ({ data: null as unknown }));
vi.mock("@workspace/api-client-react", () => ({
  getGetAjpesAnnualHistoryQueryKey: (c: string, y: number, p: object) => ["h", c, y, p],
  useGetAjpesAnnualHistory: (c: string, y: number, p: object) => useQuery({ queryKey: ["h", c, y, p], queryFn: async () => h.data as never }),
  useRequestAjpesEvidenceUpload: () => ({ mutateAsync: vi.fn() }),
  useRecordAjpesSubmission: () => ({ mutateAsync: vi.fn() }),
  getDownloadAjpesAnnualArchiveUrl: () => "/a",
  getDownloadAjpesSubmissionEvidenceUrl: () => "/s",
  customFetch: vi.fn(),
}));
import { AjpesAnnualHistoryTab } from "./ajpes-annual-history-tab";

afterEach(cleanup);
const ex = (id: string, fingerprint: string, purpose = "statistics") => ({ id, format: "xml", purpose, revision: 1, fingerprint, rulesVersion: "v", publicationReviewed: false, sha256: "a".repeat(64), byteSize: 10, filename: `${id}.xml`, mime: "application/xml", createdBy: "u", createdAt: "2026-01-01T00:00:00Z" });
const sub = { id: "s1", exportId: "e2", outcome: "accepted", submittedOn: "2026-02-01", reference: "R1", note: "", filename: "r.pdf", mime: "application/pdf", byteSize: 5, sha256: "b", recordedBy: "u", recordedAt: "2026-02-02T00:00:00Z", supersedesId: null };
const mount = (viewer: boolean) => render(<QueryClientProvider client={new QueryClient()}><AjpesAnnualHistoryTab companyId="c1" year={2025} viewer={viewer} /></QueryClientProvider>);

describe("history tab", () => {
  it("marks older revisions and does not call old accepted evidence current", async () => {
    h.data = { exports: [ex("e1", "new"), ex("e2", "old")], submissions: [sub], currentFingerprint: "new", nextOffset: null };
    mount(false);
    expect((await screen.findByTestId("badge-export-fp-e1")).textContent).toBe("Trenutno poročilo");
    expect(screen.getByTestId("badge-export-fp-e2").textContent).toBe("Starejša revizija");
    expect(screen.getByTestId("badge-sub-fp-s1").textContent).toBe("Velja za starejšo revizijo");
    expect(screen.getByTestId("evidence-form")).toBeTruthy();
  });
  it("viewer cannot record", async () => {
    h.data = { exports: [ex("e1", "new")], submissions: [], currentFingerprint: "new", nextOffset: null };
    mount(true);
    expect(await screen.findByTestId("history-viewer-note")).toBeTruthy();
    expect(screen.queryByTestId("evidence-form")).toBeNull();
    expect(screen.getByTestId("button-download-export-e1")).toBeTruthy();
  });
});
