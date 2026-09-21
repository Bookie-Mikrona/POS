export type NormativOwner = {
  mealType: "ala_carte" | "prepared" | "composite";
  nabavniArtikel: boolean;
  prodajniArtikel: boolean;
};

export type NormativItem = {
  vhodniArtikelId: number;
  kolicina: number;
};

export function requiresClassicNormativ(
  mealType: NormativOwner["mealType"],
  isMulticourseMenu: boolean,
): boolean {
  return mealType === "composite" && !isMulticourseMenu;
}

export function isAllowedOneToOneSelfNorm(
  owner: NormativOwner,
  articleId: number,
  items: NormativItem[],
): boolean {
  return items.length === 1
    && items[0]!.vhodniArtikelId === articleId
    && items[0]!.kolicina === 1
    && owner.mealType === "ala_carte"
    && owner.nabavniArtikel
    && owner.prodajniArtikel;
}