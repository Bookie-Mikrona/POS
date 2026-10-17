import "@testing-library/jest-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("@workspace/api-client-react", () => ({ customFetch: fetchMock }));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, disabled }: any) => (
    <select aria-label="Format izvoza obračuna" value={value} disabled={disabled} onChange={(e) => onValueChange(e.target.value)}>
      <option value="pdf">PDF</option><option value="xlsx">Excel</option>
    </select>
  ),
  SelectContent: () => null, SelectItem: () => null, SelectTrigger: () => null, SelectValue: () => null,
}));
import { SavedAmortizationExports } from "./SavedAmortizationExports";

function renderExports(companyId = "company-a") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const view = render(<QueryClientProvider client={client}><SavedAmortizationExports companyId={companyId} /></QueryClientProvider>);
  return { ...view, client };
}

beforeEach(() => {
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:export"), revokeObjectURL: vi.fn() }));
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  fetchMock.mockImplementation((url: string) => Promise.resolve(url.includes("/leta") ? [
    { leto: 2024, doMeseca: 12, status: "zakljucen" },
    { leto: 2023, doMeseca: 6, status: "odprt" },
  ] : new Blob(["export"])));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); fetchMock.mockReset(); });

describe("Saved amortization export controls", () => {
  it("shows a button for every saved year and downloads PDF and Excel with explicit company headers", async () => {
    renderExports();
    const buttons = await screen.findAllByRole("button", { name: "Izvozi obračun" });
    expect(buttons).toHaveLength(2);
    fireEvent.click(buttons[1]);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("leto=2023&format=pdf"),
      expect.objectContaining({ responseType: "blob", headers: { "X-Company-Id": "company-a" } }));
    fireEvent.change(screen.getByLabelText("Format izvoza obračuna"), { target: { value: "xlsx" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Izvozi obračun" })[0]);
    await waitFor(() => expect(HTMLAnchorElement.prototype.click).toHaveBeenCalledTimes(2));
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining("leto=2024&format=xlsx"),
      expect.objectContaining({ headers: { "X-Company-Id": "company-a" } }));
  });

  it("shows server errors without pretending a file was downloaded", async () => {
    fetchMock.mockImplementation((url: string) => url.includes("/leta")
      ? Promise.resolve([{ leto: 2024, doMeseca: 12, status: "zakljucen" }])
      : Promise.reject(new Error("Obračun ne obstaja več.")));
    renderExports();
    fireEvent.click(await screen.findByRole("button", { name: "Izvozi obračun" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Obračun ne obstaja več.");
    expect(HTMLAnchorElement.prototype.click).not.toHaveBeenCalled();
  });

  it("refreshes the year list after an accounting change", async () => {
    const { client } = renderExports();
    await screen.findAllByRole("button", { name: "Izvozi obračun" });
    fetchMock.mockResolvedValueOnce([{ leto: 2025, doMeseca: 12, status: "zakljucen" }]);
    await client.invalidateQueries({ queryKey: ["saved-amortization-years", "company-a"] });
    await waitFor(() => expect(screen.getByText("2025")).toBeInTheDocument());
    expect(screen.queryByText("2023")).not.toBeInTheDocument();
  });

  it("shows empty and failed list states explicitly", async () => {
    fetchMock.mockResolvedValueOnce([]);
    const view = renderExports();
    expect(await screen.findByText("Ni shranjenih obračunov.")).toBeInTheDocument();
    view.unmount();
    fetchMock.mockRejectedValueOnce(new Error("Network error"));
    renderExports("company-b");
    expect(await screen.findByRole("alert")).toHaveTextContent("Shranjena leta niso dosegljiva.");
    expect(screen.getByRole("button", { name: "Poskusi znova" })).toBeInTheDocument();
  });
});
