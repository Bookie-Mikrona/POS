/**
 * Pomožne funkcije za obvladovanje privzetih modifikatorjev.
 *
 * Posplošeno iz sistema pice — deluje za kateri koli artikel z modifikatorji.
 * Ločeno od Order.tsx, da je logika enolično testabilna brez React konteksta.
 */

export interface DodatekMeta {
  aktiven?: boolean;
  jeDodatekZaPico?: boolean;
  jeModifikator?: boolean;
}

/**
 * Iz surového seznama ID-jev privzetih modifikatorjev ohrani samo tiste,
 * ki:
 *   1. obstajajo v artikliMap (niso bili izbrisani),
 *   2. imajo aktiven === true,
 *   3. imajo jeModifikator === true ALI jeDodatekZaPico === true
 *      (jeDodatekZaPico je ohranjen za nazajskladnost s starim sistemom pice).
 *
 * Namen: preprečiti, da se izbrisan ali deaktiviran modifikator
 * prikaže kot vnaprej označen v dialogu.
 */
export function filtrirajPrivzeteDodatke(
  rawIds: number[],
  artikliMap: Map<number, DodatekMeta>,
): number[] {
  return rawIds.filter(did => {
    const d = artikliMap.get(did);
    return !!d && d.aktiven === true && (d.jeModifikator === true || d.jeDodatekZaPico === true);
  });
}
