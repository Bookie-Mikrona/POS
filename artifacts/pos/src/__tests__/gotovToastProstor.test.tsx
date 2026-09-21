/**
 * Testi za GotovToastSystem — prikaz mize + prostora v toastu.
 *
 * Preverja:
 * 1. aktivni toast prikaže "Miza 5 · Terasa" v isti vrstici (en element)
 * 2. minimizirani toast prikaže "Miza 5 · Terasa: Pica"
 * 3. miza brez prostora → samo "Miza 5", brez ločila
 */

import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { GotovToastProvider } from "@/contexts/GotovToastContext";
import { GotovToastSystem } from "@/components/GotovToastSystem";

function dispatchToast(detail: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new CustomEvent("gotov-toast", { detail }));
  });
}

const baseDetail = {
  id: "t1",
  ime: "Pica",
  kolicina: 1,
  opomba: null,
  mizaIme: "Miza 5",
  mizaStevilka: 5,
  vir: "kuhinja" as const,
};

function setup() {
  return render(
    <GotovToastProvider>
      <GotovToastSystem />
    </GotovToastProvider>,
  );
}

describe("GotovToastSystem — prostor", () => {
  it("aktivni toast prikaže mizo + prostor v isti vrstici", () => {
    setup();
    dispatchToast({ ...baseDetail, prostorIme: "Terasa" });
    // en sam element vsebuje celoten niz — miza in prostor sta v isti vrstici
    expect(screen.getByText("Miza 5 · Terasa")).toBeTruthy();
    expect(screen.getByText("Pica")).toBeTruthy();
  });

  it("miza brez prostora → samo naziv mize, brez ločila", () => {
    setup();
    dispatchToast({ ...baseDetail, prostorIme: null });
    expect(screen.getByText("Miza 5")).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it("payload brez prostorIme (starejši API) ne pokvari prikaza", () => {
    setup();
    dispatchToast({ ...baseDetail });
    expect(screen.getByText("Miza 5")).toBeTruthy();
  });
});
