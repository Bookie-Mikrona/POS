import { describe, expect, it } from "vitest";
import { ListEmbalazaBilanceResponse } from "@workspace/api-zod";
import { normalizeEmbalazaBilanca } from "./embalazaBilanca";

describe("normalizeEmbalazaBilanca", () => {
  it("pretvori PostgreSQL decimalne nize v števila veljavnega API odgovora", () => {
    const result = normalizeEmbalazaBilanca({
      artikelId: 12,
      artikelIme: "Zaboj",
      vrstaEmbalaze: "zaboj",
      dobaviteljId: "169f0955-1849-435b-a4c1-b444a7578b72",
      dobaviteljIme: "Dobavitelj",
      fizicnaZaloga: "4.0000",
      kolicina: "3.0000",
      depozitnaVrednost: "2.50",
    });

    expect(ListEmbalazaBilanceResponse.parse([result])).toEqual([expect.objectContaining({
      fizicnaKolicina: 3,
      overallPhysicalStock: 4,
      depozitnaVrednost: 2.5,
      izpostavljenostDepozita: 7.5,
    })]);
  });

  it("ohrani manjkajočo depozitno vrednost kot null", () => {
    const result = normalizeEmbalazaBilanca({
      artikelId: 13,
      artikelIme: "Steklenica",
      vrstaEmbalaze: "steklenica",
      dobaviteljId: null,
      dobaviteljIme: null,
      fizicnaZaloga: null,
      kolicina: null,
      depozitnaVrednost: null,
    });

    expect(result.depozitnaVrednost).toBeNull();
    expect(result.izpostavljenostDepozita).toBe(0);
  });
});