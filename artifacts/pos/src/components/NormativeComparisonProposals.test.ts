import { describe, expect, it } from "vitest";
import { isEligibleNormativeProposal } from "./NormativeComparisonProposals";

const row = {
  normativRowId: 1, ingredientId: 2, ingredientName: "Moka", localQuantity: 0.2, localUnit: "kg",
  externalQuantity: 250, externalUnit: "g", servings: 1, sourceUrl: "https://example.com",
  sourceTitle: "Recept", proposalToken: "signed-token", localNormalizedQuantity: 0.2,
  externalNormalizedQuantity: 0.25, comparisonUnit: "kg", status: "comparable" as const, difference: 0.05, percentDifference: 25,
};

describe("upravičenost predloga normativa", () => {
  it("ne dovoli neprimerljive vrstice ali vrstice brez preverjenega vira", () => {
    expect(isEligibleNormativeProposal({ ...row, status: "incomparable" })).toBe(false);
    expect(isEligibleNormativeProposal({ ...row, sourceTitle: null })).toBe(false);
    expect(isEligibleNormativeProposal({ ...row, externalNormalizedQuantity: 0 })).toBe(false);
  });
  it("dovoli primerljiv podpisan predlog z javnim virom", () => expect(isEligibleNormativeProposal(row)).toBe(true));
});