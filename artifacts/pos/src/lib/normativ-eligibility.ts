export type NormativArticleCandidate = {
  id?: number;
  nabavniArtikel?: boolean | null;
  prodajniArtikel?: boolean | null;
  mealType?: string | null;
  hasNormativ?: boolean | null;
};

export function canEditNormativ(article: NormativArticleCandidate): boolean {
  return article.prodajniArtikel === true
    || article.mealType === "prepared"
    || article.mealType === "composite";
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

export function normativSectionTitle(mealType: string): string {
  if (mealType === "composite") return "Sestavljeni normativ";
  if (mealType === "prepared") return "Normativ priprave";
  return "Normativ za prodajo";
}