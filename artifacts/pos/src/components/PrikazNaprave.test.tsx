import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PrikazIzbire, PRIKAZ_PRIVZETO } from "./PrikazNaprave";

describe("PrikazIzbire", () => {
  it("privzeto prikaže obstoječe nastavitve (Trenutno, Privzeto, Staro)", () => {
    render(<PrikazIzbire vrednost={PRIKAZ_PRIVZETO} onChange={() => {}} />);
    expect(screen.getByRole("radio", { name: "Trenutno" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Privzeto" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByRole("radio", { name: "Staro" }).getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText(/Velja samo za to napravo/)).toBeTruthy();
  });

  it("spremeni samo izbrano nastavitev", () => {
    const onChange = vi.fn();
    render(<PrikazIzbire vrednost={PRIKAZ_PRIVZETO} onChange={onChange} />);
    fireEvent.click(screen.getByRole("radio", { name: "Novo" }));
    expect(onChange).toHaveBeenCalledWith({ ...PRIKAZ_PRIVZETO, prikazNarocila: "novo" });
    fireEvent.click(screen.getByRole("radio", { name: "Seznam" }));
    expect(onChange).toHaveBeenLastCalledWith({ ...PRIKAZ_PRIVZETO, gostotaArtiklov: "seznam" });
  });
});
