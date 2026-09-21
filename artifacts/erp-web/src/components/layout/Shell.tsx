import React, { useEffect, useState, useRef, useCallback } from "react";
import { Link, useLocation } from "wouter";
import { 
  Building2, 
  LayoutDashboard, 
  BookOpen,
  BookMarked,
  FileText, 
  Users, 
  Truck, 
  Receipt, 
  CreditCard,
  Banknote,
  BarChart3, 
  Settings,
  LogOut,
  ChevronRight,
  ChevronDown,
  User as UserIcon,
  Menu,
  ShieldAlert,
  Calendar,
  ScanLine,
  Layers,
  PieChart,
  UtensilsCrossed,
  PackageOpen,
  Landmark,
  Tag,
  TrendingDown,
  MapPin,
} from "lucide-react";
import { useClerk, useUser, useAuth } from "@clerk/react";
import { useGetMe, useListCompanies, getAuthToken } from "@workspace/api-client-react";
import type { CompanyWithRole } from "@workspace/api-client-react";
import { useQuery } from "@tanstack/react-query";

// Extend UserProfile to include isSuperAdmin from our /me endpoint
type UserProfileExtended = { isSuperAdmin?: boolean };
import { useCompany } from "@/contexts/CompanyContext";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const MIKRONA_LOGO_URL = `${import.meta.env.BASE_URL}mikrona-logo.png`;

// null = vedno vidno; 'erp'/'pos' = zahteva aktiven modul
// Šifranti (Partnerji, StM, Kontni plan) so ODSTRANJENI iz GLK — so v SIFRANT_MODULES
const MODULES: { name: string; path: string; icon: React.ElementType; requires: "erp" | "pos" | null }[] = [
  { name: "Pregled", path: "/dashboard", icon: LayoutDashboard, requires: "erp" as const },
  { name: "Računovodska obdobja", path: "/obdobja", icon: Calendar, requires: "erp" },
  { name: "Temeljnice", path: "/temeljnice", icon: FileText, requires: "erp" },
  { name: "Glavna knjiga", path: "/glavna-knjiga", icon: BookMarked, requires: "erp" },
  { name: "Računi", path: "/racuni", icon: Receipt, requires: "erp" },
  { name: "Prejemnice", path: "/prejemnice", icon: PackageOpen, requires: "erp" },
  { name: "AI Dokumenti", path: "/dokumenti", icon: ScanLine, requires: "erp" },
  { name: "Plačila", path: "/placila", icon: CreditCard, requires: "erp" },
  { name: "Uvoz izpiskov", path: "/bancni-izpis", icon: Banknote, requires: "erp" },
  { name: "Saldakonti", path: "/saldakonti", icon: BarChart3, requires: "erp" },
  { name: "DDV evidence", path: "/ddv", icon: Receipt, requires: "erp" },
  { name: "Dimenzije", path: "/dimenzije", icon: Layers, requires: "erp" },
  { name: "Poročila", path: "/porocila", icon: BarChart3, requires: "erp" },
  { name: "Analitika", path: "/porocila/dimenzije", icon: PieChart, requires: "erp" },
  { name: "Obračun ur", path: "/porocila/obracun-ur", icon: Users, requires: "erp" },
];

/** Šifranti — skupni za vse module (GLK, OS, POS).
 *  Pravice urejanja: partnerji = vsi; stm/kontni plan = vsi razen POS-only. */
const SIFRANT_MODULES: { name: string; path: string; icon: React.ElementType }[] = [
  { name: "Poslovni partnerji", path: "/partnerji", icon: Users },
  { name: "Stroškovna mesta", path: "/stroskovana-mesta", icon: MapPin },
  { name: "Kontni plan", path: "/kontni-plan", icon: BookOpen },
];

const OS_MODULES: { name: string; path: string; icon: React.ElementType }[] = [
  { name: "Register OS", path: "/osnovna-sredstva", icon: Landmark },
  { name: "Amort. skupine", path: "/amortizacijske-skupine", icon: Tag },
  { name: "Amort. obračun", path: "/amortizacijski-obracun", icon: TrendingDown },
];

const SETTINGS_MODULES = [
  { name: "Nastavitve", path: "/nastavitve", icon: Settings },
];

/** Vse znane poti modulov — za reševanje active-state trka (npr. /porocila vs /porocila/dimenzije). */
const ALL_MODULE_PATHS = new Set([
  ...MODULES.map((m) => m.path),
  ...["Register OS", "Amort. skupine", "Amort. obračun"].map((_, i) =>
    ["/osnovna-sredstva", "/amortizacijske-skupine", "/amortizacijski-obracun"][i],
  ),
  ...SIFRANT_MODULES.map((m) => m.path),
  ...SETTINGS_MODULES.map((m) => m.path),
  "/admin",
]);

/** Modul je aktiven, če je lokacija točno na tej poti ALI na podpoti —
 *  razen če je bolj specifičen modul (daljša pot) prav tako aktiven. */
function isModuleActive(modulePath: string, location: string): boolean {
  if (location === modulePath) return true;
  if (modulePath === "/dashboard") return false; // Dashboard: samo točno ujemanje
  if (!location.startsWith(modulePath + "/")) return false;
  // Ne označi kot aktiven, če je kakšen bolj specifičen znani modul aktiven
  for (const knownPath of ALL_MODULE_PATHS) {
    if (knownPath !== modulePath && knownPath.length > modulePath.length && location.startsWith(knownPath)) {
      return false;
    }
  }
  return true;
}

interface AdminCompanyForSwitcher {
  id: string;
  podjetjeDavcna: string;
  naziv: string;
  kratekNaziv: string | null;
  naslov?: string | null;
  postnaStevika?: string | null;
  kraj?: string | null;
  createdAt: string;
  modules: string[];
  userCount: number;
}

interface AdminCompaniesResponse {
  companies: AdminCompanyForSwitcher[];
}

type SwitcherCompany = CompanyWithRole & {
  modules?: string[];
  osRole?: string | null;
};

export function CompanySwitcher() {
  const { activeCompany, setActiveCompany } = useCompany();
  const { user, isLoaded } = useUser();
  const { data: accessData } = useListCompanies();
  const { data: me } = useGetMe({
    query: {
      enabled: isLoaded && !!user?.id,
      queryKey: ["/api/me"],
    },
  });
  const isSuperAdmin = !!(me as unknown as UserProfileExtended)?.isSuperAdmin;
  const [menuOpen, setMenuOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: adminData } = useQuery<AdminCompaniesResponse>({
    queryKey: ["/api/admin/companies", "switcher"],
    queryFn: async () => {
      const token = await getAuthToken();
      const headers = new Headers();
      if (token) headers.set("Authorization", `Bearer ${token}`);
      const response = await fetch("/api/admin/companies", {
        headers,
        credentials: "include",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<AdminCompaniesResponse>;
    },
    enabled: isSuperAdmin,
    staleTime: 30_000,
  });

  // GET /api/admin/companies je na strežniku zaščiten z requireSuperAdmin.
  // Ob napaki ne uporabljamo širšega seznama kot fallback.
  const companies: SwitcherCompany[] = isSuperAdmin
    ? (adminData?.companies ?? []).map((company) => ({
        ...company,
        employerControlledTipsEnabled: false,
        // Za tip aktivnega podjetja; dejanska pravica je strežniška superadmin zaščita.
        role: "owner" as const,
      }))
    : (accessData?.companies ?? []);

  // Ko se seznam podjetij osveži (npr. admin doda modul), posodobi activeCompany
  useEffect(() => {
    if (!activeCompany) return;
    if (!isSuperAdmin && accessData === undefined) return;
    if (isSuperAdmin && adminData === undefined) return;
    const fresh =
      companies.find((c) => c.id === activeCompany.id && !(c.role as string).startsWith("pos_")) ??
      companies.find((c) => c.id === activeCompany.id);
    if (!fresh) {
      if (!(activeCompany.role as string).startsWith("pos_")) {
        setActiveCompany(null);
      }
      return;
    }
    const currentJson = JSON.stringify(activeCompany);
    const freshJson = JSON.stringify(fresh);
    if (currentJson !== freshJson) setActiveCompany(fresh);
  }, [accessData, adminData, isSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleLabel = (role: string) => ({
    owner: "Lastnik", accountant: "Računovodja", viewer: "Pregledovalec",
    os_admin: "OS Admin", os_user: "OS Upravljalec", os_viewer: "OS Pregledovalec",
  })[role as string] ?? role;

  // Podjetja za preklop: samo ne-POS vnosi (ERP/OS), brez trenutno aktivnega
  const switchable = companies.filter(
    (c) => !(c.role as string).startsWith("pos_") && c.id !== activeCompany?.id
  );
  const filteredSwitchable = switchable.filter((company) => {
    const needle = search.trim().toLocaleLowerCase("sl-SI");
    if (!needle) return true;
    return `${company.naziv} ${company.kratekNaziv ?? ""} ${company.podjetjeDavcna}`
      .toLocaleLowerCase("sl-SI")
      .includes(needle);
  });

  const displayBlock = (
    <div className="flex items-center gap-3 w-full">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground">
        <Building2 className="h-4 w-4" />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <span className="font-semibold text-sm leading-tight truncate tracking-tight text-sidebar-foreground">
          {activeCompany?.kratekNaziv ?? activeCompany?.naziv ?? "Ni podjetja"}
        </span>
        {activeCompany && (
          <span className="text-[10px] text-sidebar-foreground/60 uppercase tracking-widest font-medium">
            {roleLabel(activeCompany.role)}
          </span>
        )}
      </div>
      {switchable.length > 0 && (
        <ChevronDown className="h-4 w-4 text-sidebar-foreground/50 shrink-0" />
      )}
    </div>
  );

  // Samo eno podjetje → statičen prikaz, brez dropdown
  if (switchable.length === 0) {
    return <div className="p-2 -mx-2">{displayBlock}</div>;
  }

  // Več podjetij → preprost preklop (samo seznam, brez upravljanja)
  return (
    <DropdownMenu
      open={menuOpen}
      onOpenChange={(open) => {
        setMenuOpen(open);
        if (!open) setSearch("");
      }}
    >
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 w-full p-2 -mx-2 rounded-md hover:bg-sidebar-accent/50 transition-colors text-left group outline-none">
          {displayBlock}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-72">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Preklopi podjetje</DropdownMenuLabel>
        <div className="px-2 pb-1">
          <input
            aria-label="Išči podjetje"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
            placeholder="Išči podjetje…"
            className="flex h-8 w-full rounded-md border border-input bg-background px-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        <DropdownMenuSeparator />
        {filteredSwitchable.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => setActiveCompany(c)}
            className="cursor-pointer"
          >
            <div className="flex flex-col">
              <span className="font-medium">{c.naziv}</span>
              <span className="text-xs text-muted-foreground">{roleLabel(c.role)}</span>
            </div>
          </DropdownMenuItem>
        ))}
        {filteredSwitchable.length === 0 && (
          <div className="px-2 py-4 text-center text-sm text-muted-foreground">
            Ni najdenega podjetja.
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Tip aktivnega modula — določa kateri sidebar meni je prikazan. */
type ActiveModuleView = "glk" | "os" | "pos";
const ACTIVE_MODULE_KEY = "erp-active-module";

/** Iz poti določi, kateri modul je definitivno aktiven.
 *  Vrne null za šifrante in sistem (ohrani obstoječi kontekst). */
function moduleFromPath(path: string): ActiveModuleView | null {
  if (
    path.startsWith("/osnovna-sredstva") ||
    path.startsWith("/amortizacijske-skupine") ||
    path.startsWith("/amortizacijski-obracun")
  ) return "os";

  const glkPaths = [
    "/dashboard", "/obdobja", "/temeljnice", "/glavna-knjiga",
    "/racuni", "/prejemnice", "/dokumenti", "/placila",
    "/bancni-izpis", "/saldakonti", "/ddv", "/dimenzije", "/porocila",
  ];
  if (glkPaths.some((p) => path === p || path.startsWith(p + "/"))) return "glk";

  return null; // šifranti, sistem, neznana pot → ohrani kontekst
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const { activeCompany } = useCompany();
  const { data: me } = useGetMe({ query: { enabled: isLoaded && !!user?.id, queryKey: ["/api/me"] } });
  const isSuperAdmin = !!(me as unknown as UserProfileExtended)?.isSuperAdmin;

  // Aktivni moduli podjetja (iz razširjenega tipa CompanyWithRole)
  const activeModules: string[] = (activeCompany as (typeof activeCompany & { modules?: string[] }))?.modules ?? [];
  // OS vloga tega uporabnika za aktivno podjetje (null = ni OS dostopa)
  const osRole: string | null = (activeCompany as (typeof activeCompany & { osRole?: string | null }))?.osRole ?? null;
  // ERP uporabnik: ima accounting_roles vlogo (ne OS-only, ne POS-only).
  // Superadmin ima lahko tehnično vlogo owner zaradi začetne nastavitve ERP,
  // vendar ta vloga sama po sebi ne sme odpreti računovodskega menija.
  const isErpUser = !isSuperAdmin && ["owner", "accountant", "viewer"].includes(activeCompany?.role ?? "");
  // POS uporabnik: vloga začne z "pos_"
  const isPosUser = (activeCompany?.role ?? "").startsWith("pos_");
  // Katerakoli vloga v podjetju → prikaži šifrante
  const hasAnyRole = isErpUser || osRole !== null || isPosUser;

  // Katere module sploh ima ta uporabnik
  const hasGlk = isErpUser && activeModules.includes("erp");
  const hasOs  = osRole !== null && activeModules.includes("osnovna_sredstva");
  const hasPos = isPosUser && activeModules.includes("pos");

  // Privzeti modul: GLK > OS > POS
  const defaultModule: ActiveModuleView = hasGlk ? "glk" : hasOs ? "os" : "pos";

  // ── Aktivni modul (pogledi) ──────────────────────────────────────────────
  const [activeModuleView, setActiveModuleViewState] = useState<ActiveModuleView>(() => {
    try {
      const saved = sessionStorage.getItem(ACTIVE_MODULE_KEY) as ActiveModuleView | null;
      if (saved === "glk" && hasGlk) return "glk";
      if (saved === "os" && hasOs) return "os";
      if (saved === "pos" && hasPos) return "pos";
    } catch { /* ni sessionStorage */ }
    return defaultModule;
  });

  const setActiveModuleView = (v: ActiveModuleView) => {
    setActiveModuleViewState(v);
    try { sessionStorage.setItem(ACTIVE_MODULE_KEY, v); } catch { /* / */ }
  };

  // Sinhronizacija: ko se pot spremeni na definitivno GLK/OS pot → posodobi view
  useEffect(() => {
    const detected = moduleFromPath(location);
    if (detected && detected !== activeModuleView) {
      setActiveModuleView(detected);
    }
  }, [location]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filtriramo GLK vnose (samo za GLK pogled)
  const glkModules = MODULES.filter((m) => {
    if (m.requires === "erp") return hasGlk;
    return false;
  }).filter((m) => m.path !== "/porocila/obracun-ur" || ["owner", "accountant"].includes(activeCompany?.role ?? ""));

  // Custom navigation handler
  const navigate = (path: string) => { setLocation(path); };

  return (
    <Sidebar className="border-r border-sidebar-border shadow-sm">
      <SidebarHeader className="h-auto py-3 px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2.5 pb-3 mb-3 border-b border-sidebar-border/70">
          <img
            src={MIKRONA_LOGO_URL}
            alt="Mikrona d.o.o."
            className="h-9 w-9 shrink-0 rounded-md object-contain bg-white"
          />
          <div className="min-w-0">
            <p className="text-sm font-semibold leading-tight truncate">Mikrona d.o.o.</p>
            <p className="text-[10px] text-sidebar-foreground/55 leading-tight mt-0.5">Bookie poslovni sistemi</p>
          </div>
        </div>
        <CompanySwitcher />
      </SidebarHeader>

      <SidebarContent className="px-2 py-4">

        {/* ── Glavna knjiga (samo v GLK pogledu) ─────────────────────────── */}
        {activeModuleView === "glk" && glkModules.length > 0 && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Glavna knjiga</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {glkModules.map((module) => {
                  const isActive = isModuleActive(module.path, location);
                  return (
                    <SidebarMenuItem key={module.path}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={module.name}>
                        <button onClick={() => navigate(module.path)} className="flex items-center w-full">
                          <module.icon className="h-4 w-4" />
                          <span>{module.name}</span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Osnovna sredstva (samo v OS pogledu) ───────────────────────── */}
        {activeModuleView === "os" && hasOs && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Osnovna sredstva</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {OS_MODULES.map((module) => {
                  const isActive = location === module.path || location.startsWith(module.path + "/");
                  return (
                    <SidebarMenuItem key={module.path}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={module.name}>
                        <button onClick={() => navigate(module.path)} className="flex items-center w-full">
                          <module.icon className="h-4 w-4" />
                          <span>{module.name}</span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Šifranti — skupni za vse module ────────────────────────────── */}
        {hasAnyRole && (
          <SidebarGroup className="mt-4">
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Šifranti</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SIFRANT_MODULES.map((module) => {
                  const isActive = isModuleActive(module.path, location);
                  return (
                    <SidebarMenuItem key={module.path}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={module.name}>
                        <button onClick={() => navigate(module.path)} className="flex items-center w-full">
                          <module.icon className="h-4 w-4" />
                          <span>{module.name}</span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        {/* ── Sistem ─────────────────────────────────────────────────────── */}
        {(activeCompany?.role === "owner" || isSuperAdmin) && (
          <SidebarGroup className="mt-6">
            <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Sistem</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {SETTINGS_MODULES.map((module) => {
                  const isActive = location === module.path || location.startsWith(module.path);
                  return (
                    <SidebarMenuItem key={module.path}>
                      <SidebarMenuButton asChild isActive={isActive} tooltip={module.name}>
                        <button onClick={() => navigate(module.path)} className="flex items-center w-full">
                          <module.icon className="h-4 w-4" />
                          <span>{module.name}</span>
                        </button>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
                {isSuperAdmin && (
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      asChild
                      isActive={location === "/admin" || location.startsWith("/admin")}
                      tooltip="Administracija sistema"
                    >
                      <button onClick={() => navigate("/admin")} className="flex items-center w-full">
                        <ShieldAlert className="h-4 w-4" />
                        <span>Administracija</span>
                      </button>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
    </Sidebar>
  );
}

export function Topbar() {
  const { activeCompany } = useCompany();
  const { signOut } = useClerk();
  const { getToken } = useAuth();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { user, isLoaded } = useUser();
  const { data: dbUser } = useGetMe({ query: { enabled: isLoaded && !!user, queryKey: ["/api/me"] } });

  // ── Ob zapiranju brskalnika/zavihka prekini Clerk sejo ────────────────────
  const tokenRef = React.useRef<string | null>(null);

  useEffect(() => {
    // Predpomni žeton in ga osvežuj vsakih 55 sekund (žeton velja ~60s)
    const osveziZeton = async () => {
      try {
        tokenRef.current = await getToken();
      } catch {
        tokenRef.current = null;
      }
    };

    osveziZeton();
    const interval = setInterval(osveziZeton, 55_000);

    const obZapiranju = () => {
      const token = tokenRef.current;
      if (!token) return;
      // keepalive: true zagotovi, da zahteva doseže strežnik tudi po zaprtju strani
      fetch("/api/auth/end-session", {
        method: "POST",
        keepalive: true,
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
    };

    window.addEventListener("beforeunload", obZapiranju);
    return () => {
      window.removeEventListener("beforeunload", obZapiranju);
      clearInterval(interval);
    };
  }, [getToken]);
  
  const [location] = useLocation();
  const { toggleSidebar, state } = useSidebar();
  
  // Find current module name for breadcrumbs
  const allModules = [...MODULES, ...OS_MODULES, ...SETTINGS_MODULES];
  const currentModule = allModules.find(m => location === m.path || location.startsWith(`${m.path}/`))?.name || "Pregled";

  const handleSignOut = () => {
    signOut({ redirectUrl: basePath || "/" });
  };

  const isSuperAdmin = !!(dbUser as unknown as UserProfileExtended)?.isSuperAdmin;

  const displayName = dbUser?.firstName 
    ? `${dbUser.firstName} ${dbUser.lastName || ''}`.trim() 
    : user?.primaryEmailAddress?.emailAddress || "Uporabnik";
    
  const initials = dbUser?.firstName
    ? `${dbUser.firstName[0]}${dbUser.lastName ? dbUser.lastName[0] : ''}`.toUpperCase()
    : "UR";

  const roleLabel = (role: string) => ({
    owner: "Lastnik", accountant: "Računovodja", viewer: "Pregledovalec"
  })[role] ?? role;

  const userSubtitle = isSuperAdmin
    ? "Super admin"
    : activeCompany
      ? roleLabel(activeCompany.role)
      : null;

  return (
    <header className="h-16 border-b border-border bg-card text-card-foreground px-4 flex items-center justify-between shrink-0 sticky top-0 z-10 shadow-sm">
      <div className="flex items-center gap-3">
        <SidebarTrigger className="text-muted-foreground hover:text-foreground md:hidden" />
        
        <div className="hidden md:flex items-center text-sm">
          <span className="text-muted-foreground">{activeCompany?.kratekNaziv ?? activeCompany?.naziv ?? "Sistem"}</span>
          <ChevronRight className="h-4 w-4 mx-1 text-muted-foreground/50" />
          <span className="font-medium">{currentModule}</span>
        </div>
      </div>
      
      <div className="flex items-center gap-4">
        {dbUser && (
          <div className="hidden sm:flex items-center gap-2 mr-2">
            <div className="h-2 w-2 rounded-full bg-green-500"></div>
            <span className="text-xs text-muted-foreground">Povezano</span>
          </div>
        )}
        
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 hover:bg-muted/50 p-1.5 pr-2 rounded-md transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-8 w-8 border border-border">
                <AvatarImage src={dbUser?.imageUrl || user?.imageUrl || ""} alt={displayName} />
                <AvatarFallback className="bg-primary/10 text-primary text-xs font-medium">{initials}</AvatarFallback>
              </Avatar>
              <div className="flex flex-col items-start hidden sm:flex">
                <span className="text-sm font-medium leading-none">{displayName}</span>
                {userSubtitle && (
                  <span className="text-[10px] text-muted-foreground mt-0.5">{userSubtitle}</span>
                )}
              </div>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56 mt-1">
            <DropdownMenuLabel className="font-normal">
              <div className="flex flex-col space-y-1">
                <p className="text-sm font-medium leading-none">{displayName}</p>
                <p className="text-xs leading-none text-muted-foreground">
                  {user?.primaryEmailAddress?.emailAddress}
                </p>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem asChild>
              <Link href="/nastavitve" className="cursor-pointer flex items-center w-full">
                <UserIcon className="mr-2 h-4 w-4" />
                <span>Moj profil</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/nastavitve" className="cursor-pointer flex items-center w-full">
                <Settings className="mr-2 h-4 w-4" />
                <span>Nastavitve podjetja</span>
              </Link>
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={handleSignOut} className="text-destructive focus:bg-destructive/10 cursor-pointer">
              <LogOut className="mr-2 h-4 w-4" />
              <span>Odjava</span>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}

const SIDEBAR_MIN = 180;
const SIDEBAR_MAX = 420;
const SIDEBAR_DEFAULT = 256;
const SIDEBAR_KEY = "erp-sidebar-width";

export function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(SIDEBAR_KEY);
      if (saved) {
        const n = parseInt(saved, 10);
        if (!isNaN(n)) return Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, n));
      }
    } catch { /* brez dostopa do localStorage */ }
    return SIDEBAR_DEFAULT;
  });

  const dragRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startWidth: sidebarWidth };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";

      const onMove = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const newW = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, dragRef.current.startWidth + ev.clientX - dragRef.current.startX),
        );
        setSidebarWidth(newW);
      };

      const onUp = (ev: MouseEvent) => {
        if (!dragRef.current) return;
        const finalW = Math.min(
          SIDEBAR_MAX,
          Math.max(SIDEBAR_MIN, dragRef.current.startWidth + ev.clientX - dragRef.current.startX),
        );
        dragRef.current = null;
        setSidebarWidth(finalW);
        try { localStorage.setItem(SIDEBAR_KEY, String(finalW)); } catch { /* / */ }
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    [sidebarWidth],
  );

  return (
    <SidebarProvider
      defaultOpen={true}
      style={{ "--sidebar-width": `${sidebarWidth}px` } as React.CSSProperties}
    >
      <div className="flex min-h-[100dvh] w-full bg-background overflow-hidden">
        <AppSidebar />

        {/* ── Resize ročica ────────────────────────────────────────────────── */}
        <div
          className="w-1 shrink-0 cursor-col-resize relative z-20 hover:bg-primary/30 active:bg-primary/50 transition-colors"
          onMouseDown={handleMouseDown}
          title="Povlecite za spremembo širine"
        >
          {/* Razširjena površina za lažji klik */}
          <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
        </div>

        <div className="flex flex-col flex-1 min-w-0 overflow-hidden relative">
          <Topbar />
          <main className="flex-1 overflow-auto bg-background p-6">
            <div className="mx-auto max-w-7xl">
              {children}
            </div>
          </main>
        </div>
      </div>
    </SidebarProvider>
  );
}