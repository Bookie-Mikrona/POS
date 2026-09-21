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