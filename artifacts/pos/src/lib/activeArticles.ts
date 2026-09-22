export function onlyActiveArticles<T extends { aktiven: boolean }>(articles: T[]): T[] {
  return articles.filter((article) => article.aktiven);
}