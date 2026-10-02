import { useMemo, useState } from "react";
import {
  getGetPreparedFoodAvailabilityQueryKey,
  getListArtikliQueryKey,
  getListPreparedFoodDailyQueryKey,
  useGetPreparedFoodAvailability,
  useListArtikli,
  useListPreparedFoodDaily,
  type Artikel,
  type PreparedFoodAvailability,
  type PreparedFoodAvailabilityItem,
} from "@workspace/api-client-react";
import { ChefHat, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";

type PizzaSize = "mala" | "normalna" | "druzinska";

export type KitchenAvailabilityLine = {
  artikelId?: number | null;
  modifikatorId?: number | null;
  velikostPice?: PizzaSize | null;
  kolicina?: number;
  jePica?: boolean;
};

export type KitchenAvailabilityState = {
  availability?: PreparedFoodAvailability;
  articles?: Artikel[];
  /** Membership of the daily-evidence screen for the server's business day. */
  dailyArticleIds?: number[];
  loading?: boolean;
  error?: boolean;
  offline?: boolean;
};

export type KitchenAvailabilityBadgeValue = {
  kind: "available" | "unknown" | "offline";
  label: string;
};

const PIZZA_SIZES: PizzaSize[] = ["mala", "normalna", "druzinska"];
const PIZZA_SIZE_LABELS: Record<PizzaSize, string> = {
  mala: "mala",
  normalna: "normalna",
  druzinska: "družinska",
};

function formatQuantity(quantity: number): string {
  return quantity.toLocaleString("sl-SI", { maximumFractionDigits: 4, useGrouping: false });
}

/** Unit normalization used for display only; unsupported units stay explicit. */
export function getKitchenPreparedUnit(unit: string | null | undefined, knownArticle = false): string {
  if (unit === null) return knownArticle ? "porcija" : "enota neznana";
  if (unit === undefined || unit.trim() === "") return "enota neznana";
  const value = unit.trim().toLocaleLowerCase("en");
  if (["kg", "kilogram", "kilograms", "kgm"].includes(value)) return "kg";
  if (["l", "liter", "liters", "litre", "litres", "ltr"].includes(value)) return "l";
  if (["porcija", "porcije", "porc", "portion", "portions", "serving", "servings", "h87", "kos", "kom", "pce", "ea"].includes(value)) return "porcija";
  return `neznana enota (${unit.trim()})`;
}

function articleMap(articles: Artikel[] | undefined): Map<number, Artikel> {
  return new Map((articles ?? []).map(article => [article.id, article]));
}

function availabilityItem(state: KitchenAvailabilityState, articleId: number | null | undefined): PreparedFoodAvailabilityItem | undefined {
  if (articleId == null) return undefined;
  return state.availability?.items.find(item => item.articleId === articleId);
}

function availabilityFailure(state: KitchenAvailabilityState): KitchenAvailabilityBadgeValue | null {
  if (state.offline) return { kind: "offline", label: "Zaloga ni na voljo brez povezave" };
  if (state.loading) return { kind: "unknown", label: "Razpoložljivost se nalaga" };
  if (state.error) return { kind: "unknown", label: "Razpoložljivost ni na voljo" };
  return null;
}

/** Shows the server's remaining capacity for new sales; ticket quantities are not subtracted again. */
export function getKitchenAvailabilityBadge(
  line: KitchenAvailabilityLine,
  state: KitchenAvailabilityState,
): KitchenAvailabilityBadgeValue | null {
  const article = articleMap(state.articles).get(line.artikelId ?? -1);
  const item = availabilityItem(state, line.artikelId);
  const isPizza = Boolean(line.jePica || article?.jePica || article?.pripravaVrsta === "pica" || item?.availableBySize);
  const mealType = item?.mealType ?? article?.mealType;
  const isPreparedMeal = mealType === "prepared" || mealType === "composite";
  if (!isPizza && !isPreparedMeal) return null;

  const failed = availabilityFailure(state);
  if (failed) return failed;

  if (isPizza) {
    if (!item) return { kind: "unknown", label: "Kapaciteta pice ni znana" };
    const size = line.velikostPice ?? "normalna";
    const quantity = item.availableBySize?.[size];
    if (quantity === null) {
      return { kind: "available", label: `Brez izračunane omejitve · ${PIZZA_SIZE_LABELS[size]} pica` };
    }
    // An omitted size means that no capacity is configured for that size.
    return {
      kind: "available",
      label: `Še na voljo: ${formatQuantity(quantity ?? 0)} × ${PIZZA_SIZE_LABELS[size]} pica`,
    };
  }

  if (!item) return { kind: "unknown", label: "Razpoložljivost jedi ni znana" };
  if (item.availableQuantity === null) {
    return { kind: "available", label: "Brez izračunane omejitve" };
  }
  const unit = mealType === "prepared"
    ? getKitchenPreparedUnit(article?.enotaMere, article != null)
    : "porcij";
  const unitLabel = unit === "porcija" ? "porcij" : unit;
  return { kind: "available", label: `Še na voljo: ${formatQuantity(item.availableQuantity)} ${unitLabel}` };
}

export function getKitchenModifierAvailabilityBadge(
  modifierId: number | null | undefined,
  state: KitchenAvailabilityState,
): KitchenAvailabilityBadgeValue | null {
  if (modifierId == null) return null;
  const modifier = state.availability?.modifierItems.find(item => item.modifierId === modifierId);
  if (!modifier) return null;
  const failed = availabilityFailure(state);
  if (failed) return failed;
  return { kind: "available", label: `Še na voljo: ${formatQuantity(modifier.availableQuantity)} izbir` };
}

export function useKitchenPreparedAvailability(enabled: boolean) {
  const gatewayOffline = useGatewayOfflineContext();
  const offline = gatewayOffline.effectiveAuthority === "GATEWAY";
  const queryEnabled = enabled && !offline;
  const availabilityQuery = useGetPreparedFoodAvailability({
    query: {
      queryKey: getGetPreparedFoodAvailabilityQueryKey(),
      enabled: queryEnabled,
      refetchInterval: queryEnabled ? 5_000 : false,
      staleTime: 2_000,
      refetchOnMount: queryEnabled ? "always" : false,
    },
  });
  const articlesQuery = useListArtikli(undefined, {
    query: {
      queryKey: getListArtikliQueryKey(),
      enabled: queryEnabled,
      staleTime: 30_000,
    },
  });
  const businessDate = availabilityQuery.data?.businessDate ?? "";
  const dailyQuery = useListPreparedFoodDaily(businessDate, {
    query: {
      queryKey: getListPreparedFoodDailyQueryKey(businessDate),
      enabled: queryEnabled && !!businessDate,
      refetchInterval: queryEnabled && !!businessDate ? 5_000 : false,
      staleTime: 2_000,
      refetchOnMount: queryEnabled && !!businessDate ? "always" : false,
    },
  });
  const error = availabilityQuery.isError || articlesQuery.isError || (!!businessDate && dailyQuery.isError);
  const refetch = async () => {
    await Promise.all([
      availabilityQuery.refetch(), articlesQuery.refetch(),
      ...(businessDate ? [dailyQuery.refetch()] : []),
    ]);
  };
  return {
    state: {
      // Keep cached records for line classification, but downstream UI must
      // honor offline/error before ever reading a cached quantity.
      availability: availabilityQuery.data,
      articles: articlesQuery.data,
      dailyArticleIds: dailyQuery.data
        ?.filter(row => row.businessDate === businessDate)
        .map(row => row.artikelId),
      loading: queryEnabled && (availabilityQuery.isLoading || articlesQuery.isLoading
        || (!!businessDate && dailyQuery.isLoading)),
      error,
      offline,
    } satisfies KitchenAvailabilityState,
    isFetching: queryEnabled && (availabilityQuery.isFetching || articlesQuery.isFetching || dailyQuery.isFetching),
    refetch,
    canRetry: queryEnabled,
  };
}

function AvailabilityBadge({ value }: { value: KitchenAvailabilityBadgeValue | null }) {
  if (!value) return null;
  const color = value.kind === "available"
    ? "border-sky-300 bg-sky-50 text-sky-900"
    : value.kind === "offline"
      ? "border-amber-300 bg-amber-50 text-amber-900"
      : "border-slate-300 bg-slate-100 text-slate-700";
  return (
    <span
      className={`mt-1 inline-flex max-w-full items-center rounded border px-1.5 py-0.5 text-[10px] font-bold leading-tight ${color}`}
      data-testid="status-kitchen-availability"
      data-availability={value.kind}
    >
      {value.label}
    </span>
  );
}

export function KitchenAvailabilityBadge({
  line,
  state,
}: {
  line: KitchenAvailabilityLine;
  state: KitchenAvailabilityState;
}) {
  return <AvailabilityBadge value={getKitchenAvailabilityBadge(line, state)} />;
}

export function KitchenModifierAvailabilityBadge({
  modifierId,
  state,
}: {
  modifierId?: number | null;
  state: KitchenAvailabilityState;
}) {
  return <AvailabilityBadge value={getKitchenModifierAvailabilityBadge(modifierId, state)} />;
}

function displayQuantity(value: number | null | undefined, unit: string): string {
  return value == null ? "Ni podatka" : `${formatQuantity(value)} ${unit}`;
}

function getCapacityLabel(item: PreparedFoodAvailabilityItem, article: Artikel | undefined): string {
  const isPizza = Boolean(article?.jePica || article?.pripravaVrsta === "pica" || item.availableBySize);
  if (isPizza) {
    return PIZZA_SIZES.map(size => {
      const value = item.availableBySize?.[size];
      return `${PIZZA_SIZE_LABELS[size]}: ${value === null ? "brez izračunane omejitve" : value === undefined ? "0 · ni na voljo" : formatQuantity(value)}`;
    }).join(" · ");
  }
  if (item.mealType === "prepared" && article?.prodajniArtikel === false) {
    return "Ni prodajni artikel";
  }
  if (item.availableQuantity === null) return "Brez izračunane omejitve";
  const unit = item.mealType === "prepared"
    ? getKitchenPreparedUnit(article?.enotaMere, article != null)
    : "porcij";
  return displayQuantity(item.availableQuantity, unit === "porcija" ? "porcij" : unit);
}

function PreparedAvailabilityOverview({
  state,
  loading,
  error,
  offline,
  isFetching,
  onRetry,
  canRetry,
}: {
  state: KitchenAvailabilityState;
  loading: boolean;
  error: boolean;
  offline: boolean;
  isFetching: boolean;
  onRetry: () => void;
  canRetry: boolean;
}) {
  const dailyArticleIds = new Set(state.dailyArticleIds ?? []);
  const items = state.availability?.items.filter(item =>
    item.mealType === "prepared" && dailyArticleIds.has(item.articleId)) ?? [];
  const articles = useMemo(() => articleMap(state.articles), [state.articles]);

  if (offline) {
    return (
      <div className="rounded-md border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" role="status" data-testid="status-prepared-availability-offline">
        Zaloga ni na voljo brez povezave. Cloud zaloga v tem načinu ni trenutna, zato prikazujemo nobenih zalog.
      </div>
    );
  }
  if (error) {
    return (
      <div className="space-y-3" role="alert" data-testid="status-prepared-availability-error">
        <p className="text-sm text-destructive">Razpoložljivosti pripravljenih jedi ni mogoče naložiti. Starih podatkov ne prikazujemo.</p>
        <Button type="button" variant="outline" onClick={onRetry} disabled={!canRetry} data-testid="button-retry-prepared-availability">
          <RefreshCw className="mr-2 h-4 w-4" /> Poskusi znova
        </Button>
      </div>
    );
  }
  if (loading || !state.availability || !state.articles || !state.dailyArticleIds) {
    return <p className="py-8 text-center text-sm text-muted-foreground" role="status" data-testid="status-prepared-availability-loading">Nalaganje razpoložljivosti...</p>;
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">
        Prikazane so samo jedi iz dnevne evidence pripravljene hrane za ta poslovni dan.{" "}
        Prikazane so količine za nova naročila; sistem je že odštel vse naročene postavke, tudi te listke.
        Zamrznjene porcije niso vključene v razpoložljivost, dokler niso odtajane.
      </p>
      {items.some(item => item.availableBySize) && <p className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs font-semibold text-amber-950" data-testid="text-shared-prepared-stock">
        Zaloga je skupna. Kapacitete male, normalne in družinske pice porabljajo iste sestavine, zato jih ne seštevajte.
      </p>}
      {isFetching && <p className="text-xs text-muted-foreground" role="status" data-testid="status-prepared-availability-refreshing">Osvežujem zalogo…</p>}
      {items.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground" data-testid="status-prepared-availability-empty">V dnevni evidenci za ta poslovni dan ni pripravljenih jedi.</p>
      ) : (
        <div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
          {items.map(item => {
            const article = articles.get(item.articleId);
            const unit = getKitchenPreparedUnit(article?.enotaMere, article != null);
            const freshLabel = item.mealType === "prepared"
              ? displayQuantity(item.freshQuantity, unit === "porcija" ? "porcij" : unit)
              : null;
            return (
              <article
                key={item.articleId}
                className="rounded-md border bg-card p-3"
                data-testid={`row-prepared-availability-${item.articleId}`}
              >
                <h3 className="font-semibold">{item.articleName}</h3>
                {freshLabel && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Nezamrznjeno, za nadaljnjo uporabo: <span className="font-semibold text-foreground">{freshLabel}</span>
                  </p>
                )}
                <p className="mt-1 text-sm">
                  Kapaciteta za prodajo: <span className="font-semibold">{getCapacityLabel(item, article)}</span>
                </p>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function PreparedAvailabilityToolbar({
  state,
  loading = false,
  error = false,
  offline = false,
  isFetching = false,
  onRetry = () => undefined,
  canRetry = true,
}: {
  state: KitchenAvailabilityState;
  loading?: boolean;
  error?: boolean;
  offline?: boolean;
  isFetching?: boolean;
  onRetry?: () => void;
  canRetry?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const resolvedOffline = offline || Boolean(state.offline);
  const resolvedError = error || Boolean(state.error);
  const resolvedLoading = loading || Boolean(state.loading);
  const resolvedState = {
    ...state,
    offline: resolvedOffline,
    error: resolvedError,
    loading: resolvedLoading,
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      {resolvedOffline ? (
        <span className="text-xs font-semibold text-amber-300" role="status" data-testid="status-kitchen-stock-offline">
          Zaloga ni na voljo brez povezave
        </span>
      ) : resolvedError ? (
        <span className="text-xs font-semibold text-red-300" role="status" data-testid="status-kitchen-stock-error">
          Napaka pri nalaganju zaloge
        </span>
      ) : resolvedLoading ? (
        <span className="text-xs text-gray-300" role="status" data-testid="status-kitchen-stock-loading">
          Nalagam razpoložljivost…
        </span>
      ) : isFetching ? (
        <span className="text-xs text-gray-300" role="status" data-testid="status-kitchen-stock-refreshing">
          Osvežujem zalogo…
        </span>
      ) : null}
      <Button
        type="button"
        variant="outline"
        className="border-gray-700 bg-gray-900 text-gray-100 hover:bg-gray-800 hover:text-white"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        data-testid="button-open-prepared-availability"
      >
        <ChefHat className="mr-2 h-4 w-4" aria-hidden="true" />
        Razpoložljivost
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Razpoložljivost pripravljenih jedi</DialogTitle>
            <DialogDescription>
              Še na voljo za nova naročila. To je informativni, samo bralni pregled skupne zaloge.
            </DialogDescription>
          </DialogHeader>
          <PreparedAvailabilityOverview
            state={resolvedState}
            loading={resolvedLoading}
            error={resolvedError}
            offline={resolvedOffline}
            isFetching={isFetching}
            onRetry={onRetry}
            canRetry={canRetry}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}