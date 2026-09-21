import { describe, expect, it } from "vitest";
import type { Izmena } from "@workspace/api-client-react";
import { availableShiftOperators } from "./available-shift-operators";

function shift(id: number, naOdmoru: boolean): Izmena {
  return {
    id,
    natakariId: id,
    natakarIme: `Natakar ${id}`,
    zacetek: new Date(),
    konec: null,
    skupajZnesek: 0,
    steviloRacunov: 0,
    status: "osnutek",
    naOdmoru,
  };
}

describe("availableShiftOperators", () => {
  it("izloči natakarja z odprtim odmorom", () => {
    expect(availableShiftOperators([
      shift(1, false),
      shift(2, true),
    ]).map(item => item.natakariId)).toEqual([1]);
  });

  it("natakarja po zaključenem odmoru ponovno omogoči", () => {
    expect(availableShiftOperators([shift(2, false)])).toHaveLength(1);
  });
});