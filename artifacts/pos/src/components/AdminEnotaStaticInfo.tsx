import { Building2 } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Statični prikaz dodeljene enote za vlogo admin_enote.
 * Ne ponuja preklapljanja — enota je fiksna.
 */
export function AdminEnotaStaticInfo() {
  const { user } = useAuth();
  const enotaIme = user?.enotaIme ?? null;

  if (!enotaIme) return null;

  return (
    <div className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium text-sidebar-foreground/80 border border-sidebar-border/40">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/60" />
      <span className="flex-1 text-left truncate">{enotaIme}</span>
    </div>
  );
}
