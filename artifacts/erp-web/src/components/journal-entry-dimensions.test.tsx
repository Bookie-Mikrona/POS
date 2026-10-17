import { cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { JournalEntryDimensions } from "./journal-entry-dimensions";

afterEach(cleanup);

describe("journal entry dimensions", () => {
  it("shows every supplied dimension with a descriptive type label", () => {
    render(<JournalEntryDimensions costCenterNames={["Kuhinja", "Bar"]} projectNames={["Prenova"]} departmentNames={["Gostinstvo"]} />);
    for (const label of ["Stroškovno mesto: Kuhinja", "Stroškovno mesto: Bar", "Projekt: Prenova", "Oddelek: Gostinstvo"]) {
      expect(screen.getByLabelText(label)).toBeVisible();
      expect(screen.getByLabelText(label)).toHaveAttribute("title", label);
    }
  });

  it("renders no badges for an entry without dimensions", () => {
    const { container } = render(<JournalEntryDimensions costCenterNames={[]} projectNames={[]} departmentNames={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("handles omitted list-only fields on detail responses", () => {
    const { container } = render(<JournalEntryDimensions />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows only the dimension types actually present", () => {
    render(<JournalEntryDimensions projectNames={["Prenova"]} />);
    expect(screen.getByLabelText("Projekt: Prenova")).toBeVisible();
    expect(screen.queryByLabelText(/Stroškovno mesto|Oddelek/)).not.toBeInTheDocument();
  });

  it("distinguishes identical names used by different dimension types", () => {
    render(<JournalEntryDimensions costCenterNames={["Gostinstvo"]} projectNames={["Gostinstvo"]} departmentNames={["Gostinstvo"]} />);
    expect(screen.getAllByText("Gostinstvo")).toHaveLength(3);
  });
});
