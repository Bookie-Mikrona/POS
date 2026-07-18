import { useEffect, useRef } from "react";
import { ClerkProvider, SignIn, SignUp, Show, useClerk } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import { Switch, Route, useLocation, Router as WouterRouter, Redirect } from 'wouter';
import { QueryClientProvider, useQueryClient } from "@tanstack/react-query";

import { Shell } from "@/components/layout/Shell";
import { CompanyProvider, useCompany } from "@/contexts/CompanyContext";
import LandingPage from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import CompanySelectPage from "@/pages/company-select";
import KontniPlan from "@/pages/kontni-plan";
import Obdobja from "@/pages/obdobja";
import Placeholder from "@/pages/placeholder";
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

function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4">
      <SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} />
    </div>
  );
}

function SignUpPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-zinc-50 px-4">
      <SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} />
    </div>
  );
}

function HomeRedirect() {
  return (
    <>
      <Show when="signed-in">
        <Redirect to="/dashboard" />
      </Show>
      <Show when="signed-out">
        <LandingPage />
      </Show>
    </>
  );
}

// Protected route wrapper
function ProtectedRoute({ component: Component, ...rest }: { component: any, [key: string]: any }) {
  const [location] = useLocation();
  const { activeCompany } = useCompany();

  return (
    <Route {...rest}>
      <Show when="signed-in">
        {activeCompany || location === "/company-select" ? (
          location === "/company-select" ? (
            <Component />
          ) : (
            <Shell>
              <Component />
            </Shell>
          )
        ) : (
          <Redirect to="/company-select" />
        )}
      </Show>
      <Show when="signed-out">
        <Redirect to="/" />
      </Show>
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
          <Switch>
            <Route path="/" component={HomeRedirect} />
            <Route path="/sign-in/*?" component={SignInPage} />
            <Route path="/sign-up/*?" component={SignUpPage} />
            
            <ProtectedRoute path="/company-select" component={CompanySelectPage} />
            <ProtectedRoute path="/dashboard" component={Dashboard} />
          
          <ProtectedRoute path="/kontni-plan" component={KontniPlan} />
          
          <ProtectedRoute path="/obdobja" component={Obdobja} />

          <ProtectedRoute path="/temeljnice" component={() => (
            <Placeholder 
              title="Temeljnice / Glavna knjiga" 
              description="Vnos dnevnikov, dvostavno knjiženje in pregled prometa po kontih." 
            />
          )} />
          
          <ProtectedRoute path="/kupci" component={() => (
            <Placeholder 
              title="Kupci in terjatve" 
              description="Izdani računi, upravljanje s strankami, saldakonti kupcev in opomini." 
            />
          )} />
          
          <ProtectedRoute path="/dobavitelji" component={() => (
            <Placeholder 
              title="Dobavitelji in obveznosti" 
              description="Prejeti računi, obveznosti do dobaviteljev, nalogi za plačilo." 
            />
          )} />
          
          <ProtectedRoute path="/ddv" component={() => (
            <Placeholder 
              title="DDV evidence" 
              description="Knjige izdanih in prejetih računov, DDV-O obrazec in rekapitulacije." 
            />
          )} />
          
          <ProtectedRoute path="/porocila" component={() => (
            <Placeholder 
              title="Poročila in analitika" 
              description="Bruto bilanca, bilanca stanja, izkaz poslovnega izida in ostala standardna poročila." 
            />
          )} />
          
          <ProtectedRoute path="/nastavitve" component={() => (
            <Placeholder 
              title="Nastavitve podjetja" 
              description="Podatki o podjetju, davčne nastavitve, uporabniki in pravice." 
            />
          )} />

            <Route component={NotFound} />
          </Switch>
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