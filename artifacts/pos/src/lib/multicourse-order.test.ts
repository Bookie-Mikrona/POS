import { describe, expect, it } from "vitest";
import {
  groupMulticourseOrderRows,
  multicourseSelectionRequirements,
  validateMulticourseOrderSelection,
} from "./multicourse-order";

const courses = [
  { courseNumber: 1, allowedFoodArtikelIds: [101], allowedWineArtikelIds: [11] },
  { courseNumber: 2, allowedFoodArtikelIds: [102], allowedWineArtikelIds: [12] },
  { courseNumber: 3, allowedFoodArtikelIds: [103], allowedWineArtikelIds: [13] },
  { courseNumber: 4, allowedFoodArtikelIds: [104], allowedWineArtikelIds: [14] },
];

describe("validateMulticourseOrderSelection", () => {
  it("requires all four configured courses with an allowed dish and wine for fixed_four", () => {
    expect(validateMulticourseOrderSelection("fixed_four", courses, [
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 2, foodArtikelId: 102, wineArtikelId: 12 },
      { courseNumber: 3, foodArtikelId: 103, wineArtikelId: 13 },
    ])).toBe("Izberite natanko 4 hode.");
    expect(validateMulticourseOrderSelection("fixed_four", courses, [
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 2, foodArtikelId: 102, wineArtikelId: 99 },
      { courseNumber: 3, foodArtikelId: 103, wineArtikelId: 13 },
      { courseNumber: 4, foodArtikelId: 104, wineArtikelId: 14 },
    ])).toBe("Za vsak izbran hod izberite dovoljeno vino.");
    expect(validateMulticourseOrderSelection("fixed_four", courses, [
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 2, foodArtikelId: 999, wineArtikelId: 12 },
      { courseNumber: 3, foodArtikelId: 103, wineArtikelId: 13 },
      { courseNumber: 4, foodArtikelId: 104, wineArtikelId: 14 },
    ])).toBe("Za vsak izbran hod izberite dovoljeno jed.");
  });

  it("accepts exactly three distinct configured courses for choose_three", () => {
    expect(validateMulticourseOrderSelection("choose_three", courses, [
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 3, foodArtikelId: 103, wineArtikelId: 13 },
      { courseNumber: 4, foodArtikelId: 104, wineArtikelId: 14 },
    ])).toBeNull();
    expect(validateMulticourseOrderSelection("choose_three", courses, [
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 1, foodArtikelId: 101, wineArtikelId: 11 },
      { courseNumber: 3, foodArtikelId: 103, wineArtikelId: 13 },
    ])).toBe("Izbira hodov ni veljavna.");
  });

  it("supports arbitrary courses, optional wine and automatic informational courses", () => {
    const genericCourses = [
      { courseNumber: 1, courseName: "Pozdrav iz kuhinje", informational: true, allowedFoodArtikelIds: [], allowedWineArtikelIds: [] },
      { courseNumber: 2, courseName: "Predjed", allowedFoodArtikelIds: [201], allowedWineArtikelIds: [21], wineRequired: true },
      { courseNumber: 7, courseName: "Glavna jed", allowedFoodArtikelIds: [207], allowedWineArtikelIds: [27], wineRequired: false },
      { courseNumber: 20, courseName: "Sladica", allowedFoodArtikelIds: [220], allowedWineArtikelIds: [], wineRequired: false },
    ];
    const menu = { selectionMode: "fixed" as const };

    expect(multicourseSelectionRequirements(menu, genericCourses)).toEqual({ mode: "fixed", count: 3 });
    expect(validateMulticourseOrderSelection(menu, genericCourses, [
      { courseNumber: 2, foodArtikelId: 201, wineArtikelId: 21 },
      { courseNumber: 7, foodArtikelId: 207 },
      { courseNumber: 20, foodArtikelId: 220 },
    ])).toBeNull();
    expect(validateMulticourseOrderSelection(menu, genericCourses, [
      { courseNumber: 1, foodArtikelId: 201 },
      { courseNumber: 2, foodArtikelId: 201, wineArtikelId: 21 },
      { courseNumber: 7, foodArtikelId: 207 },
    ])).toBe("Izbira hodov ni veljavna.");
  });

  it("uses generic choose count while retaining choose_three menus", () => {
    expect(multicourseSelectionRequirements({ selectionMode: "choose", selectionCount: 2 }, courses))
      .toEqual({ mode: "choose", count: 2 });
    expect(multicourseSelectionRequirements("choose_three", courses))
      .toEqual({ mode: "choose", count: 3 });
  });
});

describe("groupMulticourseOrderRows", () => {
  it("prikaže večhodni meni z vinsko spremljavo kot eno vrstico in skrije komponente", () => {
    expect(groupMulticourseOrderRows([
      { id: 1, ime: "4 hodni meni z vinsko spremljavo – hrana", kolicina: 1, cenaKos: 40, skupaj: 40, pairingGroupId: "menu-1", courseNumber: null },
      { id: 2, ime: "4 hodni meni z vinsko spremljavo – vinska spremljava", kolicina: 1, cenaKos: 20, skupaj: 20, pairingGroupId: "menu-1", courseNumber: null },
      { id: 3, ime: "Juha", kolicina: 1, cenaKos: 0, skupaj: 0, pairingGroupId: "menu-1", courseNumber: 1 },
      { id: 4, ime: "Rebula", kolicina: 1, cenaKos: 0, skupaj: 0, pairingGroupId: "menu-1", courseNumber: 1 },
    ])).toEqual([{
      id: 1,
      ime: "4 hodni meni z vinsko spremljavo",
      kolicina: 1,
      cenaKos: 60,
      skupaj: 60,
      pairingGroupId: "menu-1",
      courseNumber: null,
      isMulticourseBundle: true,
    }]);
  });
});