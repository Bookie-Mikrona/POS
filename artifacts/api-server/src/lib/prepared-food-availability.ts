import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  businessDateForInstant,
  getCurrentPosBusinessDate,
  getEnotaBusinessDayStart,
} from "./pos-business-day";
import { izracunajVelikostiPic } from "./pica-velikosti";
import { isPreparedFoodBulkUnit, normalizePreparedFoodUnit } from "./prepared-food-units";

export type MealType = "ala_carte" | "prepared" | "composite";

export type AvailabilityArticle = {
  id: number;
  name: string;
  mealType: MealType;
  unitOfMeasure?: string | null;
  salesArticle?: boolean;
  isPizza?: boolean;
};

export type PizzaSize = "mala" | "normalna" | "druzinska";

export type AvailabilityNorm = {
  articleId: number;
  ingredientId: number;
  quantity: number;
};

export type AvailabilitySale = {
  articleId: number;
  quantity: number;
  mealType?: MealType;
  /** Snapshot-only prepared dough consumption; absent on legacy pizza lines. */
  pizzaDoughArticleId?: number | null;
  pizzaDoughQuantity?: number;
};

export type PreparedFoodAvailabilityItem = {
  articleId: number;
  articleName: string;
  mealType: "prepared" | "composite";
  availableQuantity: number | null;
  /** Preostala nezamrznjena količina (tudi delne porcije); pri sestavljeni jedi ni uporabno. */
  freshQuantity: number | null;
  /** Samo za prikaz zalog: odtajana količina odprte evidence, še vključena v shranjen zamrznjeni saldo. */
  thawedOpenQuantity?: number | null;
  /** Per-size capacity for configured pizza articles. Inactive sizes are omitted. */
  availableBySize?: Partial<Record<PizzaSize, number | null>>;
};

type RequirementResult = {
  valid: boolean;
  hasNorms: boolean;
  prepared: Map<number, number>;
};

export type PreparedFoodAvailabilityState = {
  items: PreparedFoodAvailabilityItem[];
  requirementsByArticle: Map<number, RequirementResult>;
  preparedAvailableRaw: Map<number, number>;
};

export type ModifierAvailabilityRequirement = {
  articleId: number;
  quantity: number;
  mealType: MealType;
};

type AvailabilityInput = {
  articles: AvailabilityArticle[];
  norms: AvailabilityNorm[];
  frozenByPreparedArticle: Map<number, number>;
  preparedTodayByArticle: Map<number, number>;
  closedPreparedArticles?: Set<number>;
  sales: AvailabilitySale[];
  pizzaDoughSettings?: {
    normalDoughArticleId: number | null;
    smallDoughArticleId: number | null;
    familyDoughArticleId: number | null;
  };
  pizzaSizeFactors?: Partial<Record<PizzaSize, number>>;
};

const EPSILON = 1e-9;

function mergeRequirement(target: Map<number, number>, source: Map<number, number>, factor: number): void {
  for (const [articleId, quantity] of source) {
    target.set(articleId, (target.get(articleId) ?? 0) + quantity * factor);
  }
}

/**
 * Izračun je namenoma čist: isti algoritem določa prikaz in strežniško
 * preverjanje, zato se pravila med POS in QR naročili ne morejo raziti.
 */
export function resolvePreparedFoodAvailability(input: AvailabilityInput): PreparedFoodAvailabilityState {
  const articles = new Map(input.articles.map((article) => [article.id, article]));
  const normsByArticle = new Map<number, AvailabilityNorm[]>();
  for (const norm of input.norms) {
    const list = normsByArticle.get(norm.articleId) ?? [];
    list.push(norm);
    normsByArticle.set(norm.articleId, list);
  }
  const pizzaDoughForSize = (size: PizzaSize): number | null => {
    if (size === "mala") return input.pizzaDoughSettings?.smallDoughArticleId ?? null;
    if (size === "normalna") return input.pizzaDoughSettings?.normalDoughArticleId ?? null;
    return input.pizzaDoughSettings?.familyDoughArticleId ?? null;
  };
  const addPizzaDough = (requirements: Map<number, number>, article: AvailabilityArticle, size: PizzaSize) => {
    if (!article.isPizza) return;
    const doughId = pizzaDoughForSize(size);
    if (doughId !== null) requirements.set(doughId, (requirements.get(doughId) ?? 0) + 1);
  };

  const memo = new Map<number, RequirementResult>();
  const resolveRequirements = (articleId: number, visiting: Set<number>): RequirementResult => {
    const cached = memo.get(articleId);
    if (cached) return cached;
    const article = articles.get(articleId);
    if (!article) return { valid: false, hasNorms: false, prepared: new Map() };
    if (article.mealType === "ala_carte") {
      const result = { valid: true, hasNorms: false, prepared: new Map<number, number>() };
      memo.set(articleId, result);
      return result;
    }
    if (article.mealType === "prepared") {
      const result = { valid: true, hasNorms: true, prepared: new Map([[articleId, 1]]) };
      memo.set(articleId, result);
      return result;
    }
    if (visiting.has(articleId)) return { valid: false, hasNorms: true, prepared: new Map() };

    const norms = normsByArticle.get(articleId) ?? [];
    if (norms.length === 0 && !(article.isPizza && pizzaDoughForSize("normalna") !== null)) {
      const result = { valid: false, hasNorms: false, prepared: new Map<number, number>() };
      memo.set(articleId, result);
      return result;
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(articleId);
    const prepared = new Map<number, number>();
    for (const norm of norms) {
      if (!Number.isFinite(norm.quantity) || norm.quantity <= 0) {
        return { valid: false, hasNorms: true, prepared: new Map() };
      }
      const child = resolveRequirements(norm.ingredientId, nextVisiting);
      if (!child.valid) return { valid: false, hasNorms: true, prepared: new Map() };
      mergeRequirement(prepared, child.prepared, norm.quantity);
    }
    const result = { valid: true, hasNorms: true, prepared };
    memo.set(articleId, result);
    return result;
  };

  for (const article of input.articles) resolveRequirements(article.id, new Set());

  const resolveSaleRequirements = (sale: AvailabilitySale): RequirementResult => {
    const snapshotType = sale.mealType ?? articles.get(sale.articleId)?.mealType ?? "ala_carte";
    if (snapshotType === "ala_carte") {
      return { valid: true, hasNorms: false, prepared: new Map() };
    }
    if (snapshotType === "prepared") {
      return { valid: true, hasNorms: true, prepared: new Map([[sale.articleId, 1]]) };
    }
    const norms = normsByArticle.get(sale.articleId) ?? [];
    if (norms.length === 0 && !articles.get(sale.articleId)?.isPizza) {
      return { valid: false, hasNorms: false, prepared: new Map() };
    }
    const prepared = new Map<number, number>();
    for (const norm of norms) {
      if (!Number.isFinite(norm.quantity) || norm.quantity <= 0) {
        return { valid: false, hasNorms: true, prepared: new Map() };
      }
      const child = resolveRequirements(norm.ingredientId, new Set([sale.articleId]));
      if (!child.valid) return { valid: false, hasNorms: true, prepared: new Map() };
      mergeRequirement(prepared, child.prepared, norm.quantity);
    }
    return { valid: true, hasNorms: true, prepared };
  };

  const soldByPreparedArticle = new Map<number, number>();
  for (const sale of input.sales) {
    if (!Number.isFinite(sale.quantity) || sale.quantity <= 0) continue;
    const requirements = resolveSaleRequirements(sale);
    if (requirements.valid) mergeRequirement(soldByPreparedArticle, requirements.prepared, sale.quantity);
    if (sale.pizzaDoughArticleId != null && Number.isFinite(sale.pizzaDoughQuantity)) {
      soldByPreparedArticle.set(
        sale.pizzaDoughArticleId,
        (soldByPreparedArticle.get(sale.pizzaDoughArticleId) ?? 0) + sale.pizzaDoughQuantity!,
      );
    }
  }

  const preparedAvailableRaw = new Map<number, number>();
  for (const article of input.articles) {
    if (article.mealType !== "prepared") continue;
    const closed = input.closedPreparedArticles?.has(article.id) ?? false;
    const available = closed
      ? 0
      : (input.frozenByPreparedArticle.get(article.id) ?? 0)
        + (input.preparedTodayByArticle.get(article.id) ?? 0)
        - (soldByPreparedArticle.get(article.id) ?? 0);
    preparedAvailableRaw.set(article.id, Math.max(0, available));
  }

  const items: PreparedFoodAvailabilityItem[] = [];
  for (const article of input.articles) {
    if (article.mealType === "ala_carte") continue;
    const requirements = resolveRequirements(article.id, new Set());
    let availableQuantity: number | null = 0;
    if (requirements.valid) {
      const limits = [...requirements.prepared].map(
        ([preparedId, quantity]) => (preparedAvailableRaw.get(preparedId) ?? 0) / quantity,
      );
      // Sestavljena jed samo iz à la carte sestavin ni količinsko omejena.
      const rawLimit = limits.length === 0 ? null : Math.max(0, Math.min(...limits));
      const exposeRawAmount = article.mealType === "prepared"
        && article.salesArticle === false
        && isPreparedFoodBulkUnit(article.unitOfMeasure);
      availableQuantity = rawLimit === null
        ? null
        : exposeRawAmount ? rawLimit : Math.floor(rawLimit + EPSILON);
    }
    let availableBySize: Partial<Record<PizzaSize, number | null>> | undefined;
    if (article.isPizza) {
      availableBySize = {};
      for (const size of ["mala", "normalna", "druzinska"] as const) {
        const factor = input.pizzaSizeFactors?.[size];
        if (!Number.isFinite(factor) || (factor ?? 0) <= 0) continue;
        const sizeFactor = factor!;
        const sizeRequirements = new Map<number, number>();
        const norms = normsByArticle.get(article.id) ?? [];
        let valid = true;
        for (const norm of norms) {
          if (!Number.isFinite(norm.quantity) || norm.quantity <= 0) {
            valid = false;
            break;
          }
          const child = resolveRequirements(norm.ingredientId, new Set([article.id]));
          if (!child.valid) {
            valid = false;
            break;
          }
          mergeRequirement(sizeRequirements, child.prepared, norm.quantity * sizeFactor);
        }
        addPizzaDough(sizeRequirements, article, size);
        const limits = [...sizeRequirements].map(
          ([preparedId, quantity]) => (preparedAvailableRaw.get(preparedId) ?? 0) / quantity,
        );
        availableBySize[size] = valid
          ? limits.length === 0 ? null : Math.max(0, Math.floor(Math.min(...limits) + EPSILON))
          : 0;
      }
    }
    items.push({
      articleId: article.id,
      articleName: article.name,
      mealType: article.mealType,
      availableQuantity,
      freshQuantity: article.mealType === "prepared"
        ? (preparedAvailableRaw.get(article.id) ?? 0)
        : null,
      ...(availableBySize ? { availableBySize } : {}),
    });
  }

  return { items, requirementsByArticle: memo, preparedAvailableRaw };
}

type Executor = Pick<typeof db, "execute">;

export async function loadPreparedFoodAvailability(
  executor: Executor,
  enotaId: number,
  businessDate: string,
): Promise<PreparedFoodAvailabilityState> {
  const startTime = await getEnotaBusinessDayStart(enotaId, executor);
  const startInterval = `${startTime}:00`;
  const articleResult = await executor.execute(sql`
    SELECT id, ime, COALESCE(meal_type, 'ala_carte') AS meal_type, je_pica,
           enota_mere, prodajni_artikel
    FROM artikli
    WHERE enota_id = ${enotaId}
  `);
  const doughSettingsResult = await executor.execute(sql`
    SELECT normal_dough_article_id, small_dough_article_id, family_dough_article_id
    FROM pizza_dough_settings
    WHERE enota_id = ${enotaId}
    LIMIT 1
  `);
  const pizzaSizeSettingsResult = await executor.execute(sql`
    SELECT kljuc, vrednost
    FROM nastavitve
    WHERE enota_id = ${enotaId}
      AND kljuc IN ('picaPremerMala', 'picaPremerNormalna', 'picaPremerDruzinska')
  `);
  const normResult = await executor.execute(sql`
    SELECT n.artikel_id, n.vhodni_artikel_id, n.kolicina::float8 AS quantity
    FROM normativi n
    JOIN artikli a ON a.id = n.artikel_id
    WHERE a.enota_id = ${enotaId}
  `);
  const ledgerResult = await executor.execute(sql`
    SELECT DISTINCT ON (artikel_id)
      artikel_id,
      business_date,
      thawed_quantity::float8 AS thawed_quantity,
      prepared_quantity::float8 AS prepared_quantity,
      correction_quantity::float8 AS correction_quantity,
      closed_at
    FROM prepared_food_daily_ledgers
    WHERE enota_id = ${enotaId}
      AND (
        business_date = ${businessDate}::date
        OR (business_date < ${businessDate}::date AND closed_at IS NULL)
      )
    ORDER BY
      artikel_id,
      CASE WHEN business_date = ${businessDate}::date THEN 0 ELSE 1 END,
      business_date DESC
  `);
  const salesResult = await executor.execute(sql`
    WITH availability_window AS (
      SELECT COALESCE(
        MIN(latest_open.business_date),
        ${businessDate}::date
      ) AS start_date
      FROM (
        SELECT DISTINCT ON (artikel_id) artikel_id, business_date
        FROM prepared_food_daily_ledgers
        WHERE enota_id = ${enotaId}
          AND business_date <= ${businessDate}::date
          AND closed_at IS NULL
        ORDER BY artikel_id, business_date DESC
      ) latest_open
    ),
    sold_components AS (
      SELECT
        p.artikel_id,
        p.meal_type,
        p.kolicina::numeric * COALESCE(p.normativ_faktor, 1)::numeric AS quantity,
        p.pizza_dough_article_id,
        p.kolicina::numeric AS pizza_dough_quantity
      FROM postavke p
      JOIN narocila n ON n.id = p.narocilo_id
      WHERE n.enota_id = ${enotaId}
        AND p.artikel_id IS NOT NULL
        AND p.parent_postavka_id IS NULL
        AND p.kolicina::numeric * COALESCE(p.normativ_faktor, 1)::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date
          BETWEEN (SELECT start_date FROM availability_window) AND ${businessDate}::date

      UNION ALL

      SELECT
        (snapshot.value->>'articleId')::integer AS artikel_id,
        COALESCE(snapshot.value->>'mealType', 'ala_carte') AS meal_type,
        child.kolicina::numeric
          * COALESCE(child.normativ_faktor, 1)::numeric
          * (snapshot.value->>'quantity')::numeric AS quantity,
        NULL::integer AS pizza_dough_article_id,
        NULL::numeric AS pizza_dough_quantity
      FROM postavke child
      JOIN narocila n ON n.id = child.narocilo_id
      CROSS JOIN LATERAL jsonb_array_elements(child.availability_requirements) snapshot(value)
      WHERE n.enota_id = ${enotaId}
        AND child.parent_postavka_id IS NOT NULL
        AND child.modifikator_id IS NOT NULL
        AND child.availability_requirements IS NOT NULL
        AND child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric > 0
        AND (snapshot.value->>'quantity')::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date
          BETWEEN (SELECT start_date FROM availability_window) AND ${businessDate}::date

      UNION ALL

      SELECT
        mn.vhodni_artikel_id AS artikel_id,
        COALESCE(a.meal_type, 'ala_carte') AS meal_type,
        child.kolicina::numeric
          * COALESCE(child.normativ_faktor, 1)::numeric
          * mn.kolicina::numeric AS quantity,
        NULL::integer AS pizza_dough_article_id,
        NULL::numeric AS pizza_dough_quantity
      FROM postavke child
      JOIN narocila n ON n.id = child.narocilo_id
      JOIN modifikator_normativi mn ON mn.modifikator_id = child.modifikator_id
      JOIN artikli a ON a.id = mn.vhodni_artikel_id
      WHERE n.enota_id = ${enotaId}
        AND child.parent_postavka_id IS NOT NULL
        AND child.availability_requirements IS NULL
        AND child.kolicina::numeric * COALESCE(child.normativ_faktor, 1)::numeric * mn.kolicina::numeric > 0
        AND n.status <> 'preklicano'
        AND ((n.ustvarjeno AT TIME ZONE 'Europe/Ljubljana') - ${startInterval}::interval)::date
          BETWEEN (SELECT start_date FROM availability_window) AND ${businessDate}::date
    )
    SELECT
      artikel_id,
      meal_type,
      SUM(quantity)::float8 AS quantity,
      pizza_dough_article_id,
      SUM(pizza_dough_quantity)::float8 AS pizza_dough_quantity
    FROM sold_components
    GROUP BY artikel_id, meal_type, pizza_dough_article_id
  `);

  const articles = articleResult.rows.map((row) => ({
    id: Number((row as Record<string, unknown>).id),
    name: String((row as Record<string, unknown>).ime),
    mealType: String((row as Record<string, unknown>).meal_type) as MealType,
    isPizza: Boolean((row as Record<string, unknown>).je_pica),
    unitOfMeasure: normalizePreparedFoodUnit((row as Record<string, unknown>).enota_mere as string | null),
    salesArticle: Boolean((row as Record<string, unknown>).prodajni_artikel),
  }));
  const norms = normResult.rows.map((row) => ({
    articleId: Number((row as Record<string, unknown>).artikel_id),
    ingredientId: Number((row as Record<string, unknown>).vhodni_artikel_id),
    quantity: Number((row as Record<string, unknown>).quantity),
  }));
  const preparedToday = new Map(ledgerResult.rows.map((row) => [
    Number((row as Record<string, unknown>).artikel_id),
    Number((row as Record<string, unknown>).thawed_quantity)
      + Number((row as Record<string, unknown>).prepared_quantity)
      + Number((row as Record<string, unknown>).correction_quantity),
  ]));
  const closed = new Set(ledgerResult.rows
    .filter((row) => (row as Record<string, unknown>).closed_at != null)
    .map((row) => Number((row as Record<string, unknown>).artikel_id)));
  const sales = salesResult.rows.map((row) => ({
    articleId: Number((row as Record<string, unknown>).artikel_id),
    quantity: Number((row as Record<string, unknown>).quantity),
    mealType: String((row as Record<string, unknown>).meal_type) as MealType,
    pizzaDoughArticleId: row.pizza_dough_article_id == null
      ? null
      : Number(row.pizza_dough_article_id),
    pizzaDoughQuantity: row.pizza_dough_quantity == null
      ? undefined
      : Number(row.pizza_dough_quantity),
  }));
  const doughSettingsRow = doughSettingsResult.rows[0] as Record<string, unknown> | undefined;
  const doughSettings = doughSettingsRow
    ? {
      normalDoughArticleId: doughSettingsRow.normal_dough_article_id == null
        ? null
        : Number(doughSettingsRow.normal_dough_article_id),
      smallDoughArticleId: doughSettingsRow.small_dough_article_id == null
        ? null
        : Number(doughSettingsRow.small_dough_article_id),
      familyDoughArticleId: doughSettingsRow.family_dough_article_id == null
        ? null
        : Number(doughSettingsRow.family_dough_article_id),
    }
    : undefined;
  const rawSizeSettings: Record<string, string> = {};
  for (const raw of pizzaSizeSettingsResult.rows) {
    const row = raw as Record<string, unknown>;
    rawSizeSettings[String(row.kljuc)] = String(row.vrednost);
  }
  const pizzaSizeFactors = Object.fromEntries(
    izracunajVelikostiPic(rawSizeSettings).map((size) => [size.id, size.normativFaktor]),
  ) as Partial<Record<PizzaSize, number>>;

  const state = resolvePreparedFoodAvailability({
    articles,
    norms,
    // Zamrznjena zaloga ni razpoložljiva za prodajo, dokler ni v dnevni
    // evidenci izrecno vnesena kot odtajana.
    frozenByPreparedArticle: new Map(),
    preparedTodayByArticle: preparedToday,
    closedPreparedArticles: closed,
    sales,
    pizzaDoughSettings: doughSettings,
    pizzaSizeFactors,
  });
  const openThawed = new Map(ledgerResult.rows
    .filter(row => (row as Record<string, unknown>).closed_at == null)
    .map(row => [
      Number((row as Record<string, unknown>).artikel_id),
      Number((row as Record<string, unknown>).thawed_quantity),
    ]));
  return {
    ...state,
    items: state.items.map(item => ({
      ...item,
      thawedOpenQuantity: item.mealType === "prepared" ? (openThawed.get(item.articleId) ?? 0) : null,
    })),
  };
}

export async function currentBusinessDate(enotaId: number): Promise<string> {
  return getCurrentPosBusinessDate(enotaId);
}

export async function businessDateForTimestamp(
  value: Date | string,
  enotaId: number,
  executor: Executor = db,
): Promise<string> {
  const startTime = await getEnotaBusinessDayStart(enotaId, executor);
  return businessDateForInstant(value, startTime);
}

export async function lockPreparedFoodAvailability(
  executor: Executor,
  enotaId: number,
  businessDate: string,
): Promise<void> {
  await executor.execute(sql`
    SELECT pg_advisory_xact_lock(
      hashtext('prepared-food-availability'),
      hashtext(${`${enotaId}:${businessDate}`})
    )
  `);
}

export async function loadModifierAvailabilitySnapshots(
  executor: Executor,
  modifierIds: number[],
): Promise<Map<number, ModifierAvailabilityRequirement[]>> {
  const validIds = [...new Set(modifierIds.filter((id) => Number.isInteger(id) && id > 0))];
  if (validIds.length === 0) return new Map();
  const result = await executor.execute(sql`
    SELECT
      mn.modifikator_id,
      mn.vhodni_artikel_id AS article_id,
      mn.kolicina::float8 AS quantity,
      COALESCE(a.meal_type, 'ala_carte') AS meal_type
    FROM modifikator_normativi mn
    JOIN artikli a ON a.id = mn.vhodni_artikel_id
    WHERE mn.modifikator_id IN (${sql.join(validIds.map((id) => sql`${id}`), sql`, `)})
  `);
  const snapshots = new Map<number, ModifierAvailabilityRequirement[]>();
  for (const id of validIds) snapshots.set(id, []);
  for (const raw of result.rows) {
    const row = raw as Record<string, unknown>;
    const modifierId = Number(row.modifikator_id);
    snapshots.get(modifierId)?.push({
      articleId: Number(row.article_id),
      quantity: Number(row.quantity),
      mealType: String(row.meal_type) as MealType,
    });
  }
  return snapshots;
}

export function buildModifierAvailabilityRequests(
  snapshots: Map<number, ModifierAvailabilityRequirement[]>,
  modifierIds: number[],
  parentQuantity: number,
): Array<{ articleId: number; quantity: number }> {
  if (!Number.isFinite(parentQuantity) || parentQuantity <= 0) return [];
  const aggregated = new Map<number, number>();
  for (const modifierId of modifierIds) {
    for (const requirement of snapshots.get(modifierId) ?? []) {
      aggregated.set(
        requirement.articleId,
        (aggregated.get(requirement.articleId) ?? 0) + requirement.quantity * parentQuantity,
      );
    }
  }
  return [...aggregated].map(([articleId, quantity]) => ({ articleId, quantity }));
}

export function resolveModifierPortions(
  state: PreparedFoodAvailabilityState,
  snapshots: Map<number, ModifierAvailabilityRequirement[]>,
): Array<{ modifierId: number; availableQuantity: number }> {
  const items: Array<{ modifierId: number; availableQuantity: number }> = [];
  for (const [modifierId, ingredients] of snapshots) {
    const needed = new Map<number, number>();
    let invalid = false;
    let hasPreparedIngredient = false;
    for (const ingredient of ingredients) {
      if (!Number.isFinite(ingredient.quantity) || ingredient.quantity <= 0) {
        invalid = true;
        continue;
      }
      const requirement = state.requirementsByArticle.get(ingredient.articleId);
      if (!requirement?.valid) {
        if (ingredient.mealType !== "ala_carte") hasPreparedIngredient = true;
        invalid = true;
        continue;
      }
      if (requirement.prepared.size > 0) hasPreparedIngredient = true;
      mergeRequirement(needed, requirement.prepared, ingredient.quantity);
    }
    if (!hasPreparedIngredient) continue;
    const limits = [...needed].map(([id, quantity]) => (state.preparedAvailableRaw.get(id) ?? 0) / quantity);
    items.push({
      modifierId,
      availableQuantity: invalid || limits.length === 0
        ? 0
        : Math.max(0, Math.floor(Math.min(...limits) + EPSILON)),
    });
  }
  return items;
}

export async function loadModifierAvailabilityRequests(
  executor: Executor,
  modifierIds: number[],
  parentQuantity: number,
): Promise<Array<{ articleId: number; quantity: number }>> {
  const snapshots = await loadModifierAvailabilitySnapshots(executor, modifierIds);
  return buildModifierAvailabilityRequests(snapshots, modifierIds, parentQuantity);
}

export class InsufficientPreparedFoodAvailabilityError extends Error {
  readonly code = "INSUFFICIENT_PREPARED_FOOD_AVAILABILITY";

  constructor(
    readonly details: {
      businessDate: string;
      articleId: number;
      articleName: string;
      requestedQuantity: number;
      availableQuantity: number;
    },
  ) {
    super(`Artikel »${details.articleName}« nima dovolj razpoložljive količine.`);
  }
}

export async function assertPreparedFoodAvailability(
  executor: Executor,
  enotaId: number,
  businessDate: string,
  requests: Array<{ articleId: number; quantity: number }>,
): Promise<void> {
  const aggregated = new Map<number, number>();
  for (const request of requests) {
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) continue;
    aggregated.set(request.articleId, (aggregated.get(request.articleId) ?? 0) + request.quantity);
  }
  if (aggregated.size === 0) return;

  await lockPreparedFoodAvailability(executor, enotaId, businessDate);
  const state = await loadPreparedFoodAvailability(executor, enotaId, businessDate);
  const requestedPrepared = new Map<number, number>();
  for (const [articleId, quantity] of aggregated) {
    const requirements = state.requirementsByArticle.get(articleId);
    if (!requirements || !requirements.valid) {
      const item = state.items.find((candidate) => candidate.articleId === articleId);
      if (item) {
        throw new InsufficientPreparedFoodAvailabilityError({
          businessDate,
          articleId,
          articleName: item.articleName,
          requestedQuantity: quantity,
          availableQuantity: 0,
        });
      }
      continue;
    }
    mergeRequirement(requestedPrepared, requirements.prepared, quantity);
  }

  for (const [preparedId, requestedQuantity] of requestedPrepared) {
    const availableQuantity = state.preparedAvailableRaw.get(preparedId) ?? 0;
    if (requestedQuantity > availableQuantity + EPSILON) {
      const item = state.items.find((candidate) => candidate.articleId === preparedId);
      throw new InsufficientPreparedFoodAvailabilityError({
        businessDate,
        articleId: preparedId,
        articleName: item?.articleName ?? `#${preparedId}`,
        requestedQuantity,
        availableQuantity: state.items.find(candidate => candidate.articleId === preparedId)?.availableQuantity
          ?? Math.max(0, Math.floor(availableQuantity + EPSILON)),
      });
    }
  }
}