import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MenuNav } from "./MenuNav";

const kategorije = [
  { id: 1, ime: "Zajtrki", barva: "#aa0000", oddelek: "Hrana" },
  { id: 2, ime: "Juhe", barva: "#00aa00", oddelek: "Hrana" },
  { id: 3, ime: "Kava", barva: "#0000aa", oddelek: "Kava" },
  { id: 4, ime: "Brez oddelka", barva: "#333333" },
];

describe("MenuNav", () => {
  it("varianta A: oddelki, izbira oddelka izbere njegovo prvo kategorijo, kategorije oddelka so vidne", () => {
    const onChange = vi.fn();
    const { rerender } = render(<MenuNav variant="A" kategorije={kategorije} active="pogosto" onChange={onChange} kosiloAktivno />);
    expect(screen.getByTestId("menu-nav-pogosto")).toBeTruthy();
    expect(screen.getByTestId("tab-dnevno-kosilo")).toBeTruthy();
    expect(screen.getByTestId("menu-nav-oddelek-Drugo")).toBeTruthy(); // kategorija brez oddelka je v »Drugo«
    fireEvent.click(screen.getByTestId("menu-nav-oddelek-Hrana"));
    expect(onChange).toHaveBeenCalledWith("1");
    rerender(<MenuNav variant="A" kategorije={kategorije} active="1" onChange={onChange} kosiloAktivno={false} />);
    expect(screen.getByRole("button", { name: "Juhe" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Kava" })?.closest("[data-testid='menu-nav-a']")).toBeTruthy();
    expect(screen.queryByTestId("tab-dnevno-kosilo")).toBeNull();
  });

  it("varianta B: vse kategorije so dosegljive v dveh dotikih prek spodnjega lista", () => {
    const onChange = vi.fn();
    render(<MenuNav variant="B" kategorije={kategorije} active="all" onChange={onChange} kosiloAktivno={false} />);
    fireEvent.click(screen.getByTestId("menu-nav-kategorije"));
    const mreza = screen.getByTestId("menu-nav-b-mreza");
    expect(mreza.querySelectorAll("button")).toHaveLength(kategorije.length);
    fireEvent.click(screen.getByRole("button", { name: "Kava" }));
    expect(onChange).toHaveBeenCalledWith("3");
  });

  it("varianta C: vse kategorije so vedno vidne v stranski vrstici", () => {
    const onChange = vi.fn();
    render(<MenuNav variant="C" kategorije={kategorije} active="all" onChange={onChange} kosiloAktivno />);
    const vrstica = screen.getByTestId("menu-nav-c");
    for (const k of kategorije) expect(vrstica.textContent).toContain(k.ime);
    fireEvent.click(screen.getByRole("button", { name: "Juhe" }));
    expect(onChange).toHaveBeenCalledWith("2");
    fireEvent.click(screen.getByTestId("menu-nav-pogosto"));
    expect(onChange).toHaveBeenLastCalledWith("pogosto");
  });
});
