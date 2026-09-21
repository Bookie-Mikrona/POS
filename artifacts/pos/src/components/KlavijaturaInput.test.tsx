import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { KlavijaturaInput } from "./KlavijaturaInput";

function nastaviKazalec(vrednost: "coarse" | "fine") {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query === "(pointer: fine)" ? vrednost === "fine" : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

describe("KlavijaturaInput", () => {
  it("na zaslonu na dotik ohrani običajen vnos za sistemsko tipkovnico", () => {
    nastaviKazalec("coarse");
    const onChange = vi.fn();
    render(<KlavijaturaInput value="1" onChange={onChange} naslov="Enot v paketu" />);

    const input = screen.getByLabelText("Enot v paketu");
    expect(input.hasAttribute("readonly")).toBe(false);
    expect(input.getAttribute("inputmode")).not.toBe("none");
    expect(input.hasAttribute("data-pos-keyboard-dismiss-disabled")).toBe(false);
    fireEvent.change(input, { target: { value: "12" } });
    expect(onChange).toHaveBeenCalledWith("12");
    expect(screen.queryByText("presledek")).toBeNull();
  });

  it("ob fizični tipkovnici ohrani običajen vnos", () => {
    nastaviKazalec("fine");
    const onChange = vi.fn();
    render(<KlavijaturaInput value="" onChange={onChange} naslov="Naziv" />);

    const input = screen.getByLabelText("Naziv");
    expect(input.hasAttribute("readonly")).toBe(false);
    fireEvent.change(input, { target: { value: "Kava" } });
    expect(onChange).toHaveBeenCalledWith("Kava");
  });
});