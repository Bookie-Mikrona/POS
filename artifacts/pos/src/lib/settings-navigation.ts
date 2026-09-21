export type SettingsTab =
  | "mize" | "natakari" | "dostava" | "kds" | "enote" | "knjizenje"
  | "nastavitve" | "varnostne-kopije" | "moj-profil" | "glasovni-ukazi";

export type SettingsNavigationTarget =
  | { tab: Exclude<SettingsTab, "nastavitve"> }
  | { tab: "nastavitve"; section?: SettingsSection; card?: SettingsCard };

export type SettingsSection =
  | "sek-podjetje" | "sek-eracun" | "sek-naprave" | "sek-terminali"
  | "sek-tiskalniki" | "sek-vedenje" | "sek-sistem";

export type SettingsCard =
  | "ns-furs" | "ns-certifikat" | "ns-prostori" | "ns-blagajne"
  | "ns-eracun-registracija" | "ns-bizbox" | "ns-naprave" | "ns-terminal"
  | "ns-sumup" | "ns-viva" | "ns-android-tiskalnik" | "ns-agent"
  | "ns-scanner-bridge" | "ns-happy-hour" | "ns-zaloge" | "ns-prikaz"
  | "ns-izredni-pin" | "ns-ddv-razresev" | "ns-smtp" | "ns-ddv-stopnje"
  | "ns-testi";

const CARD_SECTIONS: Record<SettingsCard, SettingsSection> = {
  "ns-furs": "sek-podjetje", "ns-certifikat": "sek-podjetje",
  "ns-prostori": "sek-podjetje", "ns-blagajne": "sek-podjetje",
  "ns-eracun-registracija": "sek-eracun", "ns-bizbox": "sek-eracun",
  "ns-naprave": "sek-naprave",
  "ns-terminal": "sek-terminali", "ns-sumup": "sek-terminali", "ns-viva": "sek-terminali",
  "ns-android-tiskalnik": "sek-tiskalniki", "ns-agent": "sek-tiskalniki",
  "ns-scanner-bridge": "sek-tiskalniki",
  "ns-happy-hour": "sek-vedenje", "ns-zaloge": "sek-vedenje",
  "ns-prikaz": "sek-vedenje", "ns-izredni-pin": "sek-vedenje",
  "ns-ddv-razresev": "sek-vedenje",
  "ns-smtp": "sek-sistem", "ns-ddv-stopnje": "sek-sistem", "ns-testi": "sek-sistem",
};

const TABS = new Set<SettingsTab>([
  "mize", "natakari", "dostava", "kds", "enote", "knjizenje", "nastavitve",
  "varnostne-kopije", "moj-profil", "glasovni-ukazi",
]);
const SECTIONS = new Set<SettingsSection>(Object.values(CARD_SECTIONS));
const CARDS = new Set<SettingsCard>(Object.keys(CARD_SECTIONS) as SettingsCard[]);

export function resolveSettingsNavigationTarget(target: SettingsNavigationTarget): string {
  if (target.tab !== "nastavitve") return `/nastavitve?tab=${target.tab}`;
  const params = new URLSearchParams({ tab: "nastavitve" });
  if (target.card) {
    params.set("section", CARD_SECTIONS[target.card]);
    params.set("card", target.card);
  } else if (target.section) {
    params.set("section", target.section);
  }
  return `/nastavitve?${params.toString()}`;
}

/** Parses only the canonical, closed settings query contract. */
export function parseSettingsNavigation(path: string): SettingsNavigationTarget | null {
  if (!path.startsWith("/nastavitve?")) return null;
  const query = path.slice("/nastavitve?".length);
  const params = new URLSearchParams(query);
  if (params.toString() !== query || [...params.keys()].some(key => !["tab", "section", "card"].includes(key))
    || ["tab", "section", "card"].some(key => params.getAll(key).length > 1)) return null;
  const tab = params.get("tab");
  if (!tab || !TABS.has(tab as SettingsTab)) return null;
  const section = params.get("section");
  const card = params.get("card");
  if (tab !== "nastavitve") return !section && !card ? { tab: tab as Exclude<SettingsTab, "nastavitve"> } : null;
  if (!section && !card) return { tab: "nastavitve" };
  if (section && !SECTIONS.has(section as SettingsSection)) return null;
  if (card && !CARDS.has(card as SettingsCard)) return null;
  if (card && section !== CARD_SECTIONS[card as SettingsCard]) return null;
  return { tab: "nastavitve", ...(section ? { section: section as SettingsSection } : {}), ...(card ? { card: card as SettingsCard } : {}) };
}

export function resolveSafeAgentSettingsNavigation(path: string): string | null {
  const target = parseSettingsNavigation(path);
  return target ? resolveSettingsNavigationTarget(target) : null;
}