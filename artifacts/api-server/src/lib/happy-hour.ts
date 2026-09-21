export const VSE_DNI_HAPPY_HOUR = [1, 2, 3, 4, 5, 6, 7] as const;
export const VSE_VELIKOSTI_PICE_HAPPY_HOUR = ["mala", "normalna", "druzinska"] as const;
export type HappyHourVelikostPice = typeof VSE_VELIKOSTI_PICE_HAPPY_HOUR[number];

export interface HappyHourPravilo {
  id: string;
  naziv: string;
  od: string;
  do: string;
  dnevi: number[];
  artikelIds: number[];
  velikostiPice?: HappyHourVelikostPice[];
}

const DNEVI_BY_SHORT_NAME: Record<string, number> = {
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
  Sun: 7,
};

function jeCas(cas: unknown): cas is string {
  return typeof cas === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(cas);
}

function normalizeRule(raw: unknown, index: number): HappyHourPravilo | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<HappyHourPravilo>;
  if (!jeCas(candidate.od) || !jeCas(candidate.do)) return null;

  const dnevi = Array.isArray(candidate.dnevi)
    ? [...new Set(candidate.dnevi.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))]
    : [...VSE_DNI_HAPPY_HOUR];
  const artikelIds = Array.isArray(candidate.artikelIds)
    ? [...new Set(candidate.artikelIds.map(Number).filter((id) => Number.isInteger(id) && id > 0))]
    : [];
  const velikostiPice = Array.isArray(candidate.velikostiPice)
    ? [...new Set(candidate.velikostiPice.filter(
        (velikost): velikost is HappyHourVelikostPice =>
          VSE_VELIKOSTI_PICE_HAPPY_HOUR.includes(velikost as HappyHourVelikostPice),
      ))]
    : [...VSE_VELIKOSTI_PICE_HAPPY_HOUR];
  if (dnevi.length === 0 || artikelIds.length === 0) return null;

  return {
    id: typeof candidate.id === "string" && candidate.id.trim() ? candidate.id : `hh-${index + 1}`,
    naziv: typeof candidate.naziv === "string" && candidate.naziv.trim()
      ? candidate.naziv.trim().slice(0, 80)
      : `Happy Hour ${index + 1}`,
    od: candidate.od,
    do: candidate.do,
    dnevi,
    artikelIds,
    velikostiPice,
  };
}

export function normalizeHappyHourRules(raw: unknown): HappyHourPravilo[] {
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeRule).filter((rule): rule is HappyHourPravilo => rule !== null);
}

export function parseHappyHourRules(
  raw: unknown,
  legacyOd: string,
  legacyDo: string,
  legacyArtikelIds: number[],
): HappyHourPravilo[] {
  const rules = normalizeHappyHourRules(raw);
  if (rules.length > 0) return rules;
  if (!jeCas(legacyOd) || !jeCas(legacyDo)) return [];
  return [{
    id: "legacy",
    naziv: "Obstoječi Happy Hour",
    od: legacyOd,
    do: legacyDo,
    dnevi: [...VSE_DNI_HAPPY_HOUR],
    artikelIds: legacyArtikelIds,
    velikostiPice: [...VSE_VELIKOSTI_PICE_HAPPY_HOUR],
  }];
}

function lokalniDatum(date: Date): { dan: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Ljubljana",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dan = DNEVI_BY_SHORT_NAME[values.weekday] ?? 1;
  return { dan, minute: Number(values.hour) * 60 + Number(values.minute) };
}

function minute(cas: string): number {
  const [h, m] = cas.split(":").map(Number);
  return h * 60 + m;
}

export function isHappyHourRuleActive(rule: HappyHourPravilo, date = new Date()): boolean {
  const { dan, minute: trenutnaMinuta } = lokalniDatum(date);
  const zacetek = minute(rule.od);
  const konec = minute(rule.do);
  const prejsnjiDan = dan === 1 ? 7 : dan - 1;

  // Enak začetek in konec pomenita celodnevno pravilo.
  if (zacetek === konec) return rule.dnevi.includes(dan);
  if (konec > zacetek) {
    return rule.dnevi.includes(dan) && trenutnaMinuta >= zacetek && trenutnaMinuta < konec;
  }

  // Pri nočnem urniku se del po polnoči šteje k dnevu začetka.
  return (rule.dnevi.includes(dan) && trenutnaMinuta >= zacetek)
    || (rule.dnevi.includes(prejsnjiDan) && trenutnaMinuta < konec);
}

export function isHappyHourActiveForArticle(
  rules: HappyHourPravilo[],
  articleId: number,
  rocno: string,
  date = new Date(),
  velikostPice?: HappyHourVelikostPice,
): boolean {
  if (rocno === "off") return false;
  if (rocno === "on") return true;
  if (rules.length === 0) return false;
  return rules.some((rule) => {
    if (!rule.artikelIds.includes(articleId)) return false;
    if (velikostPice && !(rule.velikostiPice ?? VSE_VELIKOSTI_PICE_HAPPY_HOUR).includes(velikostPice)) return false;
    return isHappyHourRuleActive(rule, date);
  });
}

export function isAnyHappyHourActive(
  rules: HappyHourPravilo[],
  rocno: string,
  date = new Date(),
): boolean {
  if (rocno === "off") return false;
  if (rocno === "on") return true;
  if (rules.length === 0) return false;
  return rules.some((rule) => isHappyHourRuleActive(rule, date));
}
