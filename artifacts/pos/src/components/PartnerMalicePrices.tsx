import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetMalicaBootstrap,
  useListMalicaPartnerGroupPrices,
  useSetMalicaPartnerGroupPrice,
  getListMalicaPartnerGroupPricesQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { DecimalInput } from "@/components/ui/decimal-input";
import { useToast } from "@/hooks/use-toast";
import { formatEur } from "@/lib/formatEur";

const lokalniDatum = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Cene malic 1–4 za poslovnega partnerja. Brez nastavitve velja redna cena iz cenika malic. */
export function PartnerMalicePrices({ partnerId }: { partnerId: string }) {
  const { data: bootstrap } = useGetMalicaBootstrap();
  const { data: partnerPrices } = useListMalicaPartnerGroupPrices(partnerId);
  const setPrice = useSetMalicaPartnerGroupPrice();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [values, setValues] = useState<Record<number, string>>({});

  const danes = lokalniDatum(new Date());
  const groups = [...(bootstrap?.groups ?? [])].filter(g => g.active).sort((a, b) => a.sortOrder - b.sortOrder);
  const regular = (groupId: number) => (bootstrap?.prices ?? []).find(p => p.groupId === groupId && p.status === "active")?.priceCents;
  const current = (groupId: number) => (partnerPrices ?? [])
    .filter(p => p.groupId === groupId && p.active !== false && p.validFrom <= danes && (!p.validTo || p.validTo >= danes))
    .sort((a, b) => b.validFrom.localeCompare(a.validFrom))[0]?.priceCents;

  useEffect(() => { setValues({}); }, [partnerId]);

  const shrani = async (groupId: number) => {
    const raw = values[groupId];
    const euro = parseFloat((raw ?? "").replace(",", "."));
    if (!Number.isFinite(euro) || euro < 0) { toast({ title: "Napaka", description: "Vnesite veljavno ceno.", variant: "destructive" }); return; }
    const jutri = new Date(); jutri.setDate(jutri.getDate() + 1);
    try {
      await setPrice.mutateAsync({ partnerId, data: { groupId, priceCents: Math.round(euro * 100), validFrom: lokalniDatum(jutri) } });
      await queryClient.invalidateQueries({ queryKey: getListMalicaPartnerGroupPricesQueryKey(partnerId) });
      setValues(v => { const { [groupId]: _removed, ...rest } = v; return rest; });
      toast({ title: "Cena shranjena", description: "Velja od naslednjega poslovnega dne." });
    } catch {
      toast({ title: "Napaka", description: "Cene ni bilo mogoče shraniti.", variant: "destructive" });
    }
  };

  if (groups.length === 0) return null;
  return (
    <section className="space-y-2" data-testid="partner-malice-prices">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Cene malic</p>
      <p className="text-[10px] text-muted-foreground leading-snug">
        Brez posebne cene velja redna cena malice. Nova cena velja od naslednjega poslovnega dne.
      </p>
      {groups.map(group => {
        const reg = regular(group.id);
        const cur = current(group.id) ?? reg;
        return (
          <div key={group.id} className="flex items-end gap-2">
            <div className="flex-1 min-w-0">
              <Label className="text-xs">{group.name}</Label>
              <p className="text-[10px] text-muted-foreground">
                Trenutno: {cur != null ? formatEur(cur / 100) : "—"}{current(group.id) == null && reg != null ? " (redna)" : ""}
              </p>
            </div>
            <div className="w-24">
              <DecimalInput
                className="h-8 text-xs"
                placeholder={cur != null ? (cur / 100).toFixed(2).replace(".", ",") : ""}
                value={values[group.id] ?? ""}
                onChange={(e: { target: { value: string } }) => setValues(v => ({ ...v, [group.id]: e.target.value }))}
              />
            </div>
            <Button type="button" size="sm" className="h-8" disabled={!values[group.id] || setPrice.isPending} onClick={() => void shrani(group.id)}>Shrani</Button>
          </div>
        );
      })}
    </section>
  );
}
