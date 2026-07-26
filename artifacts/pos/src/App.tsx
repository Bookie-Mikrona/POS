import { useState, useEffect, useRef } from "react";
import { ClerkProvider, SignIn } from "@clerk/clerk-react";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GotovToastProvider } from "@/contexts/GotovToastContext";
import { GotovToastSystem } from "@/components/GotovToastSystem";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { useListRacuni, useRetryFursBatch, getListRacuniQueryKey } from "@workspace/api-client-react";
import { NastavitveProvider, useNastavitve } from "@/contexts/NastavitveContext";
import { NapravaProvider } from "@/contexts/NapravaContext";
import { AutoStartProvider } from "@/contexts/AutoStartContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Home, Wallet, Menu, Receipt, BarChart3, Settings, ChefHat, Clock, MoreHorizontal, GlassWater, PackageOpen, AlertTriangle, X, LogOut, ShieldCheck, KeyRound, Eye, EyeOff, Loader2, FlaskConical, Mail, HardDrive, UserCircle, FileText, BookUser, CalendarDays, Users } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EnotaSwitcher } from "@/components/EnotaSwitcher";
import { BlagajnaSwitcher } from "@/components/BlagajnaSwitcher";
import { UporabnikSidebarInfo } from "@/components/UporabnikSidebarInfo";
import { AdminEnotaStaticInfo } from "@/components/AdminEnotaStaticInfo";
import { BlagajnaProvider } from "@/contexts/BlagajnaContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { setNapravaIdGetter } from "@workspace/api-client-react";
import { getNapravaId } from "@/lib/naprava";
setNapravaIdGetter(getNapravaId);
import SuperAdminPage from "@/pages/SuperAdmin";

import HomePage from "@/pages/Home";
import OrderPage from "@/pages/Order";
import CheckoutPage from "@/pages/Checkout";
import MenuPage from "@/pages/Menu";
import ReceiptsPage from "@/pages/Receipts";
import StatsPage from "@/pages/Stats";
import RealizacijaPage from "@/pages/Realizacija";
import SettingsPage from "@/pages/Settings";
import KitchenPage from "@/pages/Kitchen";
import TocilnicaPage from "@/pages/Tocilnica";
import IzmenePage from "@/pages/Izmene";
import ZalogePage from "@/pages/Zaloge";
import SimulacijaPage from "@/pages/Simulacija";
import TestniZagoniPage from "@/pages/TestniZagoni";
import PartnerjiPage from "@/pages/Partnerji";
import DnevniMeniPage from "@/pages/DnevniMeni";

function make401QueryClient() {
  const on401 = () => window.dispatchEvent(new Event("auth:401"));

  const isUnauth = (error: unknown) =>
    error instanceof Error && error.message.includes("401");

  return new QueryClient({
    queryCache: new QueryCache({
      onError: (error) => {
        if (isUnauth(error)) on401();
      },
    }),
    mutationCache: new MutationCache({
      onError: (error) => {
        if (isUnauth(error)) on401();
      },
    }),
    defaultOptions: {
      queries: {
        retry: (n, e) => !isUnauth(e) && n < 3,
        staleTime: 30_000,
        refetchOnWindowFocus: false,
      },
    },
  });
}

const queryClient = make401QueryClient();

const primaryNav = [
  { href: "/", label: "Mize", shortLabel: "Mize", icon: Home },
  { href: "/blagajna", label: "Blagajna", shortLabel: "Blagajna", icon: Wallet },
  { href: "/kuhinja", label: "Kuhinja", shortLabel: "Kuhinja", icon: ChefHat },
  { href: "/racuni", label: "Računi", shortLabel: "Računi", icon: Receipt },
];

const secondaryNav = [
  { href: "/tocilnica", label: "Točilnica", icon: GlassWater },
  { href: "/meni", label: "Meni", icon: Menu },
  { href: "/dnevni-meni", label: "Dnevni meni", icon: CalendarDays },
  { href: "/zaloge", label: "Zaloge", icon: PackageOpen },
  { href: "/statistike", label: "Statistike", icon: BarChart3 },
  { href: "/realizacija", label: "Realizacija", icon: FileText },
  { href: "/izmene", label: "Izmene", icon: Clock },
  { href: "/partnerji", label: "Partnerji", icon: BookUser },
  { href: "/simulacija", label: "Simulacija", icon: FlaskConical },
  { href: "/nastavitve", label: "Nastavitve", icon: Settings },
];

function NavLink({ href, label, icon: Icon, active, className = "" }: {
  href: string; label: string; icon: React.ElementType; active: boolean; className?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-3 px-4 py-3 rounded-xl text-base font-medium transition-all ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      } ${className}`}
    >
      <Icon className="h-5 w-5 shrink-0" />
      <span>{label}</span>
    </Link>
  );
}

interface CertInfo { dniDoIzteka?: number; opozorilo?: boolean; subjekt?: string; veljavnoDo?: string }

function CertExpiryBanner() {
  const [info, setInfo]         = useState<CertInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const today = new Date().toISOString().slice(0, 10);
    if (localStorage.getItem("certExpiryDismiss") === today) { setDismissed(true); return; }

    const cached = localStorage.getItem("certExpiryCache");
    if (cached) {
      try {
        const { datum, data } = JSON.parse(cached) as { datum: string; data: CertInfo };
        if (datum === today) { setInfo(data); return; }
      } catch { /* nop */ }
    }

    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    fetch(`${base}/api/certifikat/info`, { credentials: "include" })
      .then(r => r.json())
      .then((data: CertInfo) => {
        localStorage.setItem("certExpiryCache", JSON.stringify({ datum: today, data }));
        setInfo(data);
      })
      .catch(() => { /* tiho */ });
  }, []);

  const dismiss = () => {
    const today = new Date().toISOString().slice(0, 10);
    localStorage.setItem("certExpiryDismiss", today);
    setDismissed(true);
  };

  if (!info?.opozorilo || dismissed) return null;

  const dni = info.dniDoIzteka ?? 0;
  const urgentno = dni <= 7;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 text-sm ${urgentno ? "bg-red-600 text-white" : "bg-amber-400 text-amber-950"}`}>
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="flex-1 font-medium">
        {urgentno
          ? `⚠️ Certifikat FURS poteče čez ${dni} ${dni === 1 ? "dan" : "dni"}! Takoj naložite novega v Nastavitve.`
          : `Certifikat FURS poteče čez ${dni} dni (${info.veljavnoDo?.slice(0, 10) ?? ""}). Naložite novega v Nastavitve.`}
      </span>
      <button onClick={dismiss} className="shrink-0 opacity-70 hover:opacity-100 transition-opacity">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function FursNapakaRetryBanner() {
  const queryClient = useQueryClient();
  const { data: racuni } = useListRacuni();
  const retry = useRetryFursBatch();
  const { nastavitve } = useNastavitve();

  const fursNacin = (nastavitve as (typeof nastavitve & { fursNacin?: string }) | undefined)?.fursNacin;
  if (fursNacin !== "produkcija") return null;

  const steviloNapak = (racuni ?? []).filter(r =>
    r.status !== "storniran" && r.status !== "testni" && (r.status === "napaka" || !r.eor)
  ).length;

  if (steviloNapak === 0) return null;

  function handleRetry() {
    retry.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
      },
    });
  }

  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm bg-orange-50 border-b border-orange-200 text-orange-900">
      <AlertTriangle className="h-4 w-4 shrink-0 text-orange-500" />
      <span className="flex-1 font-medium">
        {steviloNapak === 1
          ? "1 račun ni registriran pri FURS."
          : `${steviloNapak} računov ni registriranih pri FURS.`}{" "}
        <span className="font-normal text-orange-700">Strežnik bo samodejno poskusil vsakih 5 minut.</span>
      </span>
      <button
        type="button"
        onClick={handleRetry}
        disabled={retry.isPending}
        className="shrink-0 text-xs font-medium underline underline-offset-2 hover:text-orange-950 disabled:opacity-50 transition-colors"
      >
        {retry.isPending ? "Pošiljanje…" : "Poskusi zdaj"}
      </button>
    </div>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const { user, logout } = useAuth();
  const { nastavitve } = useNastavitve();
  const [sidebarScale, setSidebarScale] = useState(1);
  const asideRef = useRef<HTMLElement>(null);
  const sidebarContentRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ skupaj: number; uspesno: number; neuspesno: number }>).detail;
      toast({
        title: `FURS retry: ${detail.uspesno} računov registriranih`,
        description: detail.neuspesno > 0
          ? `${detail.neuspesno} računov še vedno ni mogoče registrirati.`
          : "Vsi neregistrirani računi so bili uspešno poslani na FURS.",
        variant: detail.neuspesno > 0 ? "destructive" : "default",
      });
    };
    window.addEventListener("furs:retryDone", handler);
    return () => window.removeEventListener("furs:retryDone", handler);
  }, [toast]);

  useEffect(() => {
    const aside = asideRef.current;
    const content = sidebarContentRef.current;
    if (!aside || !content) return;
    const recalc = () => {
      const ah = aside.clientHeight;
      const sh = content.scrollHeight;
      if (sh > 0 && ah > 0) setSidebarScale(Math.min(1, ah / sh));
    };
    const ro = new ResizeObserver(recalc);
    ro.observe(aside);
    ro.observe(content);
    recalc();
    return () => ro.disconnect();
  });

  useEffect(() => {
    const naziv = nastavitve?.nazivRestavracije;
    const allNavForTitle = [
      { href: "/", label: "Mize" },
      { href: "/blagajna", label: "Blagajna" },
      { href: "/kuhinja", label: "Kuhinja" },
      { href: "/tocilnica", label: "Točilnica" },
      { href: "/meni", label: "Meni" },
      { href: "/zaloge", label: "Zaloge" },
      { href: "/racuni", label: "Računi" },
      { href: "/statistike", label: "Statistike" },
      { href: "/realizacija", label: "Realizacija" },
      { href: "/izmene", label: "Izmene" },
      { href: "/partnerji", label: "Partnerji" },
      { href: "/nastavitve", label: "Nastavitve" },
      { href: "/nastavitve?tab=uporabniki", label: "Uporabniki" },
      { href: "/narocilo/", label: "Naročilo" },
      { href: "/admin/testi", label: "Testi" },
      { href: "/superadmin/eposta", label: "E-pošta" },
      { href: "/superadmin/backup", label: "Varnostne kopije" },
      { href: "/superadmin/profil", label: "Moj profil" },
      { href: "/superadmin/testi", label: "Testi" },
      { href: "/superadmin", label: "Super-admin" },
    ];
    const matched = allNavForTitle.find(item =>
      item.href === "/" ? location === "/" : location.startsWith(item.href)
    );
    const pageLabel = matched?.label;
    const suffix = naziv ? `${naziv} – POS` : "Restavracija POS";
    document.title = pageLabel ? `${pageLabel} – ${suffix}` : suffix;
  }, [nastavitve?.nazivRestavracije, location]);

  const isSuperAdmin = user?.vloga === "superadmin";
  const isAdmin = user?.vloga === "admin" || isSuperAdmin;
  const isAdminEnote = user?.vloga === "admin_enote";

  const allNav = isSuperAdmin ? [
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    { href: "/superadmin", label: "Super-admin", icon: ShieldCheck },
  ] : [
    { href: "/", label: "Mize", icon: Home },
    { href: "/blagajna", label: "Blagajna", icon: Wallet },
    { href: "/kuhinja", label: "Kuhinja", icon: ChefHat },
    { href: "/tocilnica", label: "Točilnica", icon: GlassWater },
    { href: "/meni", label: "Meni", icon: Menu },
    { href: "/zaloge", label: "Zaloge", icon: PackageOpen },
    { href: "/racuni", label: "Računi", icon: Receipt },
    { href: "/statistike", label: "Statistike", icon: BarChart3 },
    { href: "/realizacija", label: "Realizacija", icon: FileText },
    { href: "/izmene", label: "Izmene", icon: Clock },
    { href: "/partnerji", label: "Partnerji", icon: BookUser },
    ...(isAdmin || isAdminEnote ? [{ href: "/dnevni-meni", label: "Dnevni meni", icon: CalendarDays }] : []),
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    ...(isAdmin ? [{ href: "/admin/testi", label: "Testi", icon: FlaskConical }] : []),
  ];

  const mobileSecondaryNav = isSuperAdmin ? [
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    { href: "/superadmin", label: "Super-admin", icon: ShieldCheck },
  ] : [
    ...secondaryNav,
    ...(isAdmin ? [{ href: "/admin/testi", label: "Testi", icon: FlaskConical }] : []),
  ];

  const isActive = (href: string) => {
    const [hrefPath] = href.split("?");
    if (href === "/") return location === "/";
    if (href === "/superadmin") return location === "/superadmin";
    // "Uporabniki" link: aktiven samo ko smo na /nastavitve z ?tab=uporabniki
    if (href.includes("tab=uporabniki")) {
      return location === "/nastavitve" && window.location.search.includes("tab=uporabniki");
    }
    return location.startsWith(hrefPath);
  };

  const isOrderPage = location.startsWith("/narocilo/");
  const isCheckoutPage = location === "/blagajna";

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background font-sans text-foreground">
      {!isOrderPage && (
        <aside ref={asideRef} className="hidden md:flex w-60 shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground shadow-md overflow-hidden">
          <div
            ref={sidebarContentRef}
            style={sidebarScale < 1 ? {
              transform: `scale(${sidebarScale})`,
              transformOrigin: "top left",
              width: `${100 / sidebarScale}%`,
            } : undefined}
          >
            <div className="p-3 border-b border-sidebar-border/50 text-red-600">
              <h1 className="text-base font-bold tracking-tight">POS Cockpit</h1>
              {!isSuperAdmin && (() => {
                // Davčna: iz nastavitev ali pa iz prijavljenega uporabnika (companies tabela)
                const davcna = nastavitve?.davcnaStevilka || user?.podjetjeDavcna;
                const naziv = nastavitve?.nazivPodjetja || nastavitve?.nazivRestavracije || user?.companyNaziv;
                const naslov = nastavitve?.naslovPodjetja || nastavitve?.naslovRestavracije || user?.companyNaslov;
                // Enota — prikaži samo za admin_enote in uporabnik (admin preklaplja v nogi)
                const enotaIme = (isAdminEnote || (!isAdmin && !isAdminEnote)) ? user?.enotaIme : null;
                if (!davcna && !naziv) return null;
                return (
                  <div className="mt-1 space-y-0.5">
                    {davcna && (
                      <p className="text-[10px] font-mono text-sidebar-foreground/60">{davcna}</p>
                    )}
                    {naziv && (
                      <p className="text-xs font-medium text-sidebar-foreground leading-snug">{naziv}</p>
                    )}
                    {naslov && (
                      <p className="text-[10px] text-sidebar-foreground/50 leading-snug">{naslov}</p>
                    )}
                    {enotaIme && (
                      <p className="text-[10px] text-sidebar-foreground/70 leading-snug border-t border-sidebar-border/30 pt-1 mt-1 font-medium">
                        {enotaIme}
                      </p>
                    )}
                  </div>
                );
              })()}
            </div>
            <nav className="py-3 px-2 flex flex-col gap-1">
              {allNav.map(item => (
                <NavLink
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(item.href)}
                />
              ))}
            </nav>
            <div className="p-2 border-t border-sidebar-border/50 text-red-600">
              {/* Admin podjetja: enota → blagajna (vizualno povezano) */}
              {isAdmin && !isSuperAdmin && (
                <div className="space-y-1 mb-1">
                  <p className="px-3 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">Enota</p>
                  <EnotaSwitcher />
                  <p className="px-3 pt-0.5 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">Blagajna</p>
                  <BlagajnaSwitcher />
                </div>
              )}
              {/* Admin enote: fiksna enota + izbira blagajne */}
              {isAdminEnote && !isSuperAdmin && (
                <div className="space-y-1 mb-1">
                  <p className="px-3 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">Enota</p>
                  <AdminEnotaStaticInfo />
                  <p className="px-3 pt-0.5 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none">Blagajna</p>
                  <BlagajnaSwitcher />
                </div>
              )}
              {/* Uporabnik: fiksna enota + fiksna blagajna */}
              {!isAdmin && !isAdminEnote && !isSuperAdmin && (
                <div className="mb-1">
                  <UporabnikSidebarInfo />
                </div>
              )}
              <button
                onClick={logout}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium text-red-600 hover:bg-sidebar-accent/50 hover:text-red-700 transition-all"
              >
                <LogOut className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">{user?.ime ?? user?.username}</span>
              </button>
            </div>
          </div>
        </aside>
      )}

      <main className={`flex-1 flex flex-col overflow-hidden ${!isOrderPage ? "pb-16 md:pb-0" : ""}`}>
        <CertExpiryBanner />
        <FursNapakaRetryBanner />
        {!isSuperAdmin && nastavitve?.nazivRestavracije && !isCheckoutPage && (
          <div className="flex items-center justify-center px-4 py-1.5 bg-background/80 backdrop-blur-sm border-b border-border/40">
            <Link href="/nastavitve" className="text-xs font-medium text-muted-foreground/70 tracking-wide truncate hover:text-foreground hover:underline transition-colors">
              {nastavitve.nazivRestavracije}
            </Link>
          </div>
        )}
        {children}
      </main>

      {!isOrderPage && (
        <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-background border-t safe-area-inset-bottom">
          {primaryNav.map(item => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px] transition-colors ${
                isActive(item.href)
                  ? "text-primary"
                  : "text-muted-foreground"
              }`}
            >
              <item.icon className="h-5 w-5" />
              <span className="text-[10px] font-medium">{item.shortLabel}</span>
            </Link>
          ))}

          <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
            <SheetTrigger asChild>
              <button
                className={`flex-1 flex flex-col items-center justify-center py-2 gap-0.5 min-h-[56px] transition-colors ${
                  mobileSecondaryNav.some(i => isActive(i.href)) ? "text-primary" : "text-muted-foreground"
                }`}
              >
                <MoreHorizontal className="h-5 w-5" />
                <span className="text-[10px] font-medium">Več</span>
              </button>
            </SheetTrigger>
            <SheetContent side="bottom" className="rounded-t-2xl pb-8">
              <SheetHeader className="mb-4">
                <SheetTitle className="text-left">Meni</SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-4 gap-2">
                {mobileSecondaryNav.map(item => (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMoreOpen(false)}
                    className={`flex flex-col items-center gap-2 p-4 rounded-xl border transition-colors ${
                      isActive(item.href)
                        ? "bg-primary/10 border-primary/30 text-primary"
                        : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <item.icon className="h-6 w-6" />
                    <span className="text-xs font-medium text-center">{item.label}</span>
                  </Link>
                ))}
              </div>
              <div className="mt-4 pt-4 border-t">
                {!isSuperAdmin && nastavitve?.nazivRestavracije && (
                  <div className="px-4 pb-2">
                    <p className="text-xs text-muted-foreground leading-snug">{nastavitve.nazivRestavracije}</p>
                    {nastavitve.davcnaStevilka && (
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">ID: {nastavitve.davcnaStevilka}</p>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { setMoreOpen(false); void logout(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-muted-foreground hover:bg-muted transition-all"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Odjava ({user?.ime ?? user?.username})</span>
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
      )}
    </div>
  );
}

function ProtectedRouter() {
  useRealtimeSync();
  return (
    <NastavitveProvider>
      <NapravaProvider>
      <AutoStartProvider>
      <ZamenjajGesloOverlay />
      <Layout>
        <Switch>
        <Route path="/" component={HomePage} />
        <Route path="/narocilo/:id" component={OrderPage} />
        <Route path="/blagajna" component={CheckoutPage} />
        <Route path="/meni" component={MenuPage} />
        <Route path="/racuni" component={ReceiptsPage} />
        <Route path="/statistike" component={StatsPage} />
        <Route path="/realizacija" component={RealizacijaPage} />
        <Route path="/kuhinja" component={KitchenPage} />
        <Route path="/tocilnica" component={TocilnicaPage} />
        <Route path="/izmene" component={IzmenePage} />
        <Route path="/zaloge" component={ZalogePage} />
        <Route path="/simulacija" component={SimulacijaPage} />
        <Route path="/partnerji" component={PartnerjiPage} />
        <Route path="/dnevni-meni" component={DnevniMeniPage} />
        <Route path="/nastavitve" component={SettingsPage} />
        <Route path="/admin/testi" component={TestniZagoniPage} />
        <Route path="/superadmin/eposta" component={SuperAdminPage} />
        <Route path="/superadmin/backup" component={SuperAdminPage} />
        <Route path="/superadmin/profil" component={SuperAdminPage} />
        <Route path="/superadmin/testi" component={SuperAdminPage} />
        <Route path="/superadmin" component={SuperAdminPage} />
        <Route component={NotFound} />
        </Switch>
      </Layout>
      </AutoStartProvider>
      </NapravaProvider>
    </NastavitveProvider>
  );
}

function ZamenjajGesloOverlay() {
  const { user, updateUser } = useAuth();
  const [trenutno, setTrenutno] = useState("");
  const [novo, setNovo] = useState("");
  const [ponovitev, setPonovitev] = useState("");
  const [napaka, setNapaka] = useState("");
  const [loading, setLoading] = useState(false);
  const [pokaziTrenutno, setPokaziTrenutno] = useState(false);
  const [pokaziNovo, setPokaziNovo] = useState(false);

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setNapaka("");
    if (novo !== ponovitev) { setNapaka("Novi gesli se ne ujemata"); return; }
    if (novo.length < 6) { setNapaka("Novo geslo mora imeti vsaj 6 znakov"); return; }
    setLoading(true);
    try {
      const r = await fetch(`${base}/api/auth/geslo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trenutno, novo }),
      });
      const data = await r.json() as { ok?: boolean; napaka?: string };
      if (!r.ok) {
        setNapaka(data.napaka ?? "Napaka pri spremembi gesla");
      } else {
        updateUser({ moraZamenjatiGeslo: false });
      }
    } catch {
      setNapaka("Napaka pri povezavi s strežnikom");
    } finally {
      setLoading(false);
    }
  };

  if (!user?.moraZamenjatiGeslo) return null;

  return (
    <Dialog open modal>
      <DialogContent className="max-w-md" onPointerDownOutside={e => e.preventDefault()} onEscapeKeyDown={e => e.preventDefault()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            Zamenjajte geslo
          </DialogTitle>
          <DialogDescription>
            Administrator je nastavil začasno geslo za vaš račun. Pred nadaljevanjem ga morate zamenjati z lastnim geslom.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label>Začasno geslo (trenutno)</Label>
            <div className="relative">
              <Input
                type={pokaziTrenutno ? "text" : "password"}
                autoComplete="current-password"
                value={trenutno}
                onChange={e => setTrenutno(e.target.value)}
                disabled={loading}
                autoFocus
              />
              <button type="button" onClick={() => setPokaziTrenutno(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {pokaziTrenutno ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Novo geslo</Label>
            <div className="relative">
              <Input
                type={pokaziNovo ? "text" : "password"}
                autoComplete="new-password"
                value={novo}
                onChange={e => setNovo(e.target.value)}
                placeholder="vsaj 6 znakov"
                disabled={loading}
              />
              <button type="button" onClick={() => setPokaziNovo(v => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                {pokaziNovo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Ponovite novo geslo</Label>
            <Input
              type="password"
              autoComplete="new-password"
              value={ponovitev}
              onChange={e => setPonovitev(e.target.value)}
              disabled={loading}
            />
          </div>
          {napaka && <p className="text-sm text-destructive font-medium">{napaka}</p>}
          <Button type="submit" className="w-full" disabled={loading || !trenutno || !novo || !ponovitev}>
            {loading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem...</> : "Nastavi novo geslo"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClerkSignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <SignIn routing="hash" />
    </div>
  );
}

function AuthGate() {
  const { user, loading } = useAuth();
  const [location, setLocation] = useLocation();

  useEffect(() => {
    if (!loading && user && location === "/login") {
      setLocation(user.vloga === "superadmin" ? "/superadmin" : "/");
    }
  }, [user, loading, location, setLocation]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Nalagam...</div>
      </div>
    );
  }

  if (!user) return <ClerkSignInPage />;
  return <ProtectedRouter />;
}

function AppRouter() {
  return (
    <Switch>
      <Route component={AuthGate} />
    </Switch>
  );
}

function App() {
  const pubKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string | undefined;
  if (!pubKey) throw new Error("Manjka VITE_CLERK_PUBLISHABLE_KEY");
  return (
    <ClerkProvider publishableKey={pubKey} afterSignOutUrl="/pos/">
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <GotovToastProvider>
            <AuthProvider>
              <BlagajnaProvider>
                <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                  <AppRouter />
                </WouterRouter>
              </BlagajnaProvider>
            </AuthProvider>
            <Toaster />
            <GotovToastSystem />
          </GotovToastProvider>
        </TooltipProvider>
      </QueryClientProvider>
    </ClerkProvider>
  );
}

export default App;
