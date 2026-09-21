import { describe, expect, it } from "vitest";
import {
  filtrirajPrazneOcrVrsticeEmbalaze,
  razsiriOcrPrometeEmbalaze,
} from "./ocr-embalaza";

describe("OCR prometi povratne embalaže", () => {
  it("ohrani prejeto in vrnjeno količino kot ločena nasprotna prometa", () => {
    const result = razsiriOcrPrometeEmbalaze([
      {
        naziv: "STEKLENICA LAŠKO 0,5L/20",
        kolicina: null,
        prejetaKolicina: "20",
        vrnjenaKolicina: "20",
        cena: null,
        vrednost: "0",
      },
    ]);

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      naziv: "STEKLENICA LAŠKO 0,5L/20",
      kolicina: "20",
    });
    expect(result[1]).toMatchObject({
      naziv: "STEKLENICA LAŠKO 0,5L/20",
      kolicina: "-20",
      cena: "0",
      vrednost: "0",
      davek: 0,
    });
  });

  it("običajno vrstico brez ločenih embalažnih količin pusti nespremenjeno", () => {
    const row = { naziv: "MLEKO 1L", kolicina: "12", cena: "1.20" };
    expect(razsiriOcrPrometeEmbalaze([row])).toEqual([row]);
  });

  it("prazne šifre embalaže odstrani, podatke pa ohrani samo na njihovi vrstici", () => {
    const sourceRows = [
      {
        vrsticaTip: "embalaza",
        sifra: "577",
        naziv: "ZABOJ PVC ULTRA FANTA 250 RGB X24",
        gtin: null,
        cena: null,
        prejetaKolicina: null,
        vrnjenaKolicina: null,
      },
      {
        vrsticaTip: "embalaza",
        sifra: "55",
        naziv: "ULTRA STEKLENICA FANTA 250 RET",
        gtin: "5449000159090",
        cena: "0.13",
        prejetaKolicina: "24",
        vrnjenaKolicina: "0",
      },
      {
        vrsticaTip: "embalaza",
        sifra: "578",
        naziv: "ZABOJ PVC ULTRA 250 RGB X24 PRAZEN",
        gtin: null,
        cena: null,
        prejetaKolicina: null,
        vrnjenaKolicina: null,
      },
    ];
    const result = filtrirajPrazneOcrVrsticeEmbalaze(sourceRows);

    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      sifra: "55",
      gtin: "5449000159090",
      cena: "0.13",
      prejetaKolicina: "24",
      vrnjenaKolicina: "0",
    });

    expect(razsiriOcrPrometeEmbalaze(sourceRows)).toEqual([
      expect.objectContaining({
        sifra: "55",
        gtin: "5449000159090",
        kolicina: "24",
        cena: "0.13",
      }),
    ]);
  });

  it("ne spremeni običajnih artiklov, tudi če nimajo embalažnih podatkov", () => {
    const row = {
      vrsticaTip: "artikel",
      sifra: "577",
      naziv: "Navaden artikel",
      kolicina: "1",
    };
    expect(filtrirajPrazneOcrVrsticeEmbalaze([row])).toEqual([row]);
  });

  it("ohrani embalažo brez dobaviteljeve šifre, če ima naziv in količini", () => {
    const row = {
      vrsticaTip: "embalaza",
      sifra: null,
      naziv: "STEKLENICA UNION 0,5L",
      prejetaKolicina: "100",
      vrnjenaKolicina: "100",
      cena: "0",
    };

    expect(razsiriOcrPrometeEmbalaze([row])).toEqual([
      expect.objectContaining({
        naziv: "STEKLENICA UNION 0,5L",
        kolicina: "100",
      }),
      expect.objectContaining({
        naziv: "STEKLENICA UNION 0,5L",
        kolicina: "-100",
      }),
    ]);
  });
});