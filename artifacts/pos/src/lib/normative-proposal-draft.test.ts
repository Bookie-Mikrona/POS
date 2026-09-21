import { describe, expect, it } from "vitest";
import { chooseOneProposal, isValidProposalDraft, type ProposalRow } from "./normative-proposal-draft";

const row = (token: string, normativRowId = 1): ProposalRow => ({
  normativRowId, proposalToken: token, ingredientName: "Moka", oldQuantity: 0.2, newQuantity: 0.25,
  unit: "kg", sourceTitle: "Javni recept", sourceUrl: "https://example.com/recept",
});

describe("draft spletnega predloga normativa", () => {
  it("sprejme le minimalen varen draft z javnim HTTPS virom", () => {
    expect(isValidProposalDraft({ version: 1, artikelId: 4, targetName: "Pizza", generatedAt: new Date().toISOString(), selected: [row("token")] })).toBe(true);
    expect(isValidProposalDraft({ version: 1, artikelId: 4, targetName: "Pizza", generatedAt: new Date().toISOString(), selected: [{ ...row("token"), sourceUrl: "http://unsafe.example" }] })).toBe(false);
  });

  it("obdrži največ en predlog za isto vrstico in ponoven klik izbere odstrani", () => {
    const first = chooseOneProposal([], row("a"));
    expect(chooseOneProposal(first, row("b"))).toEqual([row("b")]);
    expect(chooseOneProposal([row("b"), row("c", 2)], row("b"))).toEqual([row("c", 2)]);
  });
});