import { describe, expect, it } from "vitest";
import { assertNoClaimedMalicaAllocations } from "./narocila";

describe("Malica allocation claim guard", () => {
  it.each([
    ["PUT /narocila/:id status=preklicano"],
    ["DELETE /narocila/:id"],
    ["DELETE /narocila/:id/postavke/:postavkaId"],
  ])("%s rejects an already claimed allocation", ([route]) => {
    expect(() => assertNoClaimedMalicaAllocations([{ id: 7 }]))
      .toThrowError("MALICA_ALLOCATION_CLAIMED");
  });

  it.each([
    ["PUT /narocila/:id status=preklicano"],
    ["DELETE /narocila/:id"],
    ["DELETE /narocila/:id/postavke/:postavkaId"],
  ])("%s allows an unclaimed allocation", () => {
    expect(() => assertNoClaimedMalicaAllocations([])).not.toThrow();
  });
});