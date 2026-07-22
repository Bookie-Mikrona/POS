import { useAuth } from "@/contexts/AuthContext";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { Building2, MonitorCheck, AlertTriangle } from "lucide-react";

/**
 * Prikaz dodeljene enote in blagajne za vlogo "uporabnik".
 * Blagajna je fiksno dodeljena — ni možnosti preklapljanja.
 */
export function UporabnikSidebarInfo() {
  const { user } = useAuth();
  const { activeBlagajnaId } = useBlagajna();

  const enotaIme = user?.enotaIme ?? null;
  // Ime blagajne pride direktno iz auth/me — ni treba dodatnega fetch-a
  const blagajnaIme = user?.blagajnaIme ?? null;

  return (
    <div className="space-y-0.5">
      {/* Enota */}
      {enotaIme && (
        <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sidebar-foreground/80 border border-sidebar-border/40">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="flex-1 text-left truncate">{enotaIme}</span>
        </div>
      )}

      {/* Blagajna */}
      {activeBlagajnaId ? (
        <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sidebar-foreground/80 border border-sidebar-border/40">
          <MonitorCheck className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="flex-1 text-left truncate">
            {blagajnaIme ?? `Blagajna #${activeBlagajnaId}`}
          </span>
        </div>
      ) : (
        <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-amber-600 border border-amber-300/60 bg-amber-50/50">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 text-left truncate">Blagajna ni dodeljena</span>
        </div>
      )}
    </div>
  );
}
