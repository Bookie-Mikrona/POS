import { afterEach, describe, expect, it } from "vitest";
import {
  clearInitialRecipeResearchCache,
  normalizeInitialRecipeResearch,
  initialRecipeSearchSources,
  recipeSearchName,
  signInitialNormativeProposal,
  singleIngredientDrinkFromName,
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
  it("accepts an actual typed Slovenian search result as context, never an invented supplier link", () => {
    const url = "https://www.mercator.si/ponudba/konzerviran-fizol";
    const items = [
      { name: "Fižol konzerviran, odcejen", quantity: 0.18, unit: "kg" },
      { name: "Čebula rdeča", quantity: 0.02, unit: "kg" },
      { name: "Olje sončnično", quantity: 0.015, unit: "l" },
      { name: "Sol", quantity: 0.002, unit: "kg" },
    ];
    const typed = [
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url, title: "Fižol – Mercator" }] },
      { type: "text", text: JSON.stringify({ estimate: { sourceUrl: url, items } }) },
    ];
    expect(initialRecipeSearchSources(typed)).toEqual([{ url, title: "Fižol – Mercator" }]);
    const normalized = normalizeInitialRecipeResearch(typed);
    expect(normalized.origin).toBe("web_estimate");
    expect(normalized.items.map(item => item.name)).toEqual(items.map(item => item.name));
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-only-secret";
    const payload = {
      v: 1 as const, origin: "web_estimate" as const,
      enotaId: 12, articleId: 34, revision: 1, targetName: "Fižolova solata – velika", issuedAt: 1_000_000,
      items: normalized.items.map(item => ({
        ...item, existingArticleId: null, willCreate: true,
      })),
      sources: normalized.sources,
    };
    const token = signInitialNormativeProposal(payload);
    expect(token).toBeTruthy();
    expect(verifyInitialNormativeProposal(token!, 1_001_000)?.items).toHaveLength(4);
    expect(() => normalizeInitialRecipeResearch([
      typed[0], { type: "text", text: JSON.stringify({ estimate: {
        sourceUrl: "https://fake-supplier.si/izdelek", items,
      } }) },
    ])).toThrowError("RESEARCH_INSUFFICIENT_SOURCES");
    expect(initialRecipeSearchSources([
      { type: "web_search_tool_result", content: [
        { type: "web_search_result", url: "http://www.mercator.si/item", title: "Unsafe" },
        { type: "web_search_result", url: "https://localhost.si.test/item", title: "Local" },
      ] },
    ])).toEqual([]);
  });
  it("derives a single alcoholic drink serving from its name, never from a mixed-drink label", () => {
    expect(singleIngredientDrinkFromName("Borovničevec 0,05 l", "alcoholic"))
      .toEqual({ name: "Borovničevec", quantity: "0.05", unit: "LTR", sourceUrls: [] });
    expect(singleIngredientDrinkFromName("Borovničevec 3 cl", "alcoholic")?.quantity).toBe("0.03");
    expect(singleIngredientDrinkFromName("Borovničevec 50 ml", "alcoholic")?.quantity).toBe("0.05");
    expect(singleIngredientDrinkFromName("Borovničevec 0,05 l", "food")).toBeNull();
    expect(singleIngredientDrinkFromName("Koktajl Borovničevec 0,05 l", "alcoholic")).toBeNull();
    expect(singleIngredientDrinkFromName("Borovničevec 0 l", "alcoholic")).toBeNull();
    expect(singleIngredientDrinkFromName("Borovničevec 0,00001 l", "alcoholic")).toBeNull();
  });

  it("signs catalog-derived volume only with a linked HTTPS product source", () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-only-secret";
    const payload = {
      v: 1 as const,
      enotaId: 12,
      articleId: 34,
      revision: 1,
      targetName: "Borovničevec 0,05 l",
      issuedAt: 1_000_000,
      items: [{ name: "Borovničevec", quantity: "0.05", unit: "LTR" as const, existingArticleId: null, willCreate: true, sourceUrls: [] }],
      sources: [],
    };
    expect(signInitialNormativeProposal(payload)).toBeNull();
    expect(signInitialNormativeProposal({ ...payload, origin: "catalog_volume" })).toBeNull();
    const url = "https://example-shop.com/drinks/borovnicevec";
    const sourced = {
      ...payload,
      origin: "catalog_volume" as const,
      sources: [{ url, title: "Borovničevec – liqueur" }],
      items: [{ ...payload.items[0]!, sourceUrls: [url] }],
    };
    const token = signInitialNormativeProposal(sourced);
    expect(token).toBeTruthy();
    expect(verifyInitialNormativeProposal(token!, 1_001_000)?.origin).toBe("catalog_volume");
    expect(signInitialNormativeProposal({ ...sourced, items: payload.items })).toBeNull();
    expect(signInitialNormativeProposal({
      ...sourced,
      sources: [{ url: "https://localhost.internal/drink", title: "Fake" }],
      items: [{ ...payload.items[0]!, sourceUrls: ["https://localhost.internal/drink"] }],
    })).toBeNull();
  });

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

  it("searches for the dish without a portion-size suffix", () => {
    expect(recipeSearchName("Fižolova solata – velika")).toBe("Fižolova solata");
    expect(recipeSearchName("Solatni krožnik s puranjimi trakci")).toBe("Solatni krožnik s puranjimi trakci");
  });

  it("accepts numeric strings and harmless extra metadata, without accepting invented sources", () => {
    const response = recipeOutput();
    const text = response.at(-1) as { type: string; text: string };
    const data = JSON.parse(text.text);
    data.comment = "Search notes";
    data.recipes[0].servings = "2";
    data.recipes[0].ingredients[0].quantity = "200,0";
    data.recipes[0].ingredients[0].originalUnit = "g";
    const normalized = normalizeInitialRecipeResearch([
      ...response.slice(0, -1),
      { type: "text", text: "I am searching." },
      { type: "text", text: `\`\`\`json\n${JSON.stringify(data)}\n\`\`\`` },
    ]);
    expect(normalized.items.find(item => item.name === "Moka")?.quantity).toBe("0.1");
    expect(() => normalizeInitialRecipeResearch([
      { type: "text", text: JSON.stringify(data) },
    ])).toThrowError("RESEARCH_INSUFFICIENT_SOURCES");
  });

  it("reports a missing recipe separately from malformed model output", () => {
    expect(() => normalizeInitialRecipeResearch([{ type: "text", text: '{"recipes":[]}' }]))
      .toThrowError("RESEARCH_INSUFFICIENT_SOURCES");
    expect(() => normalizeInitialRecipeResearch([{ type: "text", text: "No recipes found." }]))
      .toThrowError("RESEARCH_INVALID");
  });

  it("only exposes approved typed search results for structured recovery", () => {
    expect(initialRecipeSearchSources([
      { type: "text", text: JSON.stringify({ sourceUrl: sourceA }) },
      { type: "web_search_tool_result", content: [
        { type: "web_search_result", url: sourceA, title: "Bean salad" },
        { type: "web_search_result", url: "https://example.com/recipe", title: "Unapproved" },
      ] },
    ])).toEqual([{ url: sourceA, title: "Bean salad" }]);
  });

  it("builds an explicitly approximate norm only with a typed web result and single quantities", () => {
    const estimate = { estimate: { sourceUrl: sourceA, items: [
      { name: "Fižol", quantity: "0,2", unit: "kg" },
      { name: "Čebula", quantity: 35, unit: "g" },
      { name: "Olje", quantity: 20, unit: "ml" },
    ] } };
    const content = [recipeOutput()[0]!, { type: "text", text: JSON.stringify(estimate) }];
    expect(normalizeInitialRecipeResearch(content)).toMatchObject({
      origin: "web_estimate",
      sources: [{ url: sourceA }],
      items: [
        { name: "Fižol", quantity: "0.2", unit: "KGM", sourceUrls: [sourceA] },
        { name: "Čebula", quantity: "0.035", unit: "KGM" },
        { name: "Olje", quantity: "0.02", unit: "LTR" },
      ],
    });
    expect(() => normalizeInitialRecipeResearch([{ type: "text", text: JSON.stringify(estimate) }]))
      .toThrowError("RESEARCH_INSUFFICIENT_SOURCES");
    expect(() => normalizeInitialRecipeResearch([
      recipeOutput()[0]!,
      { type: "text", text: JSON.stringify({ estimate: { ...estimate.estimate, items: [{ name: "Fižol", quantity: "0.18-0.2", unit: "kg" }] } }) },
    ])).toThrowError("RESEARCH_INVALID");
  });

  it("signs an estimate only when every ingredient is linked to its approved source", () => {
    process.env.POS_NORMATIVE_PROPOSAL_SECRET = "test-only-secret";
    const payload = {
      v: 1 as const, origin: "web_estimate" as const,
      enotaId: 12, articleId: 34, revision: 1,
      targetName: "Fižolova solata – velika", issuedAt: 1_000_000,
      sources: [{ url: sourceA, title: "Bean salad" }],
      items: [{ name: "Fižol", quantity: "0.2", unit: "KGM" as const,
        existingArticleId: null, willCreate: true, sourceUrls: [sourceA] }],
    };
    const token = signInitialNormativeProposal(payload);
    expect(token).toBeTruthy();
    expect(verifyInitialNormativeProposal(token!, 1_001_000)?.origin).toBe("web_estimate");
    expect(signInitialNormativeProposal({ ...payload, items: [{ ...payload.items[0]!, sourceUrls: [] }] })).toBeNull();
    expect(signInitialNormativeProposal({ ...payload, sources: [] })).toBeNull();
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