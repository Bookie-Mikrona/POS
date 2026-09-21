export type EtaArticle = { id: number; mealType: string; casPripraveMin: number | null };
export type EtaNorm = { artikelId: number; vhodniArtikelId: number };

/** Resolves composite ETA as the maximum component ETA, cycle-safe. */
export function resolveCompositeEtas(articles: EtaArticle[], norms: EtaNorm[]): Map<number, number> {
  const byId = new Map(articles.map((article) => [article.id, article]));
  const components = new Map<number, number[]>();
  for (const norm of norms) components.set(norm.artikelId, [...(components.get(norm.artikelId) ?? []), norm.vhodniArtikelId]);
  const memo = new Map<number, number>();
  const visit = (id: number, path: Set<number>): number => {
    if (memo.has(id)) return memo.get(id)!;
    const article = byId.get(id);
    if (!article || path.has(id)) return 0;
    const own = Math.max(0, Number(article.casPripraveMin) || 0);
    if (article.mealType !== "composite") { memo.set(id, own); return own; }
    const nextPath = new Set(path).add(id);
    const result = Math.max(0, ...(components.get(id) ?? []).map((component) => visit(component, nextPath)));
    memo.set(id, result);
    return result;
  };
  for (const article of articles) visit(article.id, new Set());
  return memo;
}