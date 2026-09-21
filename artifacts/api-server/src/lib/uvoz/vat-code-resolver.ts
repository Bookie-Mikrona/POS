import { Decimal } from "decimal.js";

export type InputVatCodeCandidate = {
  id: string;
  code: string;
  rate: string;
};

export type InputVatCodeResolution =
  | { kind: "matched"; vatCodeId: string }
  | { kind: "missing" }
  | { kind: "ambiguous"; candidateCount: number };

export function expectedPurchaseVatRateForArticle(
  explicitRate: string | null,
  taxCategory: string | null,
  addedSugar: boolean | null,
): string | null {
  if (explicitRate !== null) {
    try {
      return new Decimal(explicitRate).toFixed(2);
    } catch {
      return null;
    }
  }

  switch (taxCategory) {
    case "food":
    case "food_drink":
      return "9.50";
    case "hot_beverage":
    case "cold_beverage":
      return addedSugar ? "22.00" : "9.50";
    case "alcoholic":
    case "other":
      return "22.00";
    case "vat_super_reduced_5":
      return "5.00";
    default:
      return null;
  }
}

function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[\s._-]+/g, "");
}

function sameRate(left: string, right: string): boolean {
  try {
    return new Decimal(left).eq(new Decimal(right));
  } catch {
    return false;
  }
}

function ordinaryCodeForRate(rate: string | null): string | null {
  if (rate === null) return null;
  try {
    const value = new Decimal(rate);
    // Brez polne FURS kode 0 % ni dovolj informativen: lahko pomeni
    // oprostitev, zunajobsegni promet ali drug poseben režim.
    if (value.eq(0)) return null;
    return `P${value.toString().replace(".", "")}`;
  } catch {
    return null;
  }
}

function isOrdinarySupplierCategory(code: string | null): boolean {
  // EN 16931 uporablja S za domačo obdavčeno nabavo. CSV praviloma ne nosi
  // kategorije, zato je navadna pozitivna stopnja najvarneje obravnavana kot P.
  // E, O in Z nimajo iste KPR obravnave in se ne smejo privzeto preslikati.
  return code === null || normalizeCode(code) === "S";
}

/**
 * Iz dobaviteljeve surove kode oziroma stopnje izbere točno eno veljavno
 * vhodno FURS kodo. Nikoli ne ugiba med več možnimi KPR obravnavami.
 */
export function resolveInputVatCode(
  candidates: InputVatCodeCandidate[],
  importedCode: string | null,
  importedRate: string | null,
): InputVatCodeResolution {
  const code = importedCode?.trim() || null;
  const exactCodeMatches = code
    ? candidates.filter((candidate) => normalizeCode(candidate.code) === normalizeCode(code))
    : [];

  // Polna FURS koda ima prednost. Stopnja je dodatna varovalka, ne prepis.
  if (exactCodeMatches.length > 0) {
    const matches = importedRate === null
      ? exactCodeMatches
      : exactCodeMatches.filter((candidate) => sameRate(candidate.rate, importedRate));
    if (matches.length === 1) return { kind: "matched", vatCodeId: matches[0].id };
    if (matches.length === 0) return { kind: "missing" };
    return { kind: "ambiguous", candidateCount: matches.length };
  }

  const rateMatches = importedRate === null
    ? candidates
    : candidates.filter((candidate) => sameRate(candidate.rate, importedRate));

  if (!isOrdinarySupplierCategory(code)) {
    // O, E, Z, AE in druge posebne EN 16931 kategorije niso FURS kode.
    // Ne ugibamo njihove KPR obravnave; uvozni servis bo dodal DDV021.
    if (rateMatches.length > 1) {
      return { kind: "ambiguous", candidateCount: rateMatches.length };
    }
    return { kind: "missing" };
  }

  // Standardna dobaviteljeva kategorija ni FURS KPR koda. Samo pri njej je
  // semantika enoznačna: navadna domača nabava gre na standardno P-kodo.
  const ordinaryCode = ordinaryCodeForRate(importedRate);
  const ordinaryMatches = candidates.filter((candidate) =>
    ordinaryCode !== null
    && normalizeCode(candidate.code) === ordinaryCode
    && (importedRate === null || sameRate(candidate.rate, importedRate)),
  );
  if (ordinaryMatches.length === 1) {
    return { kind: "matched", vatCodeId: ordinaryMatches[0].id };
  }

  if (rateMatches.length === 0) return { kind: "missing" };
  return { kind: "ambiguous", candidateCount: rateMatches.length };
}