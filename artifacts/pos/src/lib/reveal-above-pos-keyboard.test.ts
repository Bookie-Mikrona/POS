import { afterEach, describe, expect, it, vi } from "vitest";
import { prikaziPoljeNadPosTipkovnico } from "./reveal-above-pos-keyboard";

function pravokotnik(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 300,
    width: 300,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

describe("prikaziPoljeNadPosTipkovnico", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("premakne drsni obrazec, da je aktivno polje nad Bookie tipkovnico", () => {
    const vsebnik = document.createElement("div");
    const polje = document.createElement("input");
    const tipkovnica = document.createElement("div");
    tipkovnica.dataset.posKeyboardPanel = "";
    vsebnik.append(polje);
    document.body.append(vsebnik, tipkovnica);

    Object.defineProperties(vsebnik, {
      scrollHeight: { value: 800 },
      clientHeight: { value: 300 },
    });
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      overflowY: "auto",
    } as CSSStyleDeclaration);
    vi.spyOn(polje, "getBoundingClientRect").mockReturnValue(pravokotnik(500, 540));
    vi.spyOn(tipkovnica, "getBoundingClientRect").mockReturnValue(pravokotnik(400, 800));
    const scrollBy = vi.fn();
    vsebnik.scrollBy = scrollBy;

    prikaziPoljeNadPosTipkovnico(polje);

    expect(scrollBy).toHaveBeenCalledWith({ top: 320, behavior: "smooth" });
  });

  it("ne premika polja, ki je že v celoti vidno", () => {
    const polje = document.createElement("input");
    const tipkovnica = document.createElement("div");
    tipkovnica.dataset.posKeyboardPanel = "";
    document.body.append(polje, tipkovnica);
    vi.spyOn(polje, "getBoundingClientRect").mockReturnValue(pravokotnik(120, 160));
    vi.spyOn(tipkovnica, "getBoundingClientRect").mockReturnValue(pravokotnik(400, 800));
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);

    prikaziPoljeNadPosTipkovnico(polje);

    expect(scrollBy).not.toHaveBeenCalled();
  });
});