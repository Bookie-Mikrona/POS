import { useQueries } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuoteDailyLunch, useListDailyLunchOffers, useAddDailyLunchToOrder, useListArtikli, useGetPreparedFoodAvailability, getGetPreparedFoodAvailabilityQueryKey, getGetModifikatorNormativiQueryOptions, ApiError, type ModSkupinaFull } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { dailyLunchPrice, requiredDailyLunchRoles, type DailyLunchMode, type DailyLunchRole } from "@/lib/dailyLunchHelpers";

const ROLE_LABELS: Record<string, string> = { starter: "Predjed", soup: "Juha", main: "Glavna jed", dessert: "Sladica" };

type ArticleGroups = { modSkupine?: ModSkupinaFull[] };
const activeGroups = (article: unknown): ModSkupinaFull[] =>
  ((article as ArticleGroups | undefined)?.modSkupine ?? [])
    .map((group) => ({ ...group, modifikatorji: group.modifikatorji.filter((mod) => mod.aktiven) }))
    .filter((group) => group.modifikatorji.length > 0);
const minRequired = (group: ModSkupinaFull) => (group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir);

type Props = { narociloId: number; onQuoted?: (quote: unknown) => void; onAdded?: () => void };

/** Quote-first daily lunch selector. The server remains authoritative for price and availability. */
export function DailyLunchOrderFlow({ narociloId, onQuoted, onAdded }: Props) {
  const { data } = useListDailyLunchOffers();
  const { data: articles } = useListArtikli();
  const articleNames = useMemo(() => new Map((articles ?? []).map((article) => [article.id, article.ime])), [articles]);
  const articlesById = useMemo(() => new Map((articles ?? []).map((article) => [article.id, article])), [articles]);
  const { data: availability } = useGetPreparedFoodAvailability({
    query: { queryKey: getGetPreparedFoodAvailabilityQueryKey(), refetchInterval: (query) => (query.state.status === "error" ? false : 5_000), retry: false, staleTime: 2_000 },
  });
  const modifierStock = useMemo(
    () => new Map((availability?.modifierItems ?? []).map((item) => [item.modifierId, item.availableQuantity] as const)),
    [availability],
  );
  const dishStock = useMemo(
    () => new Map((availability?.items ?? []).map((item) => [item.articleId, item.availableQuantity] as const)),
    [availability],
  );
  const dishSoldOut = (articleId: number) => { const q = dishStock.get(articleId); return q != null && q <= 0; };
  const soldOut = (modId: number) => { const q = modifierStock.get(modId); return q != null && q <= 0; };
  const quote = useQuoteDailyLunch();
  const add = useAddDailyLunchToOrder();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [mode, setMode] = useState<DailyLunchMode>("three_course");
  const [selected, setSelected] = useState<Partial<Record<DailyLunchRole, number>>>({});
  const [modifiers, setModifiers] = useState<Partial<Record<DailyLunchRole, number[]>>>({});
  const [podIzbire, setPodIzbire] = useState<Record<string, number[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [addError, setAddError] = useState<string | null>(null);
  const today = availability?.businessDate;
  // Samo ponudba za današnji poslovni datum; starejša objavljena ponudba ne sme ostati prikazana.
  const offer = data?.offers?.find((row) => row.status === "published" && (!today || String(row.businessDate).slice(0, 10) === today));
  const roles = requiredDailyLunchRoles(mode);
  const choices = useMemo(() => offer?.choices ?? [], [offer]);

  const chosenModifierIds = useMemo(
    () => [...new Set(roles.flatMap((role) => modifiers[role] ?? []))],
    [mode, JSON.stringify(modifiers)], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const normativeQueries = useQueries({
    queries: chosenModifierIds.map((modifierId) => getGetModifikatorNormativiQueryOptions(modifierId)),
  });
  /** Pozitivni vhodni prodajni artikli modifikatorja z lastnimi modifikatorskimi skupinami (npr. brez česna). */
  const nestedSources = (modifierId: number) => {
    const query = normativeQueries[chosenModifierIds.indexOf(modifierId)];
    if (!Array.isArray(query?.data)) return [];
    const seen = new Map<number, { artikelId: number; ime: string; groups: ModSkupinaFull[] }>();
    for (const row of query.data) {
      if (!(Number(row.kolicina) > 0)) continue;
      const article = articlesById.get(row.vhodniArtikelId);
      if (!article || article.prodajniArtikel !== true || seen.has(article.id)) continue;
      const groups = activeGroups(article);
      if (groups.length > 0) seen.set(article.id, { artikelId: article.id, ime: article.ime, groups });
    }
    return [...seen.values()];
  };
  const nestedLoading = normativeQueries.some((query) => query.isLoading);
  const nestedComplete = roles.every((role) => (modifiers[role] ?? []).every((modId) =>
    nestedSources(modId).every((source) => source.groups.every((group) =>
      group.modifikatorji.filter((mod) => (podIzbire[`${modId}:${source.artikelId}`] ?? []).includes(mod.id)).length >= minRequired(group)))));
  const podIzbirePayload = () => {
    const result: Record<string, Record<string, { artikelId: number; modifikatorIds: number[] }[]>> = {};
    for (const role of roles) for (const modId of modifiers[role] ?? []) {
      const sources = nestedSources(modId);
      if (sources.length === 0) continue;
      (result[role] ??= {})[String(modId)] = sources.map((source) => ({
        artikelId: source.artikelId, modifikatorIds: podIzbire[`${modId}:${source.artikelId}`] ?? [],
      }));
    }
    return result;
  };
  const toggleNested = (modId: number, source: { artikelId: number }, group: ModSkupinaFull, choiceId: number) => setPodIzbire((current) => {
    const key = `${modId}:${source.artikelId}`;
    const chosen = current[key] ?? [];
    if (chosen.includes(choiceId)) return { ...current, [key]: chosen.filter((id) => id !== choiceId) };
    const inGroup = group.modifikatorji.map((mod) => mod.id);
    const mine = chosen.filter((id) => inGroup.includes(id));
    if (group.maxIzbir === 1) return { ...current, [key]: [...chosen.filter((id) => !inGroup.includes(id)), choiceId] };
    if (group.maxIzbir > 0 && mine.length >= group.maxIzbir) return current;
    return { ...current, [key]: [...chosen, choiceId] };
  });

  const modifiersComplete = roles.every((role) => {
    const chosen = modifiers[role] ?? [];
    return activeGroups(articlesById.get(selected[role] ?? -1)).every((group) =>
      group.modifikatorji.filter((mod) => chosen.includes(mod.id)).length >= minRequired(group));
  });
  const selectDish = (role: DailyLunchRole, artikelId: number) => {
    setSelected((current) => ({ ...current, [role]: artikelId }));
    setModifiers((current) => ({
      ...current,
      [role]: activeGroups(articlesById.get(artikelId)).flatMap((group) =>
        group.modifikatorji.filter((mod) => mod.privzet && !soldOut(mod.id)).slice(0, group.maxIzbir > 0 ? group.maxIzbir : undefined).map((mod) => mod.id)),
    }));
  };
  const toggleModifier = (role: DailyLunchRole, group: ModSkupinaFull, modId: number) => setModifiers((current) => {
    const chosen = current[role] ?? [];
    const inGroup = group.modifikatorji.map((mod) => mod.id);
    if (soldOut(modId)) return current;
    if (chosen.includes(modId)) return { ...current, [role]: chosen.filter((id) => id !== modId) };
    const others = chosen.filter((id) => !inGroup.includes(id));
    const mine = chosen.filter((id) => inGroup.includes(id));
    const next = group.maxIzbir === 1 ? [modId] : group.maxIzbir > 0 && mine.length >= group.maxIzbir ? mine : [...mine, modId];
    return { ...current, [role]: [...others, ...next] };
  });

  useEffect(() => { setAddError(null); }, [mode, JSON.stringify(selected), JSON.stringify(modifiers), JSON.stringify(podIzbire)]);
  useEffect(() => {
    if (!offer || !roles.every((role) => selected[role] != null) || !modifiersComplete || nestedLoading || !nestedComplete) return;
    quote.mutate({ offerId: offer.id, data: { mode, selectedDishes: selected as Record<string, number>, modifiers: modifiers as Record<string, number[]>, podIzbire: podIzbirePayload() } }, {
      onSuccess: (value) => onQuoted?.(value),
    });
  }, [offer?.id, mode, JSON.stringify(selected), JSON.stringify(modifiers), JSON.stringify(podIzbire), nestedLoading, nestedComplete]);

  if (!offer) return <p className="text-sm text-muted-foreground">Danes ni objavljene ponudbe kosil.</p>;
  const complete = roles.every((role) => selected[role] != null) && modifiersComplete && nestedComplete && !nestedLoading;
  const addLunch = async () => {
    if (!offer || !complete || !quote.data) return;
    setAddError(null);
    try {
      await add.mutateAsync({
        id: narociloId,
        data: { offerId: offer.id, mode, selectedDishes: selected as Record<string, number>, modifiers: modifiers as Record<string, number[]>, podIzbire: podIzbirePayload(), quantity, idempotencyKey: idempotencyKey.current },
      });
      idempotencyKey.current = crypto.randomUUID();
      setQuantity(1);
      onAdded?.();
    } catch (error) {
      const message = error instanceof ApiError && error.data && typeof error.data === "object" && "error" in error.data
        ? String(error.data.error) : "Kosila ni bilo mogoče dodati.";
      setAddError(message);
      onQuoted?.({ error: message });
    }
  };
  return <div className="space-y-4">
    <div className="flex gap-2">
      <Button variant={mode === "three_course" ? "default" : "outline"} onClick={() => { setMode("three_course"); setSelected({}); setModifiers({}); setPodIzbire({}); }}>3 hodi</Button>
      <Button variant={mode === "four_course" ? "default" : "outline"} onClick={() => { setMode("four_course"); setSelected({}); setModifiers({}); setPodIzbire({}); }}>4 hodi</Button>
    </div>
    {roles.map((role) => <div key={role}><h3 className="mb-2 font-semibold">{ROLE_LABELS[role] ?? role}</h3><div className="grid gap-2 sm:grid-cols-2">{choices.filter((choice) => choice.role === role).map((choice) => <button key={choice.artikelId} type="button" disabled={dishSoldOut(choice.artikelId)} className={`rounded border p-2 text-left disabled:cursor-not-allowed disabled:opacity-50 ${selected[role] === choice.artikelId ? "border-primary bg-primary/10" : ""}`} onClick={() => selectDish(role, choice.artikelId)}>{articleNames.get(choice.artikelId) ?? `Artikel ${choice.artikelId}`}{dishSoldOut(choice.artikelId) ? " (razprodano)" : ""}</button>)}</div>
      {activeGroups(articlesById.get(selected[role] ?? -1)).map((group) => <div key={group.id} className="mt-2 rounded border bg-muted/30 p-2">
        <div className="mb-1 text-sm font-medium">{group.ime}{minRequired(group) > 0 && <span className="ml-1 text-xs text-destructive">(obvezno)</span>}</div>
        <div className="flex flex-wrap gap-2">{group.modifikatorji.map((mod) => {
          const on = (modifiers[role] ?? []).includes(mod.id);
          return <button key={mod.id} type="button" aria-pressed={on} disabled={soldOut(mod.id)} className={`rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-primary bg-primary/10" : ""}`} onClick={() => toggleModifier(role, group, mod.id)}>
            {mod.ime}{soldOut(mod.id) ? " (razprodano)" : ""}{Number(mod.cenaDodatek) > 0 ? ` +${Number(mod.cenaDodatek).toFixed(2).replace(".", ",")} €` : ""}
          </button>;
        })}</div>
        {(modifiers[role] ?? []).filter((id) => group.modifikatorji.some((mod) => mod.id === id)).flatMap((modId) => nestedSources(modId).map((source) => <div key={`${modId}-${source.artikelId}`} className="ml-4 mt-2 border-l-2 border-primary/30 pl-3">
          {source.groups.map((group) => <div key={group.id} className="mb-1">
            <div className="mb-1 text-xs font-medium text-muted-foreground">{source.ime} – {group.ime}{minRequired(group) > 0 && <span className="ml-1 text-destructive">(obvezno)</span>}</div>
            <div className="flex flex-wrap gap-2">{group.modifikatorji.map((mod) => {
              const on = (podIzbire[`${modId}:${source.artikelId}`] ?? []).includes(mod.id);
              return <button key={mod.id} type="button" aria-pressed={on} className={`rounded border px-2 py-1 text-sm ${on ? "border-primary bg-primary/10" : ""}`} onClick={() => toggleNested(modId, source, group, mod.id)}>{mod.ime}</button>;
            })}</div>
          </div>)}
        </div>))}
      </div>)}
    </div>)}
    <div className="flex items-center gap-3">
      <span className="text-sm font-medium">Število kosil</span>
      <Button type="button" variant="outline" size="sm" aria-label="Manj kosil" disabled={quantity <= 1} onClick={() => setQuantity((q) => Math.max(1, q - 1))}>−</Button>
      <span className="w-8 text-center font-semibold" data-testid="daily-lunch-quantity">{quantity}</span>
      <Button type="button" variant="outline" size="sm" aria-label="Več kosil" disabled={quantity >= 20} onClick={() => setQuantity((q) => Math.min(20, q + 1))}>+</Button>
    </div>
    <div className="rounded bg-muted p-3 text-sm">Cena: <strong>{dailyLunchPrice(quote.data ? Number(quote.data.total) * quantity : null)}</strong>{quantity > 1 && quote.data ? <span className="ml-2 text-muted-foreground">({quantity} × {dailyLunchPrice(quote.data.total)})</span> : null}</div>
    {(addError || quote.error) && <p role="alert" className="rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
      {addError ?? (quote.error instanceof ApiError && quote.error.data && typeof quote.error.data === "object" && "error" in quote.error.data ? String(quote.error.data.error) : "Cene kosila ni bilo mogoče izračunati.")}
    </p>}
    <Button className="w-full" disabled={!complete || !quote.data || quote.isPending || add.isPending} onClick={() => void addLunch()}>
      {add.isPending ? "Dodajanje …" : quantity > 1 ? `Dodaj ${quantity} kosil` : "Dodaj kosilo"}
    </Button>
  </div>;
}