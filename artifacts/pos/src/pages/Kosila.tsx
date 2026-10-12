import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getListDailyLunchOffersQueryKey, useCreateDailyLunchOffer, useListDailyLunchOffers,
  useListArtikli, useUpdateDailyLunchOffer, usePublishDailyLunchOffer, useCloseDailyLunchOffer,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { poslovniDatumZaCas } from "@/lib/posCas";

const roles = ["starter", "soup", "main", "dessert"] as const;
const labels = { starter: "Predjed", soup: "Juha", main: "Glavna jed", dessert: "Sladica" };
const today = () => poslovniDatumZaCas();

export default function KosilaPage() {
  const [businessDate, setBusinessDate] = useState(today());
  const [base, setBase] = useState("8");
  const [starter, setStarter] = useState("10");
  const [choices, setChoices] = useState<Record<string, number[]>>({});
  const { data } = useListDailyLunchOffers();
  const { data: articles } = useListArtikli();
  const client = useQueryClient();
  const { toast } = useToast();
  const create = useCreateDailyLunchOffer();
  const update = useUpdateDailyLunchOffer();
  const publish = usePublishDailyLunchOffer();
  const close = useCloseDailyLunchOffer();
  const offer = data?.offers?.find((row) => row.businessDate === businessDate);
  const available = useMemo(() => (articles ?? []).filter((article) =>
    article.aktiven && article.prodajniArtikel && !article.nabavniArtikel &&
    (article.mealType === "prepared" || article.mealType === "composite") &&
    article.taxCategory === "food"), [articles]);

  useEffect(() => {
    if (!offer) { setBase("8"); setStarter("10"); setChoices({}); return; }
    setBase(offer.baseFlatAmount); setStarter(offer.starterFlatAmount);
    const next: Record<string, number[]> = {};
    for (const choice of offer.choices) (next[choice.role] ??= []).push(choice.artikelId);
    setChoices(next);
  }, [offer?.id, businessDate]);

  const toggle = (role: string, artikelId: number) => setChoices((current) => ({
    ...current, [role]: (current[role] ?? []).includes(artikelId)
      ? (current[role] ?? []).filter((id) => id !== artikelId)
      : [...(current[role] ?? []), artikelId],
  }));
  const save = async () => {
    const selected = roles.flatMap((role) => (choices[role] ?? []).map((artikelId) => ({ role, artikelId })));
    if (!(choices.soup?.length && choices.main?.length && choices.dessert?.length)) {
      toast({ title: "Ponudba ni popolna", description: "Juha, glavna jed in sladica so obvezne.", variant: "destructive" }); return;
    }
    try {
      if (offer) await update.mutateAsync({ offerId: offer.id, data: { businessDate, baseFlatAmount: base, starterFlatAmount: starter, choices: selected } });
      else await create.mutateAsync({ data: { businessDate, baseFlatAmount: base, starterFlatAmount: starter, choices: selected } });
      await client.invalidateQueries({ queryKey: getListDailyLunchOffersQueryKey() });
      toast({ title: "Osnutek kosila shranjen" });
    } catch (error) { toast({ title: "Napaka pri shranjevanju", description: String(error), variant: "destructive" }); }
  };
  const transition = async (kind: "publish" | "close") => {
    if (!offer) return;
    try {
      if (kind === "publish") await publish.mutateAsync({ offerId: offer.id });
      else await close.mutateAsync({ offerId: offer.id });
      await client.invalidateQueries({ queryKey: getListDailyLunchOffersQueryKey() });
    } catch (error) { toast({ title: "Napaka", description: String(error), variant: "destructive" }); }
  };
  return <div className="space-y-6">
    <div><h1 className="text-3xl font-bold">Kosila</h1><p className="text-muted-foreground">Dnevna ponudba kosil po poslovnem datumu.</p></div>
    <Card><CardHeader><CardTitle className="flex items-center gap-3">Poslovni datum <Input type="date" value={businessDate} onChange={(event) => setBusinessDate(event.target.value)} className="w-auto" /></CardTitle></CardHeader>
      <CardContent className="space-y-6">
        <div className="flex gap-4"><label>Osnovni pribitek <Input value={base} onChange={(event) => setBase(event.target.value)} className="w-24" /></label><label>Pribitek predjedi <Input value={starter} onChange={(event) => setStarter(event.target.value)} className="w-24" /></label></div>
        {roles.map((role) => <section key={role}><h2 className="mb-2 font-semibold">{labels[role]} {role !== "starter" && <span className="text-xs text-destructive">(obvezno)</span>}</h2><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{available.map((article) => <label key={article.id} className="flex gap-2 rounded border p-2"><input type="checkbox" disabled={offer?.status !== "draft" && !!offer} checked={(choices[role] ?? []).includes(article.id)} onChange={() => toggle(role, article.id)} />{article.ime}</label>)}</div></section>)}
        <div className="flex flex-wrap gap-2"><Button disabled={!!offer && offer.status !== "draft"} onClick={() => void save()}>Shrani osnutek</Button>{offer?.status === "draft" && <Button onClick={() => void transition("publish")}>Objavi</Button>}{offer?.status === "published" && <Button variant="outline" onClick={() => void transition("close")}>Zaključi</Button>}<span className="self-center text-sm text-muted-foreground">{offer?.status ?? "Ni ponudbe"}</span></div>
      </CardContent>
    </Card>
  </div>;
}