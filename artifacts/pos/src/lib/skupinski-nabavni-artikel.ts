const ESLOG_UNIT_ALIASES: Record<string, string> = {
  KOM: "H87", KOS: "H87", PCE: "H87", EA: "H87",
  KG: "KGM",
  G: "GRM",
  L: "LTR",
  ML: "MLT",
  M: "MTR",
  M2: "MTK",
  M3: "MTQ",
  KAR: "CT",
  SKA: "BX",
};

const SUPPORTED_GROUP_UNITS = new Set([
  "H87", "KGM", "GRM", "LTR", "MLT", "MTR", "MTK", "MTQ", "CT", "BX",
]);

export function validateGroupSourceLine(
  isGroupTarget: boolean,
  targetUnit: string | null | undefined,
  sourceName: string | null | undefined,
  sourceUnit: string | null | undefined,
): string | null {
  if (!isGroupTarget) return null;
  if (!sourceName?.trim()) return "Vnesite dobaviteljev naziv postavke.";
  if (!sourceUnit?.trim()) return "Vnesite e-SLOG enoto dobaviteljeve postavke.";
  if (!canonicalEslogUnit(sourceUnit)) return `Enota dobavitelja »${sourceUnit}« ni podprta e-SLOG enota.`;
  if (!areEslogUnitsCompatible(sourceUnit, targetUnit)) {
    return `Enota dobavitelja (${sourceUnit}) ne ustreza enoti skupinskega artikla (${targetUnit ?? "ni navedena"}).`;
  }
  return null;
}

export function canonicalEslogUnit(unit: string | null | undefined): string | null {
  const normalized = unit?.trim().toUpperCase();
  if (!normalized) return null;
  const canonical = ESLOG_UNIT_ALIASES[normalized] ?? normalized;
  return SUPPORTED_GROUP_UNITS.has(canonical) ? canonical : null;
}

export function isGroupablePurchaseUnit(unit: string | null | undefined): boolean {
  const canonical = canonicalEslogUnit(unit);
  return Boolean(canonical && SUPPORTED_GROUP_UNITS.has(canonical));
}

export function areEslogUnitsCompatible(
  sourceUnit: string | null | undefined,
  targetUnit: string | null | undefined,
): boolean {
  const source = canonicalEslogUnit(sourceUnit);
  const target = canonicalEslogUnit(targetUnit);
  return Boolean(source && target && source === target);
}