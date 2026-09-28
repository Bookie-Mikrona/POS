import "@testing-library/jest-dom";
import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  getActiveKdsTarget,
  getKdsCountdown,
  getKdsTarget,
  getKdsTypeLabel,
  getKdsModifierRows,
  KdsCountdown,
  KdsNarociloGlava,
  sortKdsNarocila,
} from "./kdsNarocilo";

const NOW = new Date("2026-08-24T10:00:00.000Z").getTime();

const miza = { id: 1, nacin: "miza", mizaIme: "Terasa 3", prostorIme: "Notranjost" };
const mizaSPripravo = { ...miza, predvidenPrevzem: "2026-08-24T10:10:00.000Z" };
const prevzem = { id: 2, nacin: "telefon", nacinIzpolnitve: "prevzem", strankaIme: "Ana", predvidenPrevzem: "2026-08-24T10:12:00.000Z" };
const dostava = {
  id: 3, nacin: "telefon", nacinIzpolnitve: "dostava", strankaIme: "Bine", strankaTelefon: "041 222 333",
  predvidenPrevzem: "2026-08-24T10:05:00.000Z", predvidenaDostava: "2026-08-24T10:18:00.000Z",
  dostavaUlica: "Cesta", dostavaHisnaStevilka: "8", dostavaNaseljeNaziv: "Medvode",
};

describe("KDS telefonska naročila", () => {
  afterEach(() => vi.useRealTimers());

  it("izpiše enotne oznake Miza, Prevzem in Dostava", () => {
    expect(getKdsTypeLabel(miza)).toBe("Miza Terasa 3");
    expect(getKdsTypeLabel(prevzem)).toBe("Prevzem");
    expect(getKdsTypeLabel(dostava)).toBe("Dostava");
  });

  it("za vse vrste naročil izbere čas priprave kot ciljni čas", () => {
    expect(getKdsTarget(prevzem)).toEqual({ iso: prevzem.predvidenPrevzem, label: "Dostava ob" });
    expect(getKdsTarget(dostava)).toEqual({ iso: dostava.predvidenPrevzem, label: "Dostava ob" });
    expect(getKdsTarget(miza)).toBeNull();
    expect(getKdsTarget(mizaSPripravo)).toEqual({ iso: mizaSPripravo.predvidenPrevzem, label: "Dostava ob" });
  });

  it("formatira živ odštevalnik za prihodnji in zamujeni čas", () => {
    expect(getKdsCountdown("2026-08-24T10:04:00.000Z", NOW)).toMatchObject({ text: "čez 4 min", urgency: "soon" });
    expect(getKdsCountdown("2026-08-24T09:53:00.000Z", NOW)).toMatchObject({ text: "zamuja 7 min", urgency: "late" });
  });

  it("zaradi sekundnega odmika triminutnega roka ne prikaže kot štiri minute", () => {
    expect(getKdsCountdown("2026-08-24T10:03:20.000Z", NOW)).toMatchObject({
      text: "čez 3 min",
      minutes: 3,
    });
  });

  it("telefonska naročila razvrsti po ciljnem času, mize pa ohrani v obstoječem vrstnem redu", () => {
    const later = { ...prevzem, id: 4, predvidenPrevzem: "2026-08-24T10:30:00.000Z" };
    const earlier = { ...dostava, id: 5, predvidenaDostava: "2026-08-24T10:02:00.000Z" };
    const drugaMiza = { ...miza, id: 6, mizaIme: "Vrt 1" };
    expect(sortKdsNarocila([miza, later, drugaMiza, earlier]).map(n => n.id)).toEqual([5, 4, 1, 6]);
  });

  it("na KDS prikaže čas priprave, informativni čas dostave in naslov", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    const { unmount } = render(<KdsNarociloGlava narocilo={dostava} itemCount={2} />);

    expect(screen.getByTestId("kds-type-label")).toHaveTextContent("Dostava");
    expect(screen.getByTestId("kds-target-time")).toHaveTextContent("12:05");
    expect(screen.getByTestId("kds-target-time")).not.toHaveTextContent("Dostava ob");
    expect(screen.getByTestId("kds-target-time")).toHaveAccessibleName("Dostava ob 12:05");
    expect(screen.getByTestId("kds-countdown")).toHaveTextContent("čez 5 min");
    expect(screen.getByTestId("kds-delivery-info")).toHaveTextContent("12:18 (informativno)");
    expect(screen.getByTestId("kds-delivery-info")).not.toHaveTextContent("Dostava ob");
    expect(screen.getByTestId("kds-delivery-address")).toHaveTextContent("Cesta 8");

    act(() => { vi.advanceTimersByTime(360000); });
    expect(screen.getByTestId("kds-countdown")).toHaveTextContent("zamuja 1 min");
    expect(screen.getByTestId("kds-countdown")).toHaveAttribute("data-urgency", "late");
    unmount();
  });

  it("na KDS prikaže čas priprave tudi za naročilo mize", () => {
    render(<KdsNarociloGlava narocilo={mizaSPripravo} itemCount={1} />);

    expect(screen.getByTestId("kds-type-label")).toHaveTextContent("Miza Terasa 3");
    expect(screen.getByTestId("kds-prostor")).toHaveTextContent("Prostor: Notranjost");
    expect(screen.getByTestId("kds-target-time")).toHaveTextContent("12:10");
    expect(screen.getByTestId("kds-target-time")).not.toHaveTextContent("Dostava ob");
  });

  it("po pripravi vseh postavk ne prikazuje več ciljnega časa ali zamude", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T10:20:00.000Z"));

    expect(getActiveKdsTarget(mizaSPripravo, true)).toBeNull();
    render(<KdsNarociloGlava narocilo={mizaSPripravo} itemCount={2} pripravljeno />);

    expect(screen.queryByTestId("kds-target-time")).not.toBeInTheDocument();
    expect(screen.queryByTestId("kds-countdown")).not.toBeInTheDocument();
  });

  it("pri QR naročilu osebje opozori na preverjanje ob postrežbi", () => {
    render(
      <KdsNarociloGlava
        narocilo={{ ...mizaSPripravo, vir: "qr_gost" }}
        itemCount={1}
        pripravljeno
      />,
    );

    expect(screen.getByTestId("kds-qr-gost")).toHaveTextContent("QR gost");
    expect(screen.getByTestId("qr-gost-staff-info")).toHaveTextContent("Pripravljeno za postrežbo");
    expect(screen.getByTestId("qr-gost-staff-info")).not.toHaveTextContent("Pred postrežbo preveri starost in opitost gosta.");
  });

  it("po 30 sekundah osveži samostojni odštevalnik", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(NOW));
    render(<KdsCountdown target={{ iso: "2026-08-24T10:01:00.000Z", label: "Dostava ob" }} />);
    expect(screen.getByTestId("kds-countdown")).toHaveTextContent("čez 1 min");
    act(() => { vi.advanceTimersByTime(90000); });
    expect(screen.getByTestId("kds-countdown")).toHaveTextContent("zamuja 1 min");
  });
});

describe("KDS modifikatorji", () => {
  it("pokaže brez česna pod zeleno solato brez dodatne prodajne vrstice", () => {
    const rows = getKdsModifierRows(1, new Map([
      [1, [{ id: 2, ime: "Svinjski" }, { id: 3, ime: "Pražen krompir" }, { id: 4, ime: "Zelena" }]],
      [4, [{ id: 5, ime: "brez česna" }]],
      [10, [{ id: 11, ime: "brez soli" }]],
    ]));
    expect(rows).toEqual([
      { id: 2, ime: "Svinjski", depth: 0 },
      { id: 3, ime: "Pražen krompir", depth: 0 },
      { id: 4, ime: "Zelena", depth: 0 },
      { id: 5, ime: "brez česna", depth: 1 },
    ]);
  });
});