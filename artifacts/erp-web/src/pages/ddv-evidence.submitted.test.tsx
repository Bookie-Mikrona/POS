import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const state = vi.hoisted(() => ({
  company: { id: "company-a" },
  report: {} as any,
  create: vi.fn(),
  download: vi.fn(),
  mark: vi.fn(),
  invalidate: vi.fn(),
  submissions: [] as any[],
  reportQuery: vi.fn(),
}));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: () => ({ activeCompany: state.company }) }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: state.invalidate }),
}));
vi.mock("@workspace/api-client-react", () => ({
  useGetVatLedgerReport: (...args: unknown[]) => {
    state.reportQuery(...args);
    return { data: state.report, isLoading: false };
  },
  useListVatSubmissions: () => ({ data: { submissions: state.submissions }, isLoading: false }),
  useCreateVatSubmission: () => ({ mutateAsync: state.create, isPending: false }),
  useMarkVatSubmissionSubmitted: () => ({ mutateAsync: state.mark, isPending: false }),
  useDdvZakljucekOsnutek: () => ({ isPending: false }),
  vatSubmissionsQueryKey: (id: string) => ["companies", id, "vat-submissions"],
  downloadVatSubmission: (...args: unknown[]) => state.download(...args),
}));
import { KirKprEvidenceTab } from "./ddv-evidence";

beforeEach(() => {
  vi.clearAllMocks();
  state.company = { id: "company-a" };
  state.submissions = [];
  state.report = {
    kirRows: [{ zapst: 1, p3: "TEST KIR", p7: "100", reported: false }],
    kprRows: [{ zapst: 1, p3: "TEST KPR", p8: "100", reported: false }],
    kirTotals: {}, kprTotals: {}, kirCount: 1, kprCount: 1,
    warnings: [], errorCount: 0, warningCount: 0, hasErrors: false,
    recon: [], reconSummary: { netoDdv: "0", totalObracunan: "0", totalOdbitni: "0" },
  };
  state.create.mockResolvedValue({ id: "submission-a", kind: "BOTH" });
  state.download.mockResolvedValue(new Blob(["xml"]));
  state.mark.mockResolvedValue({ status: "submitted" });
  state.invalidate.mockResolvedValue(undefined);
  URL.createObjectURL = vi.fn(() => "blob:test");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

async function exportXml() {
  fireEvent.click(screen.getByRole("button", { name: "Izvozi ZIP" }));
  await waitFor(() => expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeEnabled());
}

describe("KIR/KPR manual submission UI", () => {
  it("enables marking only after a successful download, confirms the irreversible action, and refreshes both views", async () => {
    render(<KirKprEvidenceTab />);
    expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    await exportXml();
    fireEvent.click(screen.getByRole("button", { name: "Označi kot oddano" }));
    expect(screen.getByText(/Ta gumb ne pošlje XML FURS-u/)).toBeInTheDocument();
    expect(state.mark).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Potrdi oddajo" }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith({
      companyId: "company-a", submissionId: "submission-a",
    }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Označeno kot oddano" })).toBeDisabled());
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["companies", "company-a", "vat-submissions"] });
    expect(state.invalidate).toHaveBeenCalledWith({ queryKey: ["companies", "company-a", "vat-ledger-report"] });
  });

  it("keeps marking disabled when the download fails or errors appear after export", async () => {
    state.download.mockRejectedValueOnce(new Error("Prenos ni uspel"));
    const view = render(<KirKprEvidenceTab />);
    fireEvent.click(screen.getByRole("button", { name: "Izvozi ZIP" }));
    await screen.findByText("Prenos ni uspel");
    expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    await exportXml();
    state.report = { ...state.report, hasErrors: true, errorCount: 1 };
    view.rerender(<KirKprEvidenceTab />);
    expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
  });

  it("clears the downloaded submission when the company or period changes", async () => {
    const view = render(<KirKprEvidenceTab />);
    await exportXml();
    fireEvent.click(screen.getByRole("button", { name: "Trimesečni" }));
    expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    await exportXml();
    state.company = { id: "company-b" };
    view.rerender(<KirKprEvidenceTab />);
    expect(screen.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    expect(state.mark).not.toHaveBeenCalled();
  });

  it("shows server rejection in the confirmation dialog without marking success", async () => {
    state.mark.mockRejectedValue(new Error("Evidenca se je spremenila"));
    render(<KirKprEvidenceTab />);
    await exportXml();
    fireEvent.click(screen.getByRole("button", { name: "Označi kot oddano" }));
    fireEvent.click(screen.getByRole("button", { name: "Potrdi oddajo" }));
    expect(await screen.findByText("Evidenca se je spremenila")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Potrdi oddajo" })).toBeEnabled();
    expect(screen.queryByText("Evidenca je označena kot oddana.")).not.toBeInTheDocument();
  });

  it("renders reported KIR and KPR rows with reduced opacity", () => {
    state.report.kirRows[0].reported = true;
    state.report.kprRows[0].reported = true;
    render(<KirKprEvidenceTab />);
    expect(screen.getByText("TEST KIR").closest("tr")).toHaveClass("opacity-60");
    expect(screen.getByText("TEST KPR").closest("tr")).toHaveClass("opacity-60");
  });

  it("marks the exact archived draft after a return visit and redownload, without creating a new export", async () => {
    state.submissions = [{
      id: "archived-q1", companyId: "company-a", periodYear: 2025, period: "0703",
      periodFrom: "2025-01-01", periodTo: "2025-03-31", status: "draft", kind: "BOTH",
      createdAt: "2025-04-01T12:00:00Z", kirCount: 1, kprCount: 1, schemaVersion: "DDV_KIR_KPR_1.xsd",
    }];
    render(<KirKprEvidenceTab />);
    const row = within(screen.getByText("2025/0703").closest("tr")!);
    expect(row.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    fireEvent.click(row.getByRole("button", { name: "ZIP" }));
    await waitFor(() => expect(row.getByRole("button", { name: "Označi kot oddano" })).toBeEnabled());
    expect(state.reportQuery).toHaveBeenCalledWith("company-a", {
      year: 2025, period: "0703", periodMode: "trimesecno",
    }, expect.anything());
    fireEvent.click(row.getByRole("button", { name: "Označi kot oddano" }));
    expect(screen.getByText("Potrdi oddajo arhiviranega XML")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Potrdi oddajo" }));
    await waitFor(() => expect(state.mark).toHaveBeenCalledWith({
      companyId: "company-a", submissionId: "archived-q1",
    }));
    expect(state.create).not.toHaveBeenCalled();
    expect(await screen.findByText("Arhivirani izvoz je označen kot oddan.")).toBeInTheDocument();
  });

  it("keeps an archived draft disabled after a failed redownload or when its report has errors", async () => {
    state.submissions = [{
      id: "archived", companyId: "company-a", periodYear: 2025, period: "0703",
      periodFrom: "2025-03-01", periodTo: "2025-03-31", status: "draft", kind: "BOTH",
      createdAt: "2025-04-01T12:00:00Z", kirCount: 1, kprCount: 1,
    }];
    state.download.mockRejectedValueOnce(new Error("Arhiv ni dosegljiv"));
    const view = render(<KirKprEvidenceTab />);
    const row = within(screen.getByText("2025/0703").closest("tr")!);
    fireEvent.click(row.getByRole("button", { name: "ZIP" }));
    await screen.findByText("Arhiv ni dosegljiv");
    expect(row.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    state.report = { ...state.report, hasErrors: true };
    view.rerender(<KirKprEvidenceTab />);
    fireEvent.click(row.getByRole("button", { name: "ZIP" }));
    await waitFor(() => expect(state.download).toHaveBeenCalledTimes(2));
    expect(row.getByRole("button", { name: "Označi kot oddano" })).toBeDisabled();
    expect(state.mark).not.toHaveBeenCalled();
  });
});
