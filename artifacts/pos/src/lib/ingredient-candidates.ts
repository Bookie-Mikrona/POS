import { primerjajSlovensko } from "./slovensko-razvrscanje";

type Ingredient = { id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null };

function words(value: string): string[] {
  return value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sl").match(/[\p{Letter}\p{Number}]+/gu) ?? [];
}

function score(queryWords: string[], name: string): number {
  const articleWords = words(name);
  if (!queryWords.length || !articleWords.length) return 0;
  const query = queryWords.join(" ");
  const article = articleWords.join(" ");
  if (query === article) return 4;
  if (queryWords.length === articleWords.length
    && [...queryWords].sort().join(" ") === [...articleWords].sort().join(" ")) return 3;
  // Match whole words in any order, including a broader catalog name ("sladkor"
  // vs "kristalni sladkor"). This is a suggestion, never an automatic link.
  if (queryWords.every(word => articleWords.includes(word))) return 2;
  if (articleWords.every(word => queryWords.includes(word))) return 1;
  return 0;
}

export function ingredientCandidates<T extends Ingredient>(
  articles: T[],
  search: string,
  compatible: (article: T) => boolean,
  selectedId: number | null,
): T[] {
  const queryWords = words(search);
  return articles.map(article => ({
    article,
    rank: Math.max(score(queryWords, article.ime), score(queryWords, article.imeZaNabavo ?? "")),
  }))
    .filter(({ article, rank }) => compatible(article) && (rank > 0 || article.id === selectedId || !queryWords.length))
    .sort((a, b) => b.rank - a.rank || primerjajSlovensko(a.article.ime, b.article.ime))
    .slice(0, 40)
    .map(({ article }) => article);
}