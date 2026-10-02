import { render, screen, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { LedgerReversalLabel } from "./ledger-reversal-label";

afterEach(cleanup);

describe("ledger reversal label", () => {
  it("labels a reversal and links to its original even outside ledger filters", () => {
    render(<LedgerReversalLabel isReversal reversalOf="original-entry" />);
    expect(screen.getByText("STORNO")).toBeVisible();
    expect(screen.getByRole("link", { name: "Original" })).toHaveAttribute("href", "/temeljnice?id=original-entry");
  });

  it("does not label a normal or reversed original entry as STORNO", () => {
    const { container } = render(<LedgerReversalLabel isReversal={false} reversalOf={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});