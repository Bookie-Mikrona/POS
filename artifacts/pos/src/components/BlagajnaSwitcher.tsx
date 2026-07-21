import { useEffect } from "react";
import { MonitorCheck, ChevronDown, Check, AlertTriangle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { useListBlagajne, getListBlagajneQueryKey } from "@workspace/api-client-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function BlagajnaSwitcher() {
  const { user } = useAuth();
  const { activeBlagajnaId, setActiveBlagajnaId } = useBlagajna();
  const jeAdminAliEnote = user?.vloga === "admin" || user?.vloga === "admin_enote";

  const { data: blagajne } = useListBlagajne({
    query: { enabled: jeAdminAliEnote, queryKey: getListBlagajneQueryKey() },
  });

  // Auto-selekcija: ob nalaganju blagajn preveri veljavnost shranjene vrednosti
  // in avtomatično izberi, če je na voljo samo ena blagajna
  useEffect(() => {
    if (!jeAdminAliEnote || !blagajne) return;

    const aktivne = blagajne.filter(b => b.aktivna);
    if (aktivne.length === 0) return;

    const veljavna = aktivne.find(b => b.id === activeBlagajnaId);

    if (!veljavna) {
      // Shranjena vrednost ni veljavna (zastarela, druga enota) ali ni nastavljena
      if (aktivne.length === 1) {
        // Samo ena blagajna → avtomatično nastavi
        setActiveBlagajnaId(aktivne[0].id);
      } else {
        // Več blagajn in neveljavna vrednost → počisti
        setActiveBlagajnaId(null);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blagajne, jeAdminAliEnote]);

  if (!jeAdminAliEnote) return null;
  if (!blagajne) return null;

  const aktivne = blagajne.filter(b => b.aktivna);

  // Samo ena blagajna → switcher ni potreben (samodejno izbrana)
  if (aktivne.length <= 1) return null;

  const aktivna = aktivne.find(b => b.id === activeBlagajnaId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all border ${
          !aktivna
            ? "text-amber-700 border-amber-300 bg-amber-50 hover:bg-amber-100"
            : "text-sidebar-foreground/80 border-sidebar-border/40 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
        }`}>
          {aktivna
            ? <MonitorCheck className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
            : <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-500" />}
          <span className="flex-1 text-left truncate">
            {aktivna
              ? <><span className="font-mono">{aktivna.ppId}-{aktivna.bId}</span>{aktivna.ime ? <span className="text-sidebar-foreground/60 ml-1">{aktivna.ime}</span> : null}</>
              : "Izberite blagajno"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-60">
        {aktivne.map(b => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => setActiveBlagajnaId(b.id)}
            className="flex items-center gap-2"
          >
            <Check className={`h-4 w-4 shrink-0 ${b.id === activeBlagajnaId ? "opacity-100" : "opacity-0"}`} />
            <span className="flex-1 truncate">
              <span className="font-mono text-xs">{b.ppId}-{b.bId}</span>
              {b.ime && <span className="text-muted-foreground ml-1">{b.ime}</span>}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
