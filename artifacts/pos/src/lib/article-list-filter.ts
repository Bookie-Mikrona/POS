export type ArticleListFilter =
  | "vsi"
  | "prodajni"
  | "nabavni"
  | "embalaza"
  | "zNormativom"
  | "brezNormativa"
  | "brezSlike";

export interface FilterableArticle {
  prodajniArtikel?: boolean;
  nabavniArtikel?: boolean;
  povratnaEmbalaza: boolean;
  hasNormativ?: boolean;
  slikaUrl?: string | null;
}

export function articleMatchesListFilter(
  article: FilterableArticle,
  filter: ArticleListFilter,
): boolean {
  if (article.povratnaEmbalaza) {
    return filter === "embalaza";
  }

  switch (filter) {
    case "vsi":
      return true;
    case "prodajni":
      return Boolean(article.prodajniArtikel);
    case "nabavni":
      return Boolean(article.nabavniArtikel);
    case "embalaza":
      return false;
    case "zNormativom":
      return Boolean(article.hasNormativ);
    case "brezNormativa":
      return !article.hasNormativ;
    case "brezSlike":
      return Boolean(article.prodajniArtikel) && !article.slikaUrl;
  }
}