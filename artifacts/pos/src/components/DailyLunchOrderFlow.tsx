import { useEffect, useMemo, useRef, useState } from "react";
import { useQuoteDailyLunch, useListDailyLunchOffers, useAddDailyLunchToOrder, ApiError } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { dailyLunchPrice, requiredDailyLunchRoles, type DailyLunchMode, type DailyLunchRole } from "@/lib/dailyLunchHelpers";

type Props = { narociloId: number; onQuoted?: (quote: unknown) => void; onAdded?: () => void };

/** Quote-first daily lunch selector. The server remains authoritative for price and availability. */
export function DailyLunchOrderFlow({ narociloId, onQuoted, onAdded }: Props) {
  const { data } = useListDailyLunchOffers();
  const quote = useQuoteDailyLunch();
  const add = useAddDailyLunchToOrder();
  const idempotencyKey = useRef(crypto.randomUUID());
  const [mode, setMode] = useState<DailyLunchMode>("three_course");
  const [selected, setSelected] = useState<Partial<Record<DailyLunchRole, number>>>({});
  const offer = data?.offers?.find((row) => row.status === "published");
  const roles = requiredDailyLunchRoles(mode);
  const choices = useMemo(() => offer?.choices ?? [], [offer]);

  useEffect(() => {
    if (!offer || !roles.every((role) => selected[role] != null)) return;
    quote.mutate({ offerId: offer.id, data: { mode, selectedDishes: selected as Record<string, number> } }, {
      onSuccess: (value) => onQuoted?.(value),
    });
  }, [offer?.id, mode, JSON.stringify(selected)]);

  if (!offer) return <p className="text-sm text-muted-foreground">Danes ni objavljene ponudbe kosil.</p>;
  const complete = roles.every((role) => selected[role] != null);
  const addLunch = async () => {
    if (!offer || !complete || !quote.data) return;
    try {
      await add.mutateAsync({
        id: narociloId,
        data: { offerId: offer.id, mode, selectedDishes: selected as Record<string, number>, idempotencyKey: idempotencyKey.current },
      });
      idempotencyKey.current = crypto.randomUUID();
      onAdded?.();
    } catch (error) {
      const message = error instanceof ApiError && error.data && typeof error.data === "object" && "error" in error.data
        ? String(error.data.error) : "Kosila ni bilo mogoče dodati.";
      onQuoted?.({ error: message });
    }
  };
  return <div className="space-y-4">
    <div className="flex gap-2">
      <Button variant={mode === "three_course" ? "default" : "outline"} onClick={() => { setMode("three_course"); setSelected({}); }}>3 hodi</Button>
      <Button variant={mode === "four_course" ? "default" : "outline"} onClick={() => { setMode("four_course"); setSelected({}); }}>4 hodi</Button>
    </div>
    {roles.map((role) => <div key={role}><h3 className="mb-2 font-semibold">{role}</h3><div className="grid gap-2 sm:grid-cols-2">{choices.filter((choice) => choice.role === role).map((choice) => <button key={choice.artikelId} type="button" className={`rounded border p-2 text-left ${selected[role] === choice.artikelId ? "border-primary bg-primary/10" : ""}`} onClick={() => setSelected((current) => ({ ...current, [role]: choice.artikelId }))}>Artikel {choice.artikelId}</button>)}</div></div>)}
    <div className="rounded bg-muted p-3 text-sm">Cena: <strong>{dailyLunchPrice(quote.data?.total)}</strong></div>
    <Button className="w-full" disabled={!complete || !quote.data || quote.isPending || add.isPending} onClick={() => void addLunch()}>
      {add.isPending ? "Dodajanje …" : "Dodaj kosilo"}
    </Button>
  </div>;
}