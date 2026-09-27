import type { PreparedFoodAvailabilityItem, PreparedFoodStock } from "@workspace/api-client-react";
import { primerjajSlovensko } from "@/lib/slovensko-razvrscanje";

type PreparedItem = Pick<PreparedFoodAvailabilityItem, "articleId" | "articleName" | "mealType" | "freshQuantity" | "thawedOpenQuantity">;
type FrozenStock = Pick<PreparedFoodStock, "artikelId" | "frozenQuantity">;

export function buildPreparedStockRows(items: PreparedItem[], stocks: FrozenStock[]) {
  const frozenByArticle = new Map(stocks.map(stock => [stock.artikelId, stock.frozenQuantity]));

  return items.filter(item => item.mealType === "prepared").map(item => {
    if (item.freshQuantity == null || item.thawedOpenQuantity == null || !frozenByArticle.has(item.articleId)) {
      throw new Error(`Manjka stanje pripravljene jedi: ${item.articleName}`);
    }
    const recordedFrozen = frozenByArticle.get(item.articleId)!;
    if (recordedFrozen + 1e-6 < item.thawedOpenQuantity) {
      throw new Error(`Odtajana količina presega zamrznjeno zalogo: ${item.articleName}`);
    }
    // Shramba odtajano odšteje šele ob zaključku evidence; medtem je del obeh saldov.
    const frozenQuantity = Math.max(0, recordedFrozen - item.thawedOpenQuantity);
    return {
      articleId: item.articleId,
      articleName: item.articleName,
      freshQuantity: item.freshQuantity,
      frozenQuantity,
      totalQuantity: item.freshQuantity + frozenQuantity,
    };
  }).sort((a, b) => primerjajSlovensko(a.articleName, b.articleName));
}