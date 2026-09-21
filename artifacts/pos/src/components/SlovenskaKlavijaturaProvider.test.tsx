import { act, fireEvent, render, screen } from "@testing-library/react";
import { useRef, useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { SlovenskaKlavijaturaProvider } from "./SlovenskaKlavijaturaProvider";
import { Dialog, DialogContent, DialogTitle } from "./ui/dialog";

function namestiTouchNapravo() {
  vi.stubGlobal("matchMedia", vi.fn((query: string) => ({
    matches: query !== "(pointer: fine)",
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })));
}

function KontroliranVnos() {
  const [vrednost, setVrednost] = useState("Kava");
  return (
    <label>
      Naziv
      <input value={vrednost} onChange={event => setVrednost(event.target.value)} />
      <output>{vrednost}</output>
    </label>
  );
}

function ZamenljivVnos() {
  const [vrednost, setVrednost] = useState("");
  return (
    <label>
      Količina
      <input
        key={vrednost}
        value={vrednost}
        onChange={event => setVrednost(event.target.value)}
      />
      <output>{vrednost || "prazno"}</output>
    </label>
  );
}

function VnosVDDialogu() {
  const [odprt, setOdprt] = useState(true);
  const [datum, setDatum] = useState("");
  const [dobavitelj, setDobavitelj] = useState("");
  const [dobaviteljOdprt, setDobaviteljOdprt] = useState(false);
  const dobaviteljRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={odprt} onOpenChange={setOdprt}>
      <DialogContent>
        <DialogTitle>Uredi prejemnico</DialogTitle>
        <input
          aria-label="Datum prejemnice"
          value={datum}
          onChange={event => setDatum(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") dobaviteljRef.current?.focus();
          }}
        />
        <input
          ref={dobaviteljRef}
          aria-label="Dobavitelj"
          data-pos-keyboard-readonly-trigger
          readOnly={!dobaviteljOdprt}
          value={dobavitelj}
          onFocus={() => setDobaviteljOdprt(true)}
          onChange={event => setDobavitelj(event.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}

function NumericniVnosVDDialogu() {
  const [datum, setDatum] = useState("");
  const [kolicina, setKolicina] = useState("");
  const kolicinaRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open>
      <DialogContent>
        <DialogTitle>Nova prejemnica</DialogTitle>
        <input
          aria-label="Datum"
          value={datum}
          onChange={event => setDatum(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") kolicinaRef.current?.focus();
          }}
        />
        <input
          ref={kolicinaRef}
          aria-label="Količina"
          type="number"
          inputMode="decimal"
          value={kolicina}
          onChange={event => setKolicina(event.target.value)}
        />
      </DialogContent>
    </Dialog>
  );
}

describe("SlovenskaKlavijaturaProvider", () => {
  it("na dotik preusmeri običajen POS vnos v Bookie tipkovnico", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <KontroliranVnos />
      </SlovenskaKlavijaturaProvider>,
    );

    fireEvent.pointerDown(screen.getByLabelText("Naziv"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "@" }));
    expect(screen.getByText("Kava@")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Potrdi" }));

    expect(screen.getByText("Kava@")).toBeTruthy();
  });

  it("preklic povrne vrednost iz časa odprtja", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <KontroliranVnos />
      </SlovenskaKlavijaturaProvider>,
    );

    fireEvent.pointerDown(screen.getByLabelText("Naziv"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "@" }));
    expect(screen.getByText("Kava@")).toBeTruthy();
    const preklici = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-pos-keyboard-overlay] button"),
    ).find(button => button.textContent === "Prekliči");
    fireEvent.click(preklici!);
    expect(screen.getByText("Kava")).toBeTruthy();
  });

  it("sprejme več znakov brez vmesnega potrjevanja tudi ob zamenjavi DOM inputa", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <ZamenljivVnos />
      </SlovenskaKlavijaturaProvider>,
    );

    fireEvent.pointerDown(screen.getByLabelText("Količina"));
    fireEvent.pointerDown(screen.getByRole("button", { name: "1" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "2" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: "3" }));

    expect(screen.getByText("123")).toBeTruthy();
    expect(screen.getByText("presledek")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Potrdi" }));
    expect(screen.getByText("123")).toBeTruthy();
  });

  it("ne prevzame gesel in sistemskih datumskih vnosov", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <input aria-label="Geslo" type="password" />
        <input aria-label="Datum" type="date" />
      </SlovenskaKlavijaturaProvider>,
    );

    fireEvent.pointerDown(screen.getByLabelText("Geslo"));
    fireEvent.pointerDown(screen.getByLabelText("Datum"));
    expect(screen.queryByText("presledek")).toBeNull();
  });

  it("tipkanje z Bookie tipkovnico ne zapre odprtega Radix dialoga", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <VnosVDDialogu />
      </SlovenskaKlavijaturaProvider>,
    );

    fireEvent.pointerDown(screen.getByLabelText("Datum prejemnice"));
    expect(document.documentElement.hasAttribute("data-pos-keyboard-active")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.getByRole("dialog")).toBeTruthy();

    const tipkaEna = document.querySelector<HTMLButtonElement>("[data-pos-keyboard-overlay] button");
    expect(tipkaEna?.textContent).toBe("1");
    fireEvent.pointerDown(tipkaEna!);

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Uredi prejemnico")).toBeTruthy();
    expect(screen.getByLabelText("Datum prejemnice").getAttribute("value")).toBe("1");
  });

  it("programski fokus odpre tipkovnico, Potrdi pa nadaljuje na naslednje polje", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <VnosVDDialogu />
      </SlovenskaKlavijaturaProvider>,
    );

    act(() => screen.getByLabelText("Datum prejemnice").focus());
    const overlay = document.querySelector<HTMLElement>("[data-pos-keyboard-overlay]");
    expect(overlay?.textContent).toContain("Datum prejemnice");

    const potrdi = overlay?.querySelector<HTMLButtonElement>('button[title="Potrdi"]');
    fireEvent.click(potrdi!);
    expect(document.querySelector("[data-pos-keyboard-overlay]")?.textContent).toContain("Dobavitelj");

    const tipkaA = Array.from(document.querySelectorAll<HTMLButtonElement>("[data-pos-keyboard-overlay] button"))
      .find(button => button.textContent === "a");
    fireEvent.pointerDown(tipkaA!);
    expect(screen.getByLabelText("Dobavitelj").getAttribute("value")).toBe("a");
  });

  it("pred fokusom naslednjega numeričnega polja prepreči sistemsko tipkovnico", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <NumericniVnosVDDialogu />
      </SlovenskaKlavijaturaProvider>,
    );

    act(() => screen.getByLabelText("Datum").focus());
    const potrdi = document.querySelector<HTMLButtonElement>(
      '[data-pos-keyboard-overlay] button[title="Potrdi"]',
    );
    fireEvent.click(potrdi!);

    const kolicina = screen.getByLabelText("Količina") as HTMLInputElement;
    expect(document.querySelector("[data-pos-keyboard-overlay]")?.textContent).toContain("Količina");
    expect(kolicina.type).toBe("text");
    expect(kolicina.readOnly).toBe(true);
    expect(kolicina.inputMode).toBe("none");
  });

  it("ob Prekliči najprej umakne fokus in šele nato odklene trenutno polje", () => {
    namestiTouchNapravo();
    render(
      <SlovenskaKlavijaturaProvider>
        <VnosVDDialogu />
      </SlovenskaKlavijaturaProvider>,
    );

    const datum = screen.getByLabelText("Datum prejemnice") as HTMLInputElement;
    act(() => datum.focus());
    expect(datum.readOnly).toBe(true);
    expect(datum.inputMode).toBe("none");

    const preklici = Array.from(
      document.querySelectorAll<HTMLButtonElement>("[data-pos-keyboard-overlay] button"),
    ).find(button => button.textContent === "Prekliči");
    fireEvent.click(preklici!);

    expect(document.querySelector("[data-pos-keyboard-overlay]")).toBeNull();
    expect(document.documentElement.hasAttribute("data-pos-keyboard-active")).toBe(false);
    expect(document.activeElement).not.toBe(datum);
    expect(datum.readOnly).toBe(false);
    expect(datum.hasAttribute("inputmode")).toBe(false);
  });
});