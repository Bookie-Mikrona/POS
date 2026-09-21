import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { NormativeProposalReview } from "./NormativeProposalReview";
import type { NormativeProposalDraft } from "@/lib/normative-proposal-draft";

const draft: NormativeProposalDraft = {
  version: 1, artikelId: 8, targetName: "Testna pizza", generatedAt: "2025-01-01T12:00:00.000Z",
  selected: [
    { normativRowId: 10, proposalToken: "very-long-signed-token-that-must-not-be-a-dom-id", ingredientName: "Moka", oldQuantity: 0.2, newQuantity: 0.25, unit: "kg", sourceTitle: "Javni recept za moko", sourceUrl: "https://example.com/moka" },
    { normativRowId: 11, proposalToken: "other-signed-token", ingredientName: "Sir", oldQuantity: 0.1, newQuantity: 0.12, unit: "kg", sourceTitle: "Javni recept za sir", sourceUrl: "https://example.com/sir" },
  ],
};

function ReviewHarness({ staleMessage = null, onApply = vi.fn(), onCancel = vi.fn() }: { staleMessage?: string | null; onApply?: () => void; onCancel?: () => void }) {
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  return <NormativeProposalReview draft={draft} confirmedTokens={confirmed} loading={false} staleMessage={staleMessage}
    onConfirmationChange={(token, checked) => setConfirmed(previous => {
      const next = new Set(previous);
      if (checked) next.add(token); else next.delete(token);
      return next;
    })}
    onApply={onApply} onCancel={onCancel} />;
}

describe("NormativeProposalReview", () => {
  it("requires every individual confirmation before applying and displays local preview/source", () => {
    const apply = vi.fn();
    render(<ReviewHarness onApply={apply} />);
    const applyButton = screen.getByRole("button", { name: "Uporabi potrjene spremembe" });
    expect(applyButton).toHaveProperty("disabled", true);
    expect(screen.getByText("Moka: 0.2 kg → 0.25 kg")).toBeTruthy();
    const source = screen.getByRole("link", { name: /odpri vir za moka: javni recept za moko/i });
    expect(source.getAttribute("href")).toBe("https://example.com/moka");
    expect(screen.getByRole("checkbox", { name: /potrjujem spremembo za moka/i }).getAttribute("id")).toBe("confirm-proposal-10-0");
    fireEvent.click(screen.getByRole("checkbox", { name: /potrjujem spremembo za moka/i }));
    expect(applyButton).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /potrjujem spremembo za sir/i }));
    expect(applyButton).toHaveProperty("disabled", false);
    fireEvent.click(applyButton);
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("renders a stale rerun instruction without applying or cancelling automatically", () => {
    const apply = vi.fn();
    const cancel = vi.fn();
    render(<ReviewHarness staleMessage="Predlog je zastarel." onApply={apply} onCancel={cancel} />);
    expect(screen.getByRole("alert").textContent).toContain("Predlog je zastarel. Primerjavo zaženite znova");
    expect(apply).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });
});