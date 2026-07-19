import { MonitorCheck, ChevronDown, Check } from "lucide-react";
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

  if (!jeAdminAliEnote) return null;
  if (!blagajne || blagajne.length === 0) return null;

  const aktivne = blagajne.filter(b => b.aktivna);
  if (aktivne.length === 0) return null;

  const aktivna = blagajne.find(b => b.id === activeBlagajnaId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all border border-sidebar-border/40">
          <MonitorCheck className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="flex-1 text-left truncate">
            {aktivna ? `${aktivna.ppId}-${aktivna.bId}` : "Iz nastavitev"}
          </span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56">
        <DropdownMenuItem
          onClick={() => setActiveBlagajnaId(null)}
          className="flex items-center gap-2"
        >
          <Check className={`h-4 w-4 ${activeBlagajnaId === null ? "opacity-100" : "opacity-0"}`} />
          <span className="flex-1 truncate text-muted-foreground">Iz nastavitev (privzeto)</span>
        </DropdownMenuItem>
        {blagajne.map(b => (
          <DropdownMenuItem
            key={b.id}
            onClick={() => setActiveBlagajnaId(b.id)}
            className="flex items-center gap-2"
            disabled={!b.aktivna}
          >
            <Check className={`h-4 w-4 ${b.id === activeBlagajnaId ? "opacity-100" : "opacity-0"}`} />
            <span className="flex-1 truncate">
              <span className="font-mono text-xs">{b.ppId}-{b.bId}</span>
              {" "}<span className="text-muted-foreground">{b.ime}</span>
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
