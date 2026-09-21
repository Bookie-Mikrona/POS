import { normalizirajAlergenProfil } from "./alergeni";

const ALERGEN_PROFILE_FIELDS = [
  "alergeni",
  "alergeniSledi",
  "alergeniStatus",
  "alergeniVir",
  "alergeniOpombaVira",
  "alergeniDocumentId",
  "alergeniVerifiedBy",
  "alergeniVerifiedAt",
] as const;

function imaAlergenskiProfil(postavka: Record<string, unknown>): boolean {
  return ALERGEN_PROFILE_FIELDS.some((key) =>
    Object.prototype.hasOwnProperty.call(postavka, key),
  );
}

export function zahtevajPotrjenAlergenskiSnapshot(postavka: Record<string, unknown>) {
  if (!imaAlergenskiProfil(postavka)) {
    throw new Error(
      "Za vsako postavko prejemnice je treba vnesti in potrditi alergene ali izrecno potrditi, da jih ni.",
    );
  }
  const profile = normalizirajAlergenProfil(postavka);
  if (profile.alergeniStatus === "nepreverjeno") {
    throw new Error(
      "Alergenski profil postavke prejemnice mora biti pred shranjevanjem potrjen.",
    );
  }
  return profile;
}

/**
 * Pri urejanju količine, cene ali DDV obstoječ alergenski posnetek ostane
 * zgodovinski dokaz. Nov potrjen profil zahtevamo le za novo vrstico oziroma
 * ko uporabnik na obstoječi vrstici zamenja artikel.
 */
export function alergenskiSnapshotZaUrejanje(
  postavka: Record<string, unknown>,
  oldArtikelId: number | null | undefined,
) {
  const istiArtikel =
    oldArtikelId != null && Number(postavka.artikelId) === oldArtikelId;

  if (istiArtikel) {
    if (!imaAlergenskiProfil(postavka)) return null;
    const profile = normalizirajAlergenProfil(postavka);
    if (profile.alergeniStatus === "nepreverjeno") return null;
    return profile;
  }

  return zahtevajPotrjenAlergenskiSnapshot(postavka);
}

export function alergenskiSnapshotZaPovratnoEmbalazo(verifiedBy?: string | null) {
  return alergenskiSnapshotBrezAlergenov(verifiedBy, "Povratna embalaža");
}

export function alergenskiSnapshotBrezAlergenov(
  verifiedBy?: string | null,
  opomba = "Testno delovanje",
) {
  return zahtevajPotrjenAlergenskiSnapshot({
    alergeni: [],
    alergeniSledi: [],
    alergeniStatus: "potrjeno_brez",
    alergeniVir: "drugo",
    alergeniOpombaVira: opomba,
    alergeniDocumentId: null,
    alergeniVerifiedBy: verifiedBy ?? null,
    alergeniVerifiedAt: new Date(),
  });
}