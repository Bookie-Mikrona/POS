/**
 * Vidnost zavihka "Enote" v Nastavitvah glede na POS vlogo.
 *
 * Pravila:
 *  - admin        → vidi (ureja, ustvarja, briše)
 *  - admin_enote  → vidi (samo ureja; brez ustvarjanja/brisanja)
 *  - superadmin   → NE vidi (superadmin upravlja podjetja, ne enot)
 *  - uporabnik    → NE vidi
 */
export function prikaziZavihekEnote(vloga: string | undefined): boolean {
  if (!vloga) return false;
  if (vloga === "superadmin") return false;
  return vloga === "admin" || vloga === "admin_enote";
}

/** Ali sme vloga ustvarjati in brisati enote (samo admin, ne admin_enote). */
export function smeUpravljatiEnote(vloga: string | undefined): boolean {
  return vloga === "admin";
}
