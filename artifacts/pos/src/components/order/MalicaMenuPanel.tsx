import { useState } from "react";
import { useGetMalicaBootstrap, useListMalicaDailyOffers, type MalicaDailyMainItem } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { formatEur } from "@/lib/formatEur";

const SIZE_LABELS: Record<string, string> = { mala: "mala", normalna: "normalna", druzinska: "družinska" };

export function MalicaMenuPanel({ businessDate, onPick }: {
  businessDate: string;
  /** Doda malico na naročilo; courseIds so izbrane vključene juhe/sladice. */
  onPick: (item: MalicaDailyMainItem, courseIds: number[]) => void;
}) {
  const { data: offers, isLoading } = useListMalicaDailyOffers({ from: businessDate, to: businessDate });
  const { data: bootstrap } = useGetMalicaBootstrap();
  const [izbrana, setIzbrana] = useState<MalicaDailyMainItem | null>(null);
  const [juhaId, setJuhaId] = useState<number | null>(null);
  const [sladicaId, setSladicaId] = useState<number | null>(null);

  const offer = (offers ?? []).find(o => o.status === "published" && String(o.businessDate).slice(0, 10) === businessDate);
  const groups = [...(bootstrap?.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);
  const juhe = (offer?.includedCourses ?? []).filter(c => c.enabled && c.courseType === "soup");
  const sladice = (offer?.includedCourses ?? []).filter(c => c.enabled && c.courseType === "dessert");

  const izberi = (item: MalicaDailyMainItem) => {
    if (juhe.length === 0 && sladice.length === 0) { onPick(item, []); return; }
    setJuhaId(null);
    setSladicaId(null);
    setIzbrana(item);
  };
  const potrdi = () => {
    if (!izbrana) return;
    onPick(izbrana, [juhaId, sladicaId].filter((id): id is number => id !== null));
    setIzbrana(null);
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!offer) return <p className="py-6 text-sm text-muted-foreground">Za danes ni objavljene ponudbe malic.</p>;

  const izbiraGumbi = (naslov: string, seznam: typeof juhe, vrednost: number | null, nastavi: (id: number | null) => void) => seznam.length === 0 ? null : (
    <div className="space-y-2">
      <h4 className="text-sm font-semibold">{naslov}</h4>
      <div className="grid gap-2 sm:grid-cols-2">
        <Button type="button" variant={vrednost === null ? "default" : "outline"} className="h-auto min-h-[44px] justify-start whitespace-normal text-left" onClick={() => nastavi(null)}>Brez</Button>
        {seznam.map(c => (
          <Button key={c.id} type="button" variant={vrednost === c.id ? "default" : "outline"} className="h-auto min-h-[44px] justify-start whitespace-normal text-left" onClick={() => nastavi(c.id)}>
            {c.articleNameSnapshot}
          </Button>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="malice-panel">
      {groups.map(group => {
        const items = (offer.mainItems ?? []).filter(item => item.enabled && item.groupId === group.id);
        if (items.length === 0) return null;
        return (
          <section key={group.id} className="space-y-2">
            <h3 className="text-sm font-semibold">
              {group.name} <span className="font-normal text-muted-foreground">· {formatEur(items[0]!.priceCentsSnapshot / 100)}</span>
            </h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {items.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => izberi(item)}
                  className="min-h-[56px] rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 text-left text-sm font-medium hover:bg-orange-100"
                >
                  {item.articleNameSnapshot}
                  {item.velikostPice && <span className="ml-1 text-xs text-muted-foreground">({SIZE_LABELS[item.velikostPice]})</span>}
                </button>
              ))}
            </div>
          </section>
        );
      })}

      <Dialog open={izbrana !== null} onOpenChange={(open) => { if (!open) setIzbrana(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{izbrana?.articleNameSnapshot}</DialogTitle>
            <DialogDescription>Juha in sladica sta vključeni v ceno malice.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {izbiraGumbi("Juha", juhe, juhaId, setJuhaId)}
            {izbiraGumbi("Sladica", sladice, sladicaId, setSladicaId)}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIzbrana(null)}>Prekliči</Button>
            <Button onClick={potrdi}>Dodaj na naročilo</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
