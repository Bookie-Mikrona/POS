/**
 * Testi za formatMizaProstor — enoten prikaz mize s prostorom.
 */

import { describe, it, expect } from "vitest";
import { formatMizaProstor } from "@/lib/formatMizaProstor";

describe("formatMizaProstor", () => {
  it("miza z imenom in prostorom → 'Ime · Prostor'", () => {
    expect(formatMizaProstor({ mizaIme: "Miza 5", mizaStevilka: 5, prostorIme: "Terasa" }))
      .toBe("Miza 5 · Terasa");
  });

  it("miza brez imena (samo številka) s prostorom → 'Miza N · Prostor'", () => {
    expect(formatMizaProstor({ mizaIme: null, mizaStevilka: 7, prostorIme: "Notranjost" }))
      .toBe("Miza 7 · Notranjost");
  });

  it("miza brez prostora → samo naziv mize, brez ločila", () => {
    expect(formatMizaProstor({ mizaIme: "Šank 1", mizaStevilka: 2, prostorIme: null }))
      .toBe("Šank 1");
    expect(formatMizaProstor({ mizaIme: null, mizaStevilka: 2, prostorIme: null }))
      .toBe("Miza 2");
  });

  it("prostorIme undefined se obravnava kot brez prostora", () => {
    expect(formatMizaProstor({ mizaIme: "Miza 3", mizaStevilka: 3 }))
      .toBe("Miza 3");
  });

  it("brez mize → privzeti fallback 'Direktna prodaja'", () => {
    expect(formatMizaProstor({ mizaIme: null, mizaStevilka: null, prostorIme: null }))
      .toBe("Direktna prodaja");
  });

  it("brez mize s prostorIme (teoretično) → še vedno fallback, ne '· Prostor'", () => {
    expect(formatMizaProstor({ mizaIme: null, mizaStevilka: null, prostorIme: "Terasa" }))
      .toBe("Direktna prodaja");
  });

  it("lasten fallback (npr. '?' za toast)", () => {
    expect(formatMizaProstor({ mizaIme: null, mizaStevilka: null, prostorIme: null }, "?"))
      .toBe("?");
  });

  it("prazen niz prostorIme → brez ločila", () => {
    expect(formatMizaProstor({ mizaIme: "Miza 5", mizaStevilka: 5, prostorIme: "" }))
      .toBe("Miza 5");
  });
});
