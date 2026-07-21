import { useAuth } from "@/contexts/AuthContext";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { Building2, Monitor, AlertTriangle } from "lucide-react";

interface Enota { id: number; ime: string; }

export function UporabnikSidebarInfo() {
  const { user } = useAuth();
  const { activeBlagajnaId } = useBlagajna();

  // Ime enote dobimo direktno iz user.enote (vrnjeno ob auth/me) — brez extra fetch
  const enotaIme = user?.enote?.find((e: Enota) => e.id === user.enotaId)?.ime ?? null;

  return (
    <div className="px-4 py-2 space-y-1.5">
      {enotaIme && (
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{enotaIme}</span>
        </div>
      )}
      {activeBlagajnaId ? (
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <Monitor className="h-3 w-3 shrink-0" />
          <span className="font-mono">Blagajna #{activeBlagajnaId}</span>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-xs text-amber-500">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          <span>Blagajna ni dodeljena</span>
        </div>
      )}
    </div>
  );
}
