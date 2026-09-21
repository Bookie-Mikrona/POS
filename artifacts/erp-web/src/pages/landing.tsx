import React from "react";
import { Link } from "wouter";
import {
  ArrowRight,
  ShieldCheck,
  Database,
  BookOpen,
  Landmark,
  UtensilsCrossed,
  ChevronDown,
  CheckCircle2
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  const scrollToModules = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    document.getElementById('moduli')?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20 selection:text-primary font-sans">
      {/* Header */}
      <header className="h-16 md:h-20 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img
              src={`${basePath}/mikrona-logo.png`}
              alt="Mikrona d.o.o."
              className="h-8 w-8 md:h-10 md:w-10 object-contain mix-blend-multiply dark:mix-blend-normal"
            />
            <div>
              <span className="block font-bold text-lg md:text-xl tracking-tight text-foreground leading-none">Bookie ERP</span>
              <span className="block text-[10px] md:text-xs font-medium text-muted-foreground mt-0.5">Mikrona d.o.o.</span>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <Button asChild className="shadow-sm font-medium">
              <Link href={`${basePath}/sign-in`}>Prijava v sistem</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col">
        <section className="relative pt-24 md:pt-32 pb-20 md:pb-32 px-4 sm:px-6 lg:px-8 flex flex-col items-center text-center overflow-hidden">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-primary/5 via-background to-background"></div>

          <div className="inline-flex items-center rounded-full border border-border/60 bg-card/50 px-3 py-1.5 text-sm font-medium text-muted-foreground mb-8 shadow-sm backdrop-blur-sm">
            <span className="flex h-2 w-2 rounded-full bg-primary mr-2.5 animate-pulse"></span>
            Zanesljiv poslovni sistem
          </div>

          <h1 className="max-w-4xl text-4xl md:text-6xl lg:text-7xl font-bold tracking-tight text-foreground mb-6 text-balance leading-tight">
            Natančnost, ki ji lahko <span className="text-transparent bg-clip-text bg-gradient-to-r from-primary to-primary/70">zaupate</span>.
          </h1>

          <p className="max-w-2xl text-lg md:text-xl text-muted-foreground mb-10 text-balance leading-relaxed">
            Slovenski ERP sistem, zasnovan za profesionalne računovodje, ambiciozne podjetnike in sodobne gostinske ekipe. Popolna skladnost z zakonodajo in brezkompromisna hitrost.
          </p>

          <div className="flex flex-col sm:flex-row items-center gap-4 w-full sm:w-auto">
            <Button size="lg" className="h-14 px-8 text-base shadow-sm w-full sm:w-auto" asChild>
              <Link href={`${basePath}/sign-in`}>
                Prijava v sistem <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
            <Button size="lg" variant="outline" className="h-14 px-8 text-base w-full sm:w-auto bg-card hover:bg-muted" asChild>
              <a href="#moduli" onClick={scrollToModules}>
                Pregled funkcij <ChevronDown className="ml-2 h-4 w-4 text-muted-foreground" />
              </a>
            </Button>
          </div>
        </section>

        {/* Features Section */}
        <section id="moduli" className="py-24 bg-card/50 border-t border-border/50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="text-center mb-16">
              <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-foreground mb-4">Vse, kar potrebujete za vodenje podjetja</h2>
              <p className="text-lg text-muted-foreground max-w-2xl mx-auto text-balance">
                Povezani moduli zagotavljajo, da se podatek vnese samo enkrat. Od računa do glavne knjige, brez podvajanja dela.
              </p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Glavna knjiga - Large Card */}
              <div className="lg:col-span-8 group rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden flex flex-col transition-shadow hover:shadow-md">
                <div className="p-8 md:p-10 flex-1">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                    <BookOpen className="h-6 w-6" />
                  </div>
                  <h3 className="text-2xl font-bold mb-4">Glavna knjiga in finance</h3>
                  <p className="text-muted-foreground leading-relaxed mb-8 max-w-2xl">
                    Srce vašega računovodstva. Zmogljiva dvostavna glavna knjiga z avtomatskim knjiženjem in popolnim pregledom nad financami.
                  </p>

                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-y-3 gap-x-4">
                    {[
                      "Pregled poslovanja", "Obdobja", "Temeljnice",
                      "Glavna knjiga", "Računi", "Prejemnice",
                      "AI Dokumenti", "Plačila", "Bančni izpiski",
                      "Saldakonti", "DDV evidence", "Dimenzije",
                      "Poročila", "Analitika", "Obračun ur"
                    ].map(feature => (
                      <div key={feature} className="flex items-center text-sm font-medium">
                        <CheckCircle2 className="h-4 w-4 mr-2 text-primary/60 shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* POS Gostinstvo - Medium Card */}
              <div className="lg:col-span-4 group rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden flex flex-col transition-shadow hover:shadow-md">
                <div className="p-8 flex-1">
                  <div className="h-12 w-12 rounded-xl bg-primary/10 text-primary flex items-center justify-center mb-6">
                    <UtensilsCrossed className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-bold mb-4">POS Gostinstvo</h3>
                  <p className="text-muted-foreground leading-relaxed mb-6 text-sm">
                    Specializiran modul za vodenje gostinskih lokalov, od naročil do davčne blagajne.
                  </p>
                  <div className="flex flex-col gap-2.5">
                    {[
                      "Blagajne in FURS", "Mize in naročila", "Kuhinjski zaslon",
                      "Zaloga in normativi", "Pripravljena in sestavljena hrana", "Rezervacije in QR meni"
                    ].map(feature => (
                      <div key={feature} className="flex items-center text-sm font-medium text-muted-foreground">
                        <div className="h-1.5 w-1.5 rounded-full bg-primary/40 mr-3 shrink-0"></div>
                        {feature}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Osnovna sredstva */}
              <div className="lg:col-span-4 group rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden transition-shadow hover:shadow-md">
                <div className="p-8 h-full flex flex-col">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
                    <Landmark className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">Osnovna sredstva</h3>
                  <p className="text-muted-foreground leading-relaxed mb-5 text-sm">
                    Popoln nadzor nad premoženjem podjetja in avtomatizacija obračunov.
                  </p>
                  <ul className="space-y-2 mt-auto">
                    {["Register sredstev", "Amortizacijske skupine", "Amortizacijski obračun"].map(feature => (
                      <li key={feature} className="flex items-center text-sm text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5 mr-2 text-primary/40 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Šifranti */}
              <div className="lg:col-span-4 group rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden transition-shadow hover:shadow-md">
                <div className="p-8 h-full flex flex-col">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
                    <Database className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">Šifranti</h3>
                  <p className="text-muted-foreground leading-relaxed mb-5 text-sm">
                    Centralizirani podatki, ki zagotavljajo konsistentnost v vseh modulih.
                  </p>
                  <ul className="space-y-2 mt-auto">
                    {["Poslovni partnerji", "Stroškovna mesta", "Kontni plan"].map(feature => (
                      <li key={feature} className="flex items-center text-sm text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5 mr-2 text-primary/40 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Sistem in varnost */}
              <div className="lg:col-span-4 group rounded-2xl border border-border/60 bg-card shadow-sm overflow-hidden transition-shadow hover:shadow-md">
                <div className="p-8 h-full flex flex-col">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-5">
                    <ShieldCheck className="h-5 w-5" />
                  </div>
                  <h3 className="text-lg font-bold mb-3">Sistem in varnost</h3>
                  <p className="text-muted-foreground leading-relaxed mb-5 text-sm">
                    Zanesljiva infrastruktura z natančnim nadzorom dostopa in vlog.
                  </p>
                  <ul className="space-y-2 mt-auto">
                    {["Nastavitve podjetja", "Administracija uporabnikov", "Varnostni protokoli"].map(feature => (
                      <li key={feature} className="flex items-center text-sm text-muted-foreground">
                        <ArrowRight className="h-3.5 w-3.5 mr-2 text-primary/40 shrink-0" />
                        {feature}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

            </div>
          </div>
        </section>

        {/* Bottom CTA */}
        <section className="py-24 px-4 sm:px-6 lg:px-8">
          <div className="max-w-4xl mx-auto text-center bg-primary rounded-3xl p-10 md:p-16 shadow-xl text-primary-foreground relative overflow-hidden">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,_var(--tw-gradient-stops))] from-white/10 to-transparent"></div>
            <h2 className="text-3xl md:text-4xl font-bold tracking-tight mb-6 relative z-10">Pripravljeni na učinkovitejše poslovanje?</h2>
            <p className="text-primary-foreground/80 text-lg mb-10 max-w-2xl mx-auto relative z-10">
              Vstopite v sistem in preverite, kako lahko Bookie ERP optimizira vaše delovne procese.
            </p>
            <Button size="lg" variant="secondary" className="h-14 px-8 text-base font-semibold relative z-10 w-full sm:w-auto" asChild>
              <Link href={`${basePath}/sign-in`}>
                Prijava v sistem <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 md:py-12 border-t border-border/50 bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <img
              src={`${basePath}/mikrona-logo.png`}
              alt="Mikrona d.o.o."
              className="h-6 w-6 object-contain mix-blend-multiply dark:mix-blend-normal opacity-50 grayscale"
            />
            <span className="text-sm font-medium text-muted-foreground">Bookie ERP</span>
          </div>
          <p className="text-sm text-muted-foreground">
            © {new Date().getFullYear()} Mikrona d.o.o. Vse pravice pridržane.
          </p>
        </div>
      </footer>
    </div>
  );
}
