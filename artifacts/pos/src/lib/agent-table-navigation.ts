type TableWithNumber = {
  id: number;
  stevilka: number;
  ime?: string | null;
};
import { resolveSafeAgentSettingsNavigation } from "./settings-navigation";

export const AGENT_OPEN_TABLE_STORAGE_KEY = "pos_agent_open_table_number";
export const AGENT_OPEN_TABLE_EVENT = "pos:agent-open-table";

const SAFE_AGENT_STATIC_NAVIGATION_PATHS = new Set([
  "/", "/blagajna", "/meni", "/qr-meni", "/pripravljena-hrana",
  "/odpadki-s-kroznikov", "/racuni", "/statistike", "/operativna-porocila",
  "/izkaz", "/realizacija", "/temeljnice", "/blagajniski-premiki",
  "/rezervacije", "/dogodki", "/kuhinja", "/pice", "/izdaja", "/tocilnica",
  "/izmene", "/obracun-ur", "/zaloge", "/odstopanja", "/uvoz-cenik",
  "/partnerji", "/narocniki", "/stroskovana-mesta", "/kontni-plan",
  "/konti-za-temeljnice", "/nastavitve",
]);

export function resolveSafeAgentStaticNavigation(path: string): string | null {
  return SAFE_AGENT_STATIC_NAVIGATION_PATHS.has(path) ? path : resolveSafeAgentSettingsNavigation(path);
}

export function parseAgentOpenTableNumber(search: string): number | null {
  const rawTableNumber = new URLSearchParams(search).get("odpriMizo");
  if (!rawTableNumber || !/^\d+$/.test(rawTableNumber)) return null;
  const tableNumber = Number(rawTableNumber);
  return Number.isSafeInteger(tableNumber) && tableNumber > 0 ? tableNumber : null;
}

export function parseAgentOpenTableNavigation(navigateTo: string): number | null {
  const queryIndex = navigateTo.indexOf("?");
  if (queryIndex < 0) return null;
  return parseAgentOpenTableNumber(navigateTo.slice(queryIndex + 1));
}

export function resolveAgentOpenTable<T extends TableWithNumber>(
  search: string,
  tables: T[],
): T | null {
  const tableNumber = parseAgentOpenTableNumber(search);
  if (tableNumber === null) return null;
  const expectedName = `miza ${tableNumber}`;
  return tables.find(table =>
    table.stevilka === tableNumber
    || table.ime?.trim().toLocaleLowerCase("sl") === expectedName
  ) ?? null;
}