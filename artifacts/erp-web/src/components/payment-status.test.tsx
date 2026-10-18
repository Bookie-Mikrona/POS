import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { PaymentStatus, PaymentReversalLink, PaymentVoidDetails } from "./payment-status";

afterEach(cleanup);

describe("payment void evidence", () => {
  it("shows the reason and resolved actor, not a raw identity", () => {
    render(<PaymentVoidDetails payment={{ status: "void", voidReason: "Napačen račun\nPonovljeno plačilo",
      voidedBy: "user_private_id", voidedByName: "Testni Računovodja" }} />);
    expect(screen.getByText(/Napačen račun/)).toBeVisible();
    expect(screen.getByText("Testni Računovodja")).toBeVisible();
    expect(screen.queryByText("user_private_id")).not.toBeInTheDocument();
  });

  it("explicitly marks missing historical evidence", () => {
    render(<PaymentVoidDetails payment={{ status: "void", voidReason: null, voidedBy: null, voidedByName: null }} />);
    expect(screen.getByText("Razlog razveljavitve ni zabeležen")).toBeVisible();
    expect(screen.getByText("Izvajalec razveljavitve ni zabeležen")).toBeVisible();
  });

  it("distinguishes an unresolved name from a missing actor record", () => {
    render(<PaymentVoidDetails payment={{ status: "void", voidReason: "Popravek", voidedBy: "deleted", voidedByName: null }} />);
    expect(screen.getByText("Ime izvajalca ni na voljo")).toBeVisible();
    expect(screen.queryByText("Izvajalec razveljavitve ni zabeležen")).not.toBeInTheDocument();
  });

  it.each(["draft", "posted"] as const)("hides void details for %s payments", status => {
    const { container } = render(<PaymentVoidDetails payment={{ status, voidReason: "stale", voidedByName: "stale" }} />);
    expect(container).toBeEmptyDOMElement();
  });
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
