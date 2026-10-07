/**
 * Datum za uporabniška sporočila (toasti, napake): YYYY-MM-DD → dd.mm.yyyy,
 * YYYY-MM → mm.yyyy. Drugih vrednosti ne spreminja. API pogodba ostane ISO.
 */
export function slovenskiDatumZaSporocilo(vrednost: string): string {
  const dan = /^(\d{4})-(\d{2})-(\d{2})$/.exec(vrednost);
  if (dan) return `${dan[3]}.${dan[2]}.${dan[1]}`;
  const mesec = /^(\d{4})-(\d{2})$/.exec(vrednost);
  return mesec ? `${mesec[2]}.${mesec[1]}` : vrednost;
}
