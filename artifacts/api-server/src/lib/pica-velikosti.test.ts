import { describe, expect, it } from "vitest";
import { cenaPicePoVelikosti, happyHourCenaPicePoVelikosti, privzetaVelikostPice } from "./pica-velikosti";

describe("cenaPicePoVelikosti", () => {
  const pizza = {
    cena: "8.90",
    cenaMala: "6.50",
    cenaDruzinska: "13.20",
  };

  it("uporabi ločeno ceno za vsako velikost pice", () => {
    expect(cenaPicePoVelikosti(pizza, "mala")).toBe(6.5);
    expect(cenaPicePoVelikosti(pizza, "normalna")).toBe(8.9);
    expect(cenaPicePoVelikosti(pizza, "druzinska")).toBe(13.2);
  });

  it("pri starem artiklu brez ločenih cen ohrani osnovno ceno", () => {
    expect(cenaPicePoVelikosti({ cena: "8.90", cenaMala: null, cenaDruzinska: null }, "mala")).toBe(8.9);
    expect(cenaPicePoVelikosti({ cena: "8.90", cenaMala: null, cenaDruzinska: null }, "druzinska")).toBe(8.9);
  });

  it("ne sprejme negativne ali neveljavne cene", () => {
    expect(cenaPicePoVelikosti({ ...pizza, cenaMala: "-1" }, "mala")).toBeNull();
    expect(cenaPicePoVelikosti({ ...pizza, cenaDruzinska: "neznano" }, "druzinska")).toBeNull();
  });

  it("za stare klice brez velikosti izbere normalno pico, ne prve male", () => {
    expect(privzetaVelikostPice([
      { id: "mala" as const },
      { id: "normalna" as const },
      { id: "druzinska" as const },
    ])?.id).toBe("normalna");
    expect(privzetaVelikostPice([{ id: "mala" as const }, { id: "druzinska" as const }])?.id).toBe("mala");
  });
});

describe("happyHourCenaPicePoVelikosti", () => {
  const pizza = {
    happyHourCena: "7.50",
    happyHourCenaMala: "5.50",
    happyHourCenaDruzinska: "11.50",
  };

  it("vrne lastno Happy Hour ceno vsake velikosti", () => {
    expect(happyHourCenaPicePoVelikosti(pizza, "mala")).toBe(5.5);
    expect(happyHourCenaPicePoVelikosti(pizza, "normalna")).toBe(7.5);
    expect(happyHourCenaPicePoVelikosti(pizza, "druzinska")).toBe(11.5);
  });

  it("pri stari pici brez posebne cene ne uporabi normalne cene za drugo velikost", () => {
    const staraPizza = { happyHourCena: "7.50" };
    expect(happyHourCenaPicePoVelikosti(staraPizza, "normalna")).toBe(7.5);
    expect(happyHourCenaPicePoVelikosti(staraPizza, "mala")).toBeNull();
    expect(happyHourCenaPicePoVelikosti(staraPizza, "druzinska")).toBeNull();
  });

  it("zavrne neveljavne promocijske cene", () => {
    expect(happyHourCenaPicePoVelikosti({ ...pizza, happyHourCenaMala: "-1" }, "mala")).toBeNull();
    expect(happyHourCenaPicePoVelikosti({ ...pizza, happyHourCenaDruzinska: "neznano" }, "druzinska")).toBeNull();
  });
});