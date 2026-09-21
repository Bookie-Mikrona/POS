import { describe, expect, it } from "vitest";
import { calculateKadrovskeUre } from "./izmene";

describe("calculateKadrovskeUre", () => {
  it("neplačani odmor odšteje pred izračunom nadur", () => {
    const result = calculateKadrovskeUre(
      new Date("2026-09-03T06:00:00.000Z"),
      new Date("2026-09-03T14:30:00.000Z"),
      [{
        id: 1,
        vrsta: "neplacan",
        zacetek: new Date("2026-09-03T10:00:00.000Z"),
        konec: new Date("2026-09-03T10:30:00.000Z"),
      }],
    );

    expect(result).toEqual({
      brutoUr: 8.5,
      neplacaniOdmoriUr: 0.5,
      placaniOdmoriUr: 0,
      efektivneUr: 8,
      nadure: 0,
    });
  });

  it("plačani odmor evidentira, vendar ga ne odšteje od efektivnih ur", () => {
    const result = calculateKadrovskeUre(
      new Date("2026-09-03T06:00:00.000Z"),
      new Date("2026-09-03T15:00:00.000Z"),
      [{
        id: 2,
        vrsta: "placan",
        zacetek: new Date("2026-09-03T10:00:00.000Z"),
        konec: new Date("2026-09-03T10:30:00.000Z"),
      }],
    );

    expect(result.efektivneUr).toBe(9);
    expect(result.placaniOdmoriUr).toBe(0.5);
    expect(result.nadure).toBe(1);
  });

  it("nadure računa po posameznem lokalnem koledarskem dnevu", () => {
    const result = calculateKadrovskeUre(
      new Date("2026-09-03T20:00:00.000Z"),
      new Date("2026-09-04T08:00:00.000Z"),
      [{
        id: 3,
        vrsta: "neplacan",
        zacetek: new Date("2026-09-04T04:00:00.000Z"),
        konec: new Date("2026-09-04T05:00:00.000Z"),
      }],
    );

    expect(result.brutoUr).toBe(12);
    expect(result.efektivneUr).toBe(11);
    expect(result.nadure).toBe(1);
  });
});