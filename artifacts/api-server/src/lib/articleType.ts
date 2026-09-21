export type ArticleType = "blago" | "material" | "storitev";

/**
 * Ob manjkajoči vrsti ima prednost prodajni namen artikla. Nabavni artikel,
 * ki ni hkrati prodajni, ostane material za zalogovne in prejemniške tokove.
 */
export function resolveArticleType(
  explicitType: string | null | undefined,
  flags: { nabavniArtikel?: boolean | null; prodajniArtikel?: boolean | null },
): string {
  if (explicitType != null) return explicitType;
  return flags.nabavniArtikel === true && flags.prodajniArtikel === false
    ? "material"
    : "storitev";
}