import { describe, expect, it } from "vitest";
import { choosePreparationStations, isOutstandingKdsState, planStandardKdsDisplays, preparationStationType, resolveKdsRoutingTargets, resolvePreparationKind } from "../lib/kds-routing";

describe("KDS routing target resolution", () => {
  it("deduplicates overlap without removing intentional different stations", () => {
    expect(resolveKdsRoutingTargets([4, 4, 9, 4], 3)).toEqual({ stationIds: [4, 9], usedFallback: false });
  });

  it("uses exactly the fallback for an unmatched eligible item", () => {
    expect(resolveKdsRoutingTargets([], 3)).toEqual({ stationIds: [3], usedFallback: true });
  });
});

describe("article preparation station", () => {
  it("uses explicit mappings before classification and fallback, without duplicate tickets", () => {
    expect(choosePreparationStations([8, 8, 9], 3, 4)).toEqual({ stationIds: [8, 9], usedFallback: false });
    expect(choosePreparationStations([], 3, 4)).toEqual({ stationIds: [3], usedFallback: false });
    expect(choosePreparationStations([], null, 4)).toEqual({ stationIds: [4], usedFallback: true });
  });
  it("routes explicitly classified pizza, food and drinks to their stations", () => {
    expect(preparationStationType(resolvePreparationKind({ pripravaVrsta: "pica" })!)).toBe("pizza");
    expect(preparationStationType(resolvePreparationKind({ pripravaVrsta: "hrana" })!)).toBe("kitchen");
    expect(preparationStationType(resolvePreparationKind({ pripravaVrsta: "pijaca" })!)).toBe("bar");
  });

  it("preserves old pizza flags and infers legacy beverage categories without using VAT", () => {
    expect(resolvePreparationKind({ jePica: true, kategorijaIme: "Glavne jedi" })).toBe("pica");
    expect(resolvePreparationKind({ kategorijaIme: "Žgane pijače" })).toBe("pijaca");
    expect(resolvePreparationKind({ kategorijaIme: "Topli napitki" })).toBe("pijaca");
    expect(resolvePreparationKind({ kategorijaIme: "Glavne jedi" })).toBe("hrana");
    expect(resolvePreparationKind({ kategorijaIme: "Embalaža" })).toBeNull();
  });
});

describe("standard KDS display planning", () => {
  it("is deterministic across repeated lazy ensure planning", () => {
    const first = planStandardKdsDisplays("bar_combined_kitchen");
    const second = planStandardKdsDisplays("bar_combined_kitchen");
    expect(second).toEqual(first);
    expect(second).not.toBe(first);
  });

  it("combines kitchen and pizza while parking the separate pizza display", () => {
    expect(planStandardKdsDisplays("bar_combined_kitchen")).toEqual([
      { ime: "Bar", active: true, stationTypes: ["bar"] },
      { ime: "Kuhinja", active: true, stationTypes: ["kitchen", "pizza"] },
      { ime: "Pica", active: false, stationTypes: [] },
    ]);
  });

  it("makes the kitchen and pizza displays independently visible", () => {
    expect(planStandardKdsDisplays("bar_separate_kitchen_pizza")).toEqual([
      { ime: "Bar", active: true, stationTypes: ["bar"] },
      { ime: "Kuhinja", active: true, stationTypes: ["kitchen"] },
      { ime: "Pica", active: true, stationTypes: ["pizza"] },
    ]);
  });
});

describe("outstanding KDS ticket states", () => {
  it("keeps bumped tickets actionable but excludes acknowledged tickets", () => {
    expect(isOutstandingKdsState("aktivno")).toBe(true);
    expect(isOutstandingKdsState("bumped")).toBe(true);
    expect(isOutstandingKdsState("ack")).toBe(false);
  });
});