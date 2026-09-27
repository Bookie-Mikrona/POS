import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ToGoArticlePicker } from "./ToGoArticlePicker";

const articles = [
  { id: 1, ime: "Karton za pico", aktiven: true, prodajniArtikel: true },
  { id: 2, ime: "Aluminijasta folija 30 cm", aktiven: true, prodajniArtikel: true },
  { id: 3, ime: "Folija samo za nabavo", aktiven: true, prodajniArtikel: false },
  { id: 4, ime: "Neaktivna folija", aktiven: false, prodajniArtikel: true },
];

describe("ToGoArticlePicker", () => {
  it("poišče aktivni prodajni artikel po več delih imena in ga doda", () => {
    const onSelect = vi.fn();
    render(<ToGoArticlePicker articles={articles} selectedIds={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("button", { name: /Dodaj artikel za To Go/i }));
    fireEvent.change(screen.getByRole("textbox", { name: /Poišči artikel za To Go/i }), {
      target: { value: "alu folija" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Aluminijasta folija 30 cm" }));
    expect(onSelect).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("textbox", { name: /Poišči artikel za To Go/i })).toBeNull();
  });

  it("ne ponudi že dodanih, neaktivnih ali samo nabavnih artiklov", () => {
    render(<ToGoArticlePicker articles={articles} selectedIds={[1]} onSelect={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Dodaj artikel za To Go/i }));
    expect(screen.queryByRole("button", { name: "Karton za pico" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Folija samo za nabavo" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Neaktivna folija" })).toBeNull();
    expect(screen.getByRole("button", { name: "Aluminijasta folija 30 cm" })).toBeTruthy();
  });
});