import Decimal from "decimal.js";
import { isIP } from "node:net";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { artikliTable, db, normativiTable } from "@workspace/db";
import { isPreparedFoodBulkUnit } from "./prepared-food-units";

export const NormativeComparisonRequestSchema = z.object({
  artikelId: z.number().int().positive(),
  forceRefresh: z.boolean().optional().default(false),
}).strict();

const finiteQuantity = z.coerce.number().finite().nonnegative().max(1_000_000);
export const ResearchFindingSchema = z.object({
  ingredient: z.string().trim().min(1).max(200),
  quantity: finiteQuantity,
  unit: z.string().trim().min(1).max(30),
  servings: z.coerce.number().finite().positive().max(100_000),
  sourceUrl: z.string().trim().url().max(2_000),
}).strict();
export const ResearchResponseSchema = z.object({
  findings: z.array(ResearchFindingSchema).max(100),
}).strict();

export type LocalNormative = {
  artikelId: number;
  revision: number;
  targetName: string;
  enotaMere?: string | null;
  mealType?: "ala_carte" | "prepared" | "composite" | null;
  rows: Array<{ normativRowId: number; ingredientId: number; ingredientName: string; quantity: number; unit: string | null }>;
};

export const PREPARED_BULK_COMPARISON_MESSAGE =
  "Primerjava spletnih receptov temelji na količinah na porcijo. Za pripravljeno jed, ki se meri v kg ali l, primerjava ni varna; potreben je ročni normativ na kg/l.";

export function isPreparedFoodBulkNormative(local: Pick<LocalNormative, "mealType" | "enotaMere">): boolean {
  return local.mealType === "prepared" && isPreparedFoodBulkUnit(local.enotaMere);
}

export const NORMATIVE_COMPARISON_CACHE_TTL_MS = 5 * 60_000;
const NORMATIVE_COMPARISON_CACHE_MAX_ENTRIES = 100;
export const NORMATIVE_COMPARISON_MAX_IN_FLIGHT = 20;
export const NORMATIVE_COMPARISON_MAX_IN_FLIGHT_PER_TENANT = 4;

type CachedNormativeComparison = {
  expiresAt: number;
  value: z.infer<typeof NormativeComparisonResponseSchema>;
};

const normativeComparisonCache = new Map<string, CachedNormativeComparison>();
const normativeComparisonInFlight = new Map<string, {
  enotaId: number;
  promise: Promise<z.infer<typeof NormativeComparisonResponseSchema>>;
}>();

export function buildNormativeComparisonCacheKey(local: LocalNormative, enotaId: number): string {
  const rows = [...local.rows]
    .sort((a, b) => a.normativRowId - b.normativRowId || a.ingredientId - b.ingredientId)
    .map(row => ({
      normativRowId: row.normativRowId,
      ingredientId: row.ingredientId,
      ingredientName: row.ingredientName,
      quantity: canonicalDecimal(row.quantity),
      unit: row.unit,
    }));
  const fingerprint = createHash("sha256").update(JSON.stringify({
    enotaId,
    artikelId: local.artikelId,
    targetName: local.targetName,
    revision: local.revision,
    enotaMere: local.enotaMere ?? null,
    mealType: local.mealType ?? null,
    rows,
  })).digest("hex");
  return `normative-comparison:${enotaId}:${local.artikelId}:${fingerprint}`;
}

function pruneNormativeComparisonCache(now: number): void {
  for (const [key, entry] of normativeComparisonCache) {
    if (entry.expiresAt <= now) normativeComparisonCache.delete(key);
  }
  while (normativeComparisonCache.size >= NORMATIVE_COMPARISON_CACHE_MAX_ENTRIES) {
    const oldestKey = normativeComparisonCache.keys().next().value;
    if (!oldestKey) break;
    normativeComparisonCache.delete(oldestKey);
  }
}

export async function getCachedNormativeComparison(
  local: LocalNormative,
  enotaId: number,
  loader: () => Promise<z.infer<typeof NormativeComparisonResponseSchema>>,
  options: { forceRefresh?: boolean; now?: number; ttlMs?: number } = {},
): Promise<{ comparison: z.infer<typeof NormativeComparisonResponseSchema>; cacheHit: boolean; coalesced: boolean }> {
  const now = options.now ?? Date.now();
  const key = buildNormativeComparisonCacheKey(local, enotaId);
  const cached = normativeComparisonCache.get(key);
  if (!options.forceRefresh && cached && cached.expiresAt > now) {
    // Refresh insertion order for the bounded LRU-like map without changing the value or its evidence timestamps.
    normativeComparisonCache.delete(key);
    normativeComparisonCache.set(key, cached);
    return { comparison: cached.value, cacheHit: true, coalesced: false };
  }
  const pending = normativeComparisonInFlight.get(key);
  if (pending) return { comparison: await pending.promise, cacheHit: false, coalesced: true };
  const tenantInFlight = [...normativeComparisonInFlight.values()].filter(entry => entry.enotaId === enotaId).length;
  if (normativeComparisonInFlight.size >= NORMATIVE_COMPARISON_MAX_IN_FLIGHT
    || tenantInFlight >= NORMATIVE_COMPARISON_MAX_IN_FLIGHT_PER_TENANT) {
    throw new Error("RESEARCH_BUSY");
  }

  const loadPromise = loader().then(comparison => {
    pruneNormativeComparisonCache(now);
    normativeComparisonCache.delete(key);
    normativeComparisonCache.set(key, {
      expiresAt: now + (options.ttlMs ?? NORMATIVE_COMPARISON_CACHE_TTL_MS),
      value: comparison,
    });
    return comparison;
  }).finally(() => {
    if (normativeComparisonInFlight.get(key)?.promise === loadPromise) normativeComparisonInFlight.delete(key);
  });
  normativeComparisonInFlight.set(key, { enotaId, promise: loadPromise });
  return { comparison: await loadPromise, cacheHit: false, coalesced: false };
}

export function clearNormativeComparisonCache(): void {
  normativeComparisonCache.clear();
  normativeComparisonInFlight.clear();
}
export type Dimension = "mass" | "volume" | "count";
export type NormalizedQuantity = { dimension: Dimension; value: Decimal; baseUnit: "mg" | "ml" | "count"; canonicalUnit: string; factor: Decimal };

/** Normalizes intentionally only unambiguous units. Culinary measures are not weights. */
export function normalizeQuantity(quantity: number | string, unit: string | null | undefined): NormalizedQuantity | null {
  if (!unit) return null;
  let amount: Decimal;
  try { amount = new Decimal(quantity); } catch { return null; }
  if (!amount.isFinite() || amount.isNegative()) return null;
  const normalized = unit.trim().toLocaleLowerCase("sl").replace(/\.$/u, "");
  const units: Record<string, [Dimension, Decimal.Value, NormalizedQuantity["baseUnit"]]> = {
    mg: ["mass", 1, "mg"], milligram: ["mass", 1, "mg"], milligrams: ["mass", 1, "mg"], miligram: ["mass", 1, "mg"], miligramov: ["mass", 1, "mg"],
    g: ["mass", 1000, "mg"], gr: ["mass", 1000, "mg"], gram: ["mass", 1000, "mg"], grams: ["mass", 1000, "mg"], gramov: ["mass", 1000, "mg"],
    kg: ["mass", 1_000_000, "mg"], kilogram: ["mass", 1_000_000, "mg"], kilograms: ["mass", 1_000_000, "mg"], kilogramov: ["mass", 1_000_000, "mg"],
    ml: ["volume", 1, "ml"], milliliter: ["volume", 1, "ml"], milliliters: ["volume", 1, "ml"], mililiter: ["volume", 1, "ml"], mililitrov: ["volume", 1, "ml"],
    cl: ["volume", 10, "ml"], centiliter: ["volume", 10, "ml"], dl: ["volume", 100, "ml"], deciliter: ["volume", 100, "ml"],
    l: ["volume", 1000, "ml"], lt: ["volume", 1000, "ml"], liter: ["volume", 1000, "ml"], liters: ["volume", 1000, "ml"], literov: ["volume", 1000, "ml"],
    kos: ["count", 1, "count"], kosa: ["count", 1, "count"], kosi: ["count", 1, "count"], piece: ["count", 1, "count"], pieces: ["count", 1, "count"], pc: ["count", 1, "count"], pcs: ["count", 1, "count"], item: ["count", 1, "count"],
  };
  const found = units[normalized];
  if (!found) return null;
  const canonical = normalized === "gr" || normalized.startsWith("gram") || normalized.startsWith("miligram") ? (normalized.startsWith("m") ? "mg" : "g")
    : normalized === "lt" || normalized.startsWith("liter") ? "l" : normalized;
  return { dimension: found[0], value: amount.mul(found[1]), baseUnit: found[2], canonicalUnit: canonical, factor: new Decimal(found[1]) };
}

export async function loadTenantNormative(artikelId: number, enotaId: number): Promise<LocalNormative | null> {
  const targets = await db.select({
    id: artikliTable.id, ime: artikliTable.ime, revision: artikliTable.normativRevision,
    enotaMere: artikliTable.enotaMere, mealType: artikliTable.mealType,
  })
    .from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId))).limit(1);
  if (!targets[0]) return null;
  const ingredient = artikliTable;
  const rows = await db.select({
    normativRowId: normativiTable.id, ingredientId: ingredient.id, ingredientName: ingredient.ime, quantity: normativiTable.kolicina, unit: ingredient.enotaMere,
  }).from(normativiTable)
    .innerJoin(ingredient, eq(normativiTable.vhodniArtikelId, ingredient.id))
    .where(and(eq(normativiTable.artikelId, artikelId), eq(ingredient.enotaId, enotaId)));
  // A partial result would conceal a cross-tenant corrupt reference; reject it instead.
  const allRows = await db.select({ id: normativiTable.id }).from(normativiTable).where(eq(normativiTable.artikelId, artikelId));
  if (!rows.length || rows.length !== allRows.length) return null;
  return {
    artikelId, revision: targets[0].revision, targetName: targets[0].ime,
    enotaMere: targets[0].enotaMere, mealType: targets[0].mealType,
    rows: rows.map(row => ({
      ...row, quantity: Number(row.quantity),
    })),
  };
}

export type ComparisonRow = {
  normativRowId: number; ingredientId: number; ingredientName: string; localQuantity: number; localUnit: string | null;
  externalQuantity: number | null; externalUnit: string | null; servings: number | null;
  sourceUrl: string | null; sourceTitle: string | null; proposalToken: string | null; localNormalizedQuantity: number | null; externalNormalizedQuantity: number | null; comparisonUnit: string | null;
  status: "comparable" | "missing" | "incomparable"; difference: number | null; percentDifference: number | null;
};

export function compareNormative(local: LocalNormative, findings: z.infer<typeof ResearchFindingSchema>[]): ComparisonRow[] {
  const allowed = new Map(local.rows.map(row => [row.ingredientName.trim().toLocaleLowerCase("sl"), row]));
  const selected = new Map<string, z.infer<typeof ResearchFindingSchema>[]>();
  for (const finding of findings) {
    const key = finding.ingredient.trim().toLocaleLowerCase("sl");
    if (allowed.has(key)) selected.set(key, [...(selected.get(key) ?? []), finding]);
  }
  return local.rows.flatMap<ComparisonRow>(row => {
    const ingredientFindings = selected.get(row.ingredientName.trim().toLocaleLowerCase("sl")) ?? [];
    if (!ingredientFindings.length) return [{ normativRowId: row.normativRowId, ingredientId: row.ingredientId, ingredientName: row.ingredientName, localQuantity: row.quantity, localUnit: row.unit, externalQuantity: null, externalUnit: null, servings: null, sourceUrl: null, sourceTitle: null, proposalToken: null, localNormalizedQuantity: null, externalNormalizedQuantity: null, comparisonUnit: null, status: "missing" as const, difference: null, percentDifference: null }];
    return ingredientFindings.map(finding => {
    const localValue = normalizeQuantity(row.quantity, row.unit);
    const externalValue = normalizeQuantity(new Decimal(finding.quantity).div(finding.servings).toNumber(), finding.unit);
    const base = { normativRowId: row.normativRowId, ingredientId: row.ingredientId, ingredientName: row.ingredientName, localQuantity: row.quantity, localUnit: row.unit, externalQuantity: finding.quantity / finding.servings, externalUnit: finding.unit, servings: finding.servings, sourceUrl: finding.sourceUrl, sourceTitle: null, proposalToken: null };
    if (!localValue || !externalValue || localValue.dimension !== externalValue.dimension) return { ...base, localNormalizedQuantity: null, externalNormalizedQuantity: null, comparisonUnit: null, status: "incomparable" as const, difference: null, percentDifference: null };
    const externalInLocalUnit = externalValue.value.div(localValue.factor);
    const localInLocalUnit = localValue.value.div(localValue.factor);
    const difference = externalInLocalUnit.minus(localInLocalUnit);
    return { ...base, localNormalizedQuantity: localInLocalUnit.toNumber(), externalNormalizedQuantity: externalInLocalUnit.toNumber(), comparisonUnit: localValue.canonicalUnit, status: "comparable" as const, difference: difference.toNumber(), percentDifference: localInLocalUnit.isZero() ? null : difference.div(localInLocalUnit).mul(100).toNumber() };
    });
  });
}

export const NormativeComparisonResponseSchema = z.object({
  generatedAt: z.string().datetime(), localNormative: z.object({ artikelId: z.number().int(), revision: z.number().int().positive(), targetName: z.string(), rows: z.array(z.object({ normativRowId: z.number().int(), ingredientId: z.number().int(), ingredientName: z.string(), quantity: z.number(), unit: z.string().nullable() })) }),
  rows: z.array(z.object({ normativRowId: z.number().int(), ingredientId: z.number().int(), ingredientName: z.string(), localQuantity: z.number(), localUnit: z.string().nullable(), externalQuantity: z.number().nullable(), externalUnit: z.string().nullable(), servings: z.number().nullable(), sourceUrl: z.string().url().nullable(), sourceTitle: z.string().nullable(), proposalToken: z.string().nullable(), localNormalizedQuantity: z.number().nullable(), externalNormalizedQuantity: z.number().nullable(), comparisonUnit: z.string().nullable(), status: z.enum(["comparable", "missing", "incomparable"]), difference: z.number().nullable(), percentDifference: z.number().nullable() })),
  sources: z.array(z.object({ url: z.string().url(), title: z.string(), checkedAt: z.string().datetime(), pageDate: z.string().nullable() })),
  warnings: z.array(z.string()), disclaimer: z.string(),
}).strict();

/** Public editorial/institutional publishers. URLs are never server-fetched or redirected. */
export const APPROVED_RECIPE_DOMAINS = ["bbcgoodfood.com", "theguardian.com", "seriouseats.com", "epicurious.com", "allrecipes.com", "tasteofhome.com", "delish.com", "foodnetwork.com", "kingarthurbaking.com", "jamieoliver.com"] as const;
function approvedHost(host: string): boolean { return APPROVED_RECIPE_DOMAINS.some(domain => host === domain || host.endsWith(`.${domain}`)); }
function isReservedIp(host: string): boolean {
  const version = isIP(host);
  if (!version) return false;
  if (version === 4) {
    const [a, b] = host.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19)) || a >= 240;
  }
  const normalized = host.toLowerCase().replace(/^::ffff:/u, "");
  if (isIP(normalized) === 4) return isReservedIp(normalized);
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") || normalized.startsWith("fd") || /^fe[89ab]/u.test(normalized) || normalized.startsWith("ff") || normalized.startsWith("2001:db8");
}
export function isSafeResearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password && !isReservedIp(host) && approvedHost(host);
  } catch { return false; }
}

export type NormativeProposalPayload = {
  v: 1; artikelId: number; expectedRevision: number; normativRowId: number; ingredientId: number;
  expectedQuantity: string; localUnit: string; proposedQuantity: string;
  sourceUrl: string; sourceTitle: string; generatedAt: string;
};
const proposalPayloadSchema = z.object({
  v: z.literal(1), artikelId: z.number().int().positive(), expectedRevision: z.number().int().positive(), normativRowId: z.number().int().positive(),
  ingredientId: z.number().int().positive(), expectedQuantity: z.string().max(30),
  localUnit: z.string().trim().min(1).max(30), proposedQuantity: z.string().max(30),
  sourceUrl: z.string().url().max(2_000), sourceTitle: z.string().trim().min(1).max(500),
  generatedAt: z.string().datetime(),
}).strict();
const proposalSecret = (): string | undefined => process.env.POS_NORMATIVE_PROPOSAL_SECRET || process.env.SESSION_SECRET;
export function canonicalDecimal(value: Decimal.Value): string {
  return new Decimal(value).toFixed();
}
function validProposalPayload(value: unknown): NormativeProposalPayload | null {
  const parsed = proposalPayloadSchema.safeParse(value);
  if (!parsed.success || !isSafeResearchUrl(parsed.data.sourceUrl)) return null;
  try {
    const expected = new Decimal(parsed.data.expectedQuantity);
    const proposed = new Decimal(parsed.data.proposedQuantity);
    if (!expected.isFinite() || expected.isNegative() || expected.gt("999999.9999") || !proposed.isFinite() || !proposed.isPositive() || proposed.gt("999999.9999") || proposed.eq(expected)
      || expected.decimalPlaces()! > 4 || proposed.decimalPlaces()! > 4
      || parsed.data.expectedQuantity !== canonicalDecimal(expected) || parsed.data.proposedQuantity !== canonicalDecimal(proposed)) return null;
  } catch { return null; }
  return parsed.data;
}
/** A compact server-only HMAC envelope. Null means signing is deliberately unavailable. */
export function signNormativeProposal(payload: NormativeProposalPayload): string | null {
  const secret = proposalSecret();
  if (!secret || !validProposalPayload(payload)) return null;
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}
export function verifyNormativeProposal(token: string, now = Date.now()): NormativeProposalPayload | null {
  const secret = proposalSecret();
  if (!secret || typeof token !== "string" || token.length > 8_000) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  let actual: Buffer;
  try { actual = Buffer.from(signature, "base64url"); } catch { return null; }
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const payload = validProposalPayload(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    const generated = payload ? Date.parse(payload.generatedAt) : NaN;
    return payload && generated >= now - 30 * 60_000 && generated <= now + 5 * 60_000 ? payload : null;
  } catch { return null; }
}

export type CheckedResearchSource = { url: string; title: string; checkedAt: string; pageDate: string | null };
/** Only typed server tool result children are evidence; arbitrary content is not traversed. */
export function filterResearchSources(toolBlocks: unknown[], requestedUrls: string[], checkedAt = new Date().toISOString()): CheckedResearchSource[] {
  const found = new Map<string, { title: string; pageDate: string | null }>();
  for (const block of toolBlocks) {
    if (!block || typeof block !== "object") continue;
    const outer = block as Record<string, unknown>;
    if (outer.type !== "web_search_tool_result" || !Array.isArray(outer.content)) continue;
    for (const child of outer.content) {
      if (!child || typeof child !== "object") continue;
      const result = child as Record<string, unknown>;
      if (result.type !== "web_search_result" || typeof result.url !== "string" || typeof result.title !== "string" || !isSafeResearchUrl(result.url)) continue;
      found.set(result.url, { title: result.title.slice(0, 500), pageDate: typeof result.page_age === "string" ? result.page_age : typeof result.published_date === "string" ? result.published_date : null });
    }
  }
  return [...new Set(requestedUrls)].flatMap(url => {
    const source = found.get(url);
    return source ? [{ url, ...source, checkedAt }] : [];
  });
}