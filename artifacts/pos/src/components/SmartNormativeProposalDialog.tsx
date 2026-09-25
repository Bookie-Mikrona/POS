import { useState, useEffect, useRef } from "react";
import { posFetch } from "@/lib/pos-auth-headers";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { AlertCircle, Loader2, Info, ExternalLink } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";

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
  availableIngredients: Array<{ id: number; ime: string; imeZaNabavo?: string | null; enotaMere?: string | null }>;
};

type DraftRow = {
  key: number;
  name: string;
  quantity: string;
  unit: ProposalItem["unit"];
  existingArticleId: number | null;
  search: string;
};

const TAX_CATEGORY_LABELS: Record<TaxCategory, string> = {
  food: "Hrana (material za jedi)",
  hot_beverage: "Topli napitek (sestavina)",
  cold_beverage: "Hladni napitek (sestavina)",
  alcoholic: "Alkoholna pijača (sestavina)",
  other: "Drugo",
  vat_super_reduced_5: "Posebna znižana stopnja (5%)",
};

function compatibleUnit(articleUnit: string | null | undefined, unit: DraftRow["unit"]): boolean {
  const value = articleUnit?.trim().toLocaleUpperCase("sl").replace(/\.$/u, "");
  return unit === "KGM" ? ["KGM", "KG", "G", "GRM", "GR"].includes(value ?? "")
    : unit === "LTR" ? ["LTR", "L", "LT", "ML", "MLT"].includes(value ?? "")
      : ["KOM", "KOS", "KOSA", "KOSI", "PC", "PCS"].includes(value ?? "");
}

export function SmartNormativeProposalDialog({ open, onOpenChange, articleId, articleName, onApplySuccess, availableIngredients }: Props) {
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<ProposalResponse | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [classifications, setClassifications] = useState<Record<number, ItemClassification>>({});
  const [draftRows, setDraftRows] = useState<DraftRow[]>([]);
  const requestIdRef = useRef(0);
  const nextRowKeyRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    setProposal(null);
    setError(null);
    setConfirmed(false);
    setClassifications({});
    setDraftRows([]);
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
      nextRowKeyRef.current = data.items.length;
      setDraftRows(data.items.map((item, key) => ({
        key, name: item.name, quantity: String(item.quantity), unit: item.unit,
        existingArticleId: item.existingArticleId, search: item.name,
      })));
      
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

  const addIngredient = () => {
    setDraftRows(previous => [...previous, {
      key: nextRowKeyRef.current++, name: "", quantity: "", unit: "KGM",
      existingArticleId: null, search: "",
    }]);
    setConfirmed(false);
  };

  const handleApply = async () => {
    if (!proposal || !confirmed || !rowsValid) return;
    
    // Validate that all willCreate items have valid classification
    const classificationsArray = [];
    for (let i = 0; i < draftRows.length; i++) {
      const row = draftRows[i]!;
      if (row.existingArticleId === null) {
        const cls = classifications[row.key];
        if (!cls || cls.taxCategory === "") {
          setError("Izberite davčno klasifikacijo za vse nove nabavne artikle.");
          return;
        }
        classificationsArray.push({
          index: i,
          taxCategory: cls.taxCategory as TaxCategory,
          addedSugar: cls.addedSugar,
          rawConfirmed: true
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
           classifications: classificationsArray,
           ...(proposal.origin === "catalog_volume" ? {} : {
             editedItems: draftRows.map(row => ({
               name: row.name.trim(),
               quantity: row.quantity.trim().replace(",", "."),
               unit: row.unit,
               existingArticleId: row.existingArticleId,
             })),
           }),
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

  const allClassificationsValid = draftRows.every(row => {
    if (row.existingArticleId !== null) return true;
    const cls = classifications[row.key];
    return cls && cls.taxCategory !== "";
  });
  const rowsValid = draftRows.length > 0 && draftRows.every(row => {
    const quantity = row.quantity.trim().replace(",", ".");
    return row.name.trim().length > 0 && row.name.trim().length <= 200
      && /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/u.test(quantity)
      && Number(quantity) > 0 && Number(quantity) <= 999999.9999
      && (row.existingArticleId === null || availableIngredients.some(article => article.id === row.existingArticleId && compatibleUnit(article.enotaMere, row.unit)));
  }) && new Set(draftRows.map(row => row.name.trim().toLocaleLowerCase("sl"))).size === draftRows.length
    && new Set(draftRows.map(row => row.existingArticleId).filter(id => id !== null)).size === draftRows.filter(row => row.existingArticleId !== null).length;
  const canApply = proposal && confirmed && rowsValid && allClassificationsValid && !applying && !loading;
  const newItems = draftRows.filter(row => row.existingArticleId === null);
  const firstCategory = newItems.length ? classifications[newItems[0]!.key]?.taxCategory : "";
  const commonCategory = firstCategory && newItems.every(row => classifications[row.key]?.taxCategory === firstCategory)
    ? firstCategory : "";

  return (
    <Dialog open={open} onOpenChange={value => { if (!applying) onOpenChange(value); }}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col" style={{ height: "min(90dvh, calc(var(--pos-visual-viewport-height) - 1rem))" }}>
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
            <div aria-label="Sestavine in pregled" role="region" className="h-full min-h-0 overflow-y-auto overscroll-contain touch-pan-y pr-4 pb-4">
              <div className="space-y-5">
                {error && (
                  <div className="p-3 rounded-md bg-destructive/10 text-destructive text-sm flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <p>{error}</p>
                  </div>
                )}

                <section aria-label="Predlagani normativ" className="space-y-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="space-y-1">
                      <h3 className="text-lg font-semibold">Normativ za 1 porcijo</h3>
                      <p className="text-xs text-muted-foreground">
                        AI je predlagal {proposal.items.length} {proposal.items.length === 1 ? "sestavino" : "sestavin"}.
                        {proposal.items.length > 1 && " Za ostale se pomaknite po vsebini dialoga navzdol."}
                        {" "}Količine so okvirne za zalogo, ne navodilo za tehtanje vsake porcije. Predlog še ni shranjen.
                      </p>
                    </div>
                    {proposal.origin !== "catalog_volume" && <Button variant="outline" size="sm" onClick={addIngredient}>+ Dodaj sestavino</Button>}
                  </div>
                  {proposal.origin !== "catalog_volume" && draftRows.length === 1 && (
                    <p role="status" className="rounded-md border border-amber-500/50 bg-amber-500/10 p-2 text-sm">
                      Predlog vsebuje samo eno sestavino. Če jed vsebuje še druge, jih dodajte in določite količine pred potrditvijo.
                    </p>
                  )}
                  <div className="rounded-md border bg-card divide-y">
                    {draftRows.map((row, index) => {
                      const candidates = availableIngredients.filter(article =>
                        compatibleUnit(article.enotaMere, row.unit)
                        && (article.id === row.existingArticleId || `${article.ime} ${article.imeZaNabavo ?? ""}`.toLocaleLowerCase("sl").includes(row.search.trim().toLocaleLowerCase("sl")))
                      ).slice(0, 40);
                      return (
                        <div key={row.key} className="p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-medium text-muted-foreground">Sestavina {index + 1}</span>
                            {proposal.origin !== "catalog_volume" && <Button variant="ghost" size="sm" className="h-7 text-destructive" onClick={() => {
                              setDraftRows(previous => previous.filter(item => item.key !== row.key)); setConfirmed(false);
                            }}>Odstrani</Button>}
                          </div>
                          <div className="grid grid-cols-[minmax(0,1fr)_95px_80px] gap-2">
                            <Input aria-label={`Ime sestavine ${index + 1}`} value={row.name} disabled={proposal.origin === "catalog_volume"}
                              onChange={event => { const value = event.target.value; setDraftRows(previous => previous.map(item => item.key === row.key
                                ? { ...item, name: value, search: value, existingArticleId: null } : item)); setConfirmed(false); }} />
                            <Input aria-label={`Količina sestavine ${index + 1}`} inputMode="decimal" value={row.quantity} disabled={proposal.origin === "catalog_volume"}
                              onChange={event => { setDraftRows(previous => previous.map(item => item.key === row.key ? { ...item, quantity: event.target.value } : item)); setConfirmed(false); }} />
                            <select aria-label={`Enota sestavine ${index + 1}`} value={row.unit} disabled={proposal.origin === "catalog_volume"}
                              className="h-9 rounded-md border bg-background px-2 text-sm" onChange={event => {
                                setDraftRows(previous => previous.map(item => item.key === row.key
                                  ? { ...item, unit: event.target.value as DraftRow["unit"], existingArticleId: null } : item)); setConfirmed(false);
                              }}>
                              <option value="KGM">kg</option><option value="LTR">l</option><option value="KOM">kos</option>
                            </select>
                          </div>
                          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
                            <Input aria-label={`Poišči nabavni artikel za sestavino ${index + 1}`} placeholder="Išči v šifrantu (npr. Olje sončnično)"
                              disabled={proposal.origin === "catalog_volume"}
                              value={row.search} onChange={event => setDraftRows(previous => previous.map(item => item.key === row.key ? { ...item, search: event.target.value } : item))} />
                            <select aria-label={`Nabavni artikel za sestavino ${index + 1}`} className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm"
                              disabled={proposal.origin === "catalog_volume"}
                              value={row.existingArticleId ?? ""} onChange={event => {
                                const id = Number(event.target.value);
                                const article = availableIngredients.find(item => item.id === id);
                                setDraftRows(previous => previous.map(item => item.key === row.key ? {
                                  ...item, existingArticleId: article?.id ?? null, name: article?.ime ?? item.name,
                                } : item)); setConfirmed(false);
                              }}>
                              <option value="">Ustvari nov nabavni artikel</option>
                              {candidates.map(article => <option key={article.id} value={article.id}>{article.ime} ({article.enotaMere})</option>)}
                            </select>
                          </div>
                          {row.existingArticleId === null && <p className="text-xs text-muted-foreground">Če artikel že obstaja, ga najprej izberite iz šifranta. Nove surovine nastanejo šele ob potrditvi.</p>}
                        </div>
                      );
                    })}
                  </div>
                  {!rowsValid && <p className="text-xs text-destructive">Vsaka sestavina potrebuje ime in pozitivno količino (največ 4 decimalke); iste sestavine ne uporabite dvakrat.</p>}
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
                          for (const row of newItems) next[row.key] = { taxCategory: value as TaxCategory, addedSugar: false };
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
                      {newItems.map(row => {
                        const cls = classifications[row.key];
                        const isBeverage = cls?.taxCategory === "hot_beverage" || cls?.taxCategory === "cold_beverage" || cls?.taxCategory === "alcoholic";
                        return (
                          <div key={row.key} className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                            <Label htmlFor={`smart-normative-tax-${row.key}`} className="text-sm sm:flex-1">{row.name || "Nova sestavina"}</Label>
                            <div className="space-y-1.5 sm:w-[300px]">
                              <Select value={cls?.taxCategory ?? ""} onValueChange={value => setClassifications(previous => ({
                                ...previous, [row.key]: { taxCategory: value as TaxCategory, addedSugar: false },
                              }))}>
                                <SelectTrigger id={`smart-normative-tax-${row.key}`} className="w-full h-9">
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
                                    ...previous, [row.key]: { ...previous[row.key]!, addedSugar: !!checked },
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
                    <span className="text-muted-foreground">Spletni zadetek (ne potrjuje vseh sestavin ali dobavitelja):</span>
                    {proposal.sources.map((source, index) => (
                      <a key={index} href={source.url} target="_blank" rel="noreferrer noopener"
                        className="text-primary hover:underline inline-flex items-center gap-1">
                        <ExternalLink className="h-3 w-3" />{source.title}
                      </a>
                    ))}
                  </div>
                )}

              </div>
            </div>
          ) : null}
        </div>

        <DialogFooter className="mt-4 flex-col gap-2 border-t pt-3 sm:flex-col">
          {proposal && <label className="flex items-start gap-2 cursor-pointer text-sm">
            <Checkbox checked={confirmed} onCheckedChange={checked => setConfirmed(!!checked)} className="mt-0.5" />
            <span>Pregledal sem popravljene sestavine in količine.
              {newItems.length > 0 && " Potrjujem, da so vsi novi artikli nabavne surovine, ne polizdelki."}
              {" "}Želim shraniti normativ.</span>
          </label>}
          <div className="flex w-full flex-wrap items-center justify-end gap-2">
          {!allClassificationsValid && proposal && (
            <div className="mr-auto text-xs text-amber-600 flex items-center gap-1">
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
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
