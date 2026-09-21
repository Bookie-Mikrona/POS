const slovenskiPrimerjalnik = new Intl.Collator("sl-SI", {
  usage: "sort",
  sensitivity: "base",
  numeric: true,
});

/** Primerjava besedila po slovenski abecedi: c, č, d ... s, š, t ... z, ž. */
export function primerjajSlovensko(a: string | null | undefined, b: string | null | undefined): number {
  return slovenskiPrimerjalnik.compare(a ?? "", b ?? "");
}