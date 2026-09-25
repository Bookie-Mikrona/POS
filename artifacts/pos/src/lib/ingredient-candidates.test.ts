import { describe, expect, it } from "vitest";
import { ingredientCandidates } from "./ingredient-candidates";

const articles = [
  { id: 1, ime: "Olje rastlinsko", enotaMere: "LTR" },
  { id: 2, ime: "Kis jabolčni", enotaMere: "LTR" },
  { id: 3, ime: "Sladkor", enotaMere: "KGM" },
  { id: 4, ime: "Moka pšenična", enotaMere: "KGM" },
  { id: 5, ime: "Olje sončnično", enotaMere: "LTR" },
  { id: 6, ime: "Drugo ime", imeZaNabavo: "Kristalni sladkor", enotaMere: "KGM" },
];

describe("ingredientCandidates", () => {
  const all = () => true;
  it("finds swapped words and catalog names with fewer or more words", () => {
    expect(ingredientCandidates(articles, "rastlinsko olje", all, null).map(a => a.id)).toEqual([1]);
    expect(ingredientCandidates(articles, "jabolčni kis", all, null).map(a => a.id)).toEqual([2]);
    expect(ingredientCandidates(articles, "kristalni sladkor", all, null).map(a => a.id)).toEqual([6, 3]);
    expect(ingredientCandidates(articles, "moka", all, null).map(a => a.id)).toEqual([4]);
  });
  it("keeps incompatible units out and retains a selected article after a search change", () => {
    expect(ingredientCandidates(articles, "olje", a => a.enotaMere === "KGM", null)).toEqual([]);
    expect(ingredientCandidates(articles, "kis", all, 1).map(a => a.id)).toEqual([2, 1]);
  });
  it("does not match substrings inside unrelated words", () => {
    expect(ingredientCandidates(articles, "sol", all, null)).toEqual([]);
  });
});