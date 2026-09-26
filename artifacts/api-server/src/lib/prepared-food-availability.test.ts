import { describe, expect, it, vi } from "vitest";
import {
  loadPreparedFoodAvailability,
  resolvePreparedFoodAvailability,
  type AvailabilityArticle,
  type AvailabilityNorm,
} from "./prepared-food-availability";

const articles: AvailabilityArticle[] = [
  { id: 1, name: "Krompir", mealType: "prepared" },
  { id: 2, name: "Solata", mealType: "prepared" },
  { id: 3, name: "Zrezek", mealType: "ala_carte" },
  { id: 4, name: "Kosilo", mealType: "composite" },
];

function calculate(norms: AvailabilityNorm[], frozen = new Map([[1, 40], [2, 20]]), sales: Array<{ articleId: number; quantity: number }> = []) {
  return resolvePreparedFoodAvailability({
    articles,
    norms,
    frozenByPreparedArticle: frozen,
    preparedTodayByArticle: new Map(),
    sales,
  });
}

describe("resolvePreparedFoodAvailability", () => {
  it("uporabi minimum pripravljenih sestavin, à la carte pa ne omejuje", () => {
    const state = calculate([
      { articleId: 4, ingredientId: 1, quantity: 1 },
      { articleId: 4, ingredientId: 2, quantity: 1 },
      { articleId: 4, ingredientId: 3, quantity: 1 },
    ]);
    expect(state.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(20);
  });

  it("po shranitvi dveh pripravljenih sestavin izračuna vidno količino sestavljenega artikla", () => {
    const state = calculate([
      { articleId: 4, ingredientId: 1, quantity: 1 },
      { articleId: 4, ingredientId: 2, quantity: 1 },
    ], new Map([[1, 3], [2, 5]]));

    expect(state.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(3);
  });

  it("upošteva decimalni normativ ter današnjo pripravo in prodajo", () => {
    const state = resolvePreparedFoodAvailability({
      articles,
      norms: [{ articleId: 4, ingredientId: 1, quantity: 0.5 }],
      frozenByPreparedArticle: new Map([[1, 4]]),
      preparedTodayByArticle: new Map([[1, 3]]),
      sales: [{ articleId: 4, quantity: 2 }],
    });
    expect(state.items.find((item) => item.articleId === 1)?.availableQuantity).toBe(6);
    expect(state.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(12);
    expect(state.items.find((item) => item.articleId === 1)?.freshQuantity).toBe(6);
    expect(state.items.find((item) => item.articleId === 4)?.freshQuantity).toBeNull();
  });

  it("pri fizični zalogi ohrani delne nezamrznjene porcije, čeprav je za prodajo na voljo le celo število", () => {
    const state = resolvePreparedFoodAvailability({
      articles: [{ id: 1, name: "Juha", mealType: "prepared" }],
      norms: [],
      frozenByPreparedArticle: new Map(),
      preparedTodayByArticle: new Map([[1, 3.5]]),
      sales: [{ articleId: 1, quantity: 1 }],
    });
    expect(state.items[0]).toMatchObject({ availableQuantity: 2, freshQuantity: 2.5 });
  });

  it("za že prodano vrstico uporabi posnetek vrste hrane, ne trenutnega šifranta", () => {
    const state = resolvePreparedFoodAvailability({
      articles: [{ id: 1, name: "Naknadno pripravljena jed", mealType: "prepared" }],
      norms: [],
      frozenByPreparedArticle: new Map([[1, 1]]),
      preparedTodayByArticle: new Map(),
      sales: [{ articleId: 1, quantity: 1, mealType: "ala_carte" }],
    });
    expect(state.items.find((item) => item.articleId === 1)?.availableQuantity).toBe(1);
  });

  it("za pice računa izbrani dough enkrat, area faktor pa uporabi samo za prelive", () => {
    const pizzaArticles: AvailabilityArticle[] = [
      { id: 20, name: "Preliv", mealType: "prepared" },
      { id: 21, name: "Malo testo", mealType: "prepared" },
      { id: 22, name: "Običajno testo", mealType: "prepared" },
      { id: 23, name: "Pica", mealType: "composite", isPizza: true },
    ];
    const state = resolvePreparedFoodAvailability({
      articles: pizzaArticles,
      norms: [{ articleId: 23, ingredientId: 20, quantity: 2 }],
      frozenByPreparedArticle: new Map([[20, 20], [21, 4], [22, 8]]),
      preparedTodayByArticle: new Map(),
      pizzaDoughSettings: { normalDoughArticleId: 22, smallDoughArticleId: 21 },
      pizzaSizeFactors: { mala: 0.5, normalna: 1, druzinska: 1.5 },
      sales: [
        // Older sales debit toppings only; they have no dough snapshot.
        { articleId: 23, quantity: 2, mealType: "composite" },
        // The new snapshot debits dough by line count, never by normativ factor.
        {
          articleId: 23,
          quantity: 1.5,
          mealType: "composite",
          pizzaDoughArticleId: 22,
          pizzaDoughQuantity: 1,
        },
      ],
    });

    expect(state.preparedAvailableRaw.get(20)).toBe(13);
    expect(state.preparedAvailableRaw.get(21)).toBe(4);
    expect(state.preparedAvailableRaw.get(22)).toBe(7);
    // Zahteva za skupne sestavine ne sme zahtevati še normalnega hlebčka:
    // naročilna pot doda natanko en posnetek hlebčka izbrane velikosti.
    expect([...state.requirementsByArticle.get(23)!.prepared]).toEqual([[20, 2]]);
    expect(state.items.find((item) => item.articleId === 23)?.availableBySize).toEqual({
      mala: 4,
      normalna: 6,
      druzinska: 0,
    });
  });

  it("vrne nič pri ničelni zalogi, ciklu ali neveljavnem normativu", () => {
    const zero = calculate([{ articleId: 4, ingredientId: 1, quantity: 1 }], new Map([[1, 0]]));
    expect(zero.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(0);

    const cyclicArticles: AvailabilityArticle[] = [
      { id: 10, name: "A", mealType: "composite" },
      { id: 11, name: "B", mealType: "composite" },
    ];
    const cycle = resolvePreparedFoodAvailability({
      articles: cyclicArticles,
      norms: [
        { articleId: 10, ingredientId: 11, quantity: 1 },
        { articleId: 11, ingredientId: 10, quantity: 1 },
      ],
      frozenByPreparedArticle: new Map(),
      preparedTodayByArticle: new Map(),
      sales: [],
    });
    expect(cycle.items.every((item) => item.availableQuantity === 0)).toBe(true);

    const invalid = calculate([{ articleId: 4, ingredientId: 1, quantity: 0 }]);
    expect(invalid.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(0);
  });

  it("ohrani zalogo iz zadnje odprte evidence ob prehodu poslovnega datuma", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [
        { zacetek_dneva_ura: "04:00" },
      ] })
      .mockResolvedValueOnce({ rows: [
        { id: 1, ime: "Krompir", meal_type: "prepared" },
        { id: 4, ime: "Kosilo", meal_type: "composite" },
      ] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [
        { artikel_id: 4, vhodni_artikel_id: 1, quantity: 1 },
      ] })
      .mockResolvedValueOnce({ rows: [
        {
          artikel_id: 1,
          business_date: "2026-08-28",
          thawed_quantity: 0,
          prepared_quantity: 10,
          correction_quantity: 0,
          closed_at: null,
        },
      ] })
      .mockResolvedValueOnce({ rows: [
        { artikel_id: 1, meal_type: "prepared", quantity: 2 },
      ] });

    const state = await loadPreparedFoodAvailability(
      { execute } as never,
      309,
      "2026-08-29",
    );

    expect(state.items.find((item) => item.articleId === 1)?.availableQuantity).toBe(8);
    expect(state.items.find((item) => item.articleId === 4)?.availableQuantity).toBe(8);
    expect(state.items.find((item) => item.articleId === 1)?.thawedOpenQuantity).toBe(0);
  });

  it("negativni popravek zmanjša samo operativno razpoložljivost", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ zacetek_dneva_ura: "04:00" }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, ime: "Krompir", meal_type: "prepared" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        artikel_id: 1,
        business_date: "2026-08-29",
        thawed_quantity: 4,
        prepared_quantity: 6,
        correction_quantity: -1,
        closed_at: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ artikel_id: 1, meal_type: "prepared", quantity: 2 }] });

    const state = await loadPreparedFoodAvailability(
      { execute } as never,
      309,
      "2026-08-29",
    );

    expect(state.items.find((item) => item.articleId === 1)?.availableQuantity).toBe(7);
    expect(state.items.find((item) => item.articleId === 1)?.thawedOpenQuantity).toBe(4);
  });

  it("pozitivni popravek omogoči prodajo dodatnih fizično razpoložljivih porcij", async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce({ rows: [{ zacetek_dneva_ura: "04:00" }] })
      .mockResolvedValueOnce({ rows: [{ id: 1, ime: "Golaž", meal_type: "prepared" }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{
        artikel_id: 1,
        business_date: "2026-08-29",
        thawed_quantity: 0,
        prepared_quantity: 20,
        correction_quantity: 2,
        closed_at: null,
      }] })
      .mockResolvedValueOnce({ rows: [{ artikel_id: 1, meal_type: "prepared", quantity: 20 }] });

    const state = await loadPreparedFoodAvailability(
      { execute } as never,
      309,
      "2026-08-29",
    );

    expect(state.items.find((item) => item.articleId === 1)?.availableQuantity).toBe(2);
  });
});