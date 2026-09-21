/**
 * Privzeta vrsta pri neposrednem dodajanju prodajnega artikla v POS meniju.
 * Nabavne poti (Zaloge in uvoz prejemnic) imajo svoje, materialne privzete vrednosti.
 */
export const DEFAULT_NEW_SALES_ARTICLE_TYPE = "storitev" as const;

/** Privzeta vrsta artikla, ustvarjenega iz zalog ali uvoza prejemnice. */
export const DEFAULT_NEW_PURCHASE_ARTICLE_TYPE = "material" as const;