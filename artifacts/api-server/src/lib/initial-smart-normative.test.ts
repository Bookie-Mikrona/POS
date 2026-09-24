import { afterEach, describe, expect, it } from "vitest";
import {
  clearInitialRecipeResearchCache,
  normalizeInitialRecipeResearch,
  signInitialNormativeProposal,
  verifyInitialNormativeProposal,
} from "./initial-smart-normative";

const sourceA = "https://allrecipes.com/recipe-a";
const sourceB = "https://bbcgoodfood.com/recipe-b";
const secretBefore = process.env.POS_NORMATIVE_PROPOSAL_SECRET;
const recipeOutput = (overrides: {
  recipes?: unknown[];
  toolBlocks?: unknown[];
} = {}) => {
  const recipes = overrides.recipes ?? [
    { sourceUrl: sourceA, servings: 2, ingredients: [{ name: "Moka", quantity: 200, unit: "g" }, { name: "Voda", quantity: 300, unit: "ml" }, { name: "Jajca", quantity: 2, unit: "kos" }] },
    { sourceUrl: sourceB, servings: 3, ingredients: [{ name: "moka", quantity: 300, unit: "g" }, { name: "voda", quantity: 450, unit: "ml" }, { name: "jajca", quantity: 3, unit: "kos" }] },
  ];
  const toolBlocks = overrides.toolBlocks ?? [
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: sourceA, title: "Recipe A" }] },
    { type: "web_search_tool_result", content: [{ type: "web_search_result", url: sourceB, title: "Recipe B" }] },
  ];
  return [
    ...toolBlocks,
    { type: "text", text: JSON.stringify({ recipes }) },
  ];
};

afterEach(() => {
  clearInitialRecipeResearchCache();
  if (secretBefore === undefined) delete process.env.POS_NORMATIVE_PROPOSAL_SECRET;
  else process.env.POS_NORMATIVE_PROPOSAL_SECRET = secretBefore;
});

describe("initial smart normative research validation", () => {
  it("normalizes complete per-serving recipes to e-SLOG units and preserves typed sources", () => {
    const result = normalizeInitialRecipeResearch(recipeOutput());
    expect(result.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "Jajca", quantity: "1", unit: "KOM" }),
      expect.objectContaining({ name: "Moka", quantity: "0.1", unit: "KGM" }),
      expect.objectContaining({ name: "Voda", quantity: "0.15", unit: "LTR" }),
    ]));
    expect(result.sources).toEqual([
      { url: sourceA, title: "Recipe A" },
      { url: sourceB, title: "Recipe B" },
    ]);
  });

  it("rejects model-invented source URLs without matching typed web-search results", () => {
    expect(() => normalizeInitialRecipeResearch(recipeOutput({ toolBlocks: [] })))
      .toThrowError("RESEARCH_INSUFFICIENT_SOURCES");
  });

  it("rejects ambiguous culinary measures, duplicates, and incomplete recipes", () => {
    const ambiguous = recipeOutput({
      recipes: [
        { sourceUrl: sourceA, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "cup" }] },
        { sourceUrl: sourceB, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "kg" }] },
      ],
    });
    expect(() => normalizeInitialRecipeResearch(ambiguous)).toThrowError("RECIPE_AMBIGUOUS_INGREDIENT");

    const duplicate = recipeOutput({
      recipes: [
        { sourceUrl: sourceA, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "kg" }, { name: "moka", quantity: 2, unit: "kg" }] },
        { sourceUrl: sourceB, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "kg" }] },
      ],
    });
    expect(() => normalizeInitialRecipeResearch(duplicate)).toThrowError("RECIPE_DUPLICATE_INGREDIENT");

    const incomplete = recipeOutput({
      recipes: [
        { sourceUrl: sourceA, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "kg" }] },
        { sourceUrl: sourceB, servings: 2, ingredients: [{ name: "Moka", quantity: 1, unit: "kg" }, { name: "Voda", quantity: 1, unit: "l" }] },
      ],
    });
    expect(() => normalizeInitialRecipeResearch(incomplete)).toThrowError("RECIPE_INCOMPLETE");
  });

  it("signs short-lived tenant, article, revision, ingredient, and source metadata", () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-only-secret";
    const token = signInitialNormativeProposal({
      v: 1,
      enotaId: 12,
      articleId: 34,
      revision: 1,
      targetName: "Palačinke",
      issuedAt: 1_000_000,
      items: [{ name: "Moka", quantity: "0.1", unit: "KGM", existingArticleId: null, willCreate: true, sourceUrls: [sourceA, sourceB] }],
      sources: [{ url: sourceA, title: "A" }, { url: sourceB, title: "B" }],
    });
    expect(token).toBeTruthy();
    expect(verifyInitialNormativeProposal(token!, 1_001_000)).toMatchObject({ enotaId: 12, articleId: 34, revision: 1, targetName: "Palačinke" });
    expect(verifyInitialNormativeProposal(token!, 1_400_001)).toBeNull();
  });
});