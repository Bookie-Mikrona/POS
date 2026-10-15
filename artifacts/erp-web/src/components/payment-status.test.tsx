import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentStatus, PaymentReversalLink } from "./payment-status";

afterEach(cleanup);

describe("payment void evidence", () => {
  it("shows the void operation date in Ljubljana, not the payment date", () => {
    render(<PaymentStatus payment={{ status: "void", voidedAt: "2026-10-14T23:30:00Z" }} />);
    expect(screen.getByText("Razveljavljeno")).toBeVisible();
    expect(screen.getByText("Razveljavljeno 15.10.2026")).toHaveAttribute("dateTime", "2026-10-14T23:30:00.000Z");
  });

  it.each([null, undefined, "invalid"])("does not invent a missing date (%s)", voidedAt => {
    render(<PaymentStatus payment={{ status: "void", voidedAt }} />);
    expect(screen.getByText("Datum razveljavitve ni zabeležen")).toBeVisible();
  });

  it.each(["posted", "draft"] as const)("does not show void evidence on %s payments", status => {
    render(<PaymentStatus payment={{ status, voidedAt: "2026-10-15T12:00:00Z" }} />);
    expect(screen.queryByText(/Razveljavljeno|Datum razveljavitve/)).not.toBeInTheDocument();
  });

  it("links to the reversal, not the original journal", () => {
    render(<PaymentReversalLink payment={{ status: "void", reversalEntryId: "reversal-entry" }} />);
    expect(screen.getByRole("link", { name: "Odpri storno temeljnico" }))
      .toHaveAttribute("href", "/temeljnice?id=reversal-entry");
  });

  it.each(["void", "posted"] as const)("does not render a broken link for %s", status => {
    render(<PaymentReversalLink payment={{ status, reversalEntryId: null }} />);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
