export type SplitStrategy = "cheapest" | "fewest_suppliers";

export interface SplitMapping {
  id: number;
  supplierId: string;
  supplierName: string;
  supplierItemName: string | null;
  packageName: string | null;
  packageFactor: number;
  lastPackagePrice: number | null;
  lastUnitPrice: number | null;
  minPackageQuantity: number | null;
}

export interface SplitArticle {
  articleId: number;
  articleName: string;
  baseUnit: string | null;
  suggestedBaseQuantity: number | null;
  preferredMappingId: number | null;
  mappings: SplitMapping[];
}

export interface SplitTerms {
  minOrderAmount: number | null;
  leadTimeDays: number | null;
}

export interface SplitLine {
  articleId: number;
  articleName: string;
  supplierMappingId: number;
  supplierItemName: string | null;
  packageName: string | null;
  packageQuantity: number;
  minPackageQuantity: number | null;
  moqRaised: boolean;
  unitPrice: number | null;
  lineTotal: number | null;
}

export interface SplitGroup {
  supplierId: string;
  supplierName: string;
  minOrderAmount: number | null;
  leadTimeDays: number | null;
  total: number | null;
  totalComplete: boolean;
  meetsMinimum: boolean | null;
  shortfall: number | null;
  lines: SplitLine[];
}

export interface SplitUnassigned {
  articleId: number;
  articleName: string;
  reason: "no_supplier" | "no_price";
}

export interface SplitProposal {
  strategy: SplitStrategy;
  groups: SplitGroup[];
  unassigned: SplitUnassigned[];
}

function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function usable(mapping: SplitMapping): boolean {
  return Number.isFinite(mapping.packageFactor) && mapping.packageFactor > 0;
}

function comparablePrice(mapping: SplitMapping): number | null {
  const price = mapping.lastUnitPrice;
  return price !== null && Number.isFinite(price) && price >= 0 ? price : null;
}

/** Cheapest priced mapping; equal prices prefer the article's preferred mapping, then the lowest id. */
function pickCheapest(article: SplitArticle, candidates: SplitMapping[]): SplitMapping | null {
  let best: SplitMapping | null = null;
  let bestPrice = Infinity;
  for (const mapping of candidates) {
    const price = comparablePrice(mapping);
    if (price === null) continue;
    const better = price < bestPrice
      || (price === bestPrice && best !== null
        && ((mapping.id === article.preferredMappingId && best.id !== article.preferredMappingId)
          || (best.id !== article.preferredMappingId && mapping.id < best.id)));
    if (best === null || better) {
      best = mapping;
      bestPrice = price;
    }
  }
  return best;
}

function buildLine(article: SplitArticle, mapping: SplitMapping): SplitLine {
  const needed = article.suggestedBaseQuantity ?? 0;
  const wanted = Math.max(1, Math.ceil(needed / mapping.packageFactor - 1e-9));
  const minimum = mapping.minPackageQuantity;
  const packageQuantity = minimum !== null && minimum > wanted ? Math.ceil(minimum) : wanted;
  const unitPrice = mapping.lastPackagePrice !== null && Number.isFinite(mapping.lastPackagePrice)
    && mapping.lastPackagePrice >= 0
    ? mapping.lastPackagePrice
    : null;
  return {
    articleId: article.articleId,
    articleName: article.articleName,
    supplierMappingId: mapping.id,
    supplierItemName: mapping.supplierItemName,
    packageName: mapping.packageName,
    packageQuantity,
    minPackageQuantity: minimum,
    moqRaised: packageQuantity > wanted,
    unitPrice,
    lineTotal: unitPrice === null ? null : roundMoney(unitPrice * packageQuantity),
  };
}

/**
 * Splits the articles that need reordering across suppliers. Every article with a
 * positive suggestion lands in exactly one supplier group, or in `unassigned`.
 */
export function buildSupplierSplit(
  articles: SplitArticle[],
  termsBySupplier: Map<string, SplitTerms>,
  strategy: SplitStrategy,
): SplitProposal {
  const needed = articles.filter(article =>
    article.suggestedBaseQuantity !== null && article.suggestedBaseQuantity > 0);
  const unassigned: SplitUnassigned[] = [];
  const picked = new Map<number, SplitMapping>();
  const candidatesByArticle = new Map<number, SplitMapping[]>();

  for (const article of needed) {
    const candidates = article.mappings.filter(usable);
    if (candidates.length === 0) {
      unassigned.push({ articleId: article.articleId, articleName: article.articleName, reason: "no_supplier" });
      continue;
    }
    candidatesByArticle.set(article.articleId, candidates);
  }
  const assignable = needed.filter(article => candidatesByArticle.has(article.articleId));

  if (strategy === "cheapest") {
    for (const article of assignable) {
      const candidates = candidatesByArticle.get(article.articleId)!;
      const mapping = pickCheapest(article, candidates);
      if (mapping) picked.set(article.articleId, mapping);
      else unassigned.push({ articleId: article.articleId, articleName: article.articleName, reason: "no_price" });
    }
  } else {
    const uncovered = new Set(assignable.map(article => article.articleId));
    const chosenSuppliers: string[] = [];
    while (uncovered.size > 0) {
      const coverage = new Map<string, { count: number; cost: number }>();
      for (const article of assignable) {
        if (!uncovered.has(article.articleId)) continue;
        const bySupplier = new Map<string, SplitMapping[]>();
        for (const mapping of candidatesByArticle.get(article.articleId)!) {
          bySupplier.set(mapping.supplierId, [...(bySupplier.get(mapping.supplierId) ?? []), mapping]);
        }
        for (const [supplierId, mappings] of bySupplier) {
          const mapping = pickCheapest(article, mappings) ?? mappings[0]!;
          const line = buildLine(article, mapping);
          const entry = coverage.get(supplierId) ?? { count: 0, cost: 0 };
          entry.count += 1;
          entry.cost += line.lineTotal ?? 0;
          coverage.set(supplierId, entry);
        }
      }
      const ranked = [...coverage.entries()].sort((a, b) =>
        b[1].count - a[1].count || a[1].cost - b[1].cost || a[0].localeCompare(b[0]));
      const winner = ranked[0]?.[0];
      if (!winner) break;
      chosenSuppliers.push(winner);
      for (const article of assignable) {
        if (!uncovered.has(article.articleId)) continue;
        const mappings = candidatesByArticle.get(article.articleId)!
          .filter(mapping => mapping.supplierId === winner);
        if (mappings.length === 0) continue;
        picked.set(article.articleId, pickCheapest(article, mappings) ?? mappings[0]!);
        uncovered.delete(article.articleId);
      }
    }
  }

  const groupsBySupplier = new Map<string, SplitGroup>();
  for (const article of assignable) {
    const mapping = picked.get(article.articleId);
    if (!mapping) continue;
    const terms = termsBySupplier.get(mapping.supplierId);
    const group = groupsBySupplier.get(mapping.supplierId) ?? {
      supplierId: mapping.supplierId,
      supplierName: mapping.supplierName,
      minOrderAmount: terms?.minOrderAmount ?? null,
      leadTimeDays: terms?.leadTimeDays ?? null,
      total: null,
      totalComplete: true,
      meetsMinimum: null,
      shortfall: null,
      lines: [],
    };
    group.lines.push(buildLine(article, mapping));
    groupsBySupplier.set(mapping.supplierId, group);
  }

  const groups = [...groupsBySupplier.values()].map(group => {
    const totalComplete = group.lines.every(line => line.lineTotal !== null);
    const total = roundMoney(group.lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0));
    let meetsMinimum: boolean | null = null;
    let shortfall: number | null = null;
    if (group.minOrderAmount !== null) {
      if (total >= group.minOrderAmount) {
        meetsMinimum = true;
        shortfall = 0;
      } else if (totalComplete) {
        meetsMinimum = false;
        shortfall = roundMoney(group.minOrderAmount - total);
      }
    }
    return { ...group, total, totalComplete, meetsMinimum, shortfall };
  }).sort((a, b) => a.supplierName.localeCompare(b.supplierName, "sl"));

  unassigned.sort((a, b) => a.articleName.localeCompare(b.articleName, "sl"));
  return { strategy, groups, unassigned };
}
