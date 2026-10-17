import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { AccountDimensionHint } from "./account-dimension-hint";

afterEach(cleanup);

const optionalAccount = {
  requiresCostCenter: false,
  requiresProject: false,
  requiresPartner: false,
};

describe("early account dimension hint", () => {
  it.each([
    [{ requiresCostCenter: true }, "stroškovno mesto"],
    [{ requiresProject: true }, "projekt"],
    [{ requiresPartner: true }, "partner"],
    [{ requiresCostCenter: true, requiresProject: true, requiresPartner: true }, "stroškovno mesto, projekt, partner"],
    [{ costCenterPolicy: "required" as const }, "stroškovno mesto"],
  ])("shows requirements without any amount or dimension input: %j", (account, dimensions) => {
    render(<AccountDimensionHint account={{ ...optionalAccount, ...account }} />);
    const hint = screen.getByText(`Ta konto zahteva: ${dimensions}.`);
    expect(hint).toBeVisible();
    expect(hint.closest("p")).toHaveClass("text-blue-800");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("updates immediately when switching accounts and clears for an optional or empty account", () => {
    const { rerender } = render(<AccountDimensionHint />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<AccountDimensionHint account={{ ...optionalAccount, requiresProject: true }} />);
    expect(screen.getByText("Ta konto zahteva: projekt.")).toBeVisible();
    rerender(<AccountDimensionHint account={{ ...optionalAccount, requiresPartner: true }} />);
    expect(screen.queryByText("Ta konto zahteva: projekt.")).not.toBeInTheDocument();
    expect(screen.getByText("Ta konto zahteva: partner.")).toBeVisible();
    rerender(<AccountDimensionHint account={optionalAccount} />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    rerender(<AccountDimensionHint />);
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
  });

  it.each(["allowed", "not_allowed"] as const)(
    "respects explicit cost-center policy %s over the legacy required flag",
    (costCenterPolicy) => {
      render(<AccountDimensionHint account={{ ...optionalAccount, requiresCostCenter: true, costCenterPolicy, requiresPartner: true }} />);
      expect(screen.getByText("Ta konto zahteva: partner.")).toBeVisible();
      expect(screen.queryByText(/stroškovno mesto/)).not.toBeInTheDocument();
    },
  );
});
