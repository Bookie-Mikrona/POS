import { primerjajSlovensko } from "./slovensko-razvrscanje";

interface ArticleForMenuSort {
  id: number;
  ime: string;
  kategorijaId?: number | null;
}

interface CategoryForMenuSort {
  id: number;
  ime: string;
  vrstniRed: number;
}

/** In the sales view, keep the configured category order and alphabetize within each category. */
export function sortMenuArticles<T extends ArticleForMenuSort>(
  articles: readonly T[],
  categories: readonly CategoryForMenuSort[],
  groupByCategory: boolean,
): T[] {
  const byCategoryId = new Map(categories.map(category => [category.id, category]));
  return [...articles].sort((a, b) => {
    if (groupByCategory) {
      const categoryA = a.kategorijaId == null ? undefined : byCategoryId.get(a.kategorijaId);
      const categoryB = b.kategorijaId == null ? undefined : byCategoryId.get(b.kategorijaId);
      if (!!categoryA !== !!categoryB) return categoryA ? -1 : 1;
      if (categoryA && categoryB) {
        const categoryOrder = categoryA.vrstniRed - categoryB.vrstniRed
          || primerjajSlovensko(categoryA.ime, categoryB.ime)
          || categoryA.id - categoryB.id;
        if (categoryOrder) return categoryOrder;
      }
    }
    return primerjajSlovensko(a.ime, b.ime) || a.id - b.id;
  });
}