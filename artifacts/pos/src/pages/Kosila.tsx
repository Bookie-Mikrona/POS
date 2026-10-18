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
import { useAuth } from "@/contexts/AuthContext";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { formatEur } from "@/lib/formatEur";
import {
  canvasToPdfBlob, canvasToPngBlob, downloadBlob, formatLunchDate, lunchMenuText, renderLunchMenuCanvas,
  type LunchDay, type LunchMenuData,
} from "@/lib/dailyLunchExport";
import { ChevronLeft, ChevronRight, Copy, FileText, Image as ImageIcon, Mail, Search } from "lucide-react";

const roles = ["starter", "soup", "main", "dessert"] as const;
const labels = { starter: "Predjed", soup: "Juha", main: "Glavna jed", dessert: "Sladica" };
const LUNCH_CATEGORIES = ["Glavne jedi", "Juhe", "Otroški meni", "Sezonske jedi", "Zajtrki", "Sladice", "Solate", "Pice"];
const today = () => poslovniDatumZaCas();
const collator = new Intl.Collator("sl");
const STATUS_LABELS: Record<string, string> = { draft: "Osnutek", published: "Objavljeno", closed: "Zaključeno" };
const shiftDate = (iso: string, days: number) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
};

export default function KosilaPage() {
  const [businessDate, setBusinessDate] = useState(today());
  const [base, setBase] = useState("8");
  const [starter, setStarter] = useState("10");
  const [choices, setChoices] = useState<Record<string, number[]>>({});
  const [activeRole, setActiveRole] = useState<(typeof roles)[number]>("main");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const { nastavitve } = useNastavitve();
  const { user } = useAuth();
  const unitName = (user?.enote ?? []).find((e) => e.id === user?.enotaId)?.ime ?? (user?.enote ?? [])[0]?.ime;
  const [rangeFrom, setRangeFrom] = useState("");
  const [rangeTo, setRangeTo] = useState("");
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
    article.taxCategory === "food" &&
    LUNCH_CATEGORIES.includes(article.kategorijaIme ?? "")), [articles]);

  useEffect(() => {
    if (!offer) { setBase("8"); setStarter("10"); setChoices({}); return; }
    setBase(offer.baseFlatAmount); setStarter(offer.starterFlatAmount);
    const next: Record<string, number[]> = {};
    for (const choice of offer.choices) (next[choice.role] ??= []).push(choice.artikelId);
    setChoices(next);
  }, [offer?.id, businessDate]);

  useEffect(() => { setRangeFrom(""); setRangeTo(""); }, [businessDate]);
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
  const locked = !!offer && offer.status !== "draft";
  const byId = useMemo(() => new Map((articles ?? []).map((article) => [article.id, article])), [articles]);
  const categories = useMemo(() => [...new Set(available.map((article) => article.kategorijaIme ?? ""))].filter(Boolean).sort(collator.compare), [available]);
  const visible = useMemo(() => available
    .filter((article) => (!category || article.kategorijaIme === category) && article.ime.toLowerCase().includes(search.trim().toLowerCase()))
    .sort((a, b) => collator.compare(a.ime, b.ime)), [available, category, search]);
  const baseNum = Number(base.replace(",", ".")) || 0;
  const starterNum = Number(starter.replace(",", ".")) || 0;

  const buildSections = (selection: Record<string, number[]>, baseValue: number, starterValue: number) => roles.map((role) => ({
    title: role === "main" ? "Glavne jedi" : role === "soup" ? "Juhe" : role === "dessert" ? "Sladice" : "Predjedi",
    note: role === "main" ? "cena kosila s juho in sladico" : role === "starter" ? `4 hodi: doplačilo ${formatEur(starterValue)}` : undefined,
    items: (selection[role] ?? []).map((id) => byId.get(id)).filter((a): a is NonNullable<typeof a> => !!a)
      .sort((a, b) => collator.compare(a.ime, b.ime))
      .map((article) => ({ name: article.ime, price: role === "main" ? Number(article.cena) + baseValue : undefined })),
  })).filter((section) => section.items.length > 0);
  const restaurant = nastavitve?.nazivRestavracije || "Dnevna ponudba";
  const intro = "3 hodi: juha, glavna jed, sladica · 4 hodi: z predjedjo";
  const previewSections = useMemo(() => buildSections(choices, baseNum, starterNum), [choices, byId, baseNum, starterNum]); // eslint-disable-line react-hooks/exhaustive-deps

  const from = rangeFrom || businessDate;
  const to = rangeTo || businessDate;
  const rangeInvalid = to < from || shiftDate(from, 14) < to;
  /** Ponudbe za izbrano obdobje; za trenutno urejani dan se upošteva še neshranjeno stanje. */
  const buildMenu = (): LunchMenuData => {
    const days: LunchDay[] = [];
    for (let date = from; date <= to; date = shiftDate(date, 1)) {
      let sections;
      if (date === businessDate) sections = previewSections;
      else {
        const row = data?.offers?.find((o) => o.businessDate === date);
        if (!row) continue;
        const selection: Record<string, number[]> = {};
        for (const choice of row.choices) (selection[choice.role] ??= []).push(choice.artikelId);
        sections = buildSections(selection, Number(row.baseFlatAmount), Number(row.starterFlatAmount));
      }
      if (sections.length > 0) days.push({ dateLabel: formatLunchDate(date), sections });
    }
    return {
      restaurant, unit: unitName, address: nastavitve?.naslovRestavracije || undefined, intro, days,
      periodLabel: from === to ? formatLunchDate(from) : `${formatLunchDate(from)} – ${formatLunchDate(to)}`,
    };
  };
  const menu = useMemo<LunchMenuData>(() => ({
    restaurant, unit: unitName, intro, periodLabel: formatLunchDate(businessDate),
    days: [{ dateLabel: formatLunchDate(businessDate), sections: previewSections }],
  }), [restaurant, unitName, businessDate, previewSections]);
  const weekStart = shiftDate(businessDate, -((new Date(`${businessDate}T00:00:00Z`).getUTCDay() + 6) % 7));
  const setRange = (a: string, b: string) => { setRangeFrom(a); setRangeTo(b); };
  const exportWith = async (kind: "png" | "pdf") => {
    if (rangeInvalid) { toast({ title: "Neveljavno obdobje", description: "Obdobje je lahko dolgo največ 15 dni.", variant: "destructive" }); return; }
    const periodMenu = buildMenu();
    if (periodMenu.days.length === 0) { toast({ title: "V izbranem obdobju ni ponudbe", variant: "destructive" }); return; }
    try {
      const canvas = renderLunchMenuCanvas(periodMenu);
      const name = `kosila-${from}${from === to ? "" : `_${to}`}`;
      if (kind === "png") downloadBlob(await canvasToPngBlob(canvas), `${name}.png`);
      else downloadBlob(await canvasToPdfBlob(canvas), `${name}.pdf`);
    } catch (error) { toast({ title: "Izvoz ni uspel", description: String(error), variant: "destructive" }); }
  };
  const copyText = async () => {
    try { await navigator.clipboard.writeText(lunchMenuText(buildMenu())); toast({ title: "Besedilo kopirano" }); }
    catch { toast({ title: "Kopiranje ni uspelo", variant: "destructive" }); }
  };
  const emailIt = () => {
    const periodMenu = buildMenu();
    const subject = encodeURIComponent(`Dnevna kosila – ${periodMenu.periodLabel}`);
    window.location.href = `mailto:?subject=${subject}&body=${encodeURIComponent(lunchMenuText(periodMenu))}`;
  };

  return <div className="space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="text-3xl font-bold">Kosila</h1><p className="text-muted-foreground">Dnevna ponudba kosil po poslovnem datumu.</p></div>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" aria-label="Prejšnji dan" onClick={() => setBusinessDate(shiftDate(businessDate, -1))}><ChevronLeft className="h-4 w-4" /></Button>
        <Input type="date" value={businessDate} onChange={(event) => event.target.value && setBusinessDate(event.target.value)} className="w-auto" />
        <Button variant="outline" size="icon" aria-label="Naslednji dan" onClick={() => setBusinessDate(shiftDate(businessDate, 1))}><ChevronRight className="h-4 w-4" /></Button>
        <Button variant="ghost" onClick={() => setBusinessDate(today())}>Danes</Button>
      </div>
    </div>

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <Card className="order-2 lg:order-1">
        <CardHeader><CardTitle className="flex flex-wrap items-center gap-3 text-lg">Izbira jedi
          <span className="rounded-full bg-muted px-3 py-0.5 text-xs font-medium">{STATUS_LABELS[offer?.status ?? ""] ?? "Ni ponudbe"}</span></CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <label className="text-sm">Osnovni pribitek (€)<Input value={base} disabled={locked} onChange={(event) => setBase(event.target.value)} className="mt-1 w-28" /></label>
            <label className="text-sm">Pribitek predjedi (€)<Input value={starter} disabled={locked} onChange={(event) => setStarter(event.target.value)} className="mt-1 w-28" /></label>
          </div>
          <div className="flex flex-wrap gap-2">
            {roles.map((role) => <button key={role} type="button" onClick={() => setActiveRole(role)}
              className={`rounded-full border px-4 py-1.5 text-sm font-medium ${activeRole === role ? "border-orange-600 bg-orange-600 text-white" : "bg-background hover:bg-muted"}`}>
              {labels[role]}{role !== "starter" && "*"} <span className="ml-1 opacity-80">({choices[role]?.length ?? 0})</span></button>)}
          </div>
          <div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Išči jed …" className="pl-9" /></div>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={() => setCategory("")} className={`rounded-full border px-3 py-1 text-xs ${!category ? "bg-foreground text-background" : "hover:bg-muted"}`}>Vse</button>
            {categories.map((name) => <button key={name} type="button" onClick={() => setCategory(name)} className={`rounded-full border px-3 py-1 text-xs ${category === name ? "bg-foreground text-background" : "hover:bg-muted"}`}>{name}</button>)}
          </div>
          <div className="grid max-h-[460px] gap-1.5 overflow-y-auto sm:grid-cols-2">
            {visible.map((article) => {
              const on = (choices[activeRole] ?? []).includes(article.id);
              return <label key={article.id} className={`flex cursor-pointer items-center gap-2 rounded border p-2 text-sm ${on ? "border-orange-500 bg-orange-50" : "hover:bg-muted/50"} ${locked ? "opacity-60" : ""}`}>
                <input type="checkbox" disabled={locked} checked={on} onChange={() => toggle(activeRole, article.id)} />
                <span className="flex-1">{article.ime}</span><span className="text-xs text-muted-foreground">{formatEur(Number(article.cena))}</span></label>;
            })}
            {visible.length === 0 && <p className="text-sm text-muted-foreground">Ni zadetkov.</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 border-t pt-4">
            <Button disabled={locked} onClick={() => void save()}>Shrani osnutek</Button>
            {offer?.status === "draft" && <Button variant="secondary" onClick={() => void transition("publish")}>Objavi</Button>}
            {offer?.status === "published" && <Button variant="outline" onClick={() => void transition("close")}>Zaključi</Button>}
          </div>
        </CardContent>
      </Card>

      <Card className="order-1 h-fit lg:order-2 lg:sticky lg:top-4">
        <CardHeader className="rounded-t-lg bg-gradient-to-br from-orange-700 to-orange-500 text-white">
          <p className="text-xs uppercase tracking-wide opacity-80">{[menu.restaurant, menu.unit].filter(Boolean).join(" · ")}</p>
          <CardTitle className="text-2xl">Dnevna kosila</CardTitle>
          <p className="text-sm opacity-90">{menu.periodLabel}</p>
        </CardHeader>
        <CardContent className="space-y-4 pt-4">
          {previewSections.length === 0 && <p className="text-sm text-muted-foreground">Za ta dan še ni izbranih jedi.</p>}
          {previewSections.map((section) => <section key={section.title}>
            <h3 className="text-sm font-bold uppercase tracking-wide text-orange-700">{section.title}</h3>
            {section.note && <p className="text-xs text-muted-foreground">{section.note}</p>}
            <ul className="mt-1 space-y-0.5 text-sm">{section.items.map((item) => <li key={item.name} className="flex justify-between gap-3">
              <span>{item.name}</span>{item.price != null && <span className="font-semibold text-orange-700">{formatEur(item.price)}</span>}</li>)}</ul>
          </section>)}
          <div className="space-y-2 border-t pt-4">
            <p className="text-sm font-medium">Izvoz za obdobje</p>
            <div className="flex items-center gap-2">
              <Input type="date" value={from} onChange={(event) => setRange(event.target.value, to < event.target.value ? event.target.value : to)} />
              <span className="text-sm text-muted-foreground">do</span>
              <Input type="date" value={to} onChange={(event) => setRangeTo(event.target.value)} />
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button size="sm" variant="ghost" onClick={() => setRange(businessDate, businessDate)}>En dan</Button>
              <Button size="sm" variant="ghost" onClick={() => setRange(weekStart, shiftDate(weekStart, 6))}>Ta teden</Button>
              <Button size="sm" variant="ghost" onClick={() => setRange(shiftDate(weekStart, 7), shiftDate(weekStart, 13))}>Naslednji teden</Button>
              <Button size="sm" variant="ghost" onClick={() => setRange(shiftDate(weekStart, 5), shiftDate(weekStart, 6))}>Vikend</Button>
            </div>
            {rangeInvalid && <p className="text-xs text-destructive">Obdobje mora biti urejeno in dolgo največ 15 dni.</p>}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="outline" onClick={() => void exportWith("png")}><ImageIcon className="mr-2 h-4 w-4" />Slika (PNG)</Button>
            <Button variant="outline" onClick={() => void exportWith("pdf")}><FileText className="mr-2 h-4 w-4" />PDF</Button>
            <Button variant="outline" onClick={() => void copyText()}><Copy className="mr-2 h-4 w-4" />Kopiraj besedilo</Button>
            <Button variant="outline" onClick={emailIt}><Mail className="mr-2 h-4 w-4" />E-pošta</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  </div>;
}
