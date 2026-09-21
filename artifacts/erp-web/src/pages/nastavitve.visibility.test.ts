import { describe, expect, it } from "vitest";
import { getNastavitveVisibility } from "./nastavitve";

describe("vidnost nastavitev podjetja", () => {
  it("za lastnika ERP skrije uporabnike, e-Račun, bizBox in POS brez POS modula", () => {
    expect(
      getNastavitveVisibility({
        isErpOwnerCompany: true,
        hasPosModule: false,
        selectedTab: "uporabniki",
      }),
    ).toEqual({
      showUsers: false,
      showPosBooking: false,
      showERacunRegistration: false,
      showBizBoxCredentials: false,
      activeTab: "podatki",
    });
  });

  it("za lastnika ERP s POS modulom ohrani POS zavihek, ostale lastniške razdelke pa skrije", () => {
    expect(
      getNastavitveVisibility({
        isErpOwnerCompany: true,
        hasPosModule: true,
        selectedTab: "pos",
      }),
    ).toEqual({
      showUsers: false,
      showPosBooking: true,
      showERacunRegistration: false,
      showBizBoxCredentials: false,
      activeTab: "pos",
    });
  });

  it("za pravo stranko z moduli ohrani vse zavihke in razdelke", () => {
    expect(
      getNastavitveVisibility({
        isErpOwnerCompany: false,
        hasPosModule: true,
        selectedTab: "uporabniki",
      }),
    ).toEqual({
      showUsers: true,
      showPosBooking: true,
      showERacunRegistration: true,
      showBizBoxCredentials: true,
      activeTab: "uporabniki",
    });
  });
});