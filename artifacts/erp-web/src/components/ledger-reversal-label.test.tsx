import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerReversalLabel } from "./ledger-reversal-label";

afterEach(cleanup);

describe("ledger reversal label", () => {
  it("labels a reversal and links to its original even outside ledger filters", () => {
    render(<LedgerReversalLabel isReversal reversalOf="original-entry" isReversed={false} reversedBy={null} />);
    expect(screen.getByText("STORNO")).toBeVisible();
    expect(screen.getByRole("link", { name: "Original" })).toHaveAttribute("href", "/temeljnice?id=original-entry");
  });

  it("does not label a normal entry", () => {
    const { container } = render(<LedgerReversalLabel isReversal={false} reversalOf={null} isReversed={false} reversedBy={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("labels a reversed original separately and links directly to its reversal", () => {
    render(<LedgerReversalLabel isReversal={false} reversalOf={null} isReversed reversedBy="reversal-entry" />);
    expect(screen.getByText("STORNIRANO")).toBeVisible();
    expect(screen.queryByText("STORNO")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Storno" })).toHaveAttribute("href", "/temeljnice?id=reversal-entry");
  });

  it("keeps the reversed label without inventing a link when evidence is unavailable", () => {
    render(<LedgerReversalLabel isReversal={false} reversalOf={null} isReversed reversedBy={null} />);
    expect(screen.getByText("STORNIRANO")).toBeVisible();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});