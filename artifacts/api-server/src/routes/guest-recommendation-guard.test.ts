import { describe, expect, it } from "vitest";
import { renderGuestRecommendation, validateGuestRecommendation } from "./javnoMeni";

const facts = [
  { id: "article:0", kind: "article" as const, name: "Margherita", price: 9, available: true },
  { id: "queue:0", kind: "queue" as const, pizzaTasks: 2 },
];

describe("public guest recommendation guard", () => {
  it("accepts and server-renders a typed recommendation", () => {
    const selected = validateGuestRecommendation({ recommendationKind: "recommend_articles", factIds: ["article:0"] }, facts);
    expect(selected).toEqual({ recommendationKind: "recommend_articles", factIds: ["article:0"] });
    expect(renderGuestRecommendation(selected!, facts)).toBe("Na voljo so: Margherita (9.00 €).");
  });
  it("rejects price-to-ETA and queue-to-price type confusion", () => {
    expect(validateGuestRecommendation({ recommendationKind: "show_eta", factIds: ["article:0"] }, facts)).toBeNull();
    expect(validateGuestRecommendation({ recommendationKind: "recommend_articles", factIds: ["queue:0"] }, facts)).toBeNull();
  });
  it("makes unsupported prose impossible and rejects invalid IDs", () => {
    expect(validateGuestRecommendation({ recommendationKind: "recommend_articles", factIds: ["article:0"], answer: "Naročilo sem oddal." }, facts)).toBeNull();
    expect(validateGuestRecommendation({ recommendationKind: "recommend_articles", factIds: ["article:99"] }, facts)).toBeNull();
  });
});