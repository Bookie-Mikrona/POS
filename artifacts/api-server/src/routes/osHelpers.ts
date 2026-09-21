/**
 * osHelpers.ts — Skupne agregacijske funkcije za register OS.
 *
 * PRAVILA (potrjena z uporabnikom):
 *  1. STATUS sredstva = aggregat iz vseh doknjižb; ne polje glave (ki je shranjeno)
 *  2. ŠTEVILO DOGRADITEV = count(seq > 0); osnova seq=0 se ne šteje
 *  3. OBDOBJE OBRAČUNA = MAX(leto*100+doMeseca) za sredstvo prek os_amortizacija_obracun_sredstvo
 *
 * Enako pravilo se uporablja v GET /osnovna-sredstva (seznam) IN GET /osnovna-sredstva/:id (kartica).
 * Ena resnica, ena implementacija.
 */

/** Formatira obračunsko obdobje kot "MM/YYYY" (z vodilno ničlo na mesecu). */
export function formatObracunPeriod(leto: number, doMeseca: number): string {
  return `${String(doMeseca).padStart(2, "0")}/${leto}`;
}

/**
 * Izračuna efektivni status sredstva iz agregiranih vrednosti vseh doknjižb.
 *
 * Pravilo (potrjeno z uporabnikom):
 *  - "izloceno"  → ohranjeno z glave (soft delete) ALI je nastavljeno datumOdtujitve
 *  - "v_teku"    → nobena doknjižba ni bila aktivirana (datumAktivacije = NULL za vse)
 *  - "v_uporabi" → vsaj ena doknjižba je neodpisana (Σ sedanjaVrednost > 0.005 €)
 *  - "odpisano"  → vse doknjižbe so polno odpisane (Σ sedanjaVrednost ≤ 0.005 €)
 *
 * Ne gledamo status polja glave (ki je shranjeno ob vpisu in se ne posodablja samodejno),
 * ampak računamo iz dejanskih vrednosti doknjižb.
 *
 * @param datumOdtujitve  Ko je nastavljeno, sredstvo velja za izločeno.
 */
export function resolveStatusSredstvo(
  glavaStatus: string,
  totals: { nabavna: number; odpisana: number; hasAktivirana: boolean },
  datumOdtujitve?: string | null,
): string {
  if (glavaStatus === "izloceno" || datumOdtujitve) return "izloceno";
  if (!totals.hasAktivirana) return "v_teku"; // nobena doknjižba ni aktivirana
  const sedanja = totals.nabavna - totals.odpisana;
  if (sedanja > 0.005) return "v_uporabi"; // vsaj 1 cent neodpisano
  return "odpisano";
}

/**
 * Iz surovih vrstic obračunov (JOIN os_amortizacija_obracun_sredstvo × os_amortizacija_obracun)
 * zgradi Map: sredstvo_id → zadnje (po leto×100 + doMeseca) "MM/YYYY" ali undefined.
 *
 * Vsako sredstvo dobi SVOJE dejansko obdobje — neodvisno od globalnega zadnjega obračuna.
 * Sredstvo brez vrstice v os_amortizacija_obracun_sredstvo → undefined → "—" v UI.
 */
export function buildObracunPeriodMap(
  rows: Array<{ sredstvoId: string; leto: number; doMeseca: number }>,
): Map<string, string> {
  const map = new Map<string, { leto: number; doMeseca: number }>();
  for (const r of rows) {
    const cur = map.get(r.sredstvoId);
    if (!cur || r.leto * 100 + r.doMeseca > cur.leto * 100 + cur.doMeseca) {
      map.set(r.sredstvoId, { leto: r.leto, doMeseca: r.doMeseca });
    }
  }
  const result = new Map<string, string>();
  for (const [id, { leto, doMeseca }] of map) {
    result.set(id, formatObracunPeriod(leto, doMeseca));
  }
  return result;
}

/**
 * Iz amortizacijske zgodovine (leto/doMeseca vrstice za eno sredstvo)
 * vrne MAX obdobje v obliki "MM/YYYY", ali null če ni zgodovine.
 *
 * Enako pravilo kot buildObracunPeriodMap, a za en sredstvo naenkrat
 * (uporablja se v kartica endpointu).
 */
export function maxObracunPeriod(
  vrstice: Array<{ leto: number; doMeseca: number }>,
): string | null {
  if (vrstice.length === 0) return null;
  const best = vrstice.reduce((a, b) =>
    a.leto * 100 + a.doMeseca >= b.leto * 100 + b.doMeseca ? a : b,
  );
  return formatObracunPeriod(best.leto, best.doMeseca);
}
