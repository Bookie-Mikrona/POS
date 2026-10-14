import { formatEur } from '@/lib/format';
import React, { useEffect, useRef, useState } from 'react';
import { trackEvent } from '@/lib/analytics';
import { Drawer } from 'vaul';
import { cenaArtiklaVKosarici, cenaToGoEmbalazeVKosarici, useCart } from '@/lib/cart-context';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Plus, Minus, Trash2, ShoppingBag, Loader2, AlertTriangle } from 'lucide-react';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { useSubmitPublicOrder } from '@/hooks/use-public-api';
import { type QrGostNarociloInput } from '@workspace/api-client-react';
import { useToast } from '@/hooks/use-toast';
import { calculateQrReviewTotal, formatQrTipInput, parseQrTipInput } from '@/lib/qr-tip';

type CartDrawerProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  token: string;
  qrNapravaId: string;
  existingOrderSubtotal: number;
  currentTip: number;
  onSuccess: (response: any) => void;
};

export function CartDrawer({
  open,
  onOpenChange,
  token,
  qrNapravaId,
  existingOrderSubtotal,
  currentTip,
  onSuccess,
}: CartDrawerProps) {
  const { items, updateQuantity, removeItem, cartTotal, cartCount, clearCart } = useCart();
  const submitOrder = useSubmitPublicOrder(token);
  const { toast } = useToast();
  const [globalNote, setGlobalNote] = useState('');
  const [tipInput, setTipInput] = useState('0,00');
  const [tipError, setTipError] = useState<string | null>(null);
  // Keep the same key across a retry after a lost response; rotate only after
  // the server has accepted this cart submission.
  const idempotencyKey = useRef<string | null>(null);
  const parsedTip = parseQrTipInput(tipInput);
  const displayTip = parsedTip ?? 0;
  const reviewSubtotal = existingOrderSubtotal + cartTotal;
  const totalWithTip = calculateQrReviewTotal(existingOrderSubtotal, cartTotal, displayTip);

  useEffect(() => {
    if (!open) return;
    setTipInput(formatQrTipInput(currentTip));
    setTipError(null);
  }, [open]);

  const handleSubmit = () => {
    if (items.length === 0) return;
    if (items.some((item) => item.multicourseSelection?.courses.some(
      (course) => !Number.isInteger(course.foodArtikelId) || course.foodArtikelId <= 0
        || (course.wineArtikelId !== null
          && (!Number.isInteger(course.wineArtikelId) || course.wineArtikelId <= 0)),
    ))) {
      toast({
        variant: 'destructive',
        title: 'Izbira večhodnega menija ni popolna',
        description: 'Za vsak izbran hod izberite dovoljeno jed in, kadar je zahtevano, vino (1 dl).',
      });
      return;
    }
    const znesekNapitnina = parseQrTipInput(tipInput);
    if (znesekNapitnina === null) {
      setTipError('Vnesite veljaven znesek z največ dvema decimalnima mestoma.');
      return;
    }

    const payload = {
      idempotencyKey: idempotencyKey.current ?? (idempotencyKey.current = crypto.randomUUID().replaceAll('-', '')),
      qrNapravaId,
      opomba: globalNote.trim() || undefined,
      znesekNapitnina,
      postavke: items.map(item => ({
        artikelId: item.artikel.id,
        kolicina: item.kolicina,
        modifikatorji: item.modifikatorji.map(m => m.modifikatorId),
        opomba: item.opomba,
        velikostPice: item.velikostPice,
        toGo: item.toGo || undefined,
      })),
      multicourseSelections: items
        .filter((item) => item.multicourseSelection)
        .map((item) => ({
          menuArtikelId: item.multicourseSelection!.menuArtikelId,
          courses: item.multicourseSelection!.courses.map(({ courseNumber, foodArtikelId, wineArtikelId }) => ({
            courseNumber, foodArtikelId, wineArtikelId,
          })),
        })),
    };
    // The generated OpenAPI input predates the route's passthrough multicourse
    // extension. Keep regular order lines flat; the server materializes courses.
    submitOrder.mutate(payload as QrGostNarociloInput, {
      onSuccess: (res) => {
        const totalQuantity = items.reduce((sum, item) => sum + item.kolicina, 0);
        trackEvent("order_submitted", {
          line_count_bucket: items.length >= 5 ? "5_plus" : String(items.length),
          item_count_bucket: totalQuantity >= 10 ? "10_plus" : String(totalQuantity),
          has_multicourse: items.some(item => Boolean(item.multicourseSelection)),
          has_to_go: items.some(item => item.toGo),
          tip_present: znesekNapitnina > 0,
        });
        idempotencyKey.current = null;
        clearCart();
        setGlobalNote('');
        onOpenChange(false);
        onSuccess(res);
      },
      onError: (err: any) => {
        toast({
          variant: "destructive",
          title: "Napaka pri oddaji naročila",
          description: err.message || "Poskusite znova kasneje.",
        });
      }
    });
  };

  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange}>
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 bg-black/40 z-50 backdrop-blur-sm" />
        <Drawer.Content 
          className="bg-background flex flex-col rounded-t-[20px] mt-24 h-[92vh] fixed bottom-0 left-0 right-0 z-50 border-t"
          data-testid="drawer-cart"
        >
          <div className="p-4 bg-background rounded-t-[20px] flex-shrink-0 flex flex-col items-center border-b">
            <div className="mx-auto w-12 h-1.5 flex-shrink-0 rounded-full bg-muted-foreground/20 mb-4" />
            <div className="flex w-full items-center justify-between">
              <Drawer.Title className="text-xl font-display font-semibold">Tvoje naročilo</Drawer.Title>
              <div className="flex items-center gap-2 bg-secondary text-secondary-foreground px-3 py-1 rounded-full text-sm font-medium">
                <ShoppingBag className="w-4 h-4" />
                <span>{cartCount}</span>
              </div>
            </div>
          </div>

          {items.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center p-6 text-center text-muted-foreground">
              <ShoppingBag className="w-16 h-16 mb-4 opacity-20" />
              <p className="text-lg font-medium">Košarica je prazna</p>
              <p className="text-sm mt-1">Izberi kaj dobrega iz menija.</p>
              <Button 
                variant="outline" 
                className="mt-6 rounded-xl"
                onClick={() => onOpenChange(false)}
              >
                Nazaj na meni
              </Button>
            </div>
          ) : (
            <>
              <ScrollArea className="flex-1 px-4 py-4">
                <div className="space-y-6">
                  {items.map(item => {
                    const modsTotal = item.modifikatorji.reduce((sum, m) => sum + m.cenaDodatek, 0);
                    const cenaEmbalaže = cenaToGoEmbalazeVKosarici(item);
                    const itemTotal = (cenaArtiklaVKosarici(item) + modsTotal) * item.kolicina + cenaEmbalaže;
                    const toGoEmbalaza = item.artikel.toGoEmbalaza ?? [];

                    return (
                      <div key={item.id} className="flex gap-4 border-b pb-4 last:border-0" data-testid={`cart-item-${item.id}`}>
                        <div className="flex-1 space-y-1">
                          <div className="flex justify-between items-start">
                            <div className="flex items-center gap-2 pr-4">
                              <h4 className="font-medium leading-tight">{item.artikel.naziv}</h4>
                              {item.toGo && (
                                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">To Go</span>
                              )}
                            </div>
                            <span className="font-semibold whitespace-nowrap">{formatEur(itemTotal)}</span>
                          </div>
                          
                          {item.modifikatorji.length > 0 && (
                            <p className="text-sm text-muted-foreground leading-snug">
                              {item.modifikatorji.map(m => m.ime).join(', ')}
                            </p>
                          )}
                          {item.velikostPice && (
                            <p className="text-sm text-muted-foreground">
                              {item.artikel.velikostiPic.find((velikost) => velikost.id === item.velikostPice)?.naziv}
                            </p>
                          )}
                           {item.toGo && toGoEmbalaza.length > 0 && (
                             <p className="text-sm text-muted-foreground" data-testid={`cart-to-go-embalaza-${item.id}`}>
                               Embalaža: {toGoEmbalaza
                                  .map((embalaza) => `${item.kolicina > 1 ? `${item.kolicina}× ` : ""}${embalaza.naziv}${embalaza.cena > 0 ? ` (${formatEur(embalaza.cena * item.kolicina)})` : ""}`)
                                 .join(", ")}
                             </p>
                           )}
                           {item.multicourseSelection && (
                             <p className="text-sm text-muted-foreground">
                                Večhodni meni · {item.multicourseSelection.courses.map((course) => course.courseName).join(', ')}
                                {item.multicourseSelection.informationalCourseNames?.length
                                  ? ` · samodejno vključeno: ${item.multicourseSelection.informationalCourseNames.join(', ')}`
                                  : ''}
                             </p>
                           )}
                          
                          {item.opomba && (
                            <p className="text-sm text-muted-foreground italic bg-muted/50 p-2 rounded-md mt-2">
                              "{item.opomba}"
                            </p>
                          )}

                           <div className="flex items-center gap-4 mt-3 pt-2">
                             {!item.multicourseSelection && (
                            <div className="flex items-center bg-secondary rounded-full">
                              <Button 
                                variant="ghost" 
                                size="icon" 
                                className="h-8 w-8 rounded-full hover:bg-transparent"
                                onClick={() => updateQuantity(item.id, item.kolicina - 1)}
                              >
                                <Minus className="h-3 w-3" />
                              </Button>
                              <span className="w-6 text-center font-medium text-sm">{item.kolicina}</span>
                              <Button 
                                variant="ghost" 
                                size="icon"
                                className="h-8 w-8 rounded-full hover:bg-transparent"
                                onClick={() => updateQuantity(item.id, item.kolicina + 1)}
                              >
                                <Plus className="h-3 w-3" />
                              </Button>
                            </div>
                             )}
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-full ml-auto"
                              onClick={() => removeItem(item.id)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}

                  <div className="pt-4 space-y-3">
                    <label className="text-sm font-medium text-foreground">Splošna opomba (opcijsko)</label>
                    <Textarea 
                      placeholder="Navodila za natakarja..." 
                      value={globalNote}
                      onChange={(e) => setGlobalNote(e.target.value)}
                      className="resize-none h-20 text-sm bg-accent/30 border-transparent focus:border-primary"
                      data-testid="textarea-global-note"
                    />
                  </div>

                  <div className="pt-4 space-y-2">
                    <div>
                      <label htmlFor="qr-tip" className="text-sm font-medium text-foreground">
                        Napitnina (opcijsko)
                      </label>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Davčna in računovodska obravnava se določi po politiki ponudnika ob izdaji računa. Vrednost lahko ob naslednji oddaji popravite.
                      </p>
                    </div>
                    <div className="relative">
                      <Input
                        id="qr-tip"
                        type="text"
                        inputMode="decimal"
                        value={tipInput}
                        onChange={(event) => {
                          setTipInput(event.target.value);
                          setTipError(null);
                        }}
                        onBlur={() => {
                          const value = parseQrTipInput(tipInput);
                          if (value !== null) setTipInput(formatQrTipInput(value));
                        }}
                        className="h-12 pr-10 text-right text-base"
                        aria-invalid={tipError ? 'true' : 'false'}
                        aria-describedby={tipError ? 'qr-tip-error' : undefined}
                        data-testid="input-qr-tip"
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center font-medium text-muted-foreground">
                        €
                      </span>
                    </div>
                    {tipError && (
                      <p id="qr-tip-error" className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        {tipError}
                      </p>
                    )}
                  </div>
                </div>
              </ScrollArea>

              <div className="p-4 bg-background border-t pb-8">
                <div className="mb-4 space-y-1.5 text-sm">
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Vrednost naročila skupaj</span>
                    <span data-testid="text-order-subtotal">{formatEur(reviewSubtotal)}</span>
                  </div>
                  <div className="flex items-center justify-between text-muted-foreground">
                    <span>Napitnina</span>
                    <span data-testid="text-order-tip">{formatEur(displayTip)}</span>
                  </div>
                  <div className="flex items-end justify-between border-t pt-2">
                    <span className="text-base font-medium">Končni seštevek</span>
                    <span className="font-display text-2xl font-semibold" data-testid="text-order-total">
                      {formatEur(totalWithTip)}
                    </span>
                  </div>
                </div>
                
                <Button 
                  className="w-full h-14 text-lg font-medium rounded-xl shadow-lg hover:shadow-xl transition-all" 
                  onClick={handleSubmit}
                  disabled={submitOrder.isPending}
                  data-testid="button-submit-order"
                >
                  {submitOrder.isPending ? (
                    <><Loader2 className="mr-2 h-5 w-5 animate-spin" /> Oddajam...</>
                  ) : (
                    'Oddaj naročilo'
                  )}
                </Button>
              </div>
            </>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
