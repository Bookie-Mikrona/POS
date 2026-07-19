/**
 * Pomožne funkcije za kopiranje normativa med artikli.
 *
 * Ločene od komponente, da jih je mogoče enota-testirati brez React/QueryClient.
 */

import type { Normativ } from "@workspace/api-client-react";

export type NormativItem = { vhodniArtikelId: number; kolicina: string; ime?: string };

/**
 * Pretvori normative iz API odgovora v format za lokalno stanje urejevalnika.
 */
export function preslikajNormativIzVira(normativi: Normativ[]): NormativItem[] {
  return normativi.map(n => ({
    vhodniArtikelId: n.vhodniArtikelId,
    kolicina: String(n.kolicina),
    ime: n.vhodniArtikelIme || undefined,
  }));
}

/**
 * Vrne true, kadar seznam normativov ne vsebuje nobene vrstice.
 * V tem primeru kopiranje ni smiselno in se prikaže napaka.
 */
export function jeNormativPrazen(normativi: Normativ[] | null | undefined): boolean {
  return !normativi || normativi.length === 0;
}
