import { describe, expect, it } from "vitest";

import { buildInvoiceXML, fursSigningContextFingerprint, preveriDDVKonsistentnost, zgradiStornoPayloadIzSnapshota } from "./pos-furs";

describe("FURS XML — 5 % DDV", () => {
  it("izpiše pravilno osnovo in DDV za samostojno 5-% skupino", () => {
    const postavke = [{
      ime: "Artikel z znižano stopnjo",
      kolicina: 1,
      cenaKos: 105,
      skupaj: 105,
      davek: 5,
    }];
    preveriDDVKonsistentnost(postavke, 5);

    const xml = buildInvoiceXML({
      stevilkaRacuna: "PP001-B001-000001",
      datumCas: new Date("2026-08-20T10:00:00+02:00"),
      skupaj: 105,
      ddv: 5,
      placilnaNacin: "gotovina",
      postavke,
    });

    expect(xml).toContain("<fu:TaxRate>5.00</fu:TaxRate>");
    expect(xml).toContain("<fu:TaxableAmount>100.00</fu:TaxableAmount>");
    expect(xml).toContain("<fu:TaxAmount>5.00</fu:TaxAmount>");
  });
});

describe("FURS storno iz immutable snapshota", () => {
  it("ohrani partnersko ceno, bon-pica razdelitev in dejansko stopnjo napitnine", () => {
    const original = {
      stevilkaRacuna: "PP-C1-000101",
      datumCas: "2026-08-20T08:00:00.000Z",
      skupaj: 19.5,
      ddv: 1.61,
      placilnaNacin: "kartica" as const,
      poslovnaProstor: "PP",
      blagajnaId: "C1",
      postavke: [
        { ime: "Partnerska pica", kolicina: 1, cenaKos: 8.5, davek: 9.5 },
        { ime: "Partnerska pica", kolicina: 1, cenaKos: 0, davek: 9.5 },
        { ime: "Napitnina", kolicina: 1, cenaKos: 11, davek: 9.5 },
      ],
    };

    const storno = zgradiStornoPayloadIzSnapshota(
      original,
      "PP-C1-000102",
      "2026-08-20T09:00:00.000Z",
    );

    expect(storno).toMatchObject({
      stevilkaRacuna: "PP-C1-000102",
      datumCas: "2026-08-20T09:00:00.000Z",
      skupaj: -19.5,
      ddv: -1.61,
      placilnaNacin: "kartica",
      poslovnaProstor: "PP",
      blagajnaId: "C1",
      jeStorno: true,
      izvornaStevRacuna: "PP-C1-000101",
      izvornaStevRacunaDatumCas: "2026-08-20T08:00:00.000Z",
      postavke: [
        { ime: "Partnerska pica", kolicina: -1, cenaKos: 8.5, davek: 9.5 },
        { ime: "Partnerska pica", kolicina: -1, cenaKos: 0, davek: 9.5 },
        { ime: "Napitnina", kolicina: -1, cenaKos: 11, davek: 9.5 },
      ],
    });
  });
});

describe("FURS signing context", () => {
  it("blokirnemu preverjanju razkrije rotacijo certifikata brez shranjevanja certifikata", () => {
    const original = fursSigningContextFingerprint("produkcija", "-----BEGIN CERTIFICATE-----\nAAA\n-----END CERTIFICATE-----");
    const rotated = fursSigningContextFingerprint("produkcija", "-----BEGIN CERTIFICATE-----\nBBB\n-----END CERTIFICATE-----");
    expect(original).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(rotated).not.toBe(original);
    expect(fursSigningContextFingerprint("simulacija", "poljubno")).toBe("simulation");
  });
});
