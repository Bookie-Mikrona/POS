import Decimal from "decimal.js";

const WORD_NUMBERS: Record<string, number> = {
  en: 1, ena: 1, eno: 1, dva: 2, dve: 2, tri: 3, trije: 3, štiri: 4, stiri: 4,
  pet: 5, šest: 6, sest: 6, sedem: 7, osem: 8, devet: 9, deset: 10,
  pol: 0.5, polovica: 0.5, četrt: 0.25, cetrt: 0.25,
};
const UNIT_WORDS = "(?:kilolit|hektolit|decilit|centilit|mililit|lit)(?:er|ra|ri|re|rov)";
const NUMBER = `(?:\\d+(?:[.,]\\d+)?|${Object.keys(WORD_NUMBERS).join("|")})`;
const VOLUME = `(?<![\\p{L}\\p{N}])(${NUMBER}(?:\\s+in\\s+pol)?)\\s*(${UNIT_WORDS}|dcl|ml|cl|dl|hl|kl|l)(?![\\p{L}\\p{N}])`;

function unitFactor(unit: string): number | null {
  const normalized = unit.trim().toLocaleLowerCase("sl-SI").replace(/\.$/, "");
  if (/^(l|ltr|lit(?:er|ra|ri|re|rov)|litre|litres|liters)$/.test(normalized)) return 1;
  if (/^(dl|dcl|decilit(?:er|ra|ri|re|rov))$/.test(normalized)) return 0.1;
  if (/^(cl|centilit(?:er|ra|ri|re|rov))$/.test(normalized)) return 0.01;
  if (/^(ml|mililit(?:er|ra|ri|re|rov))$/.test(normalized)) return 0.001;
  if (/^(hl|hektolit(?:er|ra|ri|re|rov))$/.test(normalized)) return 100;
  if (/^(kl|kilolit(?:er|ra|ri|re|rov))$/.test(normalized)) return 1000;
  return null;
}

export function parseDrinkVolumeName(name: string) {
  const normalized = name.normalize("NFC").trim();
  const matches = [...normalized.matchAll(new RegExp(VOLUME, "giu"))];
  const baseName = normalized.replace(new RegExp(VOLUME, "giu"), " ")
    .replace(/\s+/g, " ").replace(/^[\s()/,;:–—-]+|[\s()/,;:–—-]+$/g, "").trim();
  if (matches.length !== 1 || !baseName) return { baseName, liters: null };
  const match = matches[0];
  // A pack is not a serving. Do not silently interpret 6 × 0.75 l as 0.75 l.
  if (/\d+\s*[x×]\s*$/i.test(normalized.slice(0, match.index))) return { baseName, liters: null };
  const token = match[1].toLocaleLowerCase("sl-SI");
  const whole = token.replace(/\s+in\s+pol$/, "");
  const quantity = WORD_NUMBERS[whole] ?? Number(whole.replace(",", "."));
  const liters = new Decimal(quantity).plus(token !== whole ? 0.5 : 0).mul(unitFactor(match[2])!);
  return { baseName, liters: liters.isFinite() && liters.gt(0) ? liters.toNumber() : null };
}

export function drinkNameKey(name: string): string {
  return name.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sl-SI")
    .replace(/\s+/g, " ").trim();
}

export function automaticDrinkVolume(article: {
  ime: string; taxCategory: string; nabavniArtikel: boolean; prodajniArtikel: boolean;
  povratnaEmbalaza?: boolean; drobniInventar?: boolean; jePica?: boolean;
}) {
  if (!article.prodajniArtikel || article.nabavniArtikel || article.povratnaEmbalaza
    || article.drobniInventar || article.jePica
    || !["alcoholic", "cold_beverage"].includes(article.taxCategory)) return null;
  const volume = parseDrinkVolumeName(article.ime);
  return volume.liters != null ? { baseName: volume.baseName, liters: volume.liters } : null;
}

export function drinkNormativeQuantity(saleLiters: number, purchase: { ime: string; enotaMere: string | null }) {
  // A bottle labelled 0.75 l but stocked in liters still consumes 0.1 liters,
  // not 0.1333 liters. Only piece/bottle inventory needs the package volume.
  const factor = purchase.enotaMere ? unitFactor(purchase.enotaMere) : null;
  const pieces = purchase.enotaMere == null || /^(kos\.?|kom\.?|h87|c62|ea|pce|pcs?|stk|steklenic[a-e]|steklenička|steklenicka|bottle|bot)$/i.test(purchase.enotaMere.trim());
  if (factor == null && !pieces) return null;
  const litersPerStockUnit = factor ?? parseDrinkVolumeName(purchase.ime).liters ?? 1;
  const quantity = new Decimal(saleLiters).div(litersPerStockUnit).toDecimalPlaces(4);
  return quantity.gt(0) && quantity.lt(1_000_000) ? quantity.toNumber() : null;
}