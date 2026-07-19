import React, { useEffect } from "react";
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
} from "lucide-react";
import { useClerk, useUser } from "@clerk/react";
import { useGetMe, useListCompanies } from "@workspace/api-client-react";

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

// null = vedno vidno; 'erp'/'pos' = zahteva aktiven modul
const MODULES: { name: string; path: string; icon: React.ElementType; requires: "erp" | "pos" | null }[] = [
  { name: "Pregled", path: "/dashboard", icon: LayoutDashboard, requires: null },
  { name: "Kontni plan", path: "/kontni-plan", icon: BookOpen, requires: "erp" },
  { name: "Računovodska obdobja", path: "/obdobja", icon: Calendar, requires: "erp" },
  { name: "Temeljnice", path: "/temeljnice", icon: FileText, requires: "erp" },
  { name: "Glavna knjiga", path: "/glavna-knjiga", icon: BookMarked, requires: "erp" },
  { name: "Partnerji", path: "/partnerji", icon: Users, requires: "erp" },
  { name: "Računi", path: "/racuni", icon: Receipt, requires: "erp" },
  { name: "AI Dokumenti", path: "/dokumenti", icon: ScanLine, requires: "erp" },
  { name: "Plačila", path: "/placila", icon: CreditCard, requires: "erp" },
  { name: "Uvoz izpiskov", path: "/bancni-izpis", icon: Banknote, requires: "erp" },
  { name: "Saldakonti", path: "/saldakonti", icon: BarChart3, requires: "erp" },
  { name: "DDV evidence", path: "/ddv", icon: Receipt, requires: "erp" },
  { name: "Dimenzije", path: "/dimenzije", icon: Layers, requires: "erp" },
  { name: "Poročila", path: "/porocila", icon: BarChart3, requires: "erp" },
  { name: "Analitika", path: "/porocila/dimenzije", icon: PieChart, requires: "erp" },
];

const SETTINGS_MODULES = [
  { name: "Nastavitve", path: "/nastavitve", icon: Settings },
];

function CompanySwitcher() {
  const { activeCompany, setActiveCompany } = useCompany();
  const { data } = useListCompanies();
  const companies = data?.companies ?? [];

  // Ko se seznam podjetij osveži (npr. admin doda modul), posodobi activeCompany
  // da se modules polje ujema s svežimi podatki iz API-ja
  useEffect(() => {
    if (!activeCompany || companies.length === 0) return;
    const fresh = companies.find((c) => c.id === activeCompany.id);
    if (!fresh) return;
    // Posodobimo samo če se kateri koli ključ razlikuje (plitka primerjava)
    const currentJson = JSON.stringify(activeCompany);
    const freshJson = JSON.stringify(fresh);
    if (currentJson !== freshJson) setActiveCompany(fresh);
  }, [companies]); // eslint-disable-line react-hooks/exhaustive-deps

  const roleLabel = (role: string) => ({
    owner: "Lastnik", accountant: "Računovodja", viewer: "Pregledovalec"
  })[role as string] ?? role;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="flex items-center gap-3 w-full p-2 -mx-2 rounded-md hover:bg-sidebar-accent/50 transition-colors text-left group outline-none">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-sm bg-primary text-primary-foreground group-hover:bg-primary/90 transition-colors">
            <Building2 className="h-4 w-4" />
          </div>
          <div className="flex flex-col flex-1 min-w-0">
            <span className="font-semibold text-sm leading-tight truncate tracking-tight text-sidebar-primary-foreground">
              {activeCompany?.kratekNaziv ?? activeCompany?.naziv ?? "Ni podjetja"}
            </span>
            {activeCompany && (
              <span className="text-[10px] text-sidebar-foreground/70 uppercase tracking-widest font-medium">
                {roleLabel(activeCompany.role)}
              </span>
            )}
          </div>
          <ChevronDown className="h-4 w-4 text-sidebar-foreground/50 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="bottom" align="start" className="w-64">
        <DropdownMenuLabel className="text-xs text-muted-foreground">Vaša podjetja</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {companies.map((c) => (
          <DropdownMenuItem
            key={c.id}
            onClick={() => setActiveCompany(c)}
            className={`cursor-pointer ${activeCompany?.id === c.id ? "bg-accent" : ""}`}
          >
            <div className="flex flex-col">
              <span className="font-medium">{c.naziv}</span>
              <span className="text-xs text-muted-foreground">SI{c.podjetjeDavcna} · {roleLabel(c.role)}</span>
            </div>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/company-select" className="w-full cursor-pointer">Upravljanje podjetij</Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function AppSidebar() {
  const [location, setLocation] = useLocation();
  const { user, isLoaded } = useUser();
  const { activeCompany } = useCompany();
  const { data: me } = useGetMe({ query: { enabled: isLoaded && !!user?.id, queryKey: ["/api/me"] } });
  const isSuperAdmin = !!(me as unknown as UserProfileExtended)?.isSuperAdmin;

  // Aktivni moduli podjetja (iz razširjenega tipa CompanyWithRole)
  const activeModules: string[] = (activeCompany as (typeof activeCompany & { modules?: string[] }))?.modules ?? [];

  // Filtriramo samo tiste vnose v meniju, ki so pokrite z aktivnimi moduli
  const visibleModules = MODULES.filter(
    (m) => m.requires === null || activeModules.includes(m.requires),
  );

  // Custom navigation handler to support base path
  const navigate = (path: string) => {
    setLocation(path);
  };

  return (
    <Sidebar className="border-r border-sidebar-border shadow-sm">
      <SidebarHeader className="h-auto py-3 px-4 border-b border-sidebar-border bg-sidebar text-sidebar-foreground">
        <CompanySwitcher />
      </SidebarHeader>
      
      <SidebarContent className="px-2 py-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Glavna knjiga</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {visibleModules.map((module) => {
                const isActive = location === module.path || (location.startsWith(module.path) && module.path !== "/dashboard");
                return (
                  <SidebarMenuItem key={module.path}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={module.name}
                    >
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
        
        <SidebarGroup className="mt-6">
          <SidebarGroupLabel className="text-xs font-semibold uppercase tracking-wider text-sidebar-foreground/50 mb-2 px-2">Sistem</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {SETTINGS_MODULES.map((module) => {
                const isActive = location === module.path || location.startsWith(module.path);
                return (
                  <SidebarMenuItem key={module.path}>
                    <SidebarMenuButton 
                      asChild 
                      isActive={isActive}
                      tooltip={module.name}
                    >
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
      </SidebarContent>
    </Sidebar>
  );
}

export function Topbar() {
  const { activeCompany } = useCompany();
  const { signOut } = useClerk();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const { user, isLoaded } = useUser();
  const { data: dbUser } = useGetMe({ query: { enabled: isLoaded && !!user, queryKey: ["/api/me"] } });
  
  const [location] = useLocation();
  const { toggleSidebar, state } = useSidebar();
  
  // Find current module name for breadcrumbs
  const allModules = [...MODULES, ...SETTINGS_MODULES];
  const currentModule = allModules.find(m => location === m.path || location.startsWith(`${m.path}/`))?.name || "Pregled";

  const handleSignOut = () => {
    signOut({ redirectUrl: basePath || "/" });
  };

  const displayName = dbUser?.firstName 
    ? `${dbUser.firstName} ${dbUser.lastName || ''}`.trim() 
    : user?.primaryEmailAddress?.emailAddress || "Uporabnik";
    
  const initials = dbUser?.firstName
    ? `${dbUser.firstName[0]}${dbUser.lastName ? dbUser.lastName[0] : ''}`.toUpperCase()
    : "UR";

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
                <span className="text-[10px] text-muted-foreground mt-0.5">Računovodja</span>
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

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="flex min-h-[100dvh] w-full bg-background overflow-hidden">
        <AppSidebar />
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