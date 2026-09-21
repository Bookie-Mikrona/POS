import { describe, expect, it } from "vitest";
import {
  absNumber,
  buildAllocationSnapshots,
  isSameConfirmReplay,
  rankPackagingCandidate,
  remainingAllocationQuantity,
} from "./creditNotePackaging";

describe("credit-note packaging matching/allocation guards", () => {
  it("ranks exact article, unit value and deposit first", () => {
    expect(rankPackagingCandidate({ articleMatch: true, unitValueMatch: true, depositMatch: true })).toBe(100);
    expect(rankPackagingCandidate({ articleMatch: true, unitValueMatch: false, depositMatch: true })).toBeLessThan(100);
  });
  it("normalizes negative movement and credit-note quantities", () => {
    expect(absNumber("-4")).toBe(4);
    expect(absNumber(-2.5)).toBe(2.5);
  });
  it("does not rank a different article as a candidate", () => {
    expect(rankPackagingCandidate({ articleMatch: false, unitValueMatch: true, depositMatch: true })).toBe(0);
  });
  it("supports partial allocation only within remaining quantity", () => {
    const remaining = remainingAllocationQuantity("-10", 6);
    expect(remaining).toBe(4);
    expect(3 <= remaining).toBe(true);
    expect(5 <= remaining).toBe(false);
    expect(remainingAllocationQuantity("-10", 12)).toBe(0);
    expect(remainingAllocationQuantity("-10", -2)).toBe(12);
  });
  it("uses the movement deposit as a per-unit snapshot and allocates credit values pro rata", () => {
    expect(buildAllocationSnapshots({
      movementUnitDeposit: "0.30",
      lineNet: "-3.00",
      lineGross: "-3.66",
      lineQuantity: "-10",
      allocatedQuantity: 4,
    })).toEqual({
      depositSnapshot: "1.20",
      netSnapshot: "1.20",
      grossSnapshot: "1.46",
    });
  });
  it("accepts numeric-equivalent idempotent replays and rejects changed payloads", () => {
    const existing = {
      sourceDocumentId: "source",
      prejemnicaPostavkaId: 12,
      embalazniPrometId: 34,
      quantitySnapshot: "1.0000",
      status: "confirmed",
    };
    expect(isSameConfirmReplay(existing, {
      sourceDocumentId: "source",
      prejemnicaPostavkaId: "12",
      embalazniPrometId: "34",
      quantity: 1,
    })).toBe(true);
    expect(isSameConfirmReplay(existing, {
      sourceDocumentId: "source",
      prejemnicaPostavkaId: 12,
      embalazniPrometId: 34,
      quantity: 2,
    })).toBe(false);
  });
});