import { prikaziZavihekEnote } from "./enoteTabVidnost";
import type { SettingsTab } from "./settings-navigation";

/** Uses the same role rules as Settings tab triggers; unauthorized deep links fall back safely. */
export function resolveVisibleSettingsTab(requested: SettingsTab, role: string | undefined): SettingsTab {
  const isSuperAdmin = role === "superadmin";
  const isAdmin = role === "admin";
  const isAdminEnote = role === "admin_enote";
  const canManagePos = !isSuperAdmin && (isAdmin || isAdminEnote);
  if (requested === "nastavitve" || requested === "moj-profil" || requested === "glasovni-ukazi") return requested;
  if (requested === "varnostne-kopije") return isSuperAdmin ? requested : "nastavitve";
  if (requested === "enote") return prikaziZavihekEnote(role) ? requested : "nastavitve";
  if (requested === "knjizenje") return isAdmin ? requested : "nastavitve";
  return canManagePos ? requested : "nastavitve";
}