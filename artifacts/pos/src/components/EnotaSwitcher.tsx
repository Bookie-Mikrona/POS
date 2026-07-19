import { useState, useEffect } from "react";
import { Building2, ChevronDown, Check } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface Enota {
  id: number;
  ime: string;
  aktiven: boolean;
}

export function EnotaSwitcher() {
  const { user, updateUser } = useAuth();
  const [enote, setEnote] = useState<Enota[]>([]);
  const [switching, setSwitching] = useState(false);
  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${base}/api/enote`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((rows: Enota[]) => setEnote(rows.filter(e => e.aktiven)))
      .catch(() => setEnote([]));
  }, [base]);

  if (enote.length <= 1) return null;

  const trenutnaEnota = enote.find(e => e.id === user?.enotaId) ?? enote[0];

  const preklopi = async (id: number) => {
    if (id === user?.enotaId || switching) return;
    setSwitching(true);
    try {
      const r = await fetch(`${base}/api/enote/${id}/izberi`, {
        method: "POST",
        credentials: "include",
      });
      if (r.ok) {
        updateUser({ enotaId: id });
        window.location.reload();
      }
    } finally {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent/50 hover:text-sidebar-foreground transition-all border border-sidebar-border/40"
          disabled={switching}
        >
          <Building2 className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
          <span className="flex-1 text-left truncate">{trenutnaEnota?.ime ?? "Enota"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {enote.map(e => (
          <DropdownMenuItem
            key={e.id}
            onClick={() => preklopi(e.id)}
            className="flex items-center gap-2"
          >
            <Check className={`h-4 w-4 ${e.id === (user?.enotaId ?? enote[0]?.id) ? "opacity-100" : "opacity-0"}`} />
            <span className="flex-1 truncate">{e.ime}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
