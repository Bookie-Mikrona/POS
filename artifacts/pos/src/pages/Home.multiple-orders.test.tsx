import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { getAktivnoNarociloEtaTarget, getDostavaStatusLabel, jeAktivniProstorVeljaven, jeAktivnoTelefonskoNarocilo, moraPregledMizPocakatiNaPodatke, MizaCard, MizaNarocilaDialog } from "./Home";

describe("MizaCard z več odprtimi naročili", () => {
  it("med nalaganjem prostorov ne prikaže klasičnega pogleda miz", () => {
    expect(moraPregledMizPocakatiNaPodatke(false, false, true)).toBe(true);
    expect(moraPregledMizPocakatiNaPodatke(false, false, false)).toBe(false);
  });

  it("ne obdrži shranjenega prostora iz druge enote", () => {
    const prostori = [{ id: 1424 }, { id: 1425 }];

    expect(jeAktivniProstorVeljaven(null, prostori)).toBe(true);
    expect(jeAktivniProstorVeljaven(1424, prostori)).toBe(true);
    expect(jeAktivniProstorVeljaven(9999, prostori)).toBe(false);
  });

  it("status dostave pretvori v uporabniku razumljivo oznako", () => {
    expect(getDostavaStatusLabel("v_pripravi")).toBe("V pripravi");
    expect(getDostavaStatusLabel("prevzel_kurir")).toBe("Prevzel kurir");
    expect(getDostavaStatusLabel("neveljaven_status")).toBeNull();
  });

  it("za dostavo uporablja predvideni čas dostave in po zaključku odstrani odštevanje", () => {
    expect(getAktivnoNarociloEtaTarget({
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      dostavaStatus: "v_pripravi",
      predvidenaDostava: "2026-08-31T12:30:00.000Z",
      predvidenPrevzem: null,
    })).toEqual({
      iso: "2026-08-31T12:30:00.000Z",
      label: "Dostava ob",
    });
    expect(getAktivnoNarociloEtaTarget({
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      dostavaStatus: "dostavljeno",
      predvidenaDostava: "2026-08-31T12:30:00.000Z",
      predvidenPrevzem: null,
    })).toBeNull();
  });

  it("zaključene dostave odstrani iz aktivnega telefonskega seznama", () => {
    expect(jeAktivnoTelefonskoNarocilo({
      nacin: "telefon",
      status: "odprto",
      nacinIzpolnitve: "dostava",
      dostavaStatus: "preklicano",
    })).toBe(false);
    expect(jeAktivnoTelefonskoNarocilo({
      nacin: "telefon",
      status: "odprto",
      nacinIzpolnitve: "dostava",
      dostavaStatus: "dostavljeno",
    })).toBe(false);
    expect(jeAktivnoTelefonskoNarocilo({
      nacin: "telefon",
      status: "odprto",
      nacinIzpolnitve: "prevzem",
      dostavaStatus: null,
    })).toBe(true);
  });

  it("pokaže skupni znesek in omogoči izbiro vsakega ločenega naročila", () => {
    const onSelectMiza = vi.fn();

    render(
      <MizaCard
        miza={{
          id: 2,
          enotaId: 1,
          stevilka: 2,
          ime: null,
          kapaciteta: 4,
          status: "zasedena",
          prostorId: null,
          posX: null,
          posY: null,
          oblika: "pravokotnik_h",
          qrToken: null,
        } as any}
        aktivnaNarocila={[
          {
            id: 101,
            stevilkaNarocila: 101,
            mizaId: 2,
            status: "odprto",
            vir: "osebje",
            skupaj: 8,
            postavke: [{ id: 1, parentPostavkaId: null, racunId: null, pripravljeno: null }],
          },
          {
            id: 102,
            stevilkaNarocila: 102,
            mizaId: 2,
            status: "odprto",
            vir: "qr_gost",
            skupaj: 12,
            postavke: [{ id: 2, parentPostavkaId: null, racunId: null, pripravljeno: null }],
          },
        ] as any}
        onSelectMiza={onSelectMiza}
        onCancelNarocilo={vi.fn()}
        onRezerviraj={vi.fn()}

        isPending={false}
      />,
    );

    expect(screen.getByText("2 odprti naročili")).toBeTruthy();
    expect(screen.getByText("20,00 €")).toBeTruthy();
    expect(screen.getByText("2 ločeni naročili · 2 artiklov")).toBeTruthy();
    expect(screen.getByText("QR gost")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pregled mize" }));
    expect(onSelectMiza).toHaveBeenCalledWith(2);
  });

  it("na prazni mizi uporabi Dodaj naročilo kot edino dejanje za naročilo", () => {
    const onSelectMiza = vi.fn();

    render(
      <MizaCard
        miza={{
          id: 3,
          enotaId: 1,
          stevilka: 3,
          ime: "Terasa",
          kapaciteta: 4,
          status: "prosta",
          prostorId: null,
          posX: null,
          posY: null,
          oblika: "pravokotnik_h",
          qrToken: null,
        } as any}
        aktivnaNarocila={[]}
        onSelectMiza={onSelectMiza}
        onCancelNarocilo={vi.fn()}
        onRezerviraj={vi.fn()}

        isPending={false}
      />,
    );

    expect(screen.getByRole("button", { name: /Dodaj naročilo/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Novo naročilo/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Nova rezervacija" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Dodaj naročilo/ }));
    expect(onSelectMiza).toHaveBeenCalledWith(3);
  });

  it("omogoča zapiranje edinega praznega odprtega naročila", () => {
    const onCancelNarocilo = vi.fn();
    render(
      <MizaCard
        miza={{ id: 5, stevilka: 5, ime: "Bar", kapaciteta: 2, status: "zasedena" } as any}
        aktivnaNarocila={[{
          id: 201,
          mizaId: 5,
          status: "odprto",
          skupaj: 0,
          postavke: [],
        } as any]}
        onSelectMiza={vi.fn()}
        onCancelNarocilo={onCancelNarocilo}
        onRezerviraj={vi.fn()}

        isPending={false}
      />,
    );

    expect(screen.getByRole("button", { name: "Pregled mize" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Zapri prazno mizo" }));
    expect(onCancelNarocilo).toHaveBeenCalledWith(201, 5);
  });

  it("dialog prikaže obstoječa naročila in ločeno možnost Dodaj naročilo", () => {
    const onDodajNarocilo = vi.fn();
    const onOpenChange = vi.fn();
    const miza = {
      id: 2,
      stevilka: 2,
      ime: "Terasa",
    } as any;
    const narocila = [
      {
        id: 101,
        stevilkaNarocila: 101,
        vir: "osebje",
        skupaj: 8,
        postavke: [{ id: 1, parentPostavkaId: null }],
      },
      {
        id: 102,
        stevilkaNarocila: 102,
        vir: "qr_gost",
        skupaj: 12,
        postavke: [{ id: 2, parentPostavkaId: null }],
      },
    ] as any;

    render(
      <MizaNarocilaDialog
        open
        miza={miza}
        narocila={narocila}
        onOpenChange={onOpenChange}
        onDodajNarocilo={onDodajNarocilo}
        isPending={false}
      />,
    );

    expect(screen.getByText("Naročilo #101")).toBeInTheDocument();
    expect(screen.getByText("Naročilo #102")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Dodaj naročilo/ }));
    expect(onDodajNarocilo).toHaveBeenCalledWith(2);
  });

  it("dialog prazne mize prikaže samo možnost Dodaj naročilo", () => {
    render(
      <MizaNarocilaDialog
        open
        miza={{ id: 3, stevilka: 3, ime: "Vrt" } as any}
        narocila={[]}
        onOpenChange={vi.fn()}
        onDodajNarocilo={vi.fn()}
        isPending={false}
      />,
    );

    expect(screen.getAllByRole("button", { name: /Dodaj naročilo/ })).toHaveLength(1);
    expect(screen.queryByText(/Naročilo #/)).not.toBeInTheDocument();
  });
});