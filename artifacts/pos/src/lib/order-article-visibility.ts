export type OrderArticleVisibilityInput = {
  prodajniArtikel?: boolean;
  kategorijaId?: number | null;
  mealType?: "ala_carte" | "prepared" | "composite";
  availableQuantity?: number | null;
};

export function isOrderArticleVisible(
  article: OrderArticleVisibilityInput,
  isConfiguredMulticourseMenu = false,
): boolean {
  if (isConfiguredMulticourseMenu) return true;
  return article.prodajniArtikel === true
    && article.kategorijaId != null
    && (
      article.mealType === "ala_carte"
      || article.availableQuantity == null
      || article.availableQuantity > 0
    );
}
/**
 * Novi prikaz zaloge: artikel s spremljanimi porcijami ostane viden tudi pri 0 porcijah
 * (siva kartica »Ni«). Ostali pogoji vidnosti so nespremenjeni.
 */
export function isOrderArticleShownWithStock(
  article: OrderArticleVisibilityInput & { spremljajPorcije?: boolean },
  isConfiguredMulticourseMenu: boolean,
  zalogaNovo: boolean,
): boolean {
  if (isOrderArticleVisible(article, isConfiguredMulticourseMenu)) return true;
  return zalogaNovo
    && article.spremljajPorcije === true
    && article.prodajniArtikel === true
    && article.kategorijaId != null;
}
