import { useState, useEffect, useRef } from "react";
import { posFetch } from "@/lib/pos-auth-headers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Loader2, Info, ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";

type ProposalItem = {
  name: string;
  quantity: number;
  unit: "KGM" | "LTR" | "KOM";
  existingArticleId: number | null;
  willCreate: boolean;
  sourceUrls: string[];
};

type ProposalSource = {
  url: string;
  title: string;
};

type ProposalResponse = {
  token: string;
  origin: "catalog_volume" | "web_recipe" | "web_estimate";
  articleId: number;
  revision: number;
  items: ProposalItem[];
  sources: ProposalSource[];
  warnings: string[];
};

type TaxCategory = "food" | "hot_beverage" | "cold_beverage" | "alcoholic" | "other" | "vat_super_reduced_5";

type ItemClassification = {
  taxCategory: TaxCategory | "";
  addedSugar: boolean;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: number;
  articleName: string;
  onApplySuccess: () => void;
};

const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  food: "Hrana (material za jedi)",
  hot_beverage: "Topli napitek (sestavina)",
  cold_beverage: "Hladni napitek (sestavina)",
  alcoholic: "Alkoholna pijača (sestavina)",
  other: "Drugo",
  vat_super_reduced_5: "Posebna znižana stopnja (5%)",
};

function displayQuantity(item: ProposalItem): string {
  const unit = { KGM: "kg", LTR: "l", KOM: "kos" }[item.unit];
  return `${item.quantity.toLocaleString("sl-SI", {
    minimumFractionDigits: item.unit === "KOM" ? 0 : 3,
    maximumFractionDigits: 4,
  })} ${unit}`;
}

export function SmartNormativeProposalDialog({ open, onOpenChange, articleId, articleName, onApplySuccess }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [classifications, setClassifications] = useState<Record<number, ItemClassification>>({});
  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setProposal(null);
    setError(null);
    setConfirmed(false);
    setClassifications({});
    setLoading(false);
    if (open && articleId > 0) void loadProposal(requestId);
    return () => { requestIdRef.current += 1; };
  }, [open, articleId]);

  const loadProposal = async (requestId = ++requestIdRef.current) => {
    setLoading(true);
    setError(null);
    try {
      const res = await posFetch(`/api/artikli/${articleId}/normativi/pametni-predlog`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null) as { error?: string } | null;
        if (res.status === 409) {
          throw new Error(detail?.error ?? "Stanje artikla je zastarelo. Osvežite podatke in poskusite znova.");
        }
        throw new Error(detail?.error ?? "Napaka pri pridobivanju predloga normativa.");
      }
      const data: ProposalResponse = await res.json();
      if (requestId !== requestIdRef.current) return;
      setProposal(data);
      
      // Initialize classifications for willCreate items
      const initialClassifications: Record<number, ItemClassification> = {};
      data.items.forEach((item, index) => {
        if (item.willCreate) {
          initialClassifications[index] = {
            taxCategory: "", // No hidden default
            addedSugar: false
          };
        }
      });
      setClassifications(initialClassifications);
      
    } catch (err: any) {
      if (requestId === requestIdRef.current) setError(err.message || "Prišlo je do napake.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  };

  const handleApply = async () => {
    if (!proposal || !confirmed) return;
    
    // Validate that all willCreate items have valid classification
    const classificationsArray = [];
    for (let i = 0; i < proposal.items.length; i++) {
      if (proposal.items[i].willCreate) {
        const cls = classifications[i];
        if (!cls || cls.taxCategory === "") {
          setError("Izberite davčno klasifikacijo za vse nove nabavne artikle.");
          return;
        }
        classificationsArray.push({
          index: i,
          taxCategory: cls.taxCategory as TaxCategory,
          addedSugar: cls.addedSugar,
          rawConfirmed: confirmed
        });
      }
    }

    setApplying(true);
    setError(null);
    try {
      const res = await posFetch(`/api/artikli/${articleId}/normativi/pametni-predlog/uporabi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          token: proposal.token, 
          confirmed: true,
          classifications: classificationsArray
        }),
      });
      if (!res.ok) {
        const detail = await res.json().catch(() => null) as { error?: string } | null;
        if (res.status === 409) {
          throw new Error(detail?.error ?? "Predlog je zastarel. Osvežite podatke in poskusite znova.");
        }
        throw new Error(detail?.error ?? "Napaka pri uporabi predloga.");
      }
      onApplySuccess();
      onOpenChange(false);
    } catch (err: any) {
      setError(err.message || "Prišlo je do napake.");
    } finally {
      setApplying(false);
    }
  };

  const allClassificationsValid = proposal?.items.every((item, i) => {
    if (!item.willCreate) return true;
    const cls = classifications[i];
    return cls && cls.taxCategory !== "";
  }) ?? false;

  const canApply = proposal && confirmed && allClassificationsValid && !applying && !loading;
  const newItems = proposal?.items.map((item, index) => ({ item, index })).filter(({ item }) => item.willCreate) ?? [];
  const firstCategory = newItems.length ? classifications[newItems[0]!.index]?.taxCategory : "";
  const commonCategory = firstCategory && newItems.every(({ index }) => classifications[index]?.taxCategory === firstCategory)
    ? firstCategory : "";

  return (
    <Dialog open={open} onOpenChange={value => { if (!applying) onOpenChange(value); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>Pametni predlog normativa: {articleName}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-hidden min-h-0">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
              <Loader2 className="h-8 w-8 animate-spin mb-4" />
              <p>Pripravljam pametni predlog...</p>
            </div>
          ) : error && !proposal ? (
            <div className="p-4 rounded-md bg-destructive/10 text-destructive flex items-start gap-3">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="space-y-3 w-full">
                <div>
                  <p className="font-semibold">Napaka</p>
                  <p className="text-sm">{error}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void loadProposal()} className="bg-background">Poskusi znova</Button>
              </div>
            </div>
          ) : proposal ? (
            <ScrollArea className="h-full pr-4 pb-4">
              <div className="space-y-5">
                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <section aria-label="Predlagani normativ" className="space-y-2">
                  <div>
                    <h3 className="text-lg font-semibold">Normativ za 1 porcijo</h3>
                    <p className="text-xs text-muted-foreground">Predlog še ni shranjen. Količine preverite pred uporabo.</p>
                  </div>
                  {proposal.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Ni bilo najdenih sestavin.</p>
                  ) : (
                    <div className="overflow-hidden rounded-md border bg-card">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50 text-muted-foreground">
                          <tr><th scope="col" className="px-3 py-2 text-left font-medium">Sestavina</th><th scope="col" className="px-3 py-2 text-right font-medium">Količina na porcijo</th></tr>
                        </thead>
                        <tbody className="divide-y">
                          {proposal.items.map((item, i) => (
                            <tr key={i}>
                              <td className="px-3 py-2 font-medium">{item.name}</td>
                              <td className="px-3 py-2 text-right font-semibold whitespace-nowrap tabular-nums">{displayQuantity(item)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {newItems.length > 0 && (
                  <section className="space-y-3 rounded-md border p-3">
                    <div>
                      <h4 className="font-semibold text-sm">Novi nabavni artikli ({newItems.length})</h4>
                      <p className="text-xs text-muted-foreground">Pred shranjevanjem določite davčno klasifikacijo. Ni nastavljena samodejno.</p>
                    </div>
                    {newItems.length > 1 && (
                      <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:gap-3 border-b pb-3">
                        <Label htmlFor="smart-normative-bulk-tax" className="text-sm shrink-0">Enaka klasifikacija za vse</Label>
                        <Select value={commonCategory} onValueChange={value => setClassifications(previous => {
                          const next = { ...previous };
                          for (const { index } of newItems) next[index] = { taxCategory: value as TaxCategory, addedSugar: false };
                          return next;
                        })}>
                          <SelectTrigger id="smart-normative-bulk-tax" className="w-full sm:w-[300px] h-9">
                            <SelectValue placeholder="Izberite, če velja za vse" />
                          </SelectTrigger>
                          <SelectContent>
                            {(Object.entries(TAX_CATEGORY_LABELS) as [TaxCategory, string][]).map(([value, label]) => (
                              <SelectItem key={value} value={value}>{label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                    <div className="space-y-2">
                      {newItems.map(({ item, index }) => {
                        const cls = classifications[index];
                        const isBeverage = cls?.taxCategory === "hot_beverage" || cls?.taxCategory === "cold_beverage" || cls?.taxCategory === "alcoholic";
                        return (
                          <div key={index} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <Label htmlFor={`smart-normative-tax-${index}`} className="text-sm sm:flex-1">{item.name}</Label>
                            <div className="space-y-1.5 sm:w-[300px]">
                              <Select value={cls?.taxCategory ?? ""} onValueChange={value => setClassifications(previous => ({
                                ...previous, [index]: { taxCategory: value as TaxCategory, addedSugar: false },
                              }))}>
                                <SelectTrigger id={`smart-normative-tax-${index}`} className="w-full h-9">
                                  <SelectValue placeholder="Izberite klasifikacijo" />
                                </SelectTrigger>
                                <SelectContent>
                                  {(Object.entries(TAX_CATEGORY_LABELS) as [TaxCategory, string][]).map(([value, label]) => (
                                    <SelectItem key={value} value={value}>{label}</SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                              {isBeverage && (
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                  <Checkbox checked={cls.addedSugar} onCheckedChange={checked => setClassifications(previous => ({
                                    ...previous, [index]: { ...previous[index]!, addedSugar: !!checked },
                                  }))} />
                                  Vsebuje dodan sladkor
                                </label>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                )}

                {proposal.warnings.length > 0 && (
                  <div className="flex items-start gap-2 text-xs text-muted-foreground">
                    <Info className="h-4 w-4 shrink-0" />
                    <p>{proposal.warnings.join(" ")}</p>
                  </div>
                )}

                {proposal.sources.length > 0 && (
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">Spletni vir (vsebina ni preverjena):</span>
                    {proposal.sources.map((source, index) => (
                      <a key={index} href={source.url} target="_blank" rel="noreferrer noopener"
                        className="text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />{source.title}
                      </a>
                    ))}
                  </div>
                )}

                <label className="flex items-start gap-2 cursor-pointer border-t pt-4 text-sm">
                  <Checkbox checked={confirmed} onCheckedChange={checked => setConfirmed(!!checked)} className="mt-0.5" />
                  <span>
                    Pregledal sem sestavine in količine.
                    {newItems.length > 0 && " Potrjujem, da so vsi novi artikli nabavne surovine, ne polizdelki."}
                    {" "}Želim shraniti normativ.
                  </span>
                </label>
              </div>
            </ScrollArea>
          ) : null}
        </div>

        <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
          {!allClassificationsValid && proposal && (
            <div className="flex-1 text-xs text-amber-600 flex items-center gap-1">
              <Info className="h-4 w-4" />
              Izberite davčno klasifikacijo za nove artikle.
            </div>
          )}
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={applying || (loading && !proposal)}>
            Prekliči
          </Button>
          <Button onClick={handleApply} disabled={!canApply}>
            {applying ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uporabljam...
              </>
            ) : (
              "Ustvari in uporabi normativ"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
