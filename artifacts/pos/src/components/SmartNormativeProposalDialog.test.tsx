import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SmartNormativeProposalDialog } from "./SmartNormativeProposalDialog";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pos-auth-headers", () => ({ posFetch: fetchMock }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogFooter: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/scroll-area", () => ({
  ScrollArea: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock("@/components/ui/select", () => ({
  Select: ({ value, onValueChange, children }: { value: string; onValueChange: (value: string) => void; children: React.ReactNode }) =>
    <select value={value} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectTrigger: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectValue: ({ placeholder }: { placeholder: string }) => <option value="">{placeholder}</option>,
  SelectContent: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  SelectItem: ({ value, children }: { value: string; children: React.ReactNode }) => <option value={value}>{children}</option>,
}));

const proposal = {
  token: "signed-preview", origin: "web_estimate", articleId: 51, revision: 1,
  items: [
    { name: "Fižol", quantity: 0.15, unit: "KGM", existingArticleId: null, willCreate: true, sourceUrls: ["https://allrecipes.com/bean-salad"] },
    { name: "Rdeča čebula", quantity: 0.02, unit: "KGM", existingArticleId: null, willCreate: true, sourceUrls: ["https://allrecipes.com/bean-salad"] },
  ],
  sources: [{ url: "https://allrecipes.com/bean-salad", title: "Bean salad" }],
  warnings: ["To je približen AI-predlog. Sestavine in količine preverite pred potrditvijo."],
};

beforeEach(() => {
  fetchMock.mockReset();
  fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(
    url.endsWith("/uporabi") ? { ok: true } : proposal,
  ), { status: 200, headers: { "Content-Type": "application/json" } }));
});

describe("SmartNormativeProposalDialog", () => {
  it("shows the actual per-serving norm first and applies explicitly classified new ingredients", async () => {
    const onApplySuccess = vi.fn();
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika"
      onOpenChange={vi.fn()} onApplySuccess={onApplySuccess} />);

    const table = await screen.findByRole("table");
    expect(within(table).getByText("Fižol")).toBeInTheDocument();
    expect(within(table).getByText("0,150 kg")).toBeInTheDocument();
    expect(within(table).getByText("0,020 kg")).toBeInTheDocument();
    expect(screen.getByText(/Predlog še ni shranjen/)).toBeInTheDocument();
    expect(screen.queryByText(/Sistemska opozorila|OPOZORILO: Potreben je strog ročni pregled/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/približen AI-predlog/)).toHaveLength(1);

    const save = screen.getByRole("button", { name: "Ustvari in uporabi normativ" });
    expect(save).toBeDisabled();
    fireEvent.change(screen.getAllByRole("combobox")[0]!, { target: { value: "food" } });
    expect(save).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(save).toBeEnabled();
    fireEvent.click(save);

    await waitFor(() => expect(onApplySuccess).toHaveBeenCalledTimes(1));
    const [url, options] = fetchMock.mock.lastCall as [string, RequestInit];
    expect(url).toContain("/pametni-predlog/uporabi");
    expect(JSON.parse(String(options.body))).toMatchObject({
      token: "signed-preview", confirmed: true,
      classifications: [
        { index: 0, taxCategory: "food", rawConfirmed: true },
        { index: 1, taxCategory: "food", rawConfirmed: true },
      ],
    });
  });
});