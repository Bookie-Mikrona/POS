import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SmartNormativeProposalDialog } from "./SmartNormativeProposalDialog";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/pos-auth-headers", () => ({ posFetch: fetchMock }));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children, style, className }: React.HTMLAttributes<HTMLDivElement>) => <div style={style} className={className}>{children}</div>,
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
  it("makes a one-ingredient result explicit and keeps adding ingredients visible", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      ...proposal, items: proposal.items.slice(0, 1),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika" availableIngredients={[]}
      onOpenChange={vi.fn()} onApplySuccess={vi.fn()} />);

    expect(await screen.findByText(/AI je predlagal 1 sestavino/)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Predlog vsebuje samo eno sestavino");
    fireEvent.click(screen.getByRole("button", { name: "+ Dodaj sestavino" }));
    expect(screen.getByLabelText("Ime sestavine 2")).toHaveValue("");
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ustvari in uporabi normativ" })).toBeDisabled();
  });

  it("keeps a long list in a bounded, native scroll region", async () => {
    fetchMock.mockImplementation(async () => new Response(JSON.stringify({
      ...proposal,
      items: Array.from({ length: 9 }, (_, index) => ({
        ...proposal.items[0], name: `Sestavina ${index + 1}`,
      })),
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika" availableIngredients={[]}
      onOpenChange={vi.fn()} onApplySuccess={vi.fn()} />);
    expect(await screen.findByLabelText("Ime sestavine 9")).toHaveValue("Sestavina 9");
    expect(screen.getByText(/AI je predlagal 9 sestavin/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Sestavine in pregled" })).toHaveClass("overflow-y-auto", "touch-pan-y");
    expect(screen.getByRole("region", { name: "Sestavine in pregled" }).parentElement?.parentElement)
      .toHaveStyle({ height: "min(90dvh, calc(var(--pos-visual-viewport-height) - 1rem))" });
  });

  it("shows the server's research timeout and can retry without saving", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(
      JSON.stringify({ error: "Spletno raziskovanje je trajalo predolgo. Poskusite znova." }),
      { status: 503, headers: { "Content-Type": "application/json" } },
    ));
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika" availableIngredients={[]}
      onOpenChange={vi.fn()} onApplySuccess={vi.fn()} />);

    expect(await screen.findByText("Spletno raziskovanje je trajalo predolgo. Poskusite znova.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ustvari in uporabi normativ" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(await screen.findByLabelText("Ime sestavine 1")).toHaveValue("Fižol");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("shows the actual per-serving norm first and applies explicitly classified new ingredients", async () => {
    const onApplySuccess = vi.fn();
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika" availableIngredients={[]}
      onOpenChange={vi.fn()} onApplySuccess={onApplySuccess} />);

    expect(await screen.findByLabelText("Ime sestavine 1")).toHaveValue("Fižol");
    expect(screen.getByLabelText("Količina sestavine 1")).toHaveValue("0.15");
    expect(screen.getByLabelText("Količina sestavine 2")).toHaveValue("0.02");
    expect(screen.getByText(/Predlog še ni shranjen/)).toBeInTheDocument();
    expect(screen.queryByText(/Sistemska opozorila|OPOZORILO: Potreben je strog ročni pregled/)).not.toBeInTheDocument();
    expect(screen.getAllByText(/približen AI-predlog/)).toHaveLength(1);

    const save = screen.getByRole("button", { name: "Ustvari in uporabi normativ" });
    expect(save).toBeDisabled();
    const bulkSelect = screen.getAllByRole("combobox").find(element => element.querySelector('option[value="food"]'))!;
    fireEvent.change(bulkSelect, { target: { value: "food" } });
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
      editedItems: [
        { name: "Fižol", quantity: "0.15", unit: "KGM", existingArticleId: null },
        { name: "Rdeča čebula", quantity: "0.02", unit: "KGM", existingArticleId: null },
      ],
    });
  });

  it("removes surplus beans, reuses the existing oil, adds salt, and saves only reviewed rows", async () => {
    fetchMock.mockImplementation(async (url: string) => new Response(JSON.stringify(
      url.endsWith("/uporabi") ? { ok: true } : {
        ...proposal,
        items: [
          { ...proposal.items[0], name: "Fižol", quantity: 0.15 },
          { ...proposal.items[0], name: "Črni fižol", quantity: 0.15 },
          { ...proposal.items[0], name: "Rdeči fižol", quantity: 0.15 },
          { ...proposal.items[0], name: "Olje", quantity: 0.01, unit: "LTR" },
        ],
      },
    ), { status: 200, headers: { "Content-Type": "application/json" } }));
    const onApplySuccess = vi.fn();
    render(<SmartNormativeProposalDialog open articleId={51} articleName="Fižolova solata – velika"
      availableIngredients={[{ id: 73, ime: "Olje sončnično", enotaMere: "LTR" }]}
      onOpenChange={vi.fn()} onApplySuccess={onApplySuccess} />);
    await screen.findByLabelText("Ime sestavine 1");
    fireEvent.click(screen.getAllByRole("button", { name: "Odstrani" })[2]!);
    fireEvent.click(screen.getAllByRole("button", { name: "Odstrani" })[1]!);
    fireEvent.change(screen.getByLabelText("Nabavni artikel za sestavino 2"), { target: { value: "73" } });
    expect(screen.getByLabelText("Ime sestavine 2")).toHaveValue("Olje sončnično");
    fireEvent.click(screen.getByRole("button", { name: /Dodaj sestavino/ }));
    fireEvent.change(screen.getByLabelText("Ime sestavine 3"), { target: { value: "Sol" } });
    fireEvent.change(screen.getByLabelText("Količina sestavine 3"), { target: { value: "0,003" } });
    const bulkSelect = screen.getAllByRole("combobox").find(element => element.querySelector('option[value="food"]'))!;
    fireEvent.change(bulkSelect, { target: { value: "food" } });
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Ustvari in uporabi normativ" }));
    await waitFor(() => expect(onApplySuccess).toHaveBeenCalledOnce());
    const [, options] = fetchMock.mock.lastCall as [string, RequestInit];
    expect(JSON.parse(String(options.body))).toMatchObject({
      editedItems: [
        { name: "Fižol", quantity: "0.15", unit: "KGM", existingArticleId: null },
        { name: "Olje sončnično", quantity: "0.01", unit: "LTR", existingArticleId: 73 },
        { name: "Sol", quantity: "0.003", unit: "KGM", existingArticleId: null },
      ],
      classifications: [{ index: 0, taxCategory: "food" }, { index: 2, taxCategory: "food" }],
    });
  });
});