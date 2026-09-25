import Decimal from "decimal.js";
import { createHmac, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import { z } from "zod";
import {
  APPROVED_RECIPE_DOMAINS,
  isSafeResearchUrl,
} from "./normative-comparison";

export type InitialNormativeUnit = "KGM" | "LTR" | "KOM";
export type InitialNormativeItem = {
  name: string;
  quantity: number;
  unit: InitialNormativeUnit;
  existingArticleId: number | null;
  willCreate: boolean;
  sourceUrls: string[];
};
export type InitialNormativeSource = { url: string; title: string };

/** A single named alcoholic drink with a serving size is not a web recipe. */
export function singleIngredientDrinkFromName(
  name: string,
  taxCategory: string | null,
): { name: string; quantity: string; unit: "LTR"; sourceUrls: [] } | null {
  if (taxCategory !== "alcoholic") return null;
  const match = /^([\p{L}\p{M}][\p{L}\p{M}'’-]*)\s+(\d+(?:[,.]\d+)?)\s*(ml|cl|l)$/iu.exec(name.trim());
  if (!match) return null;
  const factor = match[3]!.toLowerCase() === "ml" ? "0.001" : match[3]!.toLowerCase() === "cl" ? "0.01" : "1";
  const quantity = new Decimal(match[2]!.replace(",", ".")).mul(factor);
  if (quantity.lte(0) || quantity.gt(2) || quantity.decimalPlaces() > 4) return null;
  return { name: match[1]!, quantity: quantity.toFixed(), unit: "LTR", sourceUrls: [] };
}

/** Product evidence for a single-ingredient serving; never treat the menu volume as a web-sourced recipe. */
function isSafeCatalogSourceUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    return url.protocol === "https:" && !url.username && !url.password
      && !isIP(host) && host.includes(".") && !host.endsWith(".local")
      && !host.endsWith(".internal") && !host.endsWith(".test") && !host.endsWith(".example");
  } catch { return false; }
}

/** Initial suggestions may cite Slovenian supplier/search results; the URL alone proves no SKU or recipe quantity. */
function isSafeInitialSourceUrl(value: string): boolean {
  if (isSafeResearchUrl(value)) return true;
  if (!isSafeCatalogSourceUrl(value)) return false;
  return new URL(value).hostname.toLowerCase().endsWith(".si");
}

function filterInitialSources(content: unknown[], requestedUrls: string[]): InitialNormativeSource[] {
  const found = new Map<string, string>();
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const result = block as { type?: unknown; content?: unknown };
    if (result.type !== "web_search_tool_result" || !Array.isArray(result.content)) continue;
    for (const child of result.content) {
      if (!child || typeof child !== "object") continue;
      const source = child as { type?: unknown; url?: unknown; title?: unknown };
      if (source.type === "web_search_result" && typeof source.url === "string"
        && typeof source.title === "string" && isSafeInitialSourceUrl(source.url)) {
        found.set(source.url, source.title.slice(0, 500));
      }
    }
  }
  return [...new Set(requestedUrls)].flatMap(url => {
    const title = found.get(url);
    return title ? [{ url, title }] : [];
  });
}

const CatalogDrinkResponseSchema = z.object({
  sourceUrl: z.string().url().max(2_000),
  productName: z.string().trim().min(1).max(200),
  isSingleIngredientDrink: z.literal(true),
}).strict();

export function normalizeCatalogDrinkResearch(
  content: unknown[],
  expectedName: string,
): InitialNormativeSource[] {
  const parsed = CatalogDrinkResponseSchema.safeParse(extractInitialRecipeJson(content));
  if (!parsed.success || !isSafeCatalogSourceUrl(parsed.data.sourceUrl)) {
    throw new InitialNormativeError("CATALOG_PRODUCT_NOT_VERIFIED");
  }
  const expected = normalizeIngredientName(expectedName);
  const productName = normalizeIngredientName(parsed.data.productName);
  if (!expected || !productName.includes(expected)) throw new InitialNormativeError("CATALOG_PRODUCT_NOT_VERIFIED");
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const result = block as { type?: unknown; content?: unknown };
    if (result.type !== "web_search_tool_result" || !Array.isArray(result.content)) continue;
    for (const child of result.content) {
      if (!child || typeof child !== "object") continue;
      const source = child as { type?: unknown; url?: unknown; title?: unknown };
      if (source.type !== "web_search_result" || source.url !== parsed.data.sourceUrl
        || typeof source.title !== "string" || !normalizeIngredientName(source.title).includes(expected)) continue;
      return [{ url: parsed.data.sourceUrl, title: source.title.slice(0, 500) }];
    }
  }
  throw new InitialNormativeError("CATALOG_PRODUCT_NOT_VERIFIED");
}

const RecipeNumber = z.union([
  z.number(),
  z.string().trim().regex(/^\d+(?:[.,]\d+)?$/u).transform(value => Number(value.replace(",", "."))),
]);

const RecipeResponseSchema = z.object({
  recipes: z.array(z.object({
    sourceUrl: z.string().url().max(2_000),
    servings: RecipeNumber.pipe(z.number().finite().positive().max(100_000)),
    ingredients: z.array(z.object({
      name: z.string().trim().min(1).max(200),
      quantity: RecipeNumber.pipe(z.number().finite().positive().max(1_000_000)),
      unit: z.string().trim().min(1).max(30),
    })).min(1).max(100),
  })).max(4),
});

const EstimateResponseSchema = z.object({
  estimate: z.object({
    sourceUrl: z.string().url().max(2_000),
    items: z.array(z.object({
      name: z.string().trim().min(1).max(200),
      quantity: RecipeNumber.pipe(z.number().finite().positive().max(1_000_000)),
      unit: z.enum(["kg", "g", "l", "ml", "kos"]),
    })).min(1).max(100),
  }),
});

/** Portion labels are not recipe ingredients; keep the original article name in the signed proposal. */
export function recipeSearchName(articleName: string): string {
  return articleName.trim().replace(/\s+[-–—]\s*(?:velika|velik|veliko|mala|majhna|majhen|majhno)\s*$/iu, "").trim();
}

/** Only typed web-search results may provide source URLs for a second structured response. */
export function initialRecipeSearchSources(content: unknown[]): InitialNormativeSource[] {
  const requestedUrls: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const result = block as { type?: unknown; content?: unknown };
    if (result.type !== "web_search_tool_result" || !Array.isArray(result.content)) continue;
    for (const child of result.content) {
      if (!child || typeof child !== "object") continue;
      const source = child as { type?: unknown; url?: unknown };
      if (source.type === "web_search_result" && typeof source.url === "string") requestedUrls.push(source.url);
    }
  }
  return filterInitialSources(content, requestedUrls)
    .sort((a, b) => Number(new URL(b.url).hostname.endsWith(".si"))
      - Number(new URL(a.url).hostname.endsWith(".si")))
    .slice(0, 4);
}

type Measure = { code: InitialNormativeUnit; base: "kg" | "l" | "piece"; factor: Decimal };
const MEASURES: Record<string, Measure> = {
  g: { code: "KGM", base: "kg", factor: new Decimal("0.001") },
  kg: { code: "KGM", base: "kg", factor: new Decimal(1) },
  ml: { code: "LTR", base: "l", factor: new Decimal("0.001") },
  l: { code: "LTR", base: "l", factor: new Decimal(1) },
  kos: { code: "KOM", base: "piece", factor: new Decimal(1) },
};

function measureFor(unit: string): Measure | null {
  return MEASURES[unit.trim().toLocaleLowerCase("sl").replace(/\.$/u, "")] ?? null;
}

export function normalizeIngredientName(name: string): string {
  return name.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sl").replace(/[^\p{Letter}\p{Number}]+/gu, " ").trim().replace(/\s+/gu, " ");
}

export function isDetectablyPreparedIngredient(name: string): boolean {
  return /\b(polpripravlj(en|ena|eni|eno)|semi[\s-]?prepared|ready[\s-]?made|prepared ingredient|omaka|sauce|broth|stock|jušna osnova|kocka za juho|temeljec|pesto|ketchup|kečap|mayonnaise|majoneza|testo|dough|mešanica začimb|spice mix)\b/iu.test(name);
}

export function extractInitialRecipeJson(content: unknown[]): unknown | null {
  for (const block of content) {
    if (!block || typeof block !== "object" || (block as { type?: string }).type !== "text") continue;
    const text = (block as { text?: unknown }).text;
    if (typeof text !== "string") continue;
    const candidate = text.replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "").trim();
    try { return JSON.parse(candidate); } catch {
      const start = candidate.indexOf("{");
      const end = candidate.lastIndexOf("}");
      if (start >= 0 && end > start) try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* try next text block */ }
    }
  }
  return null;
}

export class InitialNormativeError extends Error {
  constructor(public readonly code: string) { super(code); }
}

/** Validates model-supplied recipe structure and typed URL evidence; it cannot verify recipe content. */
export function normalizeInitialRecipeResearch(
  content: unknown[],
): { origin: "web_recipe" | "web_estimate"; items: Array<{ name: string; quantity: string; unit: InitialNormativeUnit; sourceUrls: string[] }>; sources: InitialNormativeSource[] } {
  const payloads = content
    .filter(block => block && typeof block === "object" && (block as { type?: string }).type === "text")
    .map(block => extractInitialRecipeJson([block]));
  const candidates = payloads.map(payload => RecipeResponseSchema.safeParse(payload));
  const parsed = candidates.find(candidate => candidate.success && candidate.data.recipes.length >= 2)
    ?? candidates.find(candidate => candidate.success);
  if (!parsed?.success || parsed.data.recipes.length < 2) {
    const estimate = payloads.map(payload => EstimateResponseSchema.safeParse(payload))
      .find(candidate => candidate.success);
    if (estimate?.success) {
      const { sourceUrl } = estimate.data.estimate;
      const [source] = filterInitialSources(content, [sourceUrl]);
      if (!source) throw new InitialNormativeError("RESEARCH_INSUFFICIENT_SOURCES");
      const keys = new Set<string>();
      const items = estimate.data.estimate.items.map(item => {
        const key = normalizeIngredientName(item.name);
        const measure = measureFor(item.unit);
        if (!key || !measure || isDetectablyPreparedIngredient(item.name)) {
          throw new InitialNormativeError("RECIPE_AMBIGUOUS_INGREDIENT");
        }
        if (keys.has(key)) throw new InitialNormativeError("RECIPE_DUPLICATE_INGREDIENT");
        keys.add(key);
        const quantity = new Decimal(item.quantity).mul(measure.factor);
        if (!quantity.isFinite() || !quantity.isPositive() || quantity.gt("999999.9999")
          || quantity.decimalPlaces() > 4) throw new InitialNormativeError("RECIPE_INVALID_QUANTITY");
        return { name: item.name, quantity: quantity.toFixed(), unit: measure.code, sourceUrls: [sourceUrl] };
      });
      return { origin: "web_estimate", items, sources: [{ url: source.url, title: source.title }] };
    }
    if (parsed?.success) throw new InitialNormativeError("RESEARCH_INSUFFICIENT_SOURCES");
    throw new InitialNormativeError("RESEARCH_INVALID");
  }
  const requestedUrls = parsed.data.recipes.map(recipe => recipe.sourceUrl);
  const verifiedSources = filterInitialSources(content, requestedUrls);
  const sourceByUrl = new Map(verifiedSources.map(source => [source.url, source]));
  const recipes = parsed.data.recipes.filter(recipe => sourceByUrl.has(recipe.sourceUrl));
  if (recipes.length !== parsed.data.recipes.length) throw new InitialNormativeError("RESEARCH_INSUFFICIENT_SOURCES");
  const domains = new Set(recipes.map(recipe => {
    const hostname = new URL(recipe.sourceUrl).hostname.toLowerCase();
    return APPROVED_RECIPE_DOMAINS.find(domain => hostname === domain || hostname.endsWith(`.${domain}`))!;
  }));
  if (recipes.length < 2 || domains.size < 2) throw new InitialNormativeError("RESEARCH_INSUFFICIENT_SOURCES");

  const indexedRecipes = recipes.map(recipe => {
    const ingredients = new Map<string, { name: string; amount: Decimal; measure: Measure }>();
    for (const ingredient of recipe.ingredients) {
      const key = normalizeIngredientName(ingredient.name);
      const measure = measureFor(ingredient.unit);
      if (!key || !measure || isDetectablyPreparedIngredient(ingredient.name)) {
        throw new InitialNormativeError("RECIPE_AMBIGUOUS_INGREDIENT");
      }
      if (ingredients.has(key)) throw new InitialNormativeError("RECIPE_DUPLICATE_INGREDIENT");
      const amount = new Decimal(ingredient.quantity).mul(measure.factor).div(recipe.servings);
      if (!amount.isFinite() || !amount.isPositive()) throw new InitialNormativeError("RECIPE_INVALID_QUANTITY");
      ingredients.set(key, { name: ingredient.name.trim(), amount, measure });
    }
    return { ingredients, sourceUrl: recipe.sourceUrl };
  });
  const first = indexedRecipes[0]!;
  const names = [...first.ingredients.keys()].sort();
  for (const recipe of indexedRecipes.slice(1)) {
    if (recipe.ingredients.size !== names.length || names.some(name => !recipe.ingredients.has(name))) {
      throw new InitialNormativeError("RECIPE_INCOMPLETE");
    }
  }
  const items = names.map(key => {
    const findings = indexedRecipes.map(recipe => recipe.ingredients.get(key)!);
    const measure = findings[0]!.measure;
    if (findings.some(finding => finding.measure.base !== measure.base || finding.measure.code !== measure.code)) {
      throw new InitialNormativeError("RECIPE_CONFLICTING_UNITS");
    }
    const amount = findings.reduce((total, finding) => total.plus(finding.amount), new Decimal(0)).div(findings.length);
    return {
      name: findings[0]!.name,
      quantity: amount.toFixed(),
      unit: measure.code,
      sourceUrls: indexedRecipes.map(recipe => recipe.sourceUrl),
    };
  });
  if (new Set(items.map(item => normalizeIngredientName(item.name))).size !== items.length) {
    throw new InitialNormativeError("RECIPE_DUPLICATE_INGREDIENT");
  }
  return {
    origin: "web_recipe",
    items,
    sources: [...new Set(indexedRecipes.map(recipe => recipe.sourceUrl))].map(url => ({
      url,
      title: sourceByUrl.get(url)!.title,
    })),
  };
}

/** Catch clear package-vs-serving mistakes in model output, not normal variation in kitchen portions. */
export function assertPlausibleInitialServing(
  targetName: string,
  result: ReturnType<typeof normalizeInitialRecipeResearch>,
): void {
  const beanSalad = recipeSearchName(targetName).toLocaleLowerCase("sl") === "fižolova solata";
  const maxSingle = new Decimal(beanSalad ? "0.5" : "2");
  let mass = new Decimal(0);
  let volume = new Decimal(0);
  for (const item of result.items) {
    if (item.unit === "KOM") continue;
    const amount = new Decimal(item.quantity);
    if (amount.gt(maxSingle)) throw new InitialNormativeError("RECIPE_IMPLAUSIBLE_PORTION");
    if (item.unit === "KGM") mass = mass.plus(amount);
    if (item.unit === "LTR") volume = volume.plus(amount);
  }
  // These are deliberately broad outlier limits, not a 250 g recipe or a saving constraint.
  if (mass.gt(beanSalad ? "0.8" : "4") || volume.gt(beanSalad ? "0.5" : "4")) {
    throw new InitialNormativeError("RECIPE_IMPLAUSIBLE_PORTION");
  }
}

const InitialProposalPayloadSchema = z.object({
  v: z.literal(1),
  origin: z.enum(["catalog_volume", "web_estimate"]).optional(),
  enotaId: z.number().int().positive(),
  articleId: z.number().int().positive(),
  revision: z.number().int().positive(),
  targetName: z.string().trim().min(1).max(200),
  issuedAt: z.number().int().positive(),
  items: z.array(z.object({
    name: z.string().trim().min(1).max(200),
    quantity: z.string().min(1).max(40),
    unit: z.enum(["KGM", "LTR", "KOM"]),
    existingArticleId: z.number().int().positive().nullable(),
    willCreate: z.boolean(),
    sourceUrls: z.array(z.string().url().max(2_000)).max(4),
  }).strict()).min(1).max(100),
  sources: z.array(z.object({ url: z.string().url().max(2_000), title: z.string().min(1).max(500) }).strict()).max(4),
}).strict().superRefine((value, ctx) => {
  const catalog = value.origin === "catalog_volume";
  if (catalog
    ? value.sources.length !== 1 || value.items.length !== 1
      || value.items.some(item => item.sourceUrls.length !== 1 || item.sourceUrls[0] !== value.sources[0]?.url)
    : value.sources.length < (value.origin === "web_estimate" ? 1 : 2)
      || value.items.some(item => item.sourceUrls.length < 1 || item.sourceUrls.some(url => !value.sources.some(source => source.url === url)))) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Neveljaven dokaz izvora normativa." });
  }
});
export type InitialProposalPayload = z.infer<typeof InitialProposalPayloadSchema>;

function proposalSecret(): string | undefined {
  return process.env.POS_NORMATIVE_PROPOSAL_SECRET || process.env.SESSION_SECRET;
}

export function signInitialNormativeProposal(payload: InitialProposalPayload): string | null {
  const secret = proposalSecret();
  const parsed = InitialProposalPayloadSchema.safeParse(payload);
  if (!secret || !parsed.success || parsed.data.sources.some(source =>
    !(parsed.data.origin === "catalog_volume" ? isSafeCatalogSourceUrl(source.url) : isSafeInitialSourceUrl(source.url)))
    || parsed.data.items.some(item => item.sourceUrls.some(url =>
      !(parsed.data.origin === "catalog_volume" ? isSafeCatalogSourceUrl(url) : isSafeInitialSourceUrl(url))))) return null;
  const encoded = Buffer.from(JSON.stringify(parsed.data)).toString("base64url");
  return `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
}

export function verifyInitialNormativeProposal(token: string, now = Date.now()): InitialProposalPayload | null {
  const secret = proposalSecret();
  if (!secret || typeof token !== "string" || token.length > 40_000) return null;
  const [encoded, signature, extra] = token.split(".");
  if (!encoded || !signature || extra) return null;
  const expected = createHmac("sha256", secret).update(encoded).digest();
  const actual = Buffer.from(signature, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = InitialProposalPayloadSchema.safeParse(JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")));
    if (!parsed.success || now - parsed.data.issuedAt > 5 * 60_000 || parsed.data.issuedAt > now + 30_000
      || parsed.data.sources.some(source =>
        !(parsed.data.origin === "catalog_volume" ? isSafeCatalogSourceUrl(source.url) : isSafeInitialSourceUrl(source.url)))
      || parsed.data.items.some(item => item.sourceUrls.some(url =>
        !(parsed.data.origin === "catalog_volume" ? isSafeCatalogSourceUrl(url) : isSafeInitialSourceUrl(url))))) return null;
    return parsed.data;
  } catch { return null; }
}

const CACHE_TTL_MS = 5 * 60_000;
const MAX_CACHE_ENTRIES = 100;
const MAX_REQUESTS_PER_TENANT_PER_MINUTE = 3;
const MAX_TENANT_RATE_ENTRIES = 500;
const proposalCache = new Map<string, { expiresAt: number; result: ReturnType<typeof normalizeInitialRecipeResearch> }>();
const tenantRequests = new Map<number, number[]>();
const inFlight = new Map<string, Promise<ReturnType<typeof normalizeInitialRecipeResearch>>>();

/** Bounded tenant/article cache with short per-tenant request throttling and duplicate-request coalescing. */
export async function getInitialRecipeResearch(
  enotaId: number,
  artikelId: number,
  revision: number,
  targetName: string,
  load: () => Promise<unknown[]>,
  now = Date.now(),
): Promise<ReturnType<typeof normalizeInitialRecipeResearch>> {
  for (const [key, entry] of proposalCache) if (entry.expiresAt <= now) proposalCache.delete(key);
  const key = JSON.stringify([enotaId, artikelId, revision, targetName]);
  const cached = proposalCache.get(key);
  if (cached && cached.expiresAt > now) return cached.result;
  const pending = inFlight.get(key);
  if (pending) return pending;

  const requests = (tenantRequests.get(enotaId) ?? []).filter(timestamp => timestamp > now - 60_000);
  if (requests.length >= MAX_REQUESTS_PER_TENANT_PER_MINUTE) throw new InitialNormativeError("RESEARCH_RATE_LIMITED");
  requests.push(now);
  while (tenantRequests.size >= MAX_TENANT_RATE_ENTRIES) {
    const oldest = tenantRequests.keys().next().value;
    if (oldest === undefined) break;
    tenantRequests.delete(oldest);
  }
  tenantRequests.set(enotaId, requests);
  if (inFlight.size >= 20) throw new InitialNormativeError("RESEARCH_BUSY");

  const promise = load().then(normalizeInitialRecipeResearch).then(result => {
    while (proposalCache.size >= MAX_CACHE_ENTRIES) {
      const oldest = proposalCache.keys().next().value;
      if (!oldest) break;
      proposalCache.delete(oldest);
    }
    proposalCache.set(key, { expiresAt: now + CACHE_TTL_MS, result });
    return result;
  }).finally(() => {
    if (inFlight.get(key) === promise) inFlight.delete(key);
  });
  inFlight.set(key, promise);
  return promise;
}

export function clearInitialRecipeResearchCache(): void {
  proposalCache.clear();
  tenantRequests.clear();
  inFlight.clear();
}