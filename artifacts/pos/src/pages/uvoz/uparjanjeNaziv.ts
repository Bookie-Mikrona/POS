/** Izvleče urejen seznam decimalnih števil iz naziva. */
export function stevilkeIzNaziva(naziv: string | null | undefined): string[] {
  return (String(naziv ?? '').toLowerCase().replace(/,/g, '.').match(/\d+\.?\d*/g) ?? []).sort();
}

/** True ko oba naziva vsebujeta števila, ki se ne ujemajo (npr. "1kg" vs "3.6 kg"). */
export function jeMismatchVelikosti(
  nazivArtikla: string | null | undefined,
  nazivDobavnice: string | null | undefined,
): boolean {
  const a = stevilkeIzNaziva(nazivArtikla);
  const b = stevilkeIzNaziva(nazivDobavnice);
  return a.length > 0 && b.length > 0 && JSON.stringify(a) !== JSON.stringify(b);
}