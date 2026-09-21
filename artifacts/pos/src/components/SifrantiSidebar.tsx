/**
 * Skupina "Šifranti" v POS sidebarju.
 *
 * Vnosi (vidni vsem POS vlogam: admin, admin_enote, uporabnik):
 *   - Poslovni partnerji → /partnerji (POS ima lastno stran; dostop za vse)
 *   - Stroškovna mesta   → /stroskovana-mesta (interna POS stran; samo admin podjetja)
 *   - Kontni plan        → /kontni-plan       (interna POS stran; samo admin podjetja)
 *
 * Dostopna pravila:
 *   - vloga === "admin" (admin podjetja) → interni POS povezavi
 *   - vloga === "admin_enote" | "uporabnik" → ob kliku toast opozorilo
 *     "Nimate dodeljene pravice" (stran se ne odpre)
 *
 * Vzorec sledi SIFRANT_MODULES skupini v ERP Shell.tsx.
 */

import { Link, useLocation } from "wouter";
import { Users, MapPin, BookOpen, Phone } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface SifrantEntry {
  label: string;
  href: string;
  icon: React.ElementType;
  zahtevaAdminPodjetja: boolean;
}

export const SIFRANT_ENTRIES: readonly SifrantEntry[] = [
  { label: "Poslovni partnerji", href: "/partnerji", icon: Users, zahtevaAdminPodjetja: false },
  { label: "Telefonski naročniki", href: "/narocniki", icon: Phone, zahtevaAdminPodjetja: false },
  { label: "Stroškovna mesta",   href: "/stroskovana-mesta", icon: MapPin, zahtevaAdminPodjetja: true },
  { label: "Kontni plan",        href: "/kontni-plan", icon: BookOpen, zahtevaAdminPodjetja: true },
] as const;

export function SifrantiSidebar({ vloga }: { vloga: string }) {
  const [location] = useLocation();
  const { toast } = useToast();
  const { user } = useAuth();
  const isAdminPodjetja = vloga === "admin";
  const entries = SIFRANT_ENTRIES.filter(entry =>
    entry.href !== "/narocniki" || user?.capabilities?.includes("phone_orders"),
  );

  return (
    <div className="px-2 py-2 border-t border-sidebar-border/40 mt-1" data-testid="sifranti-sidebar">
      <p className="px-2 text-[9px] font-semibold uppercase tracking-widest text-sidebar-foreground/40 select-none mb-1">
        Šifranti
      </p>
      <div className="flex flex-col gap-0.5">
        {entries.map((entry) => {
          const isActive = location === entry.href || location.startsWith(entry.href + "/");
          const Icon = entry.icon;

          const btnClass = `flex min-h-9 items-center gap-2.5 w-full px-4 py-2 rounded-xl text-[13px] font-medium transition-all text-left ${
            isActive
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
          }`;

          if (entry.zahtevaAdminPodjetja && !isAdminPodjetja) {
            return (
              <button
                key={entry.label}
                className={btnClass}
                onClick={() => {
                  toast({
                    title: "Nimate dodeljene pravice",
                    description: "Ta šifrant je dostopen samo administratorju podjetja.",
                    variant: "destructive",
                  });
                }}
                data-testid={`sifranti-btn-${entry.href.replace("/", "")}`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{entry.label}</span>
              </button>
            );
          }

          return (
            <Link key={entry.label} href={entry.href} className={btnClass} data-testid={`sifranti-link-${entry.href.replace("/", "")}`}>
              <Icon className="h-4 w-4 shrink-0" />
              <span>{entry.label}</span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
