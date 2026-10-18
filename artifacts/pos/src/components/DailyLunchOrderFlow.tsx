import { useEffect, useMemo, useRef, useState } from "react";
import { useQuoteDailyLunch, useListDailyLunchOffers, useAddDailyLunchToOrder, useListArtikli, useGetPreparedFoodAvailability, getGetPreparedFoodAvailabilityQueryKey, ApiError, type ModSkupinaFull } from "@workspace/api-client-react";
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
  const soldOut = (modId: number) => { const q = modifierStock.get(modId); return q != null && q <= 0; };
  const quote = useQuoteDailyLunch();
  const add = useAddDailyLunchToOrder();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [mode, setMode] = useState<DailyLunchMode>("three_course");
  const [selected, setSelected] = useState<Partial<Record<DailyLunchRole, number>>>({});
  const [modifiers, setModifiers] = useState<Partial<Record<DailyLunchRole, number[]>>>({});
  const [addError, setAddError] = useState<string | null>(null);
  const offer = data?.offers?.find((row) => row.status === "published");
  const roles = requiredDailyLunchRoles(mode);
  const choices = useMemo(() => offer?.choices ?? [], [offer]);

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

  useEffect(() => { setAddError(null); }, [mode, JSON.stringify(selected), JSON.stringify(modifiers)]);
  useEffect(() => {
    if (!offer || !roles.every((role) => selected[role] != null) || !modifiersComplete) return;
    quote.mutate({ offerId: offer.id, data: { mode, selectedDishes: selected as Record<string, number>, modifiers: modifiers as Record<string, number[]> } }, {
      onSuccess: (value) => onQuoted?.(value),
    });
  }, [offer?.id, mode, JSON.stringify(selected), JSON.stringify(modifiers)]);

  if (!offer) return <p className="text-sm text-muted-foreground">Danes ni objavljene ponudbe kosil.</p>;
  const complete = roles.every((role) => selected[role] != null) && modifiersComplete;
  const addLunch = async () => {
    if (!offer || !complete || !quote.data) return;
    setAddError(null);
    try {
      await add.mutateAsync({
        id: narociloId,
        data: { offerId: offer.id, mode, selectedDishes: selected as Record<string, number>, modifiers: modifiers as Record<string, number[]>, idempotencyKey: idempotencyKey.current },
      });
      idempotencyKey.current = crypto.randomUUID();
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
      <Button variant={mode === "three_course" ? "default" : "outline"} onClick={() => { setMode("three_course"); setSelected({}); setModifiers({}); }}>3 hodi</Button>
      <Button variant={mode === "four_course" ? "default" : "outline"} onClick={() => { setMode("four_course"); setSelected({}); setModifiers({}); }}>4 hodi</Button>
    </div>
    {roles.map((role) => <div key={role}><h3 className="mb-2 font-semibold">{ROLE_LABELS[role] ?? role}</h3><div className="grid gap-2 sm:grid-cols-2">{choices.filter((choice) => choice.role === role).map((choice) => <button key={choice.artikelId} type="button" className={`rounded border p-2 text-left ${selected[role] === choice.artikelId ? "border-primary bg-primary/10" : ""}`} onClick={() => selectDish(role, choice.artikelId)}>{articleNames.get(choice.artikelId) ?? `Artikel ${choice.artikelId}`}</button>)}</div>
      {activeGroups(articlesById.get(selected[role] ?? -1)).map((group) => <div key={group.id} className="mt-2 rounded border bg-muted/30 p-2">
        <div className="mb-1 text-sm font-medium">{group.ime}{minRequired(group) > 0 && <span className="ml-1 text-xs text-destructive">(obvezno)</span>}</div>
        <div className="flex flex-wrap gap-2">{group.modifikatorji.map((mod) => {
          const on = (modifiers[role] ?? []).includes(mod.id);
          return <button key={mod.id} type="button" aria-pressed={on} disabled={soldOut(mod.id)} className={`rounded border px-2 py-1 text-sm disabled:cursor-not-allowed disabled:opacity-50 ${on ? "border-primary bg-primary/10" : ""}`} onClick={() => toggleModifier(role, group, mod.id)}>
            {mod.ime}{soldOut(mod.id) ? " (razprodano)" : ""}{Number(mod.cenaDodatek) > 0 ? ` +${Number(mod.cenaDodatek).toFixed(2).replace(".", ",")} €` : ""}
          </button>;
        })}</div>
      </div>)}
    </div>)}
    <div className="rounded bg-muted p-3 text-sm">Cena: <strong>{dailyLunchPrice(quote.data?.total)}</strong></div>
    {(addError || quote.error) && <p role="alert" className="rounded border border-destructive bg-destructive/10 p-2 text-sm text-destructive">
      {addError ?? (quote.error instanceof ApiError && quote.error.data && typeof quote.error.data === "object" && "error" in quote.error.data ? String(quote.error.data.error) : "Cene kosila ni bilo mogoče izračunati.")}
    </p>}
    <Button className="w-full" disabled={!complete || !quote.data || quote.isPending || add.isPending} onClick={() => void addLunch()}>
      {add.isPending ? "Dodajanje …" : "Dodaj kosilo"}
    </Button>
  </div>;
}