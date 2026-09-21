import React, { useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { Dialog, DialogClose, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { type PublicMenuArticle } from '@/hooks/use-public-api';
import { useCart, CartItemModifier } from '@/lib/cart-context';
import { Plus, Minus, X, AlertCircle } from 'lucide-react';
import { aggregateAllergens } from '@/lib/allergens';

type ItemDialogProps = {
  artikel: PublicMenuArticle | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function ItemDialog({ artikel, open, onOpenChange }: ItemDialogProps) {
  const { addItem } = useCart();
  const [kolicina, setKolicina] = useState(1);
  const [opomba, setOpomba] = useState('');
  const [selectedMods, setSelectedMods] = useState<Record<number, boolean>>({});
  const [velikostPice, setVelikostPice] = useState<"mala" | "normalna" | "druzinska" | undefined>();
  const [toGo, setToGo] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Reset state when opened with a new article
  React.useEffect(() => {
    if (open && artikel) {
      setKolicina(1);
      setOpomba('');
      setValidationError(null);
      const defaultMods: Record<number, boolean> = {};
      setSelectedMods(defaultMods);
      setVelikostPice(artikel.velikostiPic.find((velikost) => velikost.id === "normalna")?.id ?? artikel.velikostiPic[0]?.id);
      setToGo(false);
    }
  }, [open, artikel]);

  if (!artikel) return null;

  const handleAdd = () => {
    const modifikatorji: CartItemModifier[] = [];
    for (const skupina of artikel.modifikatorji) {
      const izbranih = skupina.opcije.filter((mod) => selectedMods[mod.id]);
      const presezenMaximum = skupina.maxIzbir > 0 && izbranih.length > skupina.maxIzbir;
      if (izbranih.length < skupina.minIzbir || presezenMaximum) {
        const navodilo = skupina.maxIzbir === 0
          ? `vsaj ${skupina.minIzbir}`
          : skupina.minIzbir === skupina.maxIzbir
            ? String(skupina.minIzbir)
            : `${skupina.minIzbir}–${skupina.maxIzbir}`;
        setValidationError(`Pri »${skupina.naziv}« izberite ${navodilo} možnosti.`);
        return;
      }
      for (const mod of skupina.opcije) {
          if (selectedMods[mod.id]) {
            modifikatorji.push({
              modifikatorId: mod.id,
              ime: mod.naziv,
              cenaDodatek: mod.cena,
            });
          }
      }
    }

    addItem({
      artikel,
      kolicina,
      modifikatorji,
      opomba: opomba.trim() || undefined,
      velikostPice,
      toGo,
    });
    trackEvent("item_added_to_cart", {
      quantity_bucket: kolicina >= 3 ? "3_plus" : String(kolicina),
      modifier_count_bucket: modifikatorji.length >= 3 ? "3_plus" : String(modifikatorji.length),
      to_go: toGo,
      has_size: Boolean(velikostPice),
    });
    setValidationError(null);
    onOpenChange(false);
  };

  const modsTotal = Object.keys(selectedMods).reduce((sum, modId) => {
    if (selectedMods[Number(modId)]) {
      for (const skupina of artikel.modifikatorji) {
        const found = skupina.opcije.find(m => m.id === Number(modId));
        if (found) return sum + found.cena;
      }
    }
    return sum;
  }, 0);

  const cenaPice = velikostPice
    ? artikel.velikostiPic.find((velikost) => velikost.id === velikostPice)?.cena ?? artikel.cena
    : artikel.cena;
  const toGoEmbalaza = artikel.toGoEmbalaza ?? [];
  const cenaToGoEmbalaze = toGo
    ? toGoEmbalaza.reduce((sum, embalaza) => sum + embalaza.cena * kolicina, 0)
    : 0;
  const opisToGoEmbalaze = toGoEmbalaza.length > 0
    ? toGoEmbalaza
      .map((embalaza) => `${kolicina > 1 ? `${kolicina}× ` : ""}${embalaza.naziv}${embalaza.cena > 0 ? ` +${(embalaza.cena * kolicina).toFixed(2)} €` : ""}`)
      .join(", ")
    : "Brez dodatne embalaže";
  const total = (cenaPice + modsTotal) * kolicina + cenaToGoEmbalaze;

  const izbraniModifikatorjiAlergeni = artikel.modifikatorji.flatMap(skupina =>
    skupina.opcije.filter(mod => selectedMods[mod.id])
  );

  const aggregatedAllergens = aggregateAllergens(artikel, izbraniModifikatorjiAlergeni);
  const showAllergensBox = aggregatedAllergens.vsebuje.length > 0 || aggregatedAllergens.sledi.length > 0 || !aggregatedAllergens.potrjen || aggregatedAllergens.opozorila.length > 0;

  const updateModifierSelection = (skupinaId: number, skupinaNaziv: string, modId: number, checked: boolean) => {
    setValidationError(null);
    setSelectedMods((prev) => {
      if (!checked || skupinaNaziv.trim().toLocaleLowerCase('sl') !== 'razrez') {
        return { ...prev, [modId]: checked };
      }

      const next = { ...prev };
      const celotnaSkupina = artikel.modifikatorji.find((skupina) => skupina.id === skupinaId);
      for (const mod of celotnaSkupina?.opcije ?? []) {
        next[mod.id] = false;
      }
      next[modId] = true;
      return next;
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-md min-h-0 p-0 flex flex-col gap-0 max-h-[90dvh] sm:max-h-[85vh] overflow-hidden"
        data-testid="dialog-item"
        showCloseButton={false}
      >
        <div className="flex items-center justify-between px-2 py-1 border-b bg-background z-10 shrink-0">
          <DialogTitle className="text-base font-display font-semibold leading-tight truncate sm:text-lg pl-2">
            {artikel.naziv}
          </DialogTitle>
          <DialogClose asChild>
            <Button
              type="button"
              variant="ghost"
              className="h-11 w-11 rounded-full p-0 shrink-0 shadow-none hover:bg-muted ml-2"
              data-testid="button-close-item"
            >
              <X className="h-5 w-5" />
            </Button>
          </DialogClose>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {artikel.slikaUrl ? (
            <img
              src={artikel.slikaUrl}
              alt=""
              className="block h-auto max-h-36 w-full shrink-0 bg-muted/20 object-contain"
            />
          ) : artikel.barva ? (
            <div className="h-4 w-full shrink-0 opacity-80" style={{ backgroundColor: artikel.barva }} />
          ) : null}

          <div className="p-3 space-y-3">
            {artikel.opis && (
              <DialogDescription className="text-[13px] sm:text-sm text-muted-foreground leading-snug">
                {artikel.opis}
              </DialogDescription>
            )}
            {artikel.toGo && (
              <label className="flex items-center justify-between rounded-xl border bg-accent/20 p-3 cursor-pointer min-h-[44px]">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="item-to-go"
                    checked={toGo}
                    onCheckedChange={(checked) => setToGo(!!checked)}
                    data-testid="checkbox-to-go"
                  />
                  <div>
                    <Label htmlFor="item-to-go" className="font-medium cursor-pointer text-[13px]">To Go</Label>
                    <p className="text-[11px] text-muted-foreground leading-none mt-0.5">Za s seboj</p>
                  </div>
                </div>
                <span className="max-w-[48%] text-right text-[11px] sm:text-xs text-muted-foreground truncate" data-testid="text-to-go-embalaza">
                  {opisToGoEmbalaze}
                </span>
              </label>
            )}
            
            {/* Modifiers */}
            {artikel.jePica && artikel.velikostiPic.length > 1 && (
              <div className="space-y-1.5">
                <h4 className="font-medium text-[13px] text-foreground">Velikost pice</h4>
                <div className="grid grid-cols-3 gap-2">
                  {artikel.velikostiPic.map((velikost) => (
                    <Button key={velikost.id} type="button" variant={velikostPice === velikost.id ? "default" : "outline"}
                      className="h-auto min-h-[44px] flex-col gap-0.5 py-1.5 px-1" onClick={() => setVelikostPice(velikost.id)}>
                      <span className="text-sm">{velikost.naziv}</span>
                      <span className="text-[10px] opacity-80 font-normal">{velikost.premerCm} cm · {velikost.cena.toFixed(2)} €</span>
                    </Button>
                  ))}
                </div>
              </div>
            )}
            {(() => {
              const skupineZDodatki = artikel.modifikatorji
                .map((skupina) => ({
                  ...skupina,
                  opcije: skupina.opcije.filter((mod) => mod.cena > 0),
                }))
                .filter((skupina) => skupina.opcije.length > 0);
              const skupineSOstalimi = artikel.modifikatorji
                .map((skupina) => ({
                  ...skupina,
                  opcije: skupina.opcije.filter((mod) => mod.cena <= 0),
                }))
                .filter((skupina) => skupina.opcije.length > 0);
              const skupineZDodatkiIds = new Set(skupineZDodatki.map((skupina) => skupina.id));
              const renderSkupina = (
                skupina: typeof skupineZDodatki[number],
                prikaziObveznost: boolean,
              ) => (
                <div key={`${skupina.id}-${prikaziObveznost}`} className="space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="font-medium text-[13px] text-foreground">{skupina.naziv}</h4>
                    {prikaziObveznost && skupina.obvezna && (
                      <span className="text-[10px] sm:text-xs text-destructive font-medium uppercase tracking-wider">
                        Obvezno · {skupina.maxIzbir === 0
                          ? `vsaj ${skupina.minIzbir}`
                          : skupina.minIzbir === skupina.maxIzbir
                            ? skupina.minIzbir
                            : `${skupina.minIzbir}–${skupina.maxIzbir}`}
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {skupina.opcije.map((mod) => (
                      <label
                        key={mod.id}
                        className="flex items-center justify-between py-2.5 px-3 min-h-[44px] rounded-xl border bg-card hover:bg-accent/50 cursor-pointer transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Checkbox
                            checked={!!selectedMods[mod.id]}
                             onCheckedChange={(checked) => updateModifierSelection(
                               skupina.id,
                               skupina.naziv,
                               mod.id,
                               !!checked,
                             )}
                            data-testid={`checkbox-mod-${mod.id}`}
                          />
                          <span className="text-[13px] font-medium">{mod.naziv}</span>
                        </div>
                        {mod.cena > 0 && (
                          <span className="text-[13px] text-muted-foreground">+{mod.cena.toFixed(2)} €</span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
              );

              return (
                <>
                  {skupineZDodatki.length > 0 && (
                    <div className="space-y-2" data-testid="modifier-section-paid">
                      <h3 className="font-semibold text-base">Dodatki</h3>
                      {skupineZDodatki.map((skupina) => renderSkupina(skupina, true))}
                    </div>
                  )}
                  {skupineSOstalimi.length > 0 && (
                    <div className="space-y-2" data-testid="modifier-section-other">
                      <h3 className="font-semibold text-base">Ostalo</h3>
                      {skupineSOstalimi.map((skupina) => renderSkupina(
                        skupina,
                        !skupineZDodatkiIds.has(skupina.id),
                      ))}
                    </div>
                  )}
                </>
              );
            })()}
            {validationError && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive" role="alert" data-testid="modifier-validation-error">
                {validationError}
              </p>
            )}
            {showAllergensBox && (
              <div className="rounded-xl border bg-card p-3 space-y-2">
                <h4 className="font-semibold text-sm">Informacije o alergenih</h4>

                {aggregatedAllergens.vsebuje.length > 0 && (
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Vsebuje:</span> {aggregatedAllergens.vsebuje.map(a => a.naziv).join(", ")}
                  </p>
                )}

                {aggregatedAllergens.sledi.length > 0 && (
                  <p className="text-sm text-foreground">
                    <span className="font-medium">Lahko vsebuje sledi:</span> {aggregatedAllergens.sledi.map(a => a.naziv).join(", ")}
                  </p>
                )}

                {(!aggregatedAllergens.potrjen || aggregatedAllergens.opozorila.length > 0) && (
                  <div className="rounded-lg bg-amber-50 dark:bg-amber-950/30 p-3 space-y-2">
                    {!aggregatedAllergens.potrjen && (
                      <div className="flex items-start gap-2 text-amber-800 dark:text-amber-500">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="text-sm font-medium">Podatki o alergenih niso preverjeni.</span>
                      </div>
                    )}

                    {aggregatedAllergens.opozorila.map((op, i) => (
                      <div key={i} className="flex items-start gap-2 text-amber-800 dark:text-amber-500">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span className="text-sm">{op}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Note */}
            <div className="space-y-1.5">
              <Label htmlFor="opomba" className="text-[13px] font-medium">Posebne želje</Label>
              <Textarea 
                id="opomba" 
                placeholder="Brez ledu, manj sladko..." 
                value={opomba}
                onChange={(e) => setOpomba(e.target.value)}
                className="resize-none h-16 min-h-[44px] text-[13px] rounded-xl"
                data-testid="textarea-item-note"
              />
            </div>

          </div>
        </div>

        <div className="p-2 border-t bg-background shrink-0 flex items-center gap-2 mt-auto">
          <div className="flex items-center rounded-xl border bg-muted/20 shrink-0 h-[48px] p-1" data-testid="item-quantity-control">
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-11 rounded-lg hover:bg-background"
              onClick={() => setKolicina(Math.max(1, kolicina - 1))}
              disabled={kolicina <= 1}
              data-testid="button-decrease-qty"
            >
              <Minus className="h-5 w-5" />
            </Button>
            <span className="w-8 text-center font-semibold text-base" data-testid="text-qty">{kolicina}</span>
            <Button
              variant="ghost"
              size="icon"
              className="h-full w-11 rounded-lg hover:bg-background"
              onClick={() => setKolicina(kolicina + 1)}
              data-testid="button-increase-qty"
            >
              <Plus className="h-5 w-5" />
            </Button>
          </div>
          <Button
            className="flex-1 h-[48px] text-[15px] font-semibold rounded-xl"
            onClick={handleAdd}
            data-testid="button-add-to-cart"
          >
            Dodaj · {total.toFixed(2)} €
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
