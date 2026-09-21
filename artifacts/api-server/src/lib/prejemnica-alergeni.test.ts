import { describe, expect, it } from "vitest";
import {
  alergenskiSnapshotBrezAlergenov,
  alergenskiSnapshotZaPovratnoEmbalazo,
  alergenskiSnapshotZaUrejanje,
  zahtevajPotrjenAlergenskiSnapshot,
} from "./prejemnica-alergeni";

const nepreverjenaVrstica = {
  artikelId: 12600,
  alergeni: [],
  alergeniSledi: [],
  alergeniStatus: "nepreverjeno",
  alergeniVir: null,
  alergeniOpombaVira: null,
  alergeniDocumentId: null,
};

describe("alergenski posnetek pri urejanju prejemnice", () => {
  it("ohrani obstoječ posnetek, ko artikel na vrstici ostane isti", () => {
    expect(alergenskiSnapshotZaUrejanje(nepreverjenaVrstica, 12600)).toBeNull();
  });

  it("zahteva potrditev, ko je artikel na obstoječi vrstici zamenjan", () => {
    expect(() =>
      alergenskiSnapshotZaUrejanje(nepreverjenaVrstica, 897),
    ).toThrow("mora biti pred shranjevanjem potrjen");
  });

  it("zahteva profil za novo vrstico", () => {
    expect(() =>
      zahtevajPotrjenAlergenskiSnapshot({ artikelId: 12600 }),
    ).toThrow("treba vnesti in potrditi alergene");
  });

  it("povratno embalažo potrdi brez alergenov", () => {
    const snapshot = alergenskiSnapshotZaPovratnoEmbalazo("test-user");
    expect(snapshot).toMatchObject({
      alergeni: [],
      alergeniSledi: [],
      alergeniStatus: "potrjeno_brez",
      alergeniVir: "drugo",
      alergeniOpombaVira: "Povratna embalaža",
      alergeniVerifiedBy: "test-user",
    });
  });

  it("v testnem načinu potrdi vhodno postavko brez alergenov", () => {
    expect(alergenskiSnapshotBrezAlergenov("test-user")).toMatchObject({
      alergeni: [],
      alergeniSledi: [],
      alergeniStatus: "potrjeno_brez",
      alergeniVir: "drugo",
      alergeniOpombaVira: "Testno delovanje",
      alergeniVerifiedBy: "test-user",
    });
  });
});