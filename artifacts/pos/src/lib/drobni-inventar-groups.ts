import { primerjajSlovensko } from "./slovensko-razvrscanje";

export const DROBNI_INVENTAR_SKUPINE = [
  { id: "01", naziv: "01 - Steklovina", popis: "Mesečno / trimesečno" },
  { id: "02", naziv: "02 - Porcelan", popis: "Trimesečno / polletno" },
  { id: "03", naziv: "03 - Jedilni pribor", popis: "Polletno / letno" },
  { id: "04", naziv: "04 - Kuhinjska posoda & GN", popis: "Letno" },
  { id: "05", naziv: "05 - Kuhinjska orodja", popis: "Polletno / letno" },
  { id: "06", naziv: "06 - Šank pripomočki", popis: "Letno" },
  { id: "07", naziv: "07 - Tekstil & Ostalo", popis: "Letno" },
] as const;

export type DrobniInventarArtikel = {
  id: number;
  ime: string;
  skupina?: string | null;
};

// Stare predloge so imele skodelice med steklovino in servirni deski med porcelanom.
// Razvrščanje popravi prikaz brez spreminjanja zgodovinskih artiklov ali listin.
const staraNapacnaSkupina = new Map([
  ["Skodelica za espresso s podstavkom", "02"],
  ["Skodelica za podaljšano kavo/kapučino", "02"],
  ["Skodelica za čaj/kakav", "02"],
  ["Lesena servirna deska za narezek/žar", "05"],
  ["Kamnita servirna deska za narezek/žar", "05"],
]);

export function drobniInventarSkupina(article: Pick<DrobniInventarArtikel, "ime" | "skupina">) {
  const naziv = article.skupina?.trim() ?? "";
  const canonical = DROBNI_INVENTAR_SKUPINE.find(group => group.naziv === naziv);
  if (canonical) return canonical;
  const id = /^(0[1-7])(?:\s|$)/.exec(naziv)?.[1];
  if (!id) return null;
  const mapped = staraNapacnaSkupina.get(article.ime);
  return DROBNI_INVENTAR_SKUPINE.find(group => group.id === (mapped ?? id)) ?? null;
}

export function sortDrobniInventar<T extends DrobniInventarArtikel>(articles: readonly T[]): T[] {
  return [...articles].sort((a, b) => {
    const groupA = drobniInventarSkupina(a)?.id ?? "99";
    const groupB = drobniInventarSkupina(b)?.id ?? "99";
    return groupA.localeCompare(groupB) || primerjajSlovensko(a.ime, b.ime) || a.id - b.id;
  });
}