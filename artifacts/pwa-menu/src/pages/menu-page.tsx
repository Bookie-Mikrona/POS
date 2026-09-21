import React, { useState, useMemo, useRef, useEffect } from 'react';
import { trackEvent } from '@/lib/analytics';
import { useParams } from 'wouter';
import { activatePublicMenu, getOrCreateQrNapravaId, useCallWaiter, useCurrentWaiterRequest, usePublicMenu, usePublicMenuRealtime, type PublicMulticourseMenu } from '@/hooks/use-public-api';
import { QrGostNarociloResponse } from '@workspace/api-client-react';
import { type PublicMenuArticle } from '@/hooks/use-public-api';
import { Loader2, ShoppingBag, MapPin, AlertCircle, BellRing, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ItemDialog } from '@/components/item-dialog';
import { CartDrawer } from '@/components/cart-drawer';
import { useCart } from '@/lib/cart-context';
import { SuccessView } from '@/components/success-view';
import { ExistingOrder } from '@/components/existing-order';
import { MulticourseMenuDialog } from '@/components/multicourse-menu-dialog';
import { GuestAssistantDrawer, type ChatMessage } from '@/components/guest-assistant-drawer';
import { useToast } from '@/hooks/use-toast';

export default function MenuPage() {
  const params = useParams();
  const token = params.token || '';

  const [qrNapravaId, setQrNapravaId] = useState<string | null>(null);
  const [qrNapravaError, setQrNapravaError] = useState<Error | null>(null);
  const [locationActivated, setLocationActivated] = useState(false);
  const [locationError, setLocationError] = useState<Error | null>(null);
  const [locationAttempt, setLocationAttempt] = useState(0);
  const [previewSession] = useState(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const session = params.get('predogled');
    if (session) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`);
    return session;
  });
  const { data, isLoading, error, refetch } = usePublicMenu(token, qrNapravaId, locationActivated);
  const menuConnection = usePublicMenuRealtime(token, qrNapravaId, locationActivated);
  const currentWaiterRequest = useCurrentWaiterRequest(token, qrNapravaId, locationActivated);
  const callWaiter = useCallWaiter(token);
  const { toast } = useToast();
  const { cartCount, cartTotal } = useCart();

  const [selectedArtikel, setSelectedArtikel] = useState<PublicMenuArticle | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedMulticourseMenu, setSelectedMulticourseMenu] = useState<PublicMulticourseMenu | null>(null);
  const [multicourseDialogOpen, setMulticourseDialogOpen] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [assistantMessages, setAssistantMessages] = useState<ChatMessage[]>([]);

  const [successResponse, setSuccessResponse] = useState<QrGostNarociloResponse | null>(null);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);

  const categoryRefs = useRef<Record<string, HTMLElement | null>>({});
  const categoryButtonRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const categoryMenuRef = useRef<HTMLDivElement | null>(null);
  const scrollingToCategoryRef = useRef<string | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const menuViewTrackedRef = useRef(false);

  useEffect(() => {
    try {
      setQrNapravaId(getOrCreateQrNapravaId());
    } catch (error) {
      setQrNapravaError(error instanceof Error ? error : new Error('Identitete QR naprave ni bilo mogoče shraniti.'));
    }
  }, []);

  useEffect(() => {
    if (!qrNapravaId) return;
    let cancelled = false;
    setLocationActivated(false);
    setLocationError(null);

    const poskusiLokalniWifi = () => {
      void activatePublicMenu(token, qrNapravaId, undefined, previewSession ?? undefined)
        .then(() => {
          if (!cancelled) setLocationActivated(true);
        })
        .catch((error) => {
          if (!cancelled) {
            setLocationError(error instanceof Error ? error : new Error('Povezave z lokalnim Wi-Fi-jem ni bilo mogoče potrditi.'));
          }
        });
    };

    if (!navigator.geolocation) {
      poskusiLokalniWifi();
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        void activatePublicMenu(token, qrNapravaId, position.coords, previewSession ?? undefined)
          .then(() => {
            if (!cancelled) setLocationActivated(true);
          })
          .catch((error) => {
            if (!cancelled) {
              setLocationError(error instanceof Error ? error : new Error('Lokacije ni bilo mogoče potrditi.'));
            }
          });
      },
      (geoError) => {
        if (cancelled) return;
        poskusiLokalniWifi();
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 30_000 },
    );

    return () => {
      cancelled = true;
    };
  }, [token, qrNapravaId, locationAttempt, previewSession]);

  useEffect(() => {
    if (data?.kategorije && data.kategorije.length > 0 && !activeCategory) {
      setActiveCategory(data.kategorije[0].naziv);
    }
  }, [data, activeCategory]);

  useEffect(() => {
    if (!activeCategory) return;
    const menu = categoryMenuRef.current;
    const button = categoryButtonRefs.current[activeCategory];
    if (!menu || !button) return;
    const centeredLeft = button.offsetLeft - ((menu.clientWidth - button.offsetWidth) / 2);
    menu.scrollTo({ left: centeredLeft, behavior: 'smooth' });
  }, [activeCategory]);

  useEffect(() => {
    if (!data || menuViewTrackedRef.current) return;
    menuViewTrackedRef.current = true;
    trackEvent("menu_viewed", {
      category_count: data.kategorije.length,
      item_count: data.artikli.length,
      multicourse_menu_count: data.multicourseMenus.length,
      has_existing_order: Boolean(data.obstojeceNarocilo),
    });
  }, [data]);

  useEffect(() => {
    if (!selectedArtikel || !data) return;
    const current = data.artikli.find((artikel) => artikel.id === selectedArtikel.id);
    if (!current || !current.naVoljo) {
      setDialogOpen(false);
      setSelectedArtikel(null);
      return;
    }
    setSelectedArtikel(current);
  }, [data, selectedArtikel]);

  useEffect(() => {
    const handleScroll = () => {
      if (!data?.kategorije) return;
      const scrollingTo = scrollingToCategoryRef.current;
      if (scrollingTo) {
        const target = categoryRefs.current[scrollingTo];
        const activationLine = (headerRef.current?.offsetHeight ?? 140) + 16;
        if (target && Math.abs(target.getBoundingClientRect().top - activationLine) <= 12) {
          scrollingToCategoryRef.current = null;
        } else {
          return;
        }
      }
      let current = activeCategory;
      for (const kat of data.kategorije) {
        const el = categoryRefs.current[kat.naziv];
        if (el) {
          const rect = el.getBoundingClientRect();
          const activationLine = (headerRef.current?.offsetHeight ?? 140) + 16;
          if (rect.top <= activationLine && rect.bottom >= activationLine) {
            current = kat.naziv;
            break;
          }
        }
      }
      if (current && current !== activeCategory) {
        setActiveCategory(current);
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [data, activeCategory]);

  const scrollToCategory = (naziv: string) => {
    scrollingToCategoryRef.current = naziv;
    setActiveCategory(naziv);
    const element = categoryRefs.current[naziv];
    if (element) {
      const headerHeight = headerRef.current?.offsetHeight ?? 140;
      const y = element.getBoundingClientRect().top + window.scrollY - headerHeight - 8;
      window.scrollTo({ top: y, behavior: 'smooth' });
    }
  };

  if (!qrNapravaId || (!locationError && (!locationActivated || isLoading))) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background" data-testid="loading-state">
        <Loader2 className="w-10 h-10 animate-spin text-primary/50 mb-4" />
        <p className="text-muted-foreground font-medium">
            {locationActivated ? 'Nalagam meni...' : 'Preverjam lokacijo ali lokalni Wi-Fi...'}
        </p>
        {!locationActivated && (
          <p className="mt-2 max-w-xs px-6 text-center text-sm text-muted-foreground">
            QR meni deluje do 50 m od lokala ali prek lokalnega Wi-Fi-ja.
          </p>
        )}
      </div>
    );
  }

  if (error || qrNapravaError || locationError) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 text-center bg-background" data-testid="error-state">
        <div className="w-16 h-16 bg-destructive/10 rounded-full flex items-center justify-center mb-4">
          <AlertCircle className="w-8 h-8 text-destructive" />
        </div>
        <h2 className="text-2xl font-display font-semibold mb-2">Ups, nekaj je šlo narobe</h2>
          <p className="text-muted-foreground">
             {locationError?.message ?? qrNapravaError?.message ?? (error instanceof Error ? error.message : 'Neznana napaka.')}
          </p>
         <Button
           className="mt-6 rounded-xl"
           onClick={() => {
             if (locationError) setLocationAttempt(value => value + 1);
             else void refetch();
           }}
           data-testid="button-retry-menu"
         >
           Poskusi znova
         </Button>
      </div>
    );
  }

  if (!data) return null;
  if (successResponse) {
    return <SuccessView
      response={successResponse}
      token={token}
      qrNapravaId={qrNapravaId}
      activated={locationActivated}
      onReset={() => {
        setSuccessResponse(null);
        void refetch();
      }}
    />;
  }

  const { lokal, miza, kategorije } = data;
  const openWaiterRequest = currentWaiterRequest.data;
  const multicourseByArticle = new Map(data.multicourseMenus.map((menu) => [menu.menuArtikelId, menu]));
  const callWaiterNow = () => {
    if (!qrNapravaId || openWaiterRequest || callWaiter.isPending) return;
    callWaiter.mutate({ qrNapravaId }, {
      onError: (waiterError) => toast({
        variant: 'destructive',
        title: 'Natakarja ni bilo mogoče poklicati',
        description: waiterError instanceof Error ? waiterError.message : 'Poskusite znova.',
      }),
    });
  };

  return (
    <div className="min-h-[100dvh] bg-background pb-28">
      {/* Header */}
      <header ref={headerRef} className="sticky top-0 z-40 bg-background/90 backdrop-blur-lg border-b border-border/50">
        <div className="px-3 py-2.5 sm:px-5 sm:py-3">
          <h1 className="w-full truncate text-sm sm:text-xl font-display font-bold leading-tight" data-testid="text-company-name">
            {lokal.podjetjeNaziv}
          </h1>

          <div className="mt-1 flex items-center justify-between gap-3">
            <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {miza && (
                <div className="flex items-center gap-1 text-muted-foreground text-[11px] sm:text-sm font-medium shrink-0">
                  <MapPin className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
                  <span data-testid="text-table-name" className="truncate">
                    {miza.naziv || `Miza ${miza.stevilka}`}
                    {miza.prostorNaziv ? ` · ${miza.prostorNaziv}` : ""}
                  </span>
                </div>
              )}

              <div className="flex w-1 h-1 rounded-full bg-border shrink-0" />

              <span className="text-[10px] sm:text-xs font-medium text-muted-foreground truncate shrink-0" data-testid="text-unit-name">
                {lokal.enotaNaziv}
              </span>

              <div className="flex w-1 h-1 rounded-full bg-border shrink-0" />

              <div className="flex items-center gap-1.5 shrink-0" aria-live="polite">
                <span className="relative flex h-1.5 w-1.5">
                  {menuConnection.connected && <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>}
                  <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${menuConnection.connected ? 'bg-emerald-500' : menuConnection.reconnecting ? 'bg-amber-500' : 'bg-muted-foreground'}`}></span>
                </span>
                <p
                  className="text-[10px] sm:text-xs font-medium text-muted-foreground"
                  data-testid="status-menu-freshness"
                >
                  {menuConnection.connected
                    ? 'V živo'
                    : menuConnection.reconnecting
                      ? 'Povezovanje…'
                      : 'Preverjanje…'}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="shrink-0 h-[44px] sm:h-10 px-3 text-[11px] sm:text-sm rounded-xl"
              onClick={callWaiterNow}
              disabled={Boolean(openWaiterRequest) || callWaiter.isPending}
              data-testid="button-call-waiter"
            >
              {callWaiter.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BellRing className="mr-1 h-4 w-4" />}
              <span className="hidden sm:inline">
                {openWaiterRequest
                  ? `Natakar (${openWaiterRequest.stanje === 'potrjeno' ? 'potrjeno' : 'čaka'})`
                  : 'Pokliči natakarja'}
              </span>
              <span className="sm:hidden font-semibold">
                {openWaiterRequest ? 'Poklican' : 'Natakar'}
              </span>
            </Button>
          </div>
        </div>

        {/* Categories Tab Bar */}
        <div
          ref={categoryMenuRef}
          className="flex overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none] gap-2 px-[calc(50%-2rem)] pb-2 sm:gap-2 sm:px-5 sm:pb-3"
          data-testid="category-menu"
        >
          {kategorije.map(kat => (
            <button
              key={kat.naziv}
              ref={(el) => { categoryButtonRefs.current[kat.naziv] = el; }}
              id={`tab-category-${kat.naziv}`}
              onClick={() => scrollToCategory(kat.naziv)}
              className={`shrink-0 px-4 py-2 min-h-[44px] sm:px-4 sm:py-2 rounded-full text-[13px] sm:text-sm font-medium leading-tight transition-colors ${
                activeCategory === kat.naziv
                  ? 'bg-primary text-primary-foreground shadow-sm'
                  : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
              }`}
              data-testid={`tab-category-${kat.naziv}`}
            >
              {kat.naziv}
            </button>
          ))}
        </div>
      </header>

      {/* Menu Content */}
      <main className="px-3 py-3 sm:px-5 sm:py-6 space-y-6 sm:space-y-12">
        <ExistingOrder narocilo={data.obstojeceNarocilo} token={token} qrNapravaId={qrNapravaId} />
        {kategorije.map(kat => {
          const items = kat.artikli;
          if (items.length === 0) return null;

          return (
            <section
              key={kat.naziv}
              ref={(el) => { categoryRefs.current[kat.naziv] = el; }}
              className="scroll-mt-28 sm:scroll-mt-36"
              data-testid={`section-category-${kat.naziv}`}
            >
              <h2 className="text-lg sm:text-xl font-display font-bold mb-3 sm:mb-4 flex items-center gap-2 sm:gap-3">
                {kat.naziv}
                <div className="h-px flex-1 bg-border/50"></div>
              </h2>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                {items.map(artikel => (
                  <button
                    key={artikel.id}
                    onClick={() => {
                      if (!artikel.naVoljo) return;
                      const multicourseMenu = multicourseByArticle.get(artikel.id);
                      if (multicourseMenu) {
                        setSelectedArtikel(artikel);
                        setSelectedMulticourseMenu(multicourseMenu);
                        setMulticourseDialogOpen(true);
                        return;
                      }
                      setSelectedArtikel(artikel);
                      setDialogOpen(true);
                    }}
                    disabled={!artikel.naVoljo}
                    className={`flex min-w-0 flex-col text-left overflow-hidden rounded-xl sm:rounded-2xl border bg-card transition-all ${
                      artikel.naVoljo
                        ? "hover:border-primary/30 active:scale-[0.98] shadow-sm"
                        : "cursor-not-allowed opacity-55 grayscale"
                    }`}
                    data-testid={`card-item-${artikel.id}`}
                  >
                    {artikel.slikaUrl ? (
                      <img
                        src={artikel.slikaUrl}
                        alt=""
                        className="aspect-[2.5/1] w-full shrink-0 bg-muted object-contain"
                        loading="lazy"
                      />
                    ) : artikel.barva ? (
                        <div
                        className="aspect-[2.5/1] w-full shrink-0 opacity-80"
                        style={{ backgroundColor: artikel.barva }}
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-col p-3 sm:p-4 w-full flex-1">
                      <div className="flex justify-between items-start w-full gap-2 sm:gap-4">
                        <div className="min-w-0 flex-1 space-y-1">
                          <h3 className="break-words whitespace-normal font-semibold text-sm sm:text-base leading-tight">{artikel.naziv}</h3>
                          {artikel.opis && (
                            <p className="text-[11px] sm:text-sm text-muted-foreground line-clamp-2 leading-snug">
                              {artikel.opis}
                            </p>
                          )}
                          {artikel.toGo && (
                            <span className="inline-flex rounded-full bg-primary/10 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-medium text-primary">
                              To Go
                            </span>
                          )}
                          {artikel.mealType !== 'ala_carte' && artikel.availableQuantity != null && (
                            <span
                              className="inline-flex rounded-full bg-emerald-500/10 px-1.5 sm:px-2 py-0.5 text-[10px] sm:text-xs font-semibold text-emerald-700"
                              data-testid={`available-portions-${artikel.id}`}
                            >
                              {artikel.availableQuantity} porcij
                            </span>
                          )}
                        </div>
                        <div className="font-semibold whitespace-nowrap bg-accent px-2 sm:px-2.5 py-1 rounded-lg text-xs sm:text-sm">
                          {artikel.cena.toFixed(2)} €
                        </div>
                      </div>
                      {!artikel.naVoljo && (
                        <div className="mt-2 sm:mt-3 text-[10px] sm:text-xs font-semibold uppercase tracking-wider text-destructive" data-testid={`sold-out-${artikel.id}`}>
                          Trenutno ni na voljo
                        </div>
                      )}
                      {((artikel.alergeni && artikel.alergeni.length > 0) || (artikel.alergeniSledi && artikel.alergeniSledi.length > 0) || artikel.potrjen === false) && (
                        <div className="mt-2 sm:mt-3 space-y-1 text-[10px] sm:text-xs text-muted-foreground" data-testid={`allergens-${artikel.id}`}>
                          {artikel.alergeni && artikel.alergeni.length > 0 && (
                            <p>
                              <span className="font-medium">Vsebuje:</span> {artikel.alergeni.map(a => a.naziv).join(", ")}
                            </p>
                          )}
                          {artikel.alergeniSledi && artikel.alergeniSledi.length > 0 && (
                            <p>
                              <span className="font-medium">Lahko vsebuje sledi:</span> {artikel.alergeniSledi.map(a => a.naziv).join(", ")}
                            </p>
                          )}
                          {artikel.potrjen === false && (
                            <div className="flex items-start gap-1 text-amber-600">
                              <AlertCircle className="w-3 h-3 sm:w-3.5 sm:h-3.5 shrink-0 mt-0.5" />
                              <span>Podatki o alergenih niso preverjeni.</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </main>

      {/* Floating Buttons */}
      <div className="fixed bottom-6 left-0 right-0 px-5 z-40 flex items-end gap-3 pointer-events-none">
        {cartCount > 0 && (
          <div className="flex-1 pointer-events-auto animate-in slide-in-from-bottom-8 fade-in duration-300">
            <Button
              size="lg"
              className="w-full h-14 rounded-2xl shadow-xl flex items-center justify-between px-6 text-lg font-medium"
              onClick={() => setCartOpen(true)}
              data-testid="button-open-cart"
            >
              <div className="flex items-center gap-3">
                <div className="relative">
                  <ShoppingBag className="w-5 h-5" />
                  <span className="absolute -top-2 -right-2 bg-background text-foreground text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center shadow-sm">
                    {cartCount}
                  </span>
                </div>
                <span>Košarica</span>
              </div>
              <span className="font-display font-semibold">{cartTotal.toFixed(2)} €</span>
            </Button>
          </div>
        )}

        {data.qrAiAsistentAktiven && <div className="shrink-0 pointer-events-auto animate-in slide-in-from-bottom-8 fade-in duration-300 ml-auto">
          <Button
            size="icon"
            className="h-14 w-14 rounded-2xl shadow-xl bg-card border border-border text-foreground hover:bg-accent hover:text-accent-foreground"
            onClick={() => setAssistantOpen(true)}
            data-testid="button-open-assistant"
          >
            <Sparkles className="w-6 h-6 text-emerald-500" />
          </Button>
        </div>}
      </div>

      <ItemDialog
        artikel={selectedArtikel}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
       <MulticourseMenuDialog
         menu={selectedMulticourseMenu}
         article={selectedArtikel}
         articles={data.artikli}
         open={multicourseDialogOpen}
         onOpenChange={setMulticourseDialogOpen}
       />

      <CartDrawer
        open={cartOpen}
        onOpenChange={setCartOpen}
        token={token}
        qrNapravaId={qrNapravaId}
        existingOrderSubtotal={data.obstojeceNarocilo?.skupaj ?? 0}
        currentTip={data.obstojeceNarocilo?.znesekNapitnina ?? 0}
        onSuccess={(res) => setSuccessResponse(res)}
      />

      {data.qrAiAsistentAktiven && <GuestAssistantDrawer
        open={assistantOpen}
        onOpenChange={setAssistantOpen}
        token={token}
        qrNapravaId={qrNapravaId}
        activated={locationActivated}
        messages={assistantMessages}
        setMessages={setAssistantMessages}
      />}
    </div>
  );
}
