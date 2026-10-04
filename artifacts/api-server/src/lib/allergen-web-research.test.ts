import { describe, expect, it } from "vitest";
import { mergeAutomaticAllergens, parseAllergenWebResearch } from "./allergen-web-research";

const source = "https://www.example.si/izdelek/psenicna-moka";
const typed = { type: "web_search_tool_result", content: [
  { type: "web_search_result", url: source, title: "Pšenična moka – sestavine" },
] };
const response = (data: unknown) => [typed, { type: "text", text: JSON.stringify(data) }];
const base = { identityMatch: true, contains: [{ code: "GLUTEN", url: source }], traces: [], note: "Pšenična moka." };
const current = {
  alergeni: ["MLEKO"], alergeniSledi: ["GLUTEN"], alergeniStatus: "nepreverjeno",
  alergeniVir: "rocno", alergeniOpombaVira: null, alergeniDocumentId: null,
};

describe("automatic ingredient allergen research", () => {
  it("accepts only a typed live source with valid EU codes", () => {
    expect(parseAllergenWebResearch(response(base))).toEqual(base);
  });
  it("rejects URLs invented in model text", () => {
    expect(() => parseAllergenWebResearch(response({
      ...base, contains: [{ code: "GLUTEN", url: "https://invented.si/izdelek" }],
    }))).toThrow(/vira/);
  });
  it("requires real web search, not model prior knowledge", () => {
    expect(() => parseAllergenWebResearch([{ type: "text", text: JSON.stringify(base) }])).toThrow(/virov/);
  });
  it("rejects arbitrary allergen codes and unsafe citation URLs", () => {
    expect(() => parseAllergenWebResearch(response({
      ...base, contains: [{ code: "UNKNOWN", url: source }],
    }))).toThrow();
    expect(() => parseAllergenWebResearch([
      { type: "web_search_tool_result", content: [{ type: "web_search_result", url: "https://127.0.0.1/private" }] },
      { type: "text", text: JSON.stringify(base) },
    ])).toThrow(/virov/);
  });
  it("merges known allergens, keeps citations and never automatically confirms", () => {
    const merged = mergeAutomaticAllergens(current, base);
    expect(merged.alergeni).toEqual(["GLUTEN", "MLEKO"]);
    expect(merged.alergeniSledi).toEqual([]);
    expect(merged.alergeniStatus).toBe("nepreverjeno");
    expect(merged.alergeniVerifiedBy).toBeNull();
    expect(merged.alergeniOpombaVira).toContain(source);
  });
  it("does not import allergens of an unmatched product", () => {
    const merged = mergeAutomaticAllergens(current, { ...base, identityMatch: false });
    expect(merged.alergeni).toEqual(["MLEKO"]);
    expect(merged.alergeniSledi).toEqual(["GLUTEN"]);
    expect(merged.alergeniOpombaVira).toContain("ni potrjeno brez alergenov");
  });
  it("an empty result never means confirmed allergen-free", () => {
    const merged = mergeAutomaticAllergens({ ...current, alergeni: [], alergeniSledi: [] }, {
      identityMatch: true, contains: [], traces: [], note: "Ni najdenih deklariranih alergenov.",
    });
    expect(merged.alergeni).toEqual([]);
    expect(merged.alergeniStatus).toBe("nepreverjeno");
  });
  it("keeps explicitly sourced traces separate from contained allergens", () => {
    const merged = mergeAutomaticAllergens({ ...current, alergeni: [], alergeniSledi: [] }, {
      ...base, traces: [{ code: "SEZAM", url: source }],
    });
    expect(merged.alergeni).toEqual(["GLUTEN"]);
    expect(merged.alergeniSledi).toEqual(["SEZAM"]);
  });
  it("reports overly long evidence rather than silently corrupting a URL", () => {
    expect(() => mergeAutomaticAllergens({
      ...current, alergeniOpombaVira: "a".repeat(2000),
    }, base)).toThrow(/dolžino/);
  });
});