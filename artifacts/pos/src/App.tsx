import { lazy, Suspense, useState, useEffect } from "react";
import { ClerkProvider, SignIn } from "@clerk/react";
import { publishableKeyFromHost } from "@clerk/react/internal";
import { Switch, Route, Router as WouterRouter, Link, useLocation } from "wouter";
import { QueryClient, QueryClientProvider, QueryCache, MutationCache, useQueryClient } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { GotovToastProvider } from "@/contexts/GotovToastContext";
import { GotovToastSystem } from "@/components/GotovToastSystem";
import { useRealtimeSync } from "@/hooks/useRealtimeSync";
import { PosSyncStatus } from "@/components/PosSyncStatus";
import { OfflineFiscalQueueStatus } from "@/components/OfflineFiscalQueueStatus";
import { LocalGatewayStatusBanner } from "@/components/LocalGatewayStatusBanner";
import { GatewayOfflineProvider } from "@/lib/gatewayOfflineStore";
import { QuickSwitch } from "@/components/QuickSwitch";
import {
  useListRacuni,
  useRetryFursBatch,
  getListRacuniQueryKey,
  useGetKdsNastavitve,
  getGetKdsNastavitveQueryKey,
  useListOpozorilaNeuspeleDostaveBonov,
  getListOpozorilaNeuspeleDostaveBonovQueryKey,
  usePonoviDostavoIndividualnegaBona,
} from "@workspace/api-client-react";
import { NastavitveProvider, useNastavitve } from "@/contexts/NastavitveContext";
import { HappyHourProvider, useHappyHour } from "@/contexts/HappyHourContext";
import { NapravaProvider } from "@/contexts/NapravaContext";
import { AutoStartProvider } from "@/contexts/AutoStartContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Home, Wallet, Menu, Receipt, BarChart3, Settings, ChefHat, Clock, MoreHorizontal, GlassWater, PackageOpen, AlertTriangle, X, LogOut, ShieldCheck, KeyRound, Eye, EyeOff, Loader2, FlaskConical, Mail, HardDrive, UserCircle, FileText, Users, ClipboardList, BookOpen, TrendingDown, Tag, Banknote, Recycle, Info, Activity, CalendarDays, QrCode, Utensils, Globe2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { EnotaSwitcher } from "@/components/EnotaSwitcher";
import { BlagajnaSwitcher } from "@/components/BlagajnaSwitcher";
import { UporabnikSidebarInfo } from "@/components/UporabnikSidebarInfo";
import { AdminEnotaStaticInfo } from "@/components/AdminEnotaStaticInfo";
import { SifrantiSidebar } from "@/components/SifrantiSidebar";
import { NAV_ANY_CAPABILITY_BY_PATH, NAV_CAPABILITY_BY_PATH, canAccessPosRoute, type UnitCapability } from "@/lib/unitProfiles";
import { CtiDohodniKlicPopup } from "@/components/CtiDohodniKlicPopup";
import { AgentLauncher } from "@/components/AgentLauncher";
import { BlagajnaProvider } from "@/contexts/BlagajnaContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import NotFound from "@/pages/not-found";
import { AuthProvider, useAuth, type PosAuthStatus } from "@/contexts/AuthContext";
import { setNapravaIdGetter } from "@workspace/api-client-react";
import { getNapravaId } from "@/lib/naprava";
import { hasActivePosUnit } from "@/lib/posUnitContext";
setNapravaIdGetter(getNapravaId);

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
const MIKRONA_LOGO_URL = `${basePath}/mikrona-logo.png`;

const clerkAppearance = {
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${MIKRONA_LOGO_URL}`,
  },
};

// Strani se nalagajo šele ob prvem obisku. App sicer uvozi navigacijo in
// avtentikacijo, ne pa celotnega velikega nastavitev/poročilnega dela.
const HomePage = lazy(() => import("@/pages/Home"));
const OrderPage = lazy(() => import("@/pages/Order"));
const CheckoutPage = lazy(() => import("@/pages/Checkout"));
const MenuPage = lazy(() => import("@/pages/Menu"));
const ReceiptsPage = lazy(() => import("@/pages/Receipts"));
const DnevniMeniPage = lazy(() => import("@/pages/DnevniMeni"));
const MalicePage = lazy(() => import("@/pages/Malice"));
const KosilaPage = lazy(() => import("@/pages/Kosila"));
const StatsPage = lazy(() => import("@/pages/Stats"));
const DnevniIzkazPage = lazy(() => import("@/pages/DnevniIzkaz"));
const OperativnaPorocilaPage = lazy(() => import("@/pages/OperativnaPorocila"));
const RealizacijaPage = lazy(() => import("@/pages/Realizacija"));
const TemeljnicePage = lazy(() => import("@/pages/Temeljnice"));
const SettingsPage = lazy(() => import("@/pages/Settings"));
const KitchenPage = lazy(() => import("@/pages/Kitchen"));
const IzmenePage = lazy(() => import("@/pages/Izmene"));
const ObracunUrPage = lazy(() => import("@/pages/ObracunUr"));
const ZalogePage = lazy(() => import("@/pages/Zaloge"));
const SimulacijaPage = lazy(() => import("@/pages/Simulacija"));
const TestniZagoniPage = lazy(() => import("@/pages/TestniZagoni"));
const PartnerjiPage = lazy(() => import("@/pages/Partnerji"));
const NarocnikiPage = lazy(() => import("@/pages/Narocniki"));
const StroskovnaMestaPage = lazy(() => import("@/pages/StroskovnaMesta"));
const KontniPlanPage = lazy(() => import("@/pages/KontniPlan"));
const KontiZaTemeljnicePage = lazy(() => import("@/pages/KontiZaTemeljnice"));
const OdstopanjaPage = lazy(() => import("@/pages/uvoz/OdstopanjaPage"));
const UvozCenikPage = lazy(() => import("@/pages/uvoz/UvozCenikPage"));
const BlagajniskiPremikiPage = lazy(() => import("@/pages/BlagajniskiPremiki"));
const EventsPage = lazy(() => import("@/pages/Events"));
const RezervacijePage = lazy(() => import("@/pages/Rezervacije"));
const IzdajaPage = lazy(() => import("@/pages/Izdaja"));
const QrAdministracijaPage = lazy(() => import("@/pages/QrAdministracija"));
const SuperAdminPage = lazy(() => import("@/pages/SuperAdmin"));
const PrirocnikPage = lazy(() => import("@/manual/PrirocnikPage"));
const JavnaStranPage = lazy(() => import("@/pages/JavnaStran"));

function KdsStationPage({ station }: { station: "bar" | "kitchen" | "pizza" }) {
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const queryKey = enotaId
    ? [...getGetKdsNastavitveQueryKey(), enotaId]
    : getGetKdsNastavitveQueryKey();
  const { data: settings } = useGetKdsNastavitve({
    query: { queryKey, enabled: !!enotaId },
  });
  const stationTypes = station === "kitchen" && settings?.profil === "bar_combined_kitchen"
    ? ["kitchen", "pizza"] as const
    : [station] as const;
  const title = station === "bar" ? "Točilnica" : station === "pizza" ? "Pice" : "Kuhinja";
  return <KitchenPage stationTypes={[...stationTypes]} title={title} />;
}

import { Snowflake, CheckSquare } from "lucide-react";
const PreparedFoodPage = lazy(() => import("@/pages/PreparedFood"));
const PlateWastePage = lazy(() => import("@/pages/PlateWaste"));

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
  { href: "/izmene", label: "Izmene", shortLabel: "Izmene", icon: Clock },
  { href: "/racuni", label: "Računi", shortLabel: "Računi", icon: Receipt },
];

const secondaryNav = [
  { href: "/tocilnica", label: "Točilnica", icon: GlassWater },
  { href: "/pripravljena-hrana", label: "Pripravljena hrana", icon: Snowflake },
  { href: "/odpadki-s-kroznikov", label: "Odpadki s krožnikov", icon: Recycle },
  { href: "/meni", label: "Meni", icon: Menu },
  { href: "/dnevni-meni", label: "Dnevni meni", icon: CalendarDays },
  { href: "/malice", label: "Malice", icon: Utensils },
  { href: "/kosila", label: "Kosila", icon: Utensils },
  { href: "/javna-stran", label: "Javna stran", icon: Globe2 },
  { href: "/zaloge", label: "Zaloge", icon: PackageOpen },
  { href: "/odstopanja", label: "Cen. odstopanja", icon: TrendingDown },
  { href: "/uvoz-cenik", label: "Uvoz cenika", icon: Tag },
  { href: "/statistike", label: "Statistike", icon: BarChart3 },
  { href: "/izkaz", label: "Dnevni izkaz", icon: ClipboardList },
  { href: "/realizacija", label: "Realizacija", icon: FileText },
  { href: "/temeljnice", label: "Temeljnice", icon: BookOpen },
  { href: "/izmene", label: "Izmene", icon: Clock },
  { href: "/simulacija", label: "Simulacija", icon: FlaskConical },
  { href: "/nastavitve", label: "Nastavitve", icon: Settings },
  { href: "/rezervacije", label: "Rezervacije miz", icon: CalendarDays },
  { href: "/narocniki", label: "Telefonski naročniki", icon: Users },
  { href: "/dogodki", label: "Dogodki in slavja", icon: CalendarDays },
  { href: "/prirocnik", label: "Priročnik", icon: BookOpen },
];

function NavLink({ href, label, icon: Icon, active, dot, className = "" }: {
  href: string; label: string; icon: React.ElementType; active: boolean; dot?: boolean; className?: string;
}) {
  return (
    <Link
      href={href}
      className={`flex min-h-10 items-center gap-2.5 px-4 py-2 rounded-xl text-[13px] font-medium transition-all ${
        active
          ? "bg-sidebar-accent text-sidebar-accent-foreground"
          : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
      } ${className}`}
    >
      <div className="relative shrink-0">
        <Icon className="h-4 w-4" />
        {dot && (
          <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-purple-500 ring-2 ring-sidebar" />
        )}
      </div>
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

function VoucherDeliveryAlertBanner() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const enotaId = user?.enotaId;
  const isManager = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "");
  const baseKey = getListOpozorilaNeuspeleDostaveBonovQueryKey();
  const queryKey = enotaId ? [...baseKey, enotaId] : baseKey;
  const { data: alerts = [] } = useListOpozorilaNeuspeleDostaveBonov({
    query: {
      queryKey,
      enabled: isManager && !!enotaId,
      refetchInterval: 60_000,
      retry: false,
    },
  });
  const retryDelivery = usePonoviDostavoIndividualnegaBona({
    mutation: {
      onSuccess: () => {
        toast({ title: "Bon je bil uspešno poslan." });
        queryClient.invalidateQueries({ queryKey });
      },
      onError: (error) => {
        toast({
          title: "Ponovna dostava ni uspela",
          description: error instanceof Error ? error.message : "Poskusite znova pozneje.",
          variant: "destructive",
        });
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });
  const alert = alerts[0];
  if (!alert) return null;

  return (
    <div
      className="flex flex-col gap-2 border-b border-red-300 bg-red-50 px-4 py-3 text-red-950 sm:flex-row sm:items-center sm:justify-between"
      data-testid="banner-voucher-delivery-alert"
    >
      <div className="flex min-w-0 items-start gap-2">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-700" />
        <div className="min-w-0 text-sm">
          <p className="font-semibold">
            Plačanega bona za {alert.recipientName} ({alert.recipientEmail}) ni bilo mogoče dostaviti
            {alerts.length > 1 ? ` · še ${alerts.length - 1} odprtih opozoril` : ""}.
          </p>
          <p className="truncate text-xs text-red-800" title={alert.lastError}>
            Zadnja napaka: {alert.lastError}
          </p>
        </div>
      </div>
      <Button
        type="button"
        size="sm"
        variant="destructive"
        className="shrink-0"
        disabled={retryDelivery.isPending}
        onClick={() => retryDelivery.mutate({ checkoutId: alert.checkoutId })}
        data-testid="button-retry-voucher-delivery"
      >
        {retryDelivery.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
        Ponovi pošiljanje
      </Button>
    </div>
  );
}

function HappyHourToggle() {
  const { status, loading, setRocno } = useHappyHour();
  if (!status) return null;
  const { aktiven, od, do: doo, rocno } = status;
  const maUrnik = od && doo;

  const handlePress = () => {
    void setRocno(aktiven ? "off" : "on");
  };

  return (
    <button
      type="button"
      disabled={loading}
      onClick={handlePress}
      title={aktiven ? `Happy Hour AKTIVEN${rocno !== "auto" ? " (ročno)" : ""}` : `Happy Hour${maUrnik ? ` (${od}–${doo})` : " — ni urnika"}`}
      className={`flex min-h-[56px] w-14 shrink-0 cursor-pointer flex-col items-center justify-center gap-0.5 border-l-2 py-2 font-semibold transition-all hover:brightness-95 disabled:cursor-wait disabled:opacity-60 ${
        aktiven
          ? "border-amber-500 bg-amber-100 text-amber-800 shadow-inner"
          : "border-slate-300 bg-slate-100 text-slate-700 hover:border-amber-400 hover:bg-amber-50 hover:text-amber-800"
      }`}
      style={aktiven ? { animation: "none" } : undefined}
    >
      <span className="text-lg leading-none">{aktiven ? "⭐" : "☆"}</span>
      <span className="text-[9px] font-medium leading-tight">HH</span>
    </button>
  );
}

function AboutProgramDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Info className="h-5 w-5 text-primary" />
            O programu
          </DialogTitle>
          <DialogDescription>
            Informacije o razvijalcu in aplikaciji Bookie POS.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-3 rounded-xl border bg-muted/30 p-4">
          <img
            src={MIKRONA_LOGO_URL}
            alt="Mikrona d.o.o."
            className="h-14 w-14 shrink-0 rounded-lg bg-white object-contain"
          />
          <div className="min-w-0">
            <p className="text-base font-semibold leading-tight">Bookie POS Gostinstvo</p>
            <p className="mt-1 text-sm text-muted-foreground">Mikrona d.o.o.</p>
          </div>
        </div>

        <dl className="divide-y rounded-xl border text-sm">
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Razvijalec</dt>
            <dd className="text-right font-medium">Mikrona d.o.o.</dd>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Program</dt>
            <dd className="text-right font-medium">Bookie POS Gostinstvo</dd>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Vrsta</dt>
            <dd className="text-right font-medium">Spletna aplikacija za gostinstvo</dd>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Uporaba</dt>
            <dd className="max-w-[13rem] text-right font-medium">
              Prodaja, računi, izmene, zaloge in poročila
            </dd>
          </div>
          <div className="flex items-start justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Povezave</dt>
            <dd className="max-w-[13rem] text-right font-medium">
              FURS in lokalni tiskalniški mostovi
            </dd>
          </div>
        </dl>

        <p className="text-xs leading-relaxed text-muted-foreground">
          Podatki o aktivnem podjetju, poslovni enoti in blagajni so prikazani
          ločeno v meniju oziroma v nastavitvah POS-a.
        </p>
      </DialogContent>
    </Dialog>
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const [location, navigate] = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const { user, logout } = useAuth();
  const { nastavitve } = useNastavitve();

  const enotaId = user?.enotaId;
  const activePosUnit = hasActivePosUnit(user);
  const keyKdsNastavitve = enotaId ? [...getGetKdsNastavitveQueryKey(), enotaId] : getGetKdsNastavitveQueryKey();
  const { data: kdsNastavitve } = useGetKdsNastavitve({ query: { queryKey: keyKdsNastavitve, enabled: activePosUnit } });

  const [simDatum, setSimDatum] = useState<string | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const v = localStorage.getItem("pos_sidebar_w");
    return v ? Math.max(180, Math.min(420, Number(v))) : 240;
  });

  const handleSidebarResizeStart = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.max(180, Math.min(420, startW + ev.clientX - startX)));
    };
    const onUp = (ev: MouseEvent) => {
      const w = Math.max(180, Math.min(420, startW + ev.clientX - startX));
      localStorage.setItem("pos_sidebar_w", String(w));
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
  };
  const { toast } = useToast();

  useEffect(() => {
    if (!activePosUnit) {
      setSimDatum(null);
      return;
    }
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const fetchSim = () => {
      fetch(`${base}/api/sim`, { credentials: "include" })
        .then(r => r.json())
        .then((d: { active: boolean; datum: string | null }) => setSimDatum(d.active ? d.datum : null))
        .catch(() => {});
    };
    fetchSim();
    const interval = setInterval(fetchSim, 30_000);
    window.addEventListener("focus", fetchSim);
    window.addEventListener("pos:sim-changed", fetchSim);
    return () => {
      clearInterval(interval);
      window.removeEventListener("focus", fetchSim);
      window.removeEventListener("pos:sim-changed", fetchSim);
    };
  }, [activePosUnit, enotaId]);

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
    const naziv = nastavitve?.nazivRestavracije;
    const allNavForTitle = [
      { href: "/", label: "Mize" },
      { href: "/blagajna", label: "Blagajna" },
      { href: "/kuhinja", label: "Kuhinja" },
      { href: "/pice", label: "Pice" },
      { href: "/izdaja", label: "Izdaja" },
      { href: "/tocilnica", label: "Točilnica" },
      { href: "/pripravljena-hrana", label: "Pripravljena hrana" },
      { href: "/odpadki-s-kroznikov", label: "Odpadki s krožnikov" },
      { href: "/meni", label: "Meni" },
      { href: "/dnevni-meni", label: "Dnevni meni" },
      { href: "/malice", label: "Malice" },
      { href: "/kosila", label: "Kosila" },
      { href: "/javna-stran", label: "Javna stran" },
      { href: "/zaloge", label: "Zaloge" },
      { href: "/odstopanja", label: "Cen. odstopanja" },
      { href: "/racuni", label: "Računi" },
      { href: "/statistike", label: "Statistike" },
      { href: "/operativna-porocila", label: "Operativna poročila" },
      { href: "/realizacija", label: "Realizacija" },
      { href: "/temeljnice", label: "Temeljnice" },
      { href: "/izmene", label: "Izmene" },
      { href: "/obracun-ur", label: "Obračun ur" },
      { href: "/partnerji", label: "Partnerji" },
      { href: "/stroskovana-mesta", label: "Stroškovna mesta" },
      { href: "/kontni-plan", label: "Kontni plan" },
       { href: "/konti-za-temeljnice", label: "Konti za temeljnice" },
      { href: "/nastavitve", label: "Nastavitve" },
      { href: "/prirocnik", label: "Priročnik" },
      { href: "/nastavitve?tab=uporabniki", label: "Uporabniki" },
      { href: "/narocilo/", label: "Naročilo" },
      { href: "/simulacija", label: "Simulacija" },
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
  const activeCapabilities = new Set<UnitCapability>(
    (user?.capabilities ?? []) as UnitCapability[],
  );
  const canShowNav = (href: string) => {
    if (isSuperAdmin) return true;
    if (href === "/nastavitve" && (isAdmin || isAdminEnote)) return true;
    const anyOf = NAV_ANY_CAPABILITY_BY_PATH[href];
    if (anyOf) return anyOf.some(c => activeCapabilities.has(c));
    const capability = NAV_CAPABILITY_BY_PATH[href];
    return capability ? activeCapabilities.has(capability) : true;
  };
  useEffect(() => {
    if (!user || canAccessPosRoute(location, (user.capabilities ?? []) as UnitCapability[], user.vloga)) return;
    toast({
      title: user.enotaId ? "Funkcija v tej enoti ni omogočena" : "Ni izbrane aktivne poslovne enote",
      description: user.enotaId
        ? "Prikaz je prilagojen profilu in izbranim funkcijam aktivne poslovne enote."
        : "V Nastavitvah najprej nastavite oziroma izberite poslovno enoto.",
      variant: "destructive",
    });
    navigate("/nastavitve", { replace: true });
  }, [location, navigate, user?.vloga, user?.enotaId, user?.capabilities, toast]);
  const visiblePrimaryNav = primaryNav.filter(item => canShowNav(item.href));

  const allNav = (isSuperAdmin ? [
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    { href: "/prirocnik", label: "Priročnik", icon: BookOpen },
    { href: "/superadmin", label: "Super-admin", icon: ShieldCheck },
  ] : [
    { href: "/", label: "Mize", icon: Home },
    { href: "/blagajna", label: "Blagajna", icon: Wallet },
    { href: "/izmene", label: "Izmene", icon: Clock },
    { href: "/racuni", label: "Računi", icon: Receipt },
    { href: "/tocilnica", label: "Točilnica", icon: GlassWater },
    { href: "/kuhinja", label: "Kuhinja", icon: ChefHat },
    ...(kdsNastavitve?.profil === "bar_separate_kitchen_pizza" ? [{ href: "/pice", label: "Pice", icon: ChefHat }] : []),
    ...(kdsNastavitve?.dispatchOmogocen ? [{ href: "/izdaja", label: "Izdaja", icon: CheckSquare }] : []),
    { href: "/pripravljena-hrana", label: "Pripravljena hrana", icon: Snowflake },
    { href: "/odpadki-s-kroznikov", label: "Odpadki s krožnikov", icon: Recycle },
    { href: "/meni", label: "Meni", icon: Menu },
    ...(isAdmin || isAdminEnote ? [{ href: "/dnevni-meni", label: "Dnevni meni", icon: CalendarDays }] : []),
    { href: "/malice", label: "Malice", icon: Utensils },
    { href: "/kosila", label: "Kosila", icon: Utensils },
    ...(isAdmin || isAdminEnote ? [{ href: "/javna-stran", label: "Javna stran", icon: Globe2 }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/qr-meni", label: "QR meni", icon: QrCode }] : []),
    { href: "/zaloge", label: "Zaloge", icon: PackageOpen },
    { href: "/statistike", label: "Statistike", icon: BarChart3 },
    ...(isAdmin || isAdminEnote ? [{ href: "/operativna-porocila", label: "Operativna poročila", icon: Activity }] : []),
    { href: "/realizacija", label: "Realizacija", icon: FileText },
    { href: "/temeljnice", label: "Temeljnice", icon: BookOpen },
    { href: "/blagajniski-premiki", label: "Blagajniški premiki", icon: Banknote },
    { href: "/rezervacije", label: "Rezervacije miz", icon: CalendarDays },
    { href: "/dogodki", label: "Dogodki in slavja", icon: CalendarDays },
    ...(isAdmin || isAdminEnote ? [{ href: "/obracun-ur", label: "Obračun ur", icon: ClipboardList }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/simulacija", label: "Simulacija", icon: FlaskConical }] : []),
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    { href: "/prirocnik", label: "Priročnik", icon: BookOpen },
    ...(isAdmin ? [{ href: "/admin/testi", label: "Testi", icon: FlaskConical }] : []),
  ]).filter(item => canShowNav(item.href));

  const mobileSecondaryNav = (isSuperAdmin ? [
    { href: "/nastavitve", label: "Nastavitve", icon: Settings },
    { href: "/superadmin", label: "Super-admin", icon: ShieldCheck },
  ] : [
    // Kuhinja je bila v primarni vrstici — zdaj na vrhu "Več"
     // (Računi in Izmene so zdaj v primarni vrstici)
    { href: "/kuhinja", label: "Kuhinja", icon: ChefHat },
    ...(kdsNastavitve?.profil === "bar_separate_kitchen_pizza" ? [{ href: "/pice", label: "Pice", icon: ChefHat }] : []),
    ...(kdsNastavitve?.dispatchOmogocen ? [{ href: "/izdaja", label: "Izdaja", icon: CheckSquare }] : []),
     // Preostalo (brez Izmene in Računi, ki so zdaj v primarni vrstici)
     ...secondaryNav.filter(i => i.href !== "/izmene" && i.href !== "/racuni"),
    ...(isAdmin || isAdminEnote ? [{ href: "/dnevni-meni", label: "Dnevni meni", icon: CalendarDays }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/qr-meni", label: "QR meni", icon: QrCode }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/javna-stran", label: "Javna stran", icon: Globe2 }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/operativna-porocila", label: "Operativna poročila", icon: Activity }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/obracun-ur", label: "Obračun ur", icon: ClipboardList }] : []),
    ...(isAdmin || isAdminEnote ? [{ href: "/simulacija", label: "Simulacija", icon: FlaskConical }] : []),
    ...(isAdmin ? [{ href: "/admin/testi", label: "Testi", icon: FlaskConical }] : []),
  ]).filter(item => canShowNav(item.href));

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
    <div className="flex h-dvh w-full overflow-hidden bg-background font-sans text-foreground">
      {!isOrderPage && (
        <aside className="hidden md:flex flex-col border-r bg-sidebar text-sidebar-foreground shadow-md overflow-hidden relative" style={{ width: sidebarWidth, flexShrink: 0 }}>
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="shrink-0 p-3 border-b border-sidebar-border/50 text-red-600">
              <div className="flex items-center gap-2.5">
                <img src={MIKRONA_LOGO_URL} alt="Mikrona d.o.o." className="h-10 w-10 shrink-0 rounded-md object-contain bg-white" />
                <div className="min-w-0">
                  <h1 className="text-base font-bold tracking-tight">POS Gostinstvo</h1>
                  <p className="text-[10px] text-sidebar-foreground/60 leading-tight">Mikrona d.o.o.</p>
                </div>
              </div>
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
            <div className="scrollbar-hidden min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <nav className="py-3 px-2 flex flex-col gap-1">
                {allNav.map(item => (
                  <NavLink
                    key={item.href}
                    href={item.href}
                    label={item.label}
                    icon={item.icon}
                    active={isActive(item.href)}
                    dot={item.href === "/simulacija" && simDatum !== null}
                  />
                ))}
              </nav>

              {/* ── Šifranti — skupni blok (vidno vsem POS vlogam; dev + produkcija) ── */}
              {!isSuperAdmin && <SifrantiSidebar vloga={user?.vloga ?? ""} />}
            </div>

            <div className="shrink-0 p-2 border-t border-sidebar-border/50 text-red-600">
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

          {/* ── Resize handle ─────────────────────────────────────────── */}
          <div
            className="absolute inset-y-0 right-0 w-2 cursor-col-resize z-20 group/rh"
            onMouseDown={handleSidebarResizeStart}
          >
            <div className="absolute inset-y-0 right-0 w-px bg-sidebar-border/0 group-hover/rh:bg-sidebar-border transition-colors duration-150" />
          </div>
        </aside>
      )}

      <main className="flex-1 min-h-0 min-w-0 flex flex-col overflow-y-auto overflow-x-hidden pb-16 md:pb-0">
        {activePosUnit && <>
          <CertExpiryBanner />
          <FursNapakaRetryBanner />
          <VoucherDeliveryAlertBanner />
          <OfflineFiscalQueueStatus />
          <LocalGatewayStatusBanner />
        </>}
        {!isSuperAdmin && <CtiDohodniKlicPopup />}
        {simDatum && !isCheckoutPage && (
          <Link href="/simulacija" className="block">
            <div className="flex items-center justify-between px-4 py-2 bg-purple-700 text-white text-xs font-medium hover:bg-purple-800 transition-colors cursor-pointer">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-3.5 h-3.5 shrink-0" />
                <span>
                  Simulacijski način —{" "}
                  {new Intl.DateTimeFormat("sl-SI", { day: "numeric", month: "long", year: "numeric" }).format(new Date(simDatum))}
                </span>
              </div>
              <span className="opacity-70 text-[10px] tracking-wide">Klikni za upravljanje →</span>
            </div>
          </Link>
        )}
        {!isSuperAdmin && nastavitve?.nazivRestavracije && (
          <div className="flex items-center justify-center px-4 py-1.5 bg-background/80 backdrop-blur-sm border-b border-border/40">
            <Link href="/nastavitve" className="text-xs font-medium text-muted-foreground/70 tracking-wide truncate hover:text-foreground hover:underline transition-colors">
              {nastavitve.nazivRestavracije}
            </Link>
          </div>
        )}
      <div className="pos-page-content flex-1 min-h-0 min-w-0 flex flex-col">
        {children}
      </div>
      {activePosUnit && <PosSyncStatus />}
      {activePosUnit && <QuickSwitch />}
      </main>

      <nav className="fixed bottom-0 left-0 right-0 z-50 flex md:hidden bg-background border-t safe-area-inset-bottom">
          {visiblePrimaryNav.map(item => (
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
          {activePosUnit && <HappyHourToggle />}

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
            <SheetContent
              side="bottom"
              data-pos-mobile-more-menu
              className="rounded-t-2xl flex h-[85dvh] max-h-[85dvh] flex-col p-0"
            >
              {/* Potegni ročaj */}
              <div className="flex justify-center pt-3 pb-1 shrink-0">
                <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
              </div>
              {/* Glava: naslov + odjava v isti vrstici */}
              <div className="shrink-0 flex items-center justify-between px-6 pb-3">
                <SheetHeader className="p-0">
                  <SheetTitle className="text-left">Meni</SheetTitle>
                </SheetHeader>
                <button
                  onClick={() => { setMoreOpen(false); void logout(); }}
                  className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-sm font-medium text-muted-foreground hover:bg-muted active:bg-muted/70 transition-colors"
                >
                  <LogOut className="h-4 w-4 shrink-0" />
                  <span className="max-w-[7rem] truncate">{user?.ime ?? user?.username}</span>
                </button>
              </div>
              {/* Pomikljiva vsebina */}
              <div className="overflow-y-auto flex-1 px-6 pb-2">

                {/* Enota in blagajna — na mobilnih napravah ni sidebara */}
                {(isAdmin || isAdminEnote) && !isSuperAdmin && (
                  <div
                    className="mb-4 pb-4 border-b space-y-1.5"
                    style={{
                      "--sidebar-foreground": "var(--foreground)",
                      "--sidebar-accent": "var(--muted)",
                      "--sidebar-accent-foreground": "var(--foreground)",
                      "--sidebar-border": "var(--border)",
                    } as React.CSSProperties}
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">Enota</p>
                    {isAdmin ? <EnotaSwitcher /> : <AdminEnotaStaticInfo />}
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1 pt-1">Blagajna</p>
                    <BlagajnaSwitcher />
                  </div>
                )}

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
                  <button
                    type="button"
                    onClick={() => {
                      setMoreOpen(false);
                      setAboutOpen(true);
                    }}
                    className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <Info className="h-6 w-6" />
                    <span className="text-center text-xs font-medium">O programu</span>
                  </button>
                </div>
                {!isSuperAdmin && nastavitve?.nazivRestavracije && (
                  <div className="mt-3 pt-3 border-t">
                    <p className="text-xs text-muted-foreground leading-snug">{nastavitve.nazivRestavracije}</p>
                    {nastavitve.davcnaStevilka && (
                      <p className="text-[11px] text-muted-foreground/60 mt-0.5">ID: {nastavitve.davcnaStevilka}</p>
                    )}
                  </div>
                )}
              </div>
              {/* Fiksen gumb za zapiranje na dnu */}
              <div className="shrink-0 px-6 py-3 border-t bg-background">
                <button
                  onClick={() => setMoreOpen(false)}
                  className="w-full flex items-center justify-center gap-2 py-2.5 rounded-xl bg-muted text-sm font-medium text-muted-foreground active:bg-muted/70"
                >
                  <X className="h-4 w-4" />
                  Zapri
                </button>
              </div>
            </SheetContent>
          </Sheet>
        </nav>
        {activePosUnit && <AgentLauncher />}
        <AboutProgramDialog open={aboutOpen} onOpenChange={setAboutOpen} />
    </div>
  );
}

// Preusmeritev superadmina je centralizirana v AuthGate (sinhrono varovalo).
// HomeGuard se ne bi smel nikoli izrisati za superadmina — return null je samo
// zadnja varnostna mreža v primeru nepričakovanega remount.
function HomeGuard() {
  const { user } = useAuth();

  if (user?.vloga === "superadmin") return null;
  return <HomePage />;
}

// Nevtralen zaslon med DNS/TCP nalaganjem /admin — brez POS Layout, sidebara ali headerja.
function PreusmeritevZaslon() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-muted-foreground text-sm">Preusmerjanje…</div>
    </div>
  );
}

function NalagamStran() {
  return (
    <div className="flex min-h-64 items-center justify-center text-sm text-muted-foreground">
      Nalagam stran…
    </div>
  );
}

function RealtimeSync() {
  useRealtimeSync();
  return null;
}

export function PosPageRoutes() {
  return (
        <Suspense fallback={<NalagamStran />}>
          <Switch>
          <Route path="/" component={HomeGuard} />
          <Route path="/prirocnik" component={PrirocnikPage} />
          <Route path="/narocilo/:id" component={OrderPage} />
          <Route path="/blagajna" component={CheckoutPage} />
          <Route path="/meni" component={MenuPage} />
          <Route path="/dnevni-meni" component={DnevniMeniPage} />
          <Route path="/malice" component={MalicePage} />
          <Route path="/kosila" component={KosilaPage} />
          <Route path="/javna-stran" component={JavnaStranPage} />
          <Route path="/qr-meni" component={QrAdministracijaPage} />
          <Route path="/pripravljena-hrana" component={PreparedFoodPage} />
          <Route path="/odpadki-s-kroznikov" component={PlateWastePage} />
          <Route path="/racuni" component={ReceiptsPage} />
          <Route path="/statistike" component={StatsPage} />
          <Route path="/operativna-porocila" component={OperativnaPorocilaPage} />
          <Route path="/izkaz" component={DnevniIzkazPage} />
          <Route path="/realizacija" component={RealizacijaPage} />
          <Route path="/temeljnice" component={TemeljnicePage} />
          <Route path="/blagajniski-premiki" component={BlagajniskiPremikiPage} />
          <Route path="/rezervacije" component={RezervacijePage} />
          <Route path="/dogodki" component={EventsPage} />
          <Route path="/kuhinja">{() => <KdsStationPage station="kitchen" />}</Route>
          <Route path="/pice">{() => <KdsStationPage station="pizza" />}</Route>
          <Route path="/izdaja" component={IzdajaPage} />
          <Route path="/tocilnica">{() => <KdsStationPage station="bar" />}</Route>
          <Route path="/izmene" component={IzmenePage} />
          <Route path="/obracun-ur" component={ObracunUrPage} />
          <Route path="/zaloge" component={ZalogePage} />
          <Route path="/odstopanja" component={OdstopanjaPage} />
          <Route path="/uvoz-cenik" component={UvozCenikPage} />
          <Route path="/simulacija" component={SimulacijaPage} />
          <Route path="/partnerji" component={PartnerjiPage} />
          <Route path="/narocniki" component={NarocnikiPage} />
          <Route path="/stroskovana-mesta" component={StroskovnaMestaPage} />
          <Route path="/kontni-plan" component={KontniPlanPage} />
          <Route path="/konti-za-temeljnice" component={KontiZaTemeljnicePage} />
          <Route path="/nastavitve" component={SettingsPage} />
          <Route path="/admin/testi" component={TestniZagoniPage} />
          <Route path="/superadmin" component={SuperAdminPage} />
          <Route path="/superadmin/eposta" component={SuperAdminPage} />
          <Route path="/superadmin/backup" component={SuperAdminPage} />
          <Route path="/superadmin/profil" component={SuperAdminPage} />
          <Route path="/superadmin/testi" component={SuperAdminPage} />
          <Route component={NotFound} />
          </Switch>
        </Suspense>
  );
}

export function PosOperationalProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.vloga === "superadmin") return <>{children}</>;
  return (
    <GatewayOfflineProvider>
      <BlagajnaProvider>
        <HappyHourProvider>{children}</HappyHourProvider>
      </BlagajnaProvider>
    </GatewayOfflineProvider>
  );
}

export function PosDeviceProviders({ children }: { children: React.ReactNode }) {
  const { user } = useAuth();
  if (user?.vloga === "superadmin") return <>{children}</>;
  return (
    <>
      <RealtimeSync />
      <NapravaProvider>
        <AutoStartProvider>
          <ZamenjajGesloOverlay />
          {children}
        </AutoStartProvider>
      </NapravaProvider>
    </>
  );
}

function ProtectedRouter() {
  return (
    <NastavitveProvider>
      <PosDeviceProviders>
        <Layout>
          <PosPageRoutes />
        </Layout>
      </PosDeviceProviders>
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
    <div className="min-h-screen flex flex-col items-center justify-center gap-5 bg-background px-4">
      <div className="flex items-center gap-3 text-foreground">
        <img src={MIKRONA_LOGO_URL} alt="Mikrona d.o.o." className="h-12 w-12 object-contain" />
        <div>
          <p className="text-base font-semibold leading-tight">Mikrona d.o.o.</p>
          <p className="text-xs text-muted-foreground">Bookie POS Gostinstvo</p>
        </div>
      </div>
      <SignIn routing="hash" />
    </div>
  );
}

export function PosAuthProblem({
  status,
  onLogout,
}: {
  status: Extract<PosAuthStatus, "unauthorized" | "forbidden" | "error">;
  onLogout: () => void | Promise<void>;
}) {
  const forbidden = status === "forbidden";
  const unauthorized = status === "unauthorized";
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border bg-card p-7 text-center shadow-sm">
        <img src={MIKRONA_LOGO_URL} alt="Mikrona d.o.o." className="mx-auto mb-4 h-12 w-12 object-contain" />
        <ShieldCheck className="mx-auto mb-3 h-9 w-9 text-muted-foreground" aria-hidden="true" />
        <h1 className="text-xl font-semibold text-foreground">
          {forbidden ? "Nimate dostopa do POS sistema" : unauthorized ? "Prijavna seja ni več veljavna" : "POS trenutno ni dosegljiv"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {forbidden
            ? "Prijavljeni ste, vendar vaš račun nima aktivne POS-vloge. Za dostop se obrnite na skrbnika podjetja."
            : unauthorized
              ? "Za nadaljevanje se odjavite in ponovno prijavite."
              : "Podatkov o vaši POS-vlogi trenutno ni mogoče pridobiti. Poskusite znova čez nekaj trenutkov."}
        </p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-center">
          {status === "error" && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              Poskusi znova
            </Button>
          )}
          <Button onClick={() => void onLogout()}>
            <LogOut className="mr-2 h-4 w-4" />
            Odjava in menjava računa
          </Button>
        </div>
      </div>
    </div>
  );
}

export function AuthGate() {
  const { user, loading, authStatus, logout } = useAuth();
  const [location, setLocation] = useLocation();
  const needsPlatformRedirect = user?.vloga === "superadmin"
    && location !== "/superadmin" && !location.startsWith("/superadmin/");

  // Platformni kontekst nima operativnih POS providerjev. Tudi star POS URL
  // ali sprememba vloge med sejo mora zato ostati na platformnih straneh.
  useEffect(() => {
    if (loading || !user) return;
    if (needsPlatformRedirect) {
      window.location.replace(`${basePath}/superadmin`);
    } else if (location === "/login") {
      setLocation("/");
    }
  }, [user, loading, location, setLocation, needsPlatformRedirect]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-muted-foreground text-sm">Nalagam...</div>
      </div>
    );
  }

  // Sinhrono varovalo — steče MED renderom, preden POS Layout dobi priložnost za izris.
  // window.location.replace znotraj renderja je nameren "escape iz Reacta" za navigacijo;
  // PreusmeritevZaslon zagotovi, da brskalnik ne naslika ničesar iz POS-a.
  if (needsPlatformRedirect) {
    window.location.replace(`${basePath}/superadmin`);
    return <PreusmeritevZaslon />;
  }

  if (!user && (authStatus === "forbidden" || authStatus === "unauthorized" || authStatus === "error")) {
    return <PosAuthProblem status={authStatus} onLogout={logout} />;
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
  if (!clerkPubKey) throw new Error("Manjka VITE_CLERK_PUBLISHABLE_KEY");
  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      afterSignOutUrl="/"
      signInFallbackRedirectUrl="/pos/"
    >
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <GotovToastProvider>
            <AuthProvider>
              <PosOperationalProviders>
                    <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
                      <AppRouter />
                    </WouterRouter>
              </PosOperationalProviders>
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
