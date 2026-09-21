/**
 * osKarticaVrednosti.ts — Čiste funkcije za vrednostni prikaz kartice OS
 *
 * Ločuje dve vrednosti:
 *   sedanjaVrednostPredObracunom  = nabavna − uvozena_odpisana
 *   sedanjaVrednostPoObracunu     = pred − Σ obracunano (vsa leta)
 *
 * Za per-doknjizbo: porazdelitev skupne amortizacije sorazmerno z amortizirljivo bazo.
 * Seštevek per-doknjizba poObracunu ≈ skupna (razlike max ±1 cent zaradi zaokroževanja).
 */

export interface KarticaDoknjizbaInput {
  /** nabavna vrednost (string decimale) */
  nabavnaVrednost: string;
  /** uvožena odpisana (string decimale) */
  odpisanaVrednost: string;
  /** amortizirljiva baza = NV × (100 − neamortizljivi%) / 100 (string decimale) */
  amortizirljivaBaza: string;
  /** true = doknjižba je izločena; ne vstopa v skupno amortizacijo */
  jeIzlocena: boolean;
}

export interface KarticaDoknjizbaVrednosti {
  /** nabavna − odpisana (= pred obračunom) */
  sedanjaVrednostPredObracunom: string;
  /**
   * Sedanja vrednost PO vseh shranjenih obračunih.
   * = predObračunom − delež skupne amortizacije (sorazmerno z amortizirljivo bazo).
   * Za izločene doknjizbe = sedanjaVrednostPredObracunom (ni amortizirljive baze).
   */
  sedanjaVrednostPoObracunu: string;
}

export interface KarticaVrednostiResult {
  /** skupnaNabavna − skupnaOdpisana (uvožena); = obstoječe "sedanjaVrednost" */
  sedanjaVrednostPredObracunom: string;
  /**
   * sedanjaVrednostPredObracunom − skupnaAmortizacijaObracunana.
   * Enaka konNed v medletnem registru za zadnje obdobje.
   */
  sedanjaVrednostPoObracunu: string;
  /** Σ obracunano iz os_amortizacija_obracun_sredstvo za VSA leta tega sredstva */
  skupnaAmortizacijaObracunana: string;
  /** Per-doknjizba razčlenitev (enako zaporedje kot vhodni array) */
  perDoknjizba: KarticaDoknjizbaVrednosti[];
}

/**
 * Izračuna vrednosti "pred obračunom" in "po obračunu" za kartico OS.
 *
 * @param nabavna        Skupna nabavna vrednost (Σ nabavnaVrednost vseh doknjižb)
 * @param odpisana       Skupna uvožena odpisana (Σ odpisanaVrednost vseh doknjižb)
 * @param skupnaAmortizacijaObracunana  Σ obracunano iz shranjenih obračunov za VSA leta
 * @param doknjizbe      Posamezne doknjižbe (za per-doc razčlenitev)
 */
export function calcKarticaVrednosti(
  nabavna: number,
  odpisana: number,
  skupnaAmortizacijaObracunana: number,
  doknjizbe: KarticaDoknjizbaInput[],
): KarticaVrednostiResult {
  const predObracunom = nabavna - odpisana;
  const poObracunu = predObracunom - skupnaAmortizacijaObracunana;

  // Skupna amortizirljiva baza (samo ne-izločene doknjizbe)
  const skupnaAmortizirljiva = doknjizbe.reduce(
    (s, d) => s + (d.jeIzlocena ? 0 : parseFloat(d.amortizirljivaBaza)),
    0,
  );

  const perDoknjizba: KarticaDoknjizbaVrednosti[] = doknjizbe.map((d) => {
    const nv = parseFloat(d.nabavnaVrednost);
    const ov = parseFloat(d.odpisanaVrednost);
    const sedanjaPred = nv - ov;

    let amortDelDoc = 0;
    if (!d.jeIzlocena && skupnaAmortizirljiva > 0) {
      const baza = parseFloat(d.amortizirljivaBaza);
      amortDelDoc = skupnaAmortizacijaObracunana * (baza / skupnaAmortizirljiva);
    }

    return {
      sedanjaVrednostPredObracunom: sedanjaPred.toFixed(2),
      sedanjaVrednostPoObracunu: Math.max(0, sedanjaPred - amortDelDoc).toFixed(2),
    };
  });

  return {
    sedanjaVrednostPredObracunom: predObracunom.toFixed(2),
    sedanjaVrednostPoObracunu: Math.max(0, poObracunu).toFixed(2),
    skupnaAmortizacijaObracunana: skupnaAmortizacijaObracunana.toFixed(2),
    perDoknjizba,
  };
}
