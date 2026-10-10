/**
 * Običajna slovenska gostinska konvencija PLU razponov in barv po skupini.
 * Razponi so le predlog; šifre lahko lokal poljubno spremeni.
 */
export type PluSkupina = {
  id: string;
  od: number;
  do: number;
  barva: string;
  ključne: RegExp;
};

const SKUPINE: PluSkupina[] = [
  { id: "kave", od: 1, do: 49, barva: "#92400e", ključne: /kav|topl|caj|cokol|kakav|espresso|kapucin/ },
  { id: "brezalkoholne", od: 50, do: 99, barva: "#3b82f6", ključne: /brezalk|vod|sok|gazir|hladn|osvezil/ },
  { id: "pivo", od: 100, do: 199, barva: "#eab308", ključne: /piv/ },
  { id: "vino", od: 200, do: 299, barva: "#9f1239", ključne: /vin|penin|spritz/ },
  { id: "zgane", od: 300, do: 399, barva: "#b45309", ključne: /zgan|zgane|zganj|koktajl|liker|aperitiv|viski|rum/ },
  { id: "sladice", od: 400, do: 499, barva: "#ec4899", ključne: /sladic|sladol|torta|palacink|kolac/ },
  { id: "dodatki", od: 900, do: 999, barva: "#64748b", ključne: /dodat|modif|storit/ },
  { id: "pice", od: 500, do: 899, barva: "#f97316", ključne: /pic|glavn|jed|kosil|malic|meso|rostilj/ },
  { id: "hrana", od: 500, do: 899, barva: "#22c55e", ključne: /hran|solat|predjed|juh|prilog|zajtrk/ },
];

function normaliziraj(ime: string): string {
  return ime.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d");
}

export function pluSkupinaZaKategorijo(ime: string | null | undefined): PluSkupina | null {
  if (!ime) return null;
  const n = normaliziraj(ime);
  return SKUPINE.find(s => s.ključne.test(n)) ?? null;
}

/** Prva prosta šifra v razponu skupine (privzeto 500–899, kot hrana in kuhinja). */
export function predlagajPlu(imeKategorije: string | null | undefined, zasedene: Iterable<string | null | undefined>): string | null {
  const skupina = pluSkupinaZaKategorijo(imeKategorije);
  const od = skupina?.od ?? 500;
  const do_ = skupina?.do ?? 899;
  const used = new Set<string>();
  for (const z of zasedene) if (z) used.add(z.trim().toLowerCase());
  for (let n = od; n <= do_; n++) if (!used.has(String(n))) return String(n);
  return null;
}

/** "3*101", "3x101", "3×101" → količina in šifra; sicer null. */
export function razcleniKolicinoInPlu(vnos: string): { kolicina: number; plu: string } | null {
  const m = vnos.trim().match(/^(\d{1,3})\s*[*x×]\s*([A-Za-z0-9]{1,10})$/i);
  if (!m) return null;
  const kolicina = Number(m[1]);
  return kolicina >= 1 ? { kolicina, plu: m[2] } : null;
}
