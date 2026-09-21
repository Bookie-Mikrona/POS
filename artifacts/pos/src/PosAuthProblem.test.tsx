import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PosAuthProblem } from "./App";

describe("PosAuthProblem", () => {
  it("prijavljenemu uporabniku brez POS-vloge pokaže jasno pojasnilo in menjavo računa", () => {
    const logout = vi.fn();
    render(<PosAuthProblem status="forbidden" onLogout={logout} />);

    expect(screen.getByRole("heading", { name: "Nimate dostopa do POS sistema" })).toBeTruthy();
    expect(screen.getByText(/nima aktivne POS-vloge/i)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /odjava in menjava računa/i }));
    expect(logout).toHaveBeenCalledOnce();
  });
});