import { describe, expect, it } from "vitest";
import { getKdsHeaderWarnings, getKdsTimerStart, getNewlyActivatedKdsTicketIds, getNextKdsCourseToFire, groupKdsNalogiByCourse } from "./Kitchen";
import { getNextKdsCoursesToFire } from "@/lib/kdsCourses";
import type { KdsNalog } from "@/hooks/use-kds";

const ticket = (courseNumber: number, stanje: KdsNalog["stanje"]): KdsNalog => ({
  id: courseNumber, enotaId: 1, postajaId: 1, narociloId: 1, postavkaId: courseNumber,
  courseNumber, stanje, uporabljenFallback: false, ustvarjeno: "2026-01-01T12:00:00Z",
});

describe("getNextKdsCourseToFire", () => {
  it("releases only the course following a fully completed prior course", () => {
    expect(getNextKdsCourseToFire([ticket(1, "bumped"), { ...ticket(1, "bumped"), id: 2, postajaId: 2 }])).toBe(2);
    expect(getNextKdsCourseToFire([ticket(1, "bumped"), { ...ticket(1, "aktivno"), id: 2 }])).toBeUndefined();
  });

  it("does not offer a course already released or a fifth course", () => {
    expect(getNextKdsCourseToFire([ticket(1, "bumped"), ticket(2, "aktivno")])).toBeUndefined();
    expect(getNextKdsCourseToFire([ticket(4, "bumped")])).toBeUndefined();
  });

  it("uses selected sequence and keeps menu pairings independent", () => {
    const paired = (id: number, courseNumber: number, courseSequence: number, pairingGroupId: string, stanje: KdsNalog["stanje"]): KdsNalog => ({
      ...ticket(courseNumber, stanje), id, postavkaId: id, courseSequence, pairingGroupId,
    });
    const first = [
      paired(1, 1, 1, "a", "bumped"),
      paired(2, 3, 2, "a", "zadrzano"),
      paired(3, 4, 3, "a", "zadrzano"),
      paired(4, 1, 1, "b", "bumped"),
      paired(5, 3, 2, "b", "zadrzano"),
    ];
    expect(getNextKdsCoursesToFire(first)).toEqual([
      { courseNumber: 3, courseSequence: 2, pairingGroupId: "a" },
      { courseNumber: 3, courseSequence: 2, pairingGroupId: "b" },
    ]);
    expect(getNextKdsCoursesToFire(first.map(n => n.id === 2 ? { ...n, stanje: "bumped" as const } : n)))
      .toEqual([
        { courseNumber: 4, courseSequence: 3, pairingGroupId: "a" },
        { courseNumber: 3, courseSequence: 2, pairingGroupId: "b" },
      ]);
  });
});

describe("groupKdsNalogiByCourse", () => {
  it("keeps fired and held courses together and renders them by immutable sequence", () => {
    const courses = [
      { ...ticket(4, "zadrzano"), id: 4, courseSequence: 3, ustvarjeno: "2026-01-01T12:04:00Z" },
      { ...ticket(1, "aktivno"), id: 1, courseSequence: 1, ustvarjeno: "2026-01-01T12:01:00Z" },
      { ...ticket(3, "zadrzano"), id: 3, courseSequence: 2, ustvarjeno: "2026-01-01T12:03:00Z" },
      { ...ticket(1, "aktivno"), id: 2, courseSequence: 1, ustvarjeno: "2026-01-01T12:02:00Z" },
    ];

    expect(groupKdsNalogiByCourse(courses).map(group => ({
      courseNumber: group.courseNumber,
      courseSequence: group.courseSequence,
      states: group.nalogi.map(nalog => nalog.stanje),
      ids: group.nalogi.map(nalog => nalog.id),
    }))).toEqual([
      { courseNumber: 1, courseSequence: 1, states: ["aktivno", "aktivno"], ids: [1, 2] },
      { courseNumber: 3, courseSequence: 2, states: ["zadrzano"], ids: [3] },
      { courseNumber: 4, courseSequence: 3, states: ["zadrzano"], ids: [4] },
    ]);
  });
});

describe("getKdsHeaderWarnings", () => {
  it("uses the highest assigned guest and de-duplicates KDS-visible allergen warnings", () => {
    expect(getKdsHeaderWarnings([
      { gostStevilka: 2, alergeni: ["gluten", "mleko"], alergeniSledi: ["jajca"] },
      { gostStevilka: null, alergeni: ["mleko", "oreščki"], alergeniSledi: ["jajca", "soja"] },
      { gostStevilka: 4, alergeni: [], alergeniSledi: [] },
      { gostStevilka: 0, alergeni: ["gluten"] },
    ], true)).toEqual({
      guestCount: 4,
      allergens: ["gluten", "mleko", "oreščki"],
      traces: ["jajca", "soja"],
    });
  });

  it("does not show a guest count or warnings when no visible line supplies them", () => {
    expect(getKdsHeaderWarnings([{ gostStevilka: 0 }, { gostStevilka: null }])).toEqual({
      guestCount: null,
      allergens: [],
      traces: [],
    });
  });
});

describe("KDS FIRE signal and timer", () => {
  it("omits allergens and traces on KDS cards while retaining guest counts", () => {
    const lines = [{ gostStevilka: 2, alergeni: ["GLUTEN"], alergeniSledi: ["MLEKO"] }];
    expect(getKdsHeaderWarnings(lines, false)).toEqual({ guestCount: 2, allergens: [], traces: [] });
    expect(getKdsHeaderWarnings(lines)).toEqual({ guestCount: 2, allergens: [], traces: [] });
  });
  it("uses the release timestamp when a held course is fired", () => {
    expect(getKdsTimerStart({
      ...ticket(2, "aktivno"),
      aktiviranoAt: "2026-01-01T12:15:00Z",
    })).toBe("2026-01-01T12:15:00Z");
    expect(getKdsTimerStart(ticket(1, "aktivno"))).toBe("2026-01-01T12:00:00Z");
  });

  it("detects a held-to-active FIRE transition but not unchanged active tickets", () => {
    const previous = new Map<number, KdsNalog["stanje"]>([
      [1, "aktivno"],
      [2, "zadrzano"],
    ]);
    expect(getNewlyActivatedKdsTicketIds(previous, [
      { ...ticket(1, "aktivno"), id: 1 },
      { ...ticket(2, "aktivno"), id: 2 },
    ])).toEqual([2]);
  });
});