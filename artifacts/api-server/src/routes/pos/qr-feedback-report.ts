import { Router, type IRouter, type Response } from "express";
import { and, asc, count, desc, eq, gte, lt, or, sql } from "drizzle-orm";
import {
  db,
  enoteTable,
  qrGostPovratneInformacijeTable,
} from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import { getBusinessDayBounds, POS_TIME_ZONE } from "../../lib/pos-business-day";

const router: IRouter = Router();
const MINIMUM_SAMPLE = 5;
const MAX_RANGE_DAYS = 366;
const ADMIN_ROLES = new Set(["admin", "admin_enote", "superadmin"]);

class ReportRequestError extends Error {
  status = 400;
}

type Granularity = "day" | "week";
type ReportUnit = {
  id: number;
  name: string;
  startTime: string;
  start: Date;
  end: Date;
  previousStart: Date;
  previousEnd: Date;
};
type ReportQuery = { od: string; do: string; enotaId?: number; granularity: Granularity };

type ReportData = {
  scope: {
    od: string;
    do: string;
    granularity: Granularity;
    timeZone: typeof POS_TIME_ZONE;
    units: Array<{ id: number; name: string }>;
  };
  totals: { responses: number; smallSample: boolean; minimumSample: number };
  dimensions: {
    food: { average: number | null; count: number; smallSample: boolean };
    ambience: { average: number | null; count: number; smallSample: boolean };
    service: { average: number | null; count: number; smallSample: boolean };
  };
  comparison: {
    current: { od: string; do: string; responses: number; smallSample: boolean };
    previous: { od: string; do: string; responses: number; smallSample: boolean };
    dimensions: {
      food: ComparisonMetric;
      ambience: ComparisonMetric;
      service: ComparisonMetric;
    };
  };
  trends: Array<{
    periodStart: string;
    periodEnd: string;
    responses: number;
    foodAverage: number | null;
    ambienceAverage: number | null;
    serviceAverage: number | null;
    smallSample: boolean;
  }>;
  articles: Array<{
    articleName: string;
    current: { average: number | null; count: number; smallSample: boolean };
    previous: { average: number | null; count: number; smallSample: boolean };
    difference: number | null;
    direction: ComparisonMetric["direction"];
    directionReason: string | null;
  }>;
  warnings: Array<{ code: "SMALL_SAMPLE"; minimumSample: number; message: string }>;
  comments: { count: number; protected: true };
};

type ComparisonMetric = {
  currentAverage: number | null;
  previousAverage: number | null;
  difference: number | null;
  direction: "improved" | "declined" | "unchanged" | "unavailable";
  directionReason: string | null;
};

function validCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseQrFeedbackReportQuery(query: Record<string, unknown>): ReportQuery {
  const od = typeof query.od === "string" ? query.od : "";
  const doParam = typeof query.do === "string" ? query.do : "";
  if (!validCalendarDate(od) || !validCalendarDate(doParam)) {
    throw new ReportRequestError("Podajte veljavno obdobje od in do (YYYY-MM-DD)");
  }
  const from = Date.parse(`${od}T00:00:00Z`);
  const to = Date.parse(`${doParam}T00:00:00Z`);
  if (from > to) throw new ReportRequestError("Začetni datum ne sme biti po končnem datumu");
  if (Math.floor((to - from) / 86_400_000) + 1 > MAX_RANGE_DAYS) {
    throw new ReportRequestError(`Obdobje je lahko dolgo največ ${MAX_RANGE_DAYS} dni`);
  }
  const granularity = query.granularity == null ? "day" : query.granularity;
  if (granularity !== "day" && granularity !== "week") {
    throw new ReportRequestError("Granularity mora biti day ali week");
  }
  let enotaId: number | undefined;
  if (query.enotaId != null && query.enotaId !== "") {
    const raw = typeof query.enotaId === "string" ? query.enotaId : "";
    if (!/^[1-9]\d*$/.test(raw)) throw new ReportRequestError("enotaId mora biti pozitivno celo število");
    enotaId = Number(raw);
    if (!Number.isSafeInteger(enotaId)) throw new ReportRequestError("Neveljaven enotaId");
  }
  return { od, do: doParam, enotaId, granularity };
}

function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function getPreviousQrFeedbackPeriod(od: string, doParam: string): { od: string; do: string } {
  const from = new Date(`${od}T00:00:00Z`);
  const to = new Date(`${doParam}T00:00:00Z`);
  const dayCount = Math.floor((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(from);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - dayCount + 1);
  return { od: formatUtcDate(previousStart), do: formatUtcDate(previousEnd) };
}

async function resolveUnits(posReq: PosRequest, query: ReportQuery): Promise<ReportUnit[]> {
  if (posReq.vloga === "admin_enote" && query.enotaId != null && query.enotaId !== posReq.enotaId) {
    const error = new Error("Administrator enote ne more zahtevati poročila druge enote");
    Object.assign(error, { status: 403 });
    throw error;
  }
  const requestedId = posReq.vloga === "admin_enote" ? posReq.enotaId : query.enotaId;
  const units = await db.select({
    id: enoteTable.id,
    name: enoteTable.ime,
  }).from(enoteTable).where(and(
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(requestedId == null ? [] : [eq(enoteTable.id, requestedId)]),
  )).orderBy(asc(enoteTable.id));
  if (requestedId != null && units.length === 0) {
    const error = new Error("Zahtevana aktivna poslovna enota ni dostopna");
    Object.assign(error, { status: 403 });
    throw error;
  }
  const previous = getPreviousQrFeedbackPeriod(query.od, query.do);
  return Promise.all(units.map(async (unit) => {
    const [first, last, previousFirst, previousLast] = await Promise.all([
      getBusinessDayBounds(unit.id, query.od),
      getBusinessDayBounds(unit.id, query.do),
      getBusinessDayBounds(unit.id, previous.od),
      getBusinessDayBounds(unit.id, previous.do),
    ]);
    return {
      ...unit,
      startTime: first.startTime,
      start: first.start,
      end: last.end,
      previousStart: previousFirst.start,
      previousEnd: previousLast.end,
    };
  }));
}

function average(sum: number, valueCount: number): number | null {
  return valueCount === 0 ? null : Math.round((sum / valueCount) * 100) / 100;
}

function comparisonMetric(currentAverage: number | null, previousAverage: number | null): ComparisonMetric {
  if (currentAverage == null || previousAverage == null) {
    return {
      currentAverage,
      previousAverage,
      difference: null,
      direction: "unavailable",
      directionReason: "Smer ni določena, ker ni ocen v obeh obdobjih.",
    };
  }
  const difference = Math.round((currentAverage - previousAverage) * 100) / 100;
  return {
    currentAverage,
    previousAverage,
    difference,
    direction: difference > 0 ? "improved" : difference < 0 ? "declined" : "unchanged",
    directionReason: null,
  };
}

export function dimensionComparisonMetric(
  currentAverage: number | null,
  currentResponses: number,
  previousAverage: number | null,
  previousResponses: number,
): ComparisonMetric {
  const comparison = comparisonMetric(currentAverage, previousAverage);
  if (comparison.direction === "unavailable") return comparison;
  if (currentResponses < MINIMUM_SAMPLE || previousResponses < MINIMUM_SAMPLE) {
    return {
      ...comparison,
      direction: "unavailable",
      directionReason: `Smer ni določena: v obeh obdobjih je potrebnih vsaj ${MINIMUM_SAMPLE} odzivov.`,
    };
  }
  return comparison;
}

export function articleComparisonMetric(
  currentAverage: number | null,
  currentCount: number,
  previousAverage: number | null,
  previousCount: number,
): ComparisonMetric & { directionReason: string | null } {
  const comparison = comparisonMetric(currentAverage, previousAverage);
  if (comparison.direction === "unavailable") {
    return {
      ...comparison,
      directionReason: "Smer ni določena, ker artikel nima ocen v obeh obdobjih.",
    };
  }
  if (currentCount < MINIMUM_SAMPLE || previousCount < MINIMUM_SAMPLE) {
    return {
      ...comparison,
      direction: "unavailable",
      directionReason: `Smer ni določena: v obeh obdobjih je potrebnih vsaj ${MINIMUM_SAMPLE} ocen.`,
    };
  }
  return { ...comparison, directionReason: null };
}

async function loadReport(query: ReportQuery, units: ReportUnit[]): Promise<ReportData> {
  let responses = 0;
  let foodSum = 0;
  let ambienceSum = 0;
  let serviceSum = 0;
  let commentsCount = 0;
  let previousResponses = 0;
  let previousFoodSum = 0;
  let previousAmbienceSum = 0;
  let previousServiceSum = 0;
  const trends = new Map<string, {
    periodStart: string; periodEnd: string; responses: number;
    foodSum: number; ambienceSum: number; serviceSum: number;
  }>();
  const articles = new Map<string, {
    currentSum: number; currentCount: number;
    previousSum: number; previousCount: number;
  }>();

  for (const unit of units) {
    const summaryResult = await db.execute(sql`
      SELECT COUNT(*) FILTER (
               WHERE created_at >= ${unit.start.toISOString()}::timestamptz
                 AND created_at < ${unit.end.toISOString()}::timestamptz
             )::int AS responses,
             COALESCE(SUM(hrana_ocena) FILTER (
               WHERE created_at >= ${unit.start.toISOString()}::timestamptz
                 AND created_at < ${unit.end.toISOString()}::timestamptz
             ), 0)::numeric AS food_sum,
             COALESCE(SUM(ambient_ocena) FILTER (
               WHERE created_at >= ${unit.start.toISOString()}::timestamptz
                 AND created_at < ${unit.end.toISOString()}::timestamptz
             ), 0)::numeric AS ambience_sum,
             COALESCE(SUM(storitev_ocena) FILTER (
               WHERE created_at >= ${unit.start.toISOString()}::timestamptz
                 AND created_at < ${unit.end.toISOString()}::timestamptz
             ), 0)::numeric AS service_sum,
             COUNT(*) FILTER (
               WHERE created_at >= ${unit.start.toISOString()}::timestamptz
                 AND created_at < ${unit.end.toISOString()}::timestamptz
                 AND length(btrim(komentar)) > 0
             )::int AS comments_count,
             COUNT(*) FILTER (
               WHERE created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND created_at < ${unit.previousEnd.toISOString()}::timestamptz
             )::int AS previous_responses,
             COALESCE(SUM(hrana_ocena) FILTER (
               WHERE created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND created_at < ${unit.previousEnd.toISOString()}::timestamptz
             ), 0)::numeric AS previous_food_sum,
             COALESCE(SUM(ambient_ocena) FILTER (
               WHERE created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND created_at < ${unit.previousEnd.toISOString()}::timestamptz
             ), 0)::numeric AS previous_ambience_sum,
             COALESCE(SUM(storitev_ocena) FILTER (
               WHERE created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND created_at < ${unit.previousEnd.toISOString()}::timestamptz
             ), 0)::numeric AS previous_service_sum
      FROM qr_gost_povratne_informacije
      WHERE enota_id = ${unit.id}
        AND created_at >= ${unit.previousStart.toISOString()}::timestamptz
        AND created_at < ${unit.end.toISOString()}::timestamptz
    `);
    const summary = summaryResult.rows[0] as Record<string, unknown> | undefined;
    responses += Number(summary?.responses ?? 0);
    foodSum += Number(summary?.food_sum ?? 0);
    ambienceSum += Number(summary?.ambience_sum ?? 0);
    serviceSum += Number(summary?.service_sum ?? 0);
    commentsCount += Number(summary?.comments_count ?? 0);
    previousResponses += Number(summary?.previous_responses ?? 0);
    previousFoodSum += Number(summary?.previous_food_sum ?? 0);
    previousAmbienceSum += Number(summary?.previous_ambience_sum ?? 0);
    previousServiceSum += Number(summary?.previous_service_sum ?? 0);

    const trendResult = await db.execute(sql`
      WITH scoped AS (
        SELECT *,
          (created_at AT TIME ZONE ${POS_TIME_ZONE} - ${unit.startTime}::time)::date AS business_date
        FROM qr_gost_povratne_informacije
        WHERE enota_id = ${unit.id}
          AND created_at >= ${unit.start.toISOString()}::timestamptz
          AND created_at < ${unit.end.toISOString()}::timestamptz
      ), grouped AS (
        SELECT
          CASE WHEN ${query.granularity} = 'week'
            THEN date_trunc('week', business_date)::date ELSE business_date END AS bucket,
          COUNT(*)::int AS responses,
          SUM(hrana_ocena)::numeric AS food_sum,
          SUM(ambient_ocena)::numeric AS ambience_sum,
          SUM(storitev_ocena)::numeric AS service_sum
        FROM scoped
        GROUP BY bucket
      )
      SELECT GREATEST(bucket, ${query.od}::date)::text AS period_start,
             LEAST(bucket + CASE WHEN ${query.granularity} = 'week' THEN 6 ELSE 0 END, ${query.do}::date)::text AS period_end,
             responses, food_sum, ambience_sum, service_sum
      FROM grouped ORDER BY bucket
    `);
    for (const row of trendResult.rows as Array<Record<string, unknown>>) {
      const key = String(row.period_start);
      const current = trends.get(key) ?? {
        periodStart: key,
        periodEnd: String(row.period_end),
        responses: 0, foodSum: 0, ambienceSum: 0, serviceSum: 0,
      };
      current.responses += Number(row.responses);
      current.foodSum += Number(row.food_sum);
      current.ambienceSum += Number(row.ambience_sum);
      current.serviceSum += Number(row.service_sum);
      trends.set(key, current);
    }

    const articleResult = await db.execute(sql`
      SELECT p.ime AS article_name,
             COALESCE(SUM(rating.value::int) FILTER (
               WHERE f.created_at >= ${unit.start.toISOString()}::timestamptz
                 AND f.created_at < ${unit.end.toISOString()}::timestamptz
             ), 0)::numeric AS current_rating_sum,
             COUNT(*) FILTER (
               WHERE f.created_at >= ${unit.start.toISOString()}::timestamptz
                 AND f.created_at < ${unit.end.toISOString()}::timestamptz
             )::int AS current_rating_count,
             COALESCE(SUM(rating.value::int) FILTER (
               WHERE f.created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND f.created_at < ${unit.previousEnd.toISOString()}::timestamptz
             ), 0)::numeric AS previous_rating_sum,
             COUNT(*) FILTER (
               WHERE f.created_at >= ${unit.previousStart.toISOString()}::timestamptz
                 AND f.created_at < ${unit.previousEnd.toISOString()}::timestamptz
             )::int AS previous_rating_count
      FROM qr_gost_povratne_informacije f
      JOIN narocila n ON n.id = f.narocilo_id AND n.enota_id = f.enota_id
      CROSS JOIN LATERAL jsonb_each_text(COALESCE(f.ocene_postavk, '{}'::jsonb)) rating
      JOIN postavke p
        ON rating.key ~ '^[1-9][0-9]*$'
       AND p.id = CASE WHEN rating.key ~ '^[1-9][0-9]{0,17}$' THEN rating.key::bigint END
       AND p.narocilo_id = f.narocilo_id
      WHERE f.enota_id = ${unit.id}
        AND f.created_at >= ${unit.previousStart.toISOString()}::timestamptz
        AND f.created_at < ${unit.end.toISOString()}::timestamptz
        AND rating.value ~ '^[1-5]$'
      GROUP BY p.ime
      ORDER BY p.ime
    `);
    for (const row of articleResult.rows as Array<Record<string, unknown>>) {
      const name = String(row.article_name);
      const current = articles.get(name) ?? {
        currentSum: 0, currentCount: 0,
        previousSum: 0, previousCount: 0,
      };
      current.currentSum += Number(row.current_rating_sum);
      current.currentCount += Number(row.current_rating_count);
      current.previousSum += Number(row.previous_rating_sum);
      current.previousCount += Number(row.previous_rating_count);
      articles.set(name, current);
    }
  }

  const smallSample = responses < MINIMUM_SAMPLE;
  const previousSmallSample = previousResponses < MINIMUM_SAMPLE;
  const previousPeriod = getPreviousQrFeedbackPeriod(query.od, query.do);
  const currentAverages = {
    food: average(foodSum, responses),
    ambience: average(ambienceSum, responses),
    service: average(serviceSum, responses),
  };
  const previousAverages = {
    food: average(previousFoodSum, previousResponses),
    ambience: average(previousAmbienceSum, previousResponses),
    service: average(previousServiceSum, previousResponses),
  };
  return {
    scope: {
      od: query.od,
      do: query.do,
      granularity: query.granularity,
      timeZone: POS_TIME_ZONE,
      units: units.map(({ id, name }) => ({ id, name })),
    },
    totals: { responses, smallSample, minimumSample: MINIMUM_SAMPLE },
    dimensions: {
      food: { average: currentAverages.food, count: responses, smallSample },
      ambience: { average: currentAverages.ambience, count: responses, smallSample },
      service: { average: currentAverages.service, count: responses, smallSample },
    },
    comparison: {
      current: { od: query.od, do: query.do, responses, smallSample },
      previous: { ...previousPeriod, responses: previousResponses, smallSample: previousSmallSample },
      dimensions: {
        food: dimensionComparisonMetric(currentAverages.food, responses, previousAverages.food, previousResponses),
        ambience: dimensionComparisonMetric(currentAverages.ambience, responses, previousAverages.ambience, previousResponses),
        service: dimensionComparisonMetric(currentAverages.service, responses, previousAverages.service, previousResponses),
      },
    },
    trends: [...trends.values()].sort((a, b) => a.periodStart.localeCompare(b.periodStart)).map((row) => ({
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      responses: row.responses,
      foodAverage: average(row.foodSum, row.responses),
      ambienceAverage: average(row.ambienceSum, row.responses),
      serviceAverage: average(row.serviceSum, row.responses),
      smallSample: row.responses < MINIMUM_SAMPLE,
    })),
    articles: [...articles.entries()].map(([articleName, value]) => {
      const currentAverage = average(value.currentSum, value.currentCount);
      const previousAverage = average(value.previousSum, value.previousCount);
      const comparison = articleComparisonMetric(
        currentAverage,
        value.currentCount,
        previousAverage,
        value.previousCount,
      );
      return {
        articleName,
        current: {
          average: currentAverage,
          count: value.currentCount,
          smallSample: value.currentCount < MINIMUM_SAMPLE,
        },
        previous: {
          average: previousAverage,
          count: value.previousCount,
          smallSample: value.previousCount < MINIMUM_SAMPLE,
        },
        difference: comparison.difference,
        direction: comparison.direction,
        directionReason: comparison.directionReason,
      };
    }).sort((a, b) => a.articleName.localeCompare(b.articleName, "sl")),
    warnings: smallSample ? [{
      code: "SMALL_SAMPLE",
      minimumSample: MINIMUM_SAMPLE,
      message: "Rezultati temeljijo na manj kot petih odgovorih; povprečja so prikazana, vendar jih razlagajte previdno.",
    }] : [],
    comments: { count: commentsCount, protected: true },
  };
}

function csvCell(value: string | number | boolean | null): string {
  if (value == null) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
}

export function qrFeedbackReportCsv(report: ReportData): string {
  const rows: Array<Array<string | number | boolean | null>> = [
    ["section", "name", "periodStart", "periodEnd", "responses", "average", "smallSample", "previousResponses", "previousAverage", "previousSmallSample", "difference", "direction", "directionReason", "warning"],
    ["counts", "responses", null, null, report.totals.responses, null, report.totals.smallSample, null, null, null, null, null, null, null],
    ["comparison_period", "current", report.comparison.current.od, report.comparison.current.do, report.comparison.current.responses, null, report.comparison.current.smallSample, null, null, null, null, null, null, null],
    ["comparison_period", "previous", report.comparison.previous.od, report.comparison.previous.do, report.comparison.previous.responses, null, report.comparison.previous.smallSample, null, null, null, null, null, null, null],
    ...Object.entries(report.dimensions).map(([name, value]) =>
      ["dimension", name, null, null, value.count, value.average, value.smallSample, report.comparison.previous.responses, report.comparison.dimensions[name as keyof typeof report.comparison.dimensions].previousAverage, report.comparison.previous.smallSample, report.comparison.dimensions[name as keyof typeof report.comparison.dimensions].difference, report.comparison.dimensions[name as keyof typeof report.comparison.dimensions].direction, report.comparison.dimensions[name as keyof typeof report.comparison.dimensions].directionReason, null] as Array<string | number | boolean | null>),
    ...report.trends.flatMap((value) => [
      ["trend", "food", value.periodStart, value.periodEnd, value.responses, value.foodAverage, value.smallSample, null, null, null, null, null, null, null],
      ["trend", "ambience", value.periodStart, value.periodEnd, value.responses, value.ambienceAverage, value.smallSample, null, null, null, null, null, null, null],
      ["trend", "service", value.periodStart, value.periodEnd, value.responses, value.serviceAverage, value.smallSample, null, null, null, null, null, null, null],
    ]),
    ...report.articles.map((value) =>
      ["article", value.articleName, null, null, value.current.count, value.current.average, value.current.smallSample, value.previous.count, value.previous.average, value.previous.smallSample, value.difference, value.direction, value.directionReason, null]),
    ...report.warnings.map((value) =>
      ["warning", value.code, null, null, report.totals.responses, null, true, null, null, null, null, null, null, value.message]),
  ];
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

async function prepare(req: PosRequest): Promise<{ query: ReportQuery; units: ReportUnit[] }> {
  if (!ADMIN_ROLES.has(req.vloga)) {
    const error = new Error("Operativna poročila zahtevajo administrativni dostop");
    Object.assign(error, { status: 403 });
    throw error;
  }
  const query = parseQrFeedbackReportQuery(req.query as Record<string, unknown>);
  return { query, units: await resolveUnits(req, query) };
}

function sendError(res: Response, error: unknown): void {
  const typed = error as Error & { status?: number };
  res.status(typed.status ?? 500).json({ error: typed.message || "Napaka pri pripravi poročila" });
}

router.get("/operativna-porocila/qr-feedback", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const prepared = await prepare(req as PosRequest);
    res.json(await loadReport(prepared.query, prepared.units));
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/operativna-porocila/qr-feedback/comments", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const prepared = await prepare(req as PosRequest);
    const pageRaw = typeof req.query.page === "string" ? req.query.page : "1";
    const pageSizeRaw = typeof req.query.pageSize === "string" ? req.query.pageSize : "20";
    if (!/^[1-9]\d*$/.test(pageRaw) || !/^[1-9]\d*$/.test(pageSizeRaw)) {
      throw new ReportRequestError("page in pageSize morata biti pozitivni celi števili");
    }
    const page = Number(pageRaw);
    const pageSize = Number(pageSizeRaw);
    if (!Number.isSafeInteger(page) || pageSize > 50) throw new ReportRequestError("pageSize je lahko največ 50");
    const scopes = prepared.units.map((unit) => and(
      eq(qrGostPovratneInformacijeTable.enotaId, unit.id),
      gte(qrGostPovratneInformacijeTable.createdAt, unit.start),
      lt(qrGostPovratneInformacijeTable.createdAt, unit.end),
    ));
    const scope = scopes.length === 0 ? sql`false` : or(...scopes);
    const where = and(scope, sql`length(btrim(${qrGostPovratneInformacijeTable.komentar})) > 0`);
    const [countRows, rows] = await Promise.all([
      db.select({ count: count() }).from(qrGostPovratneInformacijeTable).where(where),
      db.select({
        enotaId: qrGostPovratneInformacijeTable.enotaId,
        createdAt: qrGostPovratneInformacijeTable.createdAt,
        text: qrGostPovratneInformacijeTable.komentar,
      }).from(qrGostPovratneInformacijeTable).where(where)
        .orderBy(desc(qrGostPovratneInformacijeTable.createdAt))
        .limit(pageSize).offset((page - 1) * pageSize),
    ]);
    const names = new Map(prepared.units.map((unit) => [unit.id, unit.name]));
    const total = Number(countRows[0]?.count ?? 0);
    res.json({
      scope: {
        od: prepared.query.od,
        do: prepared.query.do,
        timeZone: POS_TIME_ZONE,
        units: prepared.units.map(({ id, name }) => ({ id, name })),
      },
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
      protected: true,
      comments: rows.map((row) => ({
        unitName: names.get(row.enotaId) ?? "",
        createdAt: row.createdAt.toISOString(),
        text: row.text,
      })),
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/operativna-porocila/qr-feedback/export", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  try {
    const prepared = await prepare(req as PosRequest);
    const report = await loadReport(prepared.query, prepared.units);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="qr-feedback-${prepared.query.od}-${prepared.query.do}.csv"`);
    res.send(qrFeedbackReportCsv(report));
  } catch (error) {
    sendError(res, error);
  }
});

export default router;