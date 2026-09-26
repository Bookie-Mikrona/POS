export type NormativArticleCandidate = {
  id?: number;
  nabavniArtikel?: boolean | null;
  prodajniArtikel?: boolean | null;
  mealType?: string | null;
  taxCategory?: string | null;
  hasNormativ?: boolean | null;
};

export function canEditNormativ(article: NormativArticleCandidate): boolean {
  return article.prodajniArtikel === true
    || article.mealType === "prepared"
    || article.mealType === "composite"
    || (article.mealType === "ala_carte"
      && article.taxCategory === "food"
      && article.prodajniArtikel === false
      && article.nabavniArtikel === false);
}

export function canOfferSmartNormativ(article: NormativArticleCandidate): boolean {
  return article.prodajniArtikel === true
    || (article.prodajniArtikel === false
      && article.nabavniArtikel === false
      && article.taxCategory === "food"
      && (article.mealType === "ala_carte" || article.mealType === "prepared"));
}

export function canUseAsModifierNormativInput(article: NormativArticleCandidate): boolean {
  return article.nabavniArtikel === true
    || (article.nabavniArtikel === false
      && article.prodajniArtikel === false
      && article.taxCategory === "food"
      && (article.mealType === "ala_carte" || article.mealType === "prepared"));
}

export function canUseAsNormativInput(
  ownerId: number | null,
  ownerMealType: string,
  candidate: NormativArticleCandidate,
): boolean {
  if (ownerId !== null && candidate.id === ownerId) return false;
  if (ownerMealType === "composite") {
    return candidate.mealType === "ala_carte" || candidate.mealType === "prepared";
  }
  if (ownerMealType === "prepared") {
    return candidate.nabavniArtikel === true || candidate.mealType === "prepared";
  }
  return candidate.nabavniArtikel === true;
}

export type CompositeInputGroup = "intermediate" | "sale_ala_carte" | "other";

export function compositeInputGroup(candidate: NormativArticleCandidate): CompositeInputGroup {
  if (candidate.prodajniArtikel === false && candidate.nabavniArtikel === false
    && (candidate.mealType === "ala_carte" || candidate.mealType === "prepared")) return "intermediate";
  if (candidate.prodajniArtikel === true && candidate.mealType === "ala_carte") return "sale_ala_carte";
  return "other";
}

export function normativSectionTitle(mealType: string, prodajniArtikel = true): string {
  if (mealType === "composite") return "Sestavljeni normativ";
  if (mealType === "prepared") return "Normativ priprave";
  return prodajniArtikel ? "Normativ za prodajo" : "Normativ polizdelka";
}