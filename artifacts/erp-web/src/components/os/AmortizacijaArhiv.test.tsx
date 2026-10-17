import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { AmortizacijaArhiv } from "./AmortizacijaArhiv";

afterEach(cleanup);
const heads = [
  { id: "1", leto: 2026, doMeseca: 6, skupajAmortizacija: "1234.56", status: "odprt" as const, updatedAt: "2026-06-30T12:00:00Z" },
  { id: "2", leto: 2025, doMeseca: 12, skupajAmortizacija: "0.00", status: "zakljucen" as const, updatedAt: "2026-01-03T12:00:00Z" },
];
const props = { obracuni: heads, isLoading: false, isError: false, onRetry: vi.fn(), leto: 2026, onSelect: vi.fn() };

describe("arhiv shranjenih obračunov", () => {
  it("shows every saved year, month, saved amount, colored status and update date", () => {
    render(<AmortizacijaArhiv {...props} />);
    expect(screen.getAllByRole("columnheader").map((el) => el.textContent)).toEqual([
      "Leto", "Do meseca", "Skupaj amortizacija", "Status", "Datum posodobitve",
    ]);
    const rows = screen.getAllByRole("row");
    expect(within(rows[1]).getByText("6")).toBeTruthy();
    expect(within(rows[1]).getByText(/234,56/)).toBeTruthy();
    expect(within(rows[2]).getByText("0,00 €")).toBeTruthy();
    expect(screen.getByText("Odprt").className).toContain("bg-yellow-50");
    expect(screen.getByText("Zaključen").className).toContain("bg-green-50");
    expect(within(rows[1]).getByText("30.06.2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Prikaži sredstva za leto 2026" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("selects a saved year using a real, keyboard-accessible button", () => {
    render(<AmortizacijaArhiv {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Prikaži sredstva za leto 2025" }));
    expect(props.onSelect).toHaveBeenCalledWith(heads[1]);
  });

  it("distinguishes loading, empty archive and retryable failure", () => {
    const { rerender } = render(<AmortizacijaArhiv {...props} obracuni={undefined} isLoading />);
    expect(screen.getByRole("status").textContent).toContain("Nalaganje");
    rerender(<AmortizacijaArhiv {...props} obracuni={[]} />);
    expect(screen.getByText("Za to podjetje še ni shranjenih obračunov.")).toBeTruthy();
    rerender(<AmortizacijaArhiv {...props} isError />);
    expect(screen.getByRole("alert").textContent).toContain("ni bilo mogoče naložiti");
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));
    expect(props.onRetry).toHaveBeenCalled();
    expect(screen.queryByRole("table")).toBeNull();
  });
});
