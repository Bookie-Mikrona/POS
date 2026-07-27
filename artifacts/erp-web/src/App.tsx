import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, useClerk, useUser, useSignIn, useSignUp } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQuery, useQueryClient } from "@tanstack/react-query";

import { Shell } from "@/components/layout/Shell";
import { CompanyProvider, useCompany } from "@/contexts/CompanyContext";
import { useGetMe } from "@workspace/api-client-react";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import CompanySelectPage from "@/pages/company-select";
import KontniPlan from "@/pages/kontni-plan";
import Obdobja from "@/pages/obdobja";
import Temeljnice from "@/pages/temeljnice";
import GlavnaKnjiga from "@/pages/glavna-knjiga";
import Partnerji from "@/pages/partnerji";
import Racuni from "@/pages/racuni";
import Prejemnice from "@/pages/prejemnice";
import Dokumenti from "@/pages/dokumenti";
import Placeholder from "@/pages/placeholder";
import Placila from "@/pages/placila";
import BancniIzpis from "@/pages/bancni-izpis";
import Saldakonti from "@/pages/saldakonti";
import Ddv from "@/pages/ddv";
import Dimenzije from "@/pages/dimenzije";
import Porocila from "@/pages/porocila";
import PorocilaAnalitika from "@/pages/porocila-dimenzije";
import Nastavitve from "@/pages/nastavitve";
import AdminPage from "@/pages/admin";
import AdminSetupPage from "@/pages/admin-setup";
import NotFound from "@/pages/not-found";
import { queryClient } from "@/lib/queryClient";

const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || "/"
    : path;
}

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: "clerk",
  options: {
    logoPlacement: "inside" as const,
    logoLinkUrl: basePath || "/",
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
  },
  variables: {
    colorPrimary: "hsl(220 10% 15%)", // --primary
    colorForeground: "hsl(220 10% 15%)", // --foreground
    colorMutedForeground: "hsl(220 10% 40%)", // --muted-foreground
    colorDanger: "hsl(0 70% 45%)", // --destructive
    colorBackground: "hsl(0 0% 100%)", // --card
    colorInput: "hsl(0 0% 100%)", // --input
    colorInputForeground: "hsl(220 10% 15%)", // --foreground
    colorNeutral: "hsl(40 10% 88%)", // --border
    fontFamily: "'Inter', sans-serif",
    borderRadius: "0.25rem",
  },
  elements: {
    rootBox: "w-full flex justify-center",
    cardBox: "bg-white rounded-xl w-[440px] max-w-full overflow-hidden border border-neutral-200/50 shadow-sm",
    card: "!shadow-none !border-0 !bg-transparent !rounded-none",
    footer: "!shadow-none !border-0 !bg-transparent !rounded-none bg-neutral-50/50",
    headerTitle: "text-xl font-bold tracking-tight text-neutral-900",
    headerSubtitle: "text-sm text-neutral-500",
    socialButtonsBlockButtonText: "font-medium",
    formFieldLabel: "text-sm font-medium text-neutral-900",
    footerActionLink: "font-medium text-neutral-900 hover:text-neutral-700",
    footerActionText: "text-neutral-500",
    dividerText: "text-xs text-neutral-400 font-medium",
    identityPreviewEditButton: "text-neutral-500 hover:text-neutral-900",
    formFieldSuccessText: "text-green-600",
    alertText: "text-sm text-red-600",
    logoBox: "h-12 flex justify-center mb-4",
    logoImage: "h-full w-auto object-contain",
    socialButtonsBlockButton: "border-neutral-200 hover:bg-neutral-50 transition-colors",
    formButtonPrimary: "bg-neutral-900 hover:bg-neutral-800 text-white font-medium shadow-sm transition-colors",
    formFieldInput: "flex h-10 w-full rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm ring-offset-white file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-neutral-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
    footerAction: "flex items-center justify-center gap-2",
    dividerLine: "bg-neutral-200",
    alert: "bg-red-50 border border-red-200 p-3 rounded-md",
    otpCodeFieldInput: "border-neutral-200 focus-visible:ring-neutral-900",
    formFieldRow: "mb-4",
    main: "gap-6",
  },
};

function AuthSpinner() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center bg-zinc-50">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-neutral-900 border-t-transparent" />
    </div>
  );
}

function SignInPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { signIn, isLoaded: signInLoaded } = useSignIn();
  const [, setLocation] = useLocation();
  // Fallback: če Clerk po prijavi ne pokliče routerPush, sami navigiramo
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/");
  }, [isLoaded, isSignedIn, setLocation]);
  // Pokaži spinner takoj ko je signIn "complete" ali ko je isSignedIn=true —
  // to prepreči prazen zaslon ki ga Clerk prikaže med tranzicijo stanja
  const isCompleting =
    (signInLoaded && signIn?.status === "complete") ||
    (isLoaded && isSignedIn);
  if (isCompleting) return <AuthSpinner />;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  const { isSignedIn, isLoaded } = useUser();
  const { signUp, isLoaded: signUpLoaded } = useSignUp();
  const [, setLocation] = useLocation();
  // Fallback: če Clerk po registraciji ne pokliče routerPush, sami navigiramo
  useEffect(() => {
    if (isLoaded && isSignedIn) setLocation("/");
  }, [isLoaded, isSignedIn, setLocation]);
  // Pokaži spinner takoj ko je signUp "complete" ali ko je isSignedIn=true —
  // to prepreči prazen zaslon ki ga Clerk prikaže med tranzicijo stanja
  const isCompleting =
    (signUpLoaded && signUp?.status === "complete") ||
    (isLoaded && isSignedIn);
  if (isCompleting) return <AuthSpinner />;
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  const { isSuperAdmin, isLoading } = useIsSuperAdminState();
  const { isSignedIn, isLoaded, user } = useUser();

  const spinner = (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );

  // Clerk se inicializira — nevtralni spinner (ne ERP landing page)
  if (!isLoaded) return spinner;

  if (isSignedIn) {
    // POS-only hint: preusmeri takoj, preden se naloži karkoli ERP
    if (localStorage.getItem("pos_user_hint") === "1") {
      window.location.replace("/pos/");
      return spinner;
    }

    // Počakaj na /api/me da super admin ne pristane napačno
    if (isLoading) return spinner;

    if (isSuperAdmin) return <Redirect to="/admin" />;

    // Vedno na company-select — ta stran sama odloči ali avtomatično
    // preusmeri (čisti ERP) ali prikaže izbiro (dual-role ERP+POS).
    return <Redirect to="/company-select" />;
  }

  // Odjavljen → pristajalna stran
  return <LandingPage />;
}

// Super admin hook — reads isSuperAdmin from /api/me response
function useIsSuperAdmin(): boolean {
  return useIsSuperAdminState().isSuperAdmin;
}
function useIsSuperAdminState(): { isSuperAdmin: boolean; isLoading: boolean } {
  const { user, isLoaded } = useUser();
  const { data, isLoading } = useGetMe({ query: { enabled: isLoaded && !!user?.id, queryKey: ["/api/me"] } });
  return {
    isSuperAdmin: !!(data as any)?.isSuperAdmin,
    isLoading: !isLoaded || (isLoaded && !!user?.id && isLoading),
  };
}

// Hook: pridobi stanje ERP sistema (ali je setup narejen)
interface ErpSystem {
  erpOwnerCompanyId: string | null;
  company: (Record<string, unknown> & { role: string; modules: string[] }) | null;
}
function useErpSystem(enabled: boolean) {
  const { user } = useUser();
  return useQuery({
    queryKey: ["/api/admin/system"],
    queryFn: async () => {
      const res = await fetch("/api/admin/system");
      if (!res.ok) throw new Error("Napaka pri preverjanju sistema");
      return res.json() as Promise<ErpSystem>;
    },
    enabled: enabled && !!user?.id,
    staleTime: 30_000,
  });
}

// Super admin guard — ob vsaki navigaciji preveri stanje sistema
function SuperAdminGuard({ children }: { children: React.ReactNode }) {
  const [location, setLocation] = useLocation();
  const isSuperAdmin = useIsSuperAdmin();
  const { activeCompany, setActiveCompany } = useCompany();
  const { data: system, isLoading } = useErpSystem(isSuperAdmin);

  useEffect(() => {
    if (!isSuperAdmin || isLoading || system === undefined) return;

    if (!system.erpOwnerCompanyId) {
      // Setup še ni narejen → setup stran (razen če že tam)
      if (location !== "/admin/setup") setLocation("/admin/setup");
      return;
    }

    // Setup je narejen — auto-nastavi activeCompany če še ni
    if (!activeCompany && system.company) {
      setActiveCompany(system.company as unknown as Parameters<typeof setActiveCompany>[0]);
    }

    // Super admin na / ali /dashboard → vedno preusmeri na /admin
    if (location === "/" || location === "/dashboard") {
      setLocation("/admin");
      return;
    }

    // Če je prišel na /admin/setup ampak setup je že opravljen → /admin
    if (location === "/admin/setup") setLocation("/admin");
  }, [isSuperAdmin, isLoading, system, location, activeCompany]);

  return <>{children}</>;
}

// Protected route wrapper
function ProtectedRoute({ component: Component, adminOnly = false, setupPage = false, ...rest }: { component: any; adminOnly?: boolean; setupPage?: boolean; [key: string]: any }) {
  const [location] = useLocation();
  const { activeCompany } = useCompany();
  const isSuperAdmin = useIsSuperAdmin();
  const { isSignedIn, isLoaded } = useUser();

  return (
    <Route {...rest}>
      {/* Clerk se inicializira — ne prikazuj nič da ni 'flash' napačne vsebine */}
      {!isLoaded ? (
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : !isSignedIn ? (
        <Redirect to="/" />
      ) : setupPage ? (
        isSuperAdmin ? <Component /> : <Redirect to="/dashboard" />
      ) : adminOnly ? (
        isSuperAdmin ? <Shell><Component /></Shell> : <Redirect to="/dashboard" />
      ) : activeCompany || location === "/company-select" ? (
        location === "/company-select" ? <Component /> : <Shell><Component /></Shell>
      ) : (
        <Redirect to={isSuperAdmin ? "/admin" : "/company-select"} />
      )}
    </Route>
  );
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const queryClient = useQueryClient();
  const prevUserIdRef = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    const unsubscribe = addListener(({ user }) => {
      const userId = user?.id ?? null;
      if (
        prevUserIdRef.current !== undefined &&
        prevUserIdRef.current !== userId
      ) {
        queryClient.clear();
      }
      prevUserIdRef.current = userId;
    });
    return unsubscribe;
  }, [addListener, queryClient]);

  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();

  return (
    <ClerkProvider
      publishableKey={clerkPubKey}
      proxyUrl={clerkProxyUrl}
      appearance={clerkAppearance}
      signInUrl={`${basePath}/sign-in`}
      signUpUrl={`${basePath}/sign-up`}
      localization={{
        signIn: {
          start: {
            title: "Prijava v sistem",
            subtitle: "Vnesite vaše podatke za dostop do ERP",
          },
        },
        signUp: {
          start: {
            title: "Ustvarite račun",
            subtitle: "Začnite uporabljati ERP za vašo organizacico",
          },
        },
      }}
      routerPush={(to) => setLocation(stripBase(to))}
      routerReplace={(to) => setLocation(stripBase(to), { replace: true })}
    >
      <CompanyProvider>
        <QueryClientProvider client={queryClient}>
          <ClerkQueryClientCacheInvalidator />
          <SuperAdminGuard>
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <ProtectedRoute path="/admin/setup" component={AdminSetupPage} setupPage={true} />
            <ProtectedRoute path="/company-select" component={CompanySelectPage} />
            <ProtectedRoute path="/dashboard" component={Dashboard} />
          
          <ProtectedRoute path="/kontni-plan" component={KontniPlan} />
          
          <ProtectedRoute path="/obdobja" component={Obdobja} />

          <ProtectedRoute path="/temeljnice" component={Temeljnice} />
          
          <ProtectedRoute path="/glavna-knjiga" component={GlavnaKnjiga} />
          
          <ProtectedRoute path="/partnerji" component={Partnerji} />
          <ProtectedRoute path="/racuni" component={Racuni} />
          <ProtectedRoute path="/prejemnice" component={Prejemnice} />
          <ProtectedRoute path="/dokumenti" component={Dokumenti} />
          <ProtectedRoute path="/placila" component={Placila} />
          <ProtectedRoute path="/bancni-izpis" component={BancniIzpis} />
          <ProtectedRoute path="/saldakonti" component={Saldakonti} />
          
          <ProtectedRoute path="/ddv" component={Ddv} />
          
          <ProtectedRoute path="/dimenzije" component={Dimenzije} />
          
          <ProtectedRoute path="/porocila" component={Porocila} />
          <ProtectedRoute path="/porocila/dimenzije" component={PorocilaAnalitika} />
          
          <ProtectedRoute path="/nastavitve" component={Nastavitve} />
          <ProtectedRoute path="/admin" component={AdminPage} adminOnly={true} />

            <Route component={NotFound} />
          </Switch>
          </SuperAdminGuard>
        </QueryClientProvider>
      </CompanyProvider>
    </ClerkProvider>
  );
}

function App() {
  return (
    <WouterRouter base={basePath}>
      <ClerkProviderWithRoutes />
    </WouterRouter>
  );
}

export default App;