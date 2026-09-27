import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, MessageSquare, Star, TrendingUp, TrendingDown, Minus, AlertTriangle, AlertCircle, ChevronLeft, ChevronRight, Search, RotateCcw, ArrowDown, ArrowUp } from "lucide-react";
import {
  useGetOperativnaPorocilaQrFeedback,
  getGetOperativnaPorocilaQrFeedbackQueryKey,
  useGetOperativnaPorocilaQrFeedbackComments,
  getGetOperativnaPorocilaQrFeedbackCommentsQueryKey,
  exportOperativnaPorocilaQrFeedback
} from "@workspace/api-client-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import { primerjajSlovensko } from "@/lib/slovensko-razvrscanje";

interface Props {
  queryParams: {
    od: string;
    do: string;
    enotaId?: number;
  };
}

type ArticleDirection = "improved" | "declined" | "unchanged" | "unavailable";
type ArticleSort = "difference" | "currentAverage" | "sampleSize";
type ArticleSortOrder = "ascending" | "descending";
type ArticleViewState = {
  version: 1;
  search: string;
  sort: ArticleSort;
  sortOrder: ArticleSortOrder;
  directions: Record<ArticleDirection, boolean>;
};
type TrendRow = {
  periodStart: string;
  periodEnd: string;
  responses: number;
  foodAverage: number | null;
  ambienceAverage: number | null;
  serviceAverage: number | null;
  smallSample: boolean;
};

type TrendChartRow = TrendRow & {
  foodReliable: number | null;
  ambienceReliable: number | null;
  serviceReliable: number | null;
  foodSmallSample: number | null;
  ambienceSmallSample: number | null;
  serviceSmallSample: number | null;
};

const ARTICLE_DIRECTION_LABELS: Record<ArticleDirection, string> = {
  improved: "Izboljšani",
  declined: "Poslabšani",
  unchanged: "Nespremenjeni",
  unavailable: "Neprimerljivi",
};
export const QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY = "pos.qr-feedback.article-view.v1";
const ARTICLE_SORTS = new Set<ArticleSort>(["difference", "currentAverage", "sampleSize"]);
const ARTICLE_SORT_ORDERS = new Set<ArticleSortOrder>(["ascending", "descending"]);
const DEFAULT_ARTICLE_VIEW: ArticleViewState = {
  version: 1,
  search: "",
  sort: "difference",
  sortOrder: "descending",
  directions: {
    improved: true,
    declined: true,
    unchanged: true,
    unavailable: true,
  },
};

export function parseStoredArticleView(raw: string | null): ArticleViewState {
  if (raw == null) return DEFAULT_ARTICLE_VIEW;
  try {
    const parsed = JSON.parse(raw) as Partial<ArticleViewState>;
    const directions = parsed.directions as Partial<Record<ArticleDirection, unknown>> | undefined;
    if (
      parsed.version !== 1
      || typeof parsed.search !== "string"
      || typeof parsed.sort !== "string"
      || !ARTICLE_SORTS.has(parsed.sort as ArticleSort)
      || (
        parsed.sortOrder !== undefined
        && (
          typeof parsed.sortOrder !== "string"
          || !ARTICLE_SORT_ORDERS.has(parsed.sortOrder as ArticleSortOrder)
        )
      )
      || directions == null
      || Object.keys(directions).some(
        (direction) => !(direction in ARTICLE_DIRECTION_LABELS),
      )
      || Object.keys(ARTICLE_DIRECTION_LABELS).some(
        (direction) => typeof directions[direction as ArticleDirection] !== "boolean",
      )
    ) {
      return DEFAULT_ARTICLE_VIEW;
    }
    return {
      version: 1,
      search: parsed.search,
      sort: parsed.sort as ArticleSort,
      sortOrder: parsed.sortOrder as ArticleSortOrder | undefined ?? "descending",
      directions: {
        improved: directions.improved as boolean,
        declined: directions.declined as boolean,
        unchanged: directions.unchanged as boolean,
        unavailable: directions.unavailable as boolean,
      },
    };
  } catch {
    return DEFAULT_ARTICLE_VIEW;
  }
}

function readStoredArticleView(): ArticleViewState {
  if (typeof window === "undefined") return DEFAULT_ARTICLE_VIEW;
  try {
    return parseStoredArticleView(window.localStorage.getItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY));
  } catch {
    return DEFAULT_ARTICLE_VIEW;
  }
}

export function buildTrendChartData(trends: TrendRow[]): TrendChartRow[] {
  return trends.map((row) => ({
    ...row,
    foodReliable: row.smallSample ? null : row.foodAverage,
    ambienceReliable: row.smallSample ? null : row.ambienceAverage,
    serviceReliable: row.smallSample ? null : row.serviceAverage,
    foodSmallSample: row.smallSample ? row.foodAverage : null,
    ambienceSmallSample: row.smallSample ? row.ambienceAverage : null,
    serviceSmallSample: row.smallSample ? row.serviceAverage : null,
  }));
}

export function OperativnaPorocilaQrFeedback({ queryParams }: Props) {
  const [granularity, setGranularity] = useState<"day" | "week">("day");
  const [commentsPage, setCommentsPage] = useState(1);
  const [articleView, setArticleView] = useState<ArticleViewState>(readStoredArticleView);
  const {
    search: articleSearch,
    sort: articleSort,
    sortOrder: articleSortOrder,
    directions: articleDirections,
  } = articleView;

  useEffect(() => {
    setCommentsPage(1);
  }, [queryParams.od, queryParams.do, queryParams.enotaId, granularity]);

  useEffect(() => {
    try {
      window.localStorage.setItem(QR_FEEDBACK_ARTICLE_VIEW_STORAGE_KEY, JSON.stringify(articleView));
    } catch {
      // Preferences are optional; keep the report usable when browser storage is unavailable.
    }
  }, [articleView]);

  const {
    data,
    isLoading,
    isError,
    error
  } = useGetOperativnaPorocilaQrFeedback({
    ...queryParams,
    granularity
  }, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaQrFeedbackQueryKey({ ...queryParams, granularity })
    }
  });

  const {
    data: commentsData,
    isLoading: isCommentsLoading,
    isFetching: isCommentsFetching,
    isError: isCommentsError,
    error: commentsError
  } = useGetOperativnaPorocilaQrFeedbackComments({
    ...queryParams,
    granularity,
    page: commentsPage,
    pageSize: 10
  }, {
    query: {
      enabled: !!queryParams.od && !!queryParams.do,
      queryKey: getGetOperativnaPorocilaQrFeedbackCommentsQueryKey({ ...queryParams, granularity, page: commentsPage, pageSize: 10 })
    }
  });

  const handleExport = async () => {
    try {
      const csvString = await exportOperativnaPorocilaQrFeedback({
        ...queryParams,
        granularity
      });
      const blob = new Blob([csvString], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `ocene_gostov_${queryParams.od}_${queryParams.do}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (err) {
      console.error("Export failed", err);
    }
  };

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-destructive text-sm flex items-center gap-3">
        <AlertTriangle className="h-5 w-5" />
        <span>Napaka pri nalaganju mnenj: {(error as any)?.message || "Neznana napaka"}</span>
      </div>
    );
  }

  if (isLoading || !data) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-[200px] w-full rounded-xl" />
      </div>
    );
  }

  const { totals, dimensions, comparison, trends, articles, warnings, comments } = data;
  const trendChartData = buildTrendChartData(trends);

  const normalizedArticleSearch = normalizeSearchText(articleSearch.trim());
  const visibleArticles = articles
    .filter(article =>
      articleDirections[article.direction]
      && normalizeSearchText(article.articleName).includes(normalizedArticleSearch))
    .sort((a, b) => compareArticles(a, b, articleSort, articleSortOrder));

  const articleFiltersChanged = articleSearch !== ""
    || articleSort !== "difference"
    || articleSortOrder !== "descending"
    || Object.values(articleDirections).some(enabled => !enabled);

  const toggleArticleDirection = (direction: ArticleDirection) => {
    setArticleView(current => ({
      ...current,
      directions: {
        ...current.directions,
        [direction]: !current.directions[direction],
      },
    }));
  };

  const resetArticleFilters = () => {
    setArticleView(DEFAULT_ARTICLE_VIEW);
  };
  
  return (
    <div className="space-y-6 animate-in fade-in duration-300">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-bold flex items-center gap-2 text-foreground">
            <Star className="h-5 w-5 text-amber-500" />
            Zadovoljstvo gostov (QR)
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            Povzetek ocen in komentarjev gostov za izbrano obdobje.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Select value={granularity} onValueChange={(v: "day" | "week") => setGranularity(v)}>
            <SelectTrigger className="w-[140px] bg-background" data-testid="select-granularity">
              <SelectValue placeholder="Prikaz" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="day" data-testid="select-option-day">Po dnevih</SelectItem>
              <SelectItem value="week" data-testid="select-option-week">Po tednih</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={handleExport} className="gap-2" data-testid="button-export-feedback">
            <Download className="h-4 w-4" />
            Izvozi CSV
          </Button>
        </div>
      </div>

      {warnings.length > 0 && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-800 dark:text-amber-300 text-sm flex flex-col gap-2">
          {warnings.map((w, i) => (
            <div key={i} className="flex items-start gap-2">
              <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
              <span>{w.message}</span>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-border/60 bg-muted/20 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-sm" data-testid="comparison-periods">
        <div>
          <span className="font-medium text-foreground">Primerjava s prejšnjim obdobjem:</span>{" "}
          <span className="text-muted-foreground">{formatPeriod(comparison.previous.od, comparison.previous.do)}</span>
        </div>
        <div className="flex flex-wrap gap-2 text-xs">
          <SampleBadge label="Trenutno" responses={comparison.current.responses} smallSample={comparison.current.smallSample} />
          <SampleBadge label="Prej" responses={comparison.previous.responses} smallSample={comparison.previous.smallSample} />
        </div>
      </div>

      {totals.responses === 0 ? (
        <Card className="bg-muted/30 border-dashed">
          <CardContent className="p-10 text-center text-muted-foreground">
            <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-20" />
            <p>V tem obdobju ni zabeleženih nobenih mnenj gostov.</p>
            <p className="text-xs mt-2" data-testid="empty-comparison-state">
              Primerjava ni na voljo. Prejšnje obdobje {formatPeriod(comparison.previous.od, comparison.previous.do)} vsebuje {comparison.previous.responses} odzivov.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-primary/5 border-primary/20">
              <CardContent className="p-5 flex flex-col justify-center items-center text-center h-full">
                <p className="text-sm font-medium text-muted-foreground mb-1">Skupno odzivov</p>
                <div className="text-4xl font-bold text-primary">{totals.responses}</div>
                {totals.smallSample && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" /> Manj kot {totals.minimumSample} odzivov
                  </p>
                )}
              </CardContent>
            </Card>

            <ScoreCard title="Hrana" metric={dimensions.food} comparison={comparison.dimensions.food} />
            <ScoreCard title="Ambient" metric={dimensions.ambience} comparison={comparison.dimensions.ambience} />
            <ScoreCard title="Postrežba" metric={dimensions.service} comparison={comparison.dimensions.service} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-2 shadow-sm border-border/60">
              <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Gibanje ocen
                </CardTitle>
              </CardHeader>
              <CardContent className="p-6">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={trendChartData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                      <XAxis 
                        dataKey="periodStart" 
                        tickFormatter={(val) => new Intl.DateTimeFormat('sl-SI', { month: 'short', day: 'numeric' }).format(new Date(val))}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        dy={10}
                      />
                      <YAxis 
                        domain={[1, 5]} 
                        ticks={[1, 2, 3, 4, 5]}
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={12}
                        tickLine={false}
                        axisLine={false}
                        dx={-10}
                      />
                      <Tooltip content={<TrendTooltip />} />
                      <Legend wrapperStyle={{ paddingTop: '20px' }} />
                      <Line type="monotone" name="Hrana" dataKey="foodReliable" stroke="#ef4444" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
                      <Line type="monotone" name="Ambient" dataKey="ambienceReliable" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
                      <Line type="monotone" name="Postrežba" dataKey="serviceReliable" stroke="#10b981" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} />
                      <Line type="monotone" dataKey="foodSmallSample" stroke="transparent" legendType="none" dot={<SmallSampleDot />} activeDot={<SmallSampleDot active />} connectNulls={false} />
                      <Line type="monotone" dataKey="ambienceSmallSample" stroke="transparent" legendType="none" dot={<SmallSampleDot />} activeDot={<SmallSampleDot active />} connectNulls={false} />
                      <Line type="monotone" dataKey="serviceSmallSample" stroke="transparent" legendType="none" dot={<SmallSampleDot />} activeDot={<SmallSampleDot active />} connectNulls={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground" data-testid="trend-sample-legend">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-foreground" aria-hidden="true" />
                    Vsaj 5 odzivov
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full border-2 border-dashed border-amber-500 bg-background" aria-hidden="true" />
                    Manj kot 5 odzivov · majhen vzorec, brez povezovalne črte
                  </span>
                </div>
              </CardContent>
            </Card>

            <Card className="shadow-sm border-border/60 flex flex-col">
              <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5">
                <CardTitle className="text-sm font-bold flex items-center gap-2">
                  <Star className="h-4 w-4" />
                  Spremembe ocen artiklov
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0 flex-1">
                <div className="border-b border-border/40 p-3 space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div className="relative sm:col-span-2">
                      <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                      <Input
                        value={articleSearch}
                        onChange={event => setArticleView(current => ({ ...current, search: event.target.value }))}
                        placeholder="Išči artikel…"
                        aria-label="Išči po nazivu artikla"
                        className="pl-8"
                        data-testid="input-article-search"
                      />
                    </div>
                    <Select value={articleSort} onValueChange={(value: ArticleSort) => setArticleView(current => ({ ...current, sort: value }))}>
                      <SelectTrigger className="bg-background" aria-label="Razvrsti artikle" data-testid="select-article-sort">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="difference">Največja sprememba</SelectItem>
                        <SelectItem value="currentAverage">Trenutna ocena</SelectItem>
                        <SelectItem value="sampleSize">Velikost vzorca</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-2 whitespace-nowrap"
                      aria-label={`Smer razvrščanja: ${articleSortOrder === "descending" ? "padajoče" : "naraščajoče"}`}
                      onClick={() => setArticleView(current => ({
                        ...current,
                        sortOrder: current.sortOrder === "descending" ? "ascending" : "descending",
                      }))}
                      data-testid="button-article-sort-order"
                    >
                      {articleSortOrder === "descending"
                        ? <ArrowDown className="h-4 w-4" />
                        : <ArrowUp className="h-4 w-4" />}
                      {articleSortOrder === "descending" ? "Padajoče" : "Naraščajoče"}
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filtriraj artikle po smeri">
                    {(Object.keys(ARTICLE_DIRECTION_LABELS) as ArticleDirection[]).map(direction => (
                      <Button
                        key={direction}
                        type="button"
                        size="sm"
                        variant={articleDirections[direction] ? "secondary" : "outline"}
                        className="h-7 px-2 text-xs"
                        aria-pressed={articleDirections[direction]}
                        onClick={() => toggleArticleDirection(direction)}
                        data-testid={`filter-article-${direction}`}
                      >
                        {ARTICLE_DIRECTION_LABELS[direction]}
                      </Button>
                    ))}
                    {articleFiltersChanged && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2 text-xs ml-auto"
                        onClick={resetArticleFilters}
                        data-testid="button-reset-article-filters"
                      >
                        <RotateCcw className="h-3 w-3 mr-1" />
                        Ponastavi
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground" data-testid="article-result-count">
                    Prikazano {visibleArticles.length} od {articles.length} artiklov
                  </p>
                </div>
                <div className="overflow-auto max-h-[300px]">
                  {articles.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-article-comparison">
                      Ni artiklov za primerjavo.
                    </div>
                  ) : visibleArticles.length === 0 ? (
                    <div className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-filtered-article-comparison">
                      Noben artikel ne ustreza iskanju in filtrom.
                    </div>
                  ) : (
                    <ArticleComparisonTable articles={visibleArticles} />
                  )}
                  </div>
                </CardContent>
            </Card>
          </div>

          <Card className="shadow-sm border-border/60">
            <CardHeader className="bg-muted/30 border-b border-border/40 pb-4 pt-5 flex flex-row items-center justify-between">
              <CardTitle className="text-sm font-bold flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Komentarji gostov
              </CardTitle>
              <div className="text-xs font-semibold bg-primary/10 text-primary px-2.5 py-1 rounded-full">
                Skupaj: {comments.count}
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {comments.count === 0 ? (
                <div className="p-8 text-center text-sm text-muted-foreground" data-testid="empty-comments-state">
                  V tem obdobju ni besedilnih komentarjev.
                </div>
              ) : isCommentsError ? (
                <div className="p-6" data-testid="error-comments-state">
                  <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-destructive text-sm flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5" />
                    <span>Napaka pri nalaganju komentarjev: {(commentsError as any)?.message || "Neznana napaka"}</span>
                  </div>
                </div>
              ) : (
                <>
                  <div className="divide-y divide-border/40">
                    {isCommentsLoading ? (
                      <div className="p-6 space-y-4">
                        <Skeleton className="h-16 w-full" />
                        <Skeleton className="h-16 w-full" />
                      </div>
                    ) : commentsData?.comments?.length === 0 ? (
                      <div className="p-6 text-center text-sm text-muted-foreground" data-testid="empty-page-comments-state">
                        Na tej strani ni komentarjev.
                      </div>
                    ) : (
                      commentsData?.comments?.map((c, i) => (
                        <div key={i} className="p-5 hover:bg-muted/20 transition-colors" data-testid={`comment-row-${i}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                              {c.unitName}
                            </div>
                            <div className="text-xs text-muted-foreground tabular-nums">
                              {new Intl.DateTimeFormat('sl-SI', { 
                                day: '2-digit', month: '2-digit', year: 'numeric',
                                hour: '2-digit', minute: '2-digit'
                              }).format(new Date(c.createdAt))}
                            </div>
                          </div>
                          <p className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">{c.text}</p>
                        </div>
                      ))
                    )}
                  </div>
                  {commentsData && commentsData.totalPages > 1 && (
                    <div className="p-4 border-t border-border/40 flex items-center justify-between bg-muted/10">
                      <div className="text-xs text-muted-foreground">
                        Stran <span data-testid="comments-current-page">{commentsData.page}</span> od {commentsData.totalPages}
                      </div>
                      <div className="flex items-center gap-2">
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setCommentsPage(p => Math.max(1, p - 1))}
                          disabled={commentsData.page === 1 || isCommentsFetching}
                          data-testid="button-comments-prev"
                        >
                          <ChevronLeft className="h-4 w-4" />
                        </Button>
                        <Button 
                          variant="outline" 
                          size="sm" 
                          onClick={() => setCommentsPage(p => Math.min(commentsData.totalPages, p + 1))}
                          disabled={commentsData.page === commentsData.totalPages || isCommentsFetching}
                          data-testid="button-comments-next"
                        >
                          <ChevronRight className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function slovenianPeriod(start: string, end: string): string {
  const formatter = new Intl.DateTimeFormat("sl-SI", { dateStyle: "medium", timeZone: "UTC" });
  const formattedStart = formatter.format(new Date(`${start.slice(0, 10)}T00:00:00Z`));
  const formattedEnd = formatter.format(new Date(`${end.slice(0, 10)}T00:00:00Z`));
  return start.slice(0, 10) === end.slice(0, 10) ? formattedStart : `${formattedStart}–${formattedEnd}`;
}

export function TrendTooltip({ active, payload }: {
  active?: boolean;
  payload?: Array<{ payload?: TrendChartRow }>;
}) {
  const row = payload?.[0]?.payload;
  if (!active || !row) return null;
  const metrics = [
    ["Hrana", row.foodAverage],
    ["Ambient", row.ambienceAverage],
    ["Postrežba", row.serviceAverage],
  ] as const;
  return (
    <div className="min-w-[190px] rounded-lg border border-border bg-background p-3 text-xs shadow-lg" data-testid="trend-tooltip">
      <p className="font-semibold text-foreground">{slovenianPeriod(row.periodStart, row.periodEnd)}</p>
      <p className="mt-1 text-muted-foreground">{row.responses} odzivov</p>
      {row.smallSample && (
        <p className="mt-2 flex items-start gap-1.5 font-medium text-amber-700 dark:text-amber-300" data-testid="trend-tooltip-small-sample">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          Majhen vzorec – manj kot 5 odzivov
        </p>
      )}
      <div className="mt-2 space-y-1">
        {metrics.map(([label, value]) => (
          <div key={label} className="flex justify-between gap-4">
            <span className="text-muted-foreground">{label}</span>
            <span className="font-medium tabular-nums text-foreground">{value == null ? "–" : value.toFixed(1)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function SmallSampleDot({ cx, cy, active = false }: {
  cx?: number;
  cy?: number;
  active?: boolean;
}) {
  if (cx == null || cy == null) return null;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={active ? 7 : 5}
      fill="hsl(var(--background))"
      stroke="#f59e0b"
      strokeWidth={2}
      strokeDasharray="2 1"
      data-testid="trend-dot-small-sample"
    />
  );
}

function formatPeriod(od: string, doParam: string): string {
  const formatter = new Intl.DateTimeFormat("sl-SI", { day: "numeric", month: "numeric", year: "numeric", timeZone: "UTC" });
  const from = formatter.format(new Date(`${od}T00:00:00Z`));
  const to = formatter.format(new Date(`${doParam}T00:00:00Z`));
  return od === doParam ? from : `${from}–${to}`;
}

function SampleBadge({ label, responses, smallSample }: { label: string; responses: number; smallSample: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 font-medium ${smallSample ? "bg-amber-500/10 text-amber-700 dark:text-amber-300" : "bg-background text-muted-foreground"}`}>
      {smallSample && <AlertTriangle className="h-3 w-3" />}
      {label}: {responses} odzivov{smallSample ? " · majhen vzorec" : ""}
    </span>
  );
}

type ComparisonMetric = {
  currentAverage: number | null;
  previousAverage: number | null;
  difference: number | null;
  direction: "improved" | "declined" | "unchanged" | "unavailable";
  directionReason: string | null;
};

function ScoreCard({ title, metric, comparison }: {
  title: string;
  metric: { average: number | null; count: number; smallSample: boolean };
  comparison: ComparisonMetric;
}) {
  const comparisonContent = comparison.direction === "unavailable" && comparison.difference !== null
    ? {
        label: `${comparison.difference > 0 ? "+" : ""}${comparison.difference.toFixed(1)} točke · nezanesljivo`,
        className: "text-amber-600 dark:text-amber-400",
        icon: AlertTriangle,
      }
    : comparison.direction === "unavailable" || comparison.difference === null
      ? { label: "Primerjava ni na voljo", className: "text-muted-foreground", icon: AlertCircle }
    : comparison.direction === "improved"
      ? { label: `+${comparison.difference.toFixed(1)} točke`, className: "text-emerald-600 dark:text-emerald-400", icon: TrendingUp }
      : comparison.direction === "declined"
        ? { label: `${comparison.difference.toFixed(1)} točke`, className: "text-red-600 dark:text-red-400", icon: TrendingDown }
        : { label: "Brez spremembe", className: "text-muted-foreground", icon: Minus };
  const ComparisonIcon = comparisonContent.icon;
  return (
    <Card className="shadow-sm border-border/60" data-testid={`card-metric-${title.toLowerCase()}`}>
      <CardContent className="p-5 flex flex-col justify-center">
        <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
        <div className="flex items-baseline gap-2">
          {metric.average !== null ? (
            <>
              <div className="text-3xl font-bold tabular-nums text-foreground">
                {metric.average.toFixed(1)}
              </div>
              <div className="text-sm font-medium text-muted-foreground flex items-center">
                <Star className="h-3.5 w-3.5 fill-amber-500 text-amber-500 mr-1" />
                / 5
              </div>
            </>
          ) : (
            <div className="text-3xl font-bold text-muted-foreground/30">-</div>
          )}
        </div>
        <div className={`mt-3 flex items-center gap-1.5 text-xs font-semibold ${comparisonContent.className}`} data-testid={`metric-comparison-${title.toLowerCase()}`}>
          <ComparisonIcon className="h-3.5 w-3.5" />
          <span>{comparisonContent.label}</span>
          {comparison.previousAverage !== null && (
            <span className="font-normal text-muted-foreground">· prej {comparison.previousAverage.toFixed(1)}</span>
          )}
        </div>
        {comparison.directionReason && (
          <p className="mt-1 text-[11px] leading-snug text-amber-700 dark:text-amber-300" data-testid={`metric-direction-reason-${title.toLowerCase()}`}>
            {comparison.directionReason}
          </p>
        )}
        <div className="mt-3 flex items-center justify-between text-xs">
          <span className="text-muted-foreground">{metric.count} ocen</span>
          {metric.smallSample && (
            <span className="text-amber-600 dark:text-amber-400 font-medium flex items-center" title="Majhen vzorec ocen, ocena morda ni merodajna." aria-label="Majhen vzorec">
              <AlertTriangle className="h-3 w-3 mr-1" /> Opozorilo
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

type ArticleComparison = {
  articleName: string;
  current: { average: number | null; count: number; smallSample: boolean };
  previous: { average: number | null; count: number; smallSample: boolean };
  difference: number | null;
  direction: ArticleDirection;
  directionReason: string | null;
};

function ArticleComparisonTable({ articles }: { articles: ArticleComparison[] }) {
  return (
    <table className="w-full text-sm">
      <tbody className="divide-y divide-border/20">
        {articles.map((a) => (
          <tr key={a.articleName} className="hover:bg-muted/30 transition-colors" data-testid={`article-comparison-${a.articleName.replace(/\s+/g, '-').toLowerCase()}`}>
            <td className="px-4 py-2 font-medium" data-testid={`article-name-${a.articleName.replace(/\s+/g, '-').toLowerCase()}`}>{a.articleName}</td>
            <td className="px-4 py-2 text-right text-xs tabular-nums text-muted-foreground">
              <div>Zdaj <span className="font-semibold text-foreground">{a.current.average?.toFixed(1) ?? "-"}</span> · {a.current.count} ocen{a.current.smallSample ? "*" : ""}</div>
              <div>Prej <span className="font-semibold text-foreground">{a.previous.average?.toFixed(1) ?? "-"}</span> · {a.previous.count} ocen{a.previous.smallSample ? "*" : ""}</div>
            </td>
            <td className={`px-4 py-2 text-right tabular-nums ${a.direction === "improved" ? "font-bold text-emerald-600 dark:text-emerald-400" : a.direction === "declined" ? "font-bold text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
              <div>{a.difference !== null ? `${a.difference > 0 ? "+" : ""}${a.difference.toFixed(1)}` : "-"}</div>
              <div
                className="mt-1 text-[10px] font-medium"
                data-testid={`article-direction-${a.articleName.replace(/\s+/g, '-').toLowerCase()}`}
              >
                {ARTICLE_DIRECTION_LABELS[a.direction]}
              </div>
              {a.directionReason && (
                <div className="mt-1 max-w-[260px] text-[11px] font-normal leading-tight text-amber-700 dark:text-amber-300" data-testid={`article-direction-reason-${a.articleName.replace(/\s+/g, '-').toLowerCase()}`}>
                  {a.directionReason}
                </div>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("sl");
}

function compareArticles(
  a: ArticleComparison,
  b: ArticleComparison,
  sort: ArticleSort,
  order: ArticleSortOrder,
): number {
  let difference = 0;
  if (sort === "difference") {
    difference = nullableNumberComparison(
      a.difference === null ? null : Math.abs(a.difference),
      b.difference === null ? null : Math.abs(b.difference),
      order,
    );
  } else if (sort === "currentAverage") {
    difference = nullableNumberComparison(a.current.average, b.current.average, order);
  } else {
    difference = nullableNumberComparison(
      a.current.count + a.previous.count,
      b.current.count + b.previous.count,
      order,
    );
  }
  return difference || primerjajSlovensko(a.articleName, b.articleName);
}

function nullableNumberComparison(a: number | null, b: number | null, order: ArticleSortOrder): number {
  if (a === null) return b === null ? 0 : 1;
  if (b === null) return -1;
  return order === "descending" ? b - a : a - b;
}
