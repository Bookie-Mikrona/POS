import { useState, useEffect, useRef } from "react";
import { posFetch } from "@/lib/pos-auth-headers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Loader2, Info, ExternalLink, ShieldAlert, Check } from "lucide-react";
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
  rawConfirmed: boolean;
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
            addedSugar: false,
            rawConfirmed: false
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
    if (!proposal) return;
    
    // Validate that all willCreate items have valid classification
    const classificationsArray = [];
    for (let i = 0; i < proposal.items.length; i++) {
      if (proposal.items[i].willCreate) {
        const cls = classifications[i];
        if (!cls || cls.taxCategory === "" || !cls.rawConfirmed) {
          setError("Prosimo, izpolnite klasifikacijo in potrdite, da je sestavina osnovna surovina za vse nove artikle.");
          return;
        }
        classificationsArray.push({
          index: i,
          taxCategory: cls.taxCategory as TaxCategory,
          addedSugar: cls.addedSugar,
          rawConfirmed: cls.rawConfirmed
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
    return cls && cls.taxCategory !== "" && cls.rawConfirmed;
  }) ?? false;

  const canApply = proposal && confirmed && allClassificationsValid && !applying && !loading;

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
              <div className="space-y-6">
                <div className="p-4 rounded-md bg-blue-50/50 border border-blue-100 flex gap-3 text-sm text-blue-900">
                  <ShieldAlert className="h-5 w-5 shrink-0 text-blue-600 mt-0.5" />
                  <div className="space-y-1">
                    <p className="font-medium text-blue-950 text-base">OPOZORILO: Potreben je strog ročni pregled</p>
                    <p>
                      {proposal.sources.length > 0
                        ? proposal.origin === "catalog_volume"
                          ? "Spletni rezultat potrjuje le naslov in povezavo do izdelka. Odmerek in enota sta razbrana iz naziva artikla, ne iz spletnega recepta."
                          : proposal.origin === "web_estimate"
                            ? "To je približen AI-normativ, ne prepis recepta. Spletni vir potrjuje le naslov in povezavo; predlaganih sestavin in količin ne dokazuje. Količino za veliko ali malo porcijo preverite sami."
                          : "Samo naslovi in povezave virov so preverjeni. Količine, sestavine in pretvorbe receptov so nepotrjeni AI izračuni."
                        : "Predlog nima preverljivega spletnega vira."}
                      Ta predlog <b>ni preverjena računovodska ali davčna informacija</b>.
                    </p>
                    <p>Sestavine, količine in davčno klasifikacijo morate pred uporabo obvezno preveriti in potrditi.</p>
                  </div>
                </div>

                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                {proposal.warnings.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-medium text-sm text-amber-800 flex items-center gap-1.5">
                      <AlertCircle className="h-4 w-4" /> Sistemska opozorila
                    </h4>
                    <ul className="text-sm text-amber-700 bg-amber-50 rounded-md border border-amber-200 p-3 space-y-1 list-disc pl-5">
                      {proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                )}

                <div className="space-y-4">
                  <h4 className="font-semibold">Predlagane sestavine na porcijo</h4>
                  {proposal.items.length === 0 ? (
                    <p className="text-sm text-muted-foreground italic">Ni bilo najdenih sestavin.</p>
                  ) : (
                    <div className="rounded-md border divide-y bg-card">
                      {proposal.items.map((item, i) => {
                        const cls = classifications[i];
                        const isBeverage = cls?.taxCategory === "hot_beverage" || cls?.taxCategory === "cold_beverage" || cls?.taxCategory === "alcoholic";
                        
                        return (
                        <div key={i} className={`p-4 flex flex-col gap-4 ${item.willCreate ? 'bg-emerald-50/10' : ''}`}>
                          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-2">
                            <div>
                              <p className="font-medium">{item.name}</p>
                              <p className="text-sm text-muted-foreground">
                                Količina: <span className="font-semibold text-foreground">{item.quantity} {item.unit}</span>
                              </p>
                            </div>
                            <div className="text-xs">
                              {item.willCreate ? (
                                <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full font-medium border border-emerald-200">
                                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
                                  Ustvarja se kot nov nabavni artikel
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-slate-700 bg-slate-100 px-2 py-1 rounded-full font-medium border border-slate-200">
                                  Povezano z obstoječim artiklom
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {item.willCreate && cls && (
                            <div className="pl-0 sm:pl-4 border-l-2 border-emerald-200 space-y-3 pt-2">
                              <div className="space-y-2">
                                <Label className="text-xs font-semibold text-emerald-900">Klasifikacija nabavnega artikla (Obvezno)</Label>
                                <Select 
                                  value={cls.taxCategory} 
                                  onValueChange={(val) => setClassifications(prev => ({ 
                                    ...prev, 
                                    [i]: { ...prev[i], taxCategory: val as TaxCategory, addedSugar: false }
                                  }))}
                                >
                                  <SelectTrigger className="w-full sm:w-[300px] h-8 text-sm">
                                    <SelectValue placeholder="Izberi davčno klasifikacijo..." />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {(Object.entries(TAX_CATEGORY_LABELS) as [TaxCategory, string][]).map(([val, label]) => (
                                      <SelectItem key={val} value={val}>{label}</SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                              
                              {isBeverage && (
                                <label className="flex items-center gap-2 cursor-pointer text-sm">
                                  <Checkbox 
                                    checked={cls.addedSugar}
                                    onCheckedChange={(c) => setClassifications(prev => ({ 
                                      ...prev, 
                                      [i]: { ...prev[i], addedSugar: !!c } 
                                    }))}
                                  />
                                  <span>Vsebuje dodan sladkor (O-Sladkor)</span>
                                </label>
                              )}

                              <label className="flex items-start gap-2 cursor-pointer text-sm p-2 rounded bg-emerald-50/50 border border-emerald-100 hover:bg-emerald-100/50 transition-colors">
                                <Checkbox 
                                  className="mt-0.5"
                                  checked={cls.rawConfirmed}
                                  onCheckedChange={(c) => setClassifications(prev => ({ 
                                    ...prev, 
                                    [i]: { ...prev[i], rawConfirmed: !!c } 
                                  }))}
                                />
                                <span className="leading-snug">
                                  Potrjujem, da je "{item.name}" <b>SUROVINA / NABAVNI ARTIKEL</b> in ne polizdelek ali drug prodajni artikel. Če predlog uporablja polizdelke, ki bi morali imeti svoj normativ, <b>prekličite postopek</b> in artikel sestavite ročno.
                                </span>
                              </label>
                            </div>
                          )}
                        </div>
                      )})}
                    </div>
                  )}
                </div>

                {proposal.sources.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="font-semibold text-sm">Najdeni spletni viri (vsebina ni preverjena)</h4>
                    <div className="flex flex-col gap-1.5">
                      {proposal.sources.map((src, i) => (
                        <a 
                          key={i} 
                          href={src.url} 
                          target="_blank" 
                          rel="noreferrer noopener"
                          className="text-sm text-primary hover:underline inline-flex items-center gap-1.5 w-fit"
                        >
                          <ExternalLink className="h-3 w-3" />
                          {src.title}
                        </a>
                      ))}
                    </div>
                  </div>
                )}

                <div className="pt-4 border-t space-y-4">
                  <label className="flex items-start gap-3 cursor-pointer p-4 rounded-lg bg-muted/30 border-2 border-transparent hover:border-primary/20 transition-colors">
                    <Checkbox 
                      checked={confirmed} 
                      onCheckedChange={(c) => setConfirmed(!!c)} 
                      className="mt-1"
                    />
                    <div className="space-y-1.5">
                      <p className="text-sm font-medium leading-none">Potrjujem ustvarjanje in dodajanje normativa</p>
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Preveril sem vse predlagane sestavine, njihove količine, davčne stopnje in klasifikacijo. 
                        Prevzemam polno odgovornost za točnost normativa in pravilnost knjigovodskih in davčnih vplivov (vključno z zalogo, davki in DDV izračuni), ki bodo nastali ob prodaji.
                      </p>
                    </div>
                  </label>
                </div>
              </div>
            </ScrollArea>
          ) : null}
        </div>

        <DialogFooter className="mt-4 flex-col sm:flex-row gap-2">
          {!allClassificationsValid && proposal && (
            <div className="flex-1 text-xs text-amber-600 flex items-center gap-1">
              <Info className="h-4 w-4" />
              Izpolnite klasifikacijo in potrdite surovine za vse nove artikle.
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
