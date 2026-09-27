import { describe, expect, it } from "vitest";
import { sortMenuArticles } from "./article-menu-sort";

const categories = [
  { id: 1, ime: "Čaj", vrstniRed: 1 },
  { id: 2, ime: "Cedevita", vrstniRed: 1 },
  { id: 3, ime: "Žar", vrstniRed: 2 },
];

const articles = [
  { id: 1, ime: "Domači čaj", kategorijaId: 1 },
  { id: 2, ime: "Žajbelj", kategorijaId: 1 },
  { id: 3, ime: "Česen", kategorijaId: 1 },
  { id: 4, ime: "Šunka", kategorijaId: 2 },
  { id: 5, ime: "Sok", kategorijaId: 2 },
  { id: 6, ime: "Zelje", kategorijaId: 3 },
  { id: 7, ime: "Brez kategorije", kategorijaId: null },
];

describe("sortMenuArticles", () => {
  it("groups sales articles by category order, then Slovenian category and article alphabet", () => {
    expect(sortMenuArticles(articles, categories, true).map(a => a.id))
      .toEqual([5, 4, 3, 1, 2, 6, 7]);
  });

  it("sorts all other views directly by the Slovenian alphabet", () => {
    expect(sortMenuArticles(articles, categories, false).map(a => a.id))
      .toEqual([7, 3, 1, 5, 4, 6, 2]);
  });

  it("keeps missing categories last and handles numerals naturally", () => {
    const values = [
      { id: 1, ime: "Pica 10", kategorijaId: 1 },
      { id: 2, ime: "Pica 2", kategorijaId: 1 },
      { id: 3, ime: "A", kategorijaId: 999 },
    ];
    expect(sortMenuArticles(values, categories, true).map(a => a.id)).toEqual([2, 1, 3]);
  });
});