import { useState } from "react";
import { useGetMalicaBootstrap, useListMalicaDailyOffers, type MalicaDailyMainItem } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { posFetch } from "@/lib/pos-auth-headers";
import { formatEur } from "@/lib/formatEur";

const SIZE_LABELS: Record<string, string> = { mala: "mala", normalna: "normalna", druzinska: "družinska" };

export function MalicaMenuPanel({ narociloId, businessDate, onAdded }: {
  narociloId: number;
  businessDate: string;
  onAdded: () => void;
}) {
  const { data: offers, isLoading } = useListMalicaDailyOffers({ from: businessDate, to: businessDate });
  const { data: bootstrap } = useGetMalicaBootstrap();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<number | null>(null);

  const offer = (offers ?? []).find(o => o.status === "published" && String(o.businessDate).slice(0, 10) === businessDate);
  const groups = [...(bootstrap?.groups ?? [])].sort((a, b) => a.sortOrder - b.sortOrder);

  const add = async (item: MalicaDailyMainItem) => {
    setBusyId(item.id);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/narocila/${narociloId}/postavke`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artikelId: item.artikelId,
          kolicina: 1,
          maliceMainItemId: item.id,
          ...(item.velikostPice ? { velikostPice: item.velikostPice } : {}),
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : "Malice ni bilo mogoče dodati.";
        throw new Error(message);
      }
      onAdded();
    } catch (error) {
      toast({ title: "Napaka", description: error instanceof Error ? error.message : "Malice ni bilo mogoče dodati.", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!offer) return <p className="py-6 text-sm text-muted-foreground">Za danes ni objavljene ponudbe malic.</p>;

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
                  disabled={busyId !== null}
                  onClick={() => void add(item)}
                  className="min-h-[56px] rounded-lg border-2 border-orange-300 bg-orange-50 px-3 py-2 text-left text-sm font-medium hover:bg-orange-100 disabled:opacity-60"
                >
                  {item.articleNameSnapshot}
                  {item.velikostPice && <span className="ml-1 text-xs text-muted-foreground">({SIZE_LABELS[item.velikostPice]})</span>}
                </button>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
