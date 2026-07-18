import React from "react";
import { Link } from "wouter";
import { 
  Building2, 
  ArrowRight, 
  ShieldCheck, 
  Database, 
  Zap, 
  BarChart4
} from "lucide-react";
import { Button } from "@/components/ui/button";

export default function LandingPage() {
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background selection:bg-primary/20 selection:text-primary">
      {/* Header */}
      <header className="h-20 border-b border-border/50 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 h-full flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-primary text-primary-foreground shadow-sm">
              <Building2 className="h-5 w-5" />
            </div>
            <span className="font-bold text-xl tracking-tight text-foreground">ERP Sistem</span>
          </div>
          <div className="flex items-center gap-4">
            <Button variant="ghost" className="hidden sm:flex text-muted-foreground hover:text-foreground" asChild>
              <Link href={`${basePath}/sign-in`}>Prijava</Link>
            </Button>
            <Button asChild className="shadow-sm">
              <Link href={`${basePath}/sign-up`}>Brezplačen preizkus</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <main className="flex-1 flex flex-col items-center justify-center pt-24 pb-32 px-4 text-center">
        <div className="inline-flex items-center rounded-full border border-border/50 bg-muted/50 px-3 py-1 text-sm font-medium text-muted-foreground mb-8">
          <span className="flex h-2 w-2 rounded-full bg-primary mr-2"></span>
          Profesionalno dvostavno knjigovodstvo
        </div>
        
        <h1 className="max-w-4xl text-5xl md:text-7xl font-bold tracking-tight text-foreground mb-8 text-balance leading-tight">
          Natančnost, ki ji lahko <span className="text-primary">zaupate</span>.
        </h1>
        
        <p className="max-w-2xl text-xl text-muted-foreground mb-12 text-balance leading-relaxed">
          Celovit slovenski ERP sistem za profesionalno vodenje poslovnih knjig. 
          Brez navlake, zgrajen za hitrost in popolno skladnost z zakonodajo.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center gap-4">
          <Button size="lg" className="h-14 px-8 text-base shadow-sm w-full sm:w-auto" asChild>
            <Link href={`${basePath}/sign-up`}>
              Začni z uporabo <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
          <Button size="lg" variant="outline" className="h-14 px-8 text-base w-full sm:w-auto bg-background" asChild>
            <Link href={`${basePath}/sign-in`}>Prijava v sistem</Link>
          </Button>
        </div>

        {/* Feature Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8 max-w-5xl mx-auto mt-32 text-left">
          <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm">
            <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
              <Database className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold mb-3">Dvostavno knjigovodstvo</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Celovita glavna knjiga, integriran kontni plan in avtomatsko knjiženje dogodkov brez redundance.
            </p>
          </div>
          
          <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm">
            <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
              <ShieldCheck className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold mb-3">Skladnost in DDV</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Popolna prilagoditev slovenski davčni zakonodaji in samodejno generiranje DDV evidenc.
            </p>
          </div>
          
          <div className="p-6 rounded-xl border border-border/50 bg-card shadow-sm">
            <div className="h-12 w-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mb-6">
              <Zap className="h-6 w-6" />
            </div>
            <h3 className="text-lg font-semibold mb-3">Profesionalen vmesnik</h3>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Informacijsko gost in optimiziran UI. Narejen za računovodje, ki cenijo hitrost in preglednost nad okraski.
            </p>
          </div>
        </div>
      </main>
      
      {/* Footer */}
      <footer className="py-8 border-t border-border/50 text-center text-sm text-muted-foreground">
        <p>© {new Date().getFullYear()} Acme Računovodstvo ERP. Vse pravice pridržane.</p>
      </footer>
    </div>
  );
}