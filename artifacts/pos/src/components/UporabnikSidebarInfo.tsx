import { useState, useEffect } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { Building2, Monitor, AlertTriangle } from "lucide-react";

interface Enota { id: number; ime: string; }
interface Blagajna { id: number; ppId: string; bId: string; ime: string; }

export function UporabnikSidebarInfo() {
  const { user } = useAuth();
  const { activeBlagajnaId } = useBlagajna();
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const [enotaIme, setEnotaIme] = useState<string | null>(null);
  const [blagajnaLabel, setBlagajnaLabel] = useState<string | null>(null);

  useEffect(() => {
    if (!user?.enotaId) return;
    fetch(`${base}/api/enote`, { credentials: "include" })
      .then(r => r.json() as Promise<Enota[]>)
      .then(data => {
        const e = data.find(en => en.id === user.enotaId);
        if (e) setEnotaIme(e.ime);
      }).catch(() => {});
  }, [user?.enotaId, base]);

  useEffect(() => {
    if (!activeBlagajnaId) { setBlagajnaLabel(null); return; }
    fetch(`${base}/api/blagajne`, { credentials: "include" })
      .then(r => r.json() as Promise<Blagajna[]>)
      .then(data => {
        const b = data.find(bl => bl.id === activeBlagajnaId);
        if (b) setBlagajnaLabel(`${b.ppId}-${b.bId}`);
      }).catch(() => {});
  }, [activeBlagajnaId, base]);

  return (
    <div className="px-4 py-2 space-y-1.5">
      {enotaIme && (
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <Building2 className="h-3 w-3 shrink-0" />
          <span className="truncate">{enotaIme}</span>
        </div>
      )}
      {blagajnaLabel ? (
        <div className="flex items-center gap-2 text-xs text-sidebar-foreground/60">
          <Monitor className="h-3 w-3 shrink-0" />
          <span className="font-mono">{blagajnaLabel}</span>
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
