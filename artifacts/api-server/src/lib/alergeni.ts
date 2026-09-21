import { createHash } from "node:crypto";
import {
  EU_ALERGENI,
  type AlergenKoda,
  type AlergenStatusPotrditve,
  type AlergenVir,
} from "@workspace/db";

export { EU_ALERGENI, type AlergenKoda, type AlergenStatusPotrditve, type AlergenVir };

export const ALERGEN_KODE = new Set<string>(EU_ALERGENI.map((alergen) => alergen.koda));
export const ALERGEN_NAZIVI = new Map(EU_ALERGENI.map((alergen) => [alergen.koda, alergen.naziv]));

export type AlergenProfilInput = {
  alergeni?: unknown;
  alergeniSledi?: unknown;
  alergeniStatus?: unknown;
  alergeniVir?: unknown;
  alergeniOpombaVira?: unknown;
  alergeniDocumentId?: unknown;
  alergeniVerifiedBy?: unknown;
  alergeniVerifiedAt?: unknown;
};

export type NormaliziranAlergenProfil = {
  alergeni: AlergenKoda[];
  alergeniSledi: AlergenKoda[];
  alergeniStatus: AlergenStatusPotrditve;
  alergeniVir: AlergenVir | null;
  alergeniOpombaVira: string | null;
  alergeniDocumentId: string | null;
  alergeniVerifiedBy: string | null;
  alergeniVerifiedAt: Date | null;
  alergeniHash: string;
};

const STATUSES = new Set<AlergenStatusPotrditve>(["nepreverjeno", "potrjeno_brez", "potrjeno"]);
const SOURCES = new Set<AlergenVir>(["etiketa", "specifikacija", "izjava_dobavitelja", "normativ", "rocno", "drugo"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function codes(value: unknown, field: string): AlergenKoda[] {
  if (!Array.isArray(value) || !value.every((code) => typeof code === "string" && ALERGEN_KODE.has(code))) {
    throw new Error(`${field} mora biti seznam veljavnih EU alergenov.`);
  }
  if (new Set(value).size !== value.length) throw new Error(`${field} ne sme vsebovati podvojenih kod.`);
  return [...value].sort() as AlergenKoda[];
}

/**
 * Stroga normalizacija za artikel in POS prejemnično vrstico. Klicatelj mora
 * eksplicitno poslati profil; manjkajoč profil se ne interpretira kot brez
 * alergenov. `vsebuje` ima prednost pred `sledi`.
 */
export function normalizirajAlergenProfil(input: AlergenProfilInput): NormaliziranAlergenProfil {
  const alergeni = codes(input.alergeni, "alergeni");
  const alergeniSledi = codes(input.alergeniSledi, "alergeniSledi")
    .filter((code) => !alergeni.includes(code));
  const alergeniStatus = input.alergeniStatus;
  if (typeof alergeniStatus !== "string" || !STATUSES.has(alergeniStatus as AlergenStatusPotrditve)) {
    throw new Error("alergeniStatus mora biti nepreverjeno, potrjeno_brez ali potrjeno.");
  }
  const alergeniVir = input.alergeniVir ?? null;
  if (alergeniVir !== null && (typeof alergeniVir !== "string" || !SOURCES.has(alergeniVir as AlergenVir))) {
    throw new Error("alergeniVir ni veljaven vir alergenskega profila.");
  }
  if (alergeniStatus === "potrjeno_brez" && (alergeni.length || alergeniSledi.length)) {
    throw new Error("potrjeno_brez zahteva prazen seznam vsebuje in sledi.");
  }
  if (alergeniStatus === "potrjeno" && alergeni.length === 0 && alergeniSledi.length === 0) {
    throw new Error("Status potrjeno zahteva vsaj en alergen ali sled; za prazen seznam uporabite potrjeno_brez.");
  }
  if (alergeniStatus !== "nepreverjeno" && alergeniVir === null) {
    throw new Error("Potrjen alergenski profil mora imeti naveden vir.");
  }
  const note = input.alergeniOpombaVira ?? null;
  if (note !== null && (typeof note !== "string" || note.length > 2_000)) throw new Error("alergeniOpombaVira ni veljavna.");
  const documentId = input.alergeniDocumentId ?? null;
  if (documentId !== null && (typeof documentId !== "string" || !UUID_RE.test(documentId))) throw new Error("alergeniDocumentId ni veljaven UUID.");
  const verifiedBy = input.alergeniVerifiedBy ?? null;
  if (verifiedBy !== null && (typeof verifiedBy !== "string" || !verifiedBy.trim())) throw new Error("alergeniVerifiedBy ni veljaven.");
  const rawVerifiedAt = input.alergeniVerifiedAt ?? null;
  const verifiedAt = rawVerifiedAt === null ? null : new Date(String(rawVerifiedAt));
  if (verifiedAt !== null && Number.isNaN(verifiedAt.getTime())) throw new Error("alergeniVerifiedAt ni veljaven čas.");

  const stable = { alergeni, alergeniSledi, alergeniStatus: alergeniStatus as AlergenStatusPotrditve, alergeniVir, alergeniOpombaVira: note, alergeniDocumentId: documentId };
  return {
    ...stable,
    alergeniVir: alergeniVir as AlergenVir | null,
    alergeniOpombaVira: note as string | null,
    alergeniDocumentId: documentId as string | null,
    alergeniVerifiedBy: verifiedBy as string | null,
    alergeniVerifiedAt: verifiedAt,
    alergeniHash: createHash("sha256").update(JSON.stringify(stable)).digest("hex"),
  };
}

export function alergeniZNazivi(codes: readonly AlergenKoda[]) {
  return codes.map((koda) => ({ koda, naziv: ALERGEN_NAZIVI.get(koda)! }));
}