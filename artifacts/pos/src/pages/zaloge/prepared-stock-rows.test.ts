import { describe, expect, it } from "vitest";
import { buildPreparedStockRows } from "./prepared-stock-rows";

describe("prikaz zaloge pripravljenih jedi", () => {
  it("sešteje sveže in zamrznjene porcije, vključno z delnimi porcijami", () => {
    expect(buildPreparedStockRows([
      { articleId: 1, articleName: "Juha", mealType: "prepared", freshQuantity: 2.5, thawedOpenQuantity: 1 },
      { articleId: 2, articleName: "Meni", mealType: "composite", freshQuantity: null, thawedOpenQuantity: null },
    ], [{ artikelId: 1, frozenQuantity: 4 }])).toEqual([
      { articleId: 1, articleName: "Juha", freshQuantity: 2.5, frozenQuantity: 3, totalQuantity: 5.5 },
    ]);
  });

  it("ne prikaže napačne vsote, če manjka zamrznjeni saldo", () => {
    expect(() => buildPreparedStockRows([
      { articleId: 1, articleName: "Juha", mealType: "prepared", freshQuantity: 2, thawedOpenQuantity: 0 },
    ], [])).toThrow("Manjka stanje pripravljene jedi");
  });

  it("po zaključku evidence prikaže zamrznjeno stanje brez ponovnega odštevanja", () => {
    expect(buildPreparedStockRows([
      { articleId: 1, articleName: "Juha", mealType: "prepared", freshQuantity: 0, thawedOpenQuantity: 0 },
    ], [{ artikelId: 1, frozenQuantity: 5 }])[0]?.totalQuantity).toBe(5);
  });

  it("razvrsti nazive jedi po slovenski abecedi", () => {
    const rows = buildPreparedStockRows([
      { articleId: 1, articleName: "Žito", mealType: "prepared", freshQuantity: 1, thawedOpenQuantity: 0 },
      { articleId: 2, articleName: "Čaj", mealType: "prepared", freshQuantity: 1, thawedOpenQuantity: 0 },
      { articleId: 3, articleName: "Cedevita", mealType: "prepared", freshQuantity: 1, thawedOpenQuantity: 0 },
    ], [
      { artikelId: 1, frozenQuantity: 0 },
      { artikelId: 2, frozenQuantity: 0 },
      { artikelId: 3, frozenQuantity: 0 },
    ]);

    expect(rows.map(row => row.articleName)).toEqual(["Cedevita", "Čaj", "Žito"]);
  });
});