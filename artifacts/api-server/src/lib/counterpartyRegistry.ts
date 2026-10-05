import { poisciNaInetis } from "./inetis";
import type { AjpesResult } from "./ajpesSim";

/** Real, exact-tax-ID registry lookup. Never synthesize a partner. */
export async function lookupCounterpartyInetis(rawTaxId: string): Promise<AjpesResult> {
  const taxId = rawTaxId.trim().toUpperCase().replace(/^SI\s*/, "").replace(/[\s.-]/g, "");
  if (!/^\d{8}$/.test(taxId)) throw new Error("Slovenska davčna številka mora vsebovati 8 števk.");
  const result = await poisciNaInetis(taxId, { throwOnFailure: true });
  return {
    found: !!result,
    taxId,
    registrationNumber: result?.maticnaStevilka ?? null,
    name: result?.naziv ?? "",
    address: result?.ulica ?? null,
    postCode: result?.postnaStevilka ?? null,
    city: result?.kraj ?? null,
    country: "SI",
    vatPayer: result?.zavezanecDdv ?? null,
    iban: result?.trr?.[0]?.iban ?? null,
    source: "inetis",
  };
}
