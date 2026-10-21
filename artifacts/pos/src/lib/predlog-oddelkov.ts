/** Predlog oddelka (prikaz menija A) po imenu kategorije. Samo predlog: uporabi se šele po potrditvi. */
const TOCNA_IMENA: Record<string, string> = {
  "juhe": "Hrana",
  "zajtrki": "Hrana",
  "glavne jedi": "Hrana",
  "otroški meni": "Hrana",
  "sezonske jedi": "Hrana",
  "priloge": "Hrana",
  "solate": "Hrana",
  "pice": "Pica",
  "sladice": "Sladice",
  "topli napitki": "Kava",
  "brezalkoholne pijače": "Pijača",
  "pivo": "Pijača",
  "vino": "Pijača",
  "žgane pijače": "Pijača",
  "embalaža": "Drugo",
};

/** Delne ujemanja za imena, ki niso med točnimi (po vrstnem redu: prvo ujemanje velja). */
const KLJUCNE_BESEDE: Array<[RegExp, string]> = [
  [/\bpic[aeio]\b/, "Pica"],
  [/sladic|torta|torte|deserti?\b/, "Sladice"],
  [/\bkav|espresso|topli napitk/, "Kava"],
  [/pijač|pivo|piva|vino|vina|žgan|sok\b|soki\b|voda|vode/, "Pijača"],
  [/juh|zajtrk|jedi\b|jed\b|solat|prilog|malic|otroški/, "Hrana"],
];

export function predlogOddelka(ime: string): string {
  const n = ime.trim().toLocaleLowerCase("sl");
  if (TOCNA_IMENA[n]) return TOCNA_IMENA[n];
  for (const [re, oddelek] of KLJUCNE_BESEDE) if (re.test(n)) return oddelek;
  return "Drugo";
}
