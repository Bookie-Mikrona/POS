export type DostavniNaslovSnapshotInput = {
  ulica: string;
  hisnaStevilka: string;
  vhod?: string | null;
  nadstropje?: string | null;
  navodilo?: string | null;
  naseljeId: number;
  naseljeNaziv: string;
  cenaDostave: number;
  casDostaveMin: number;
};

export type DostavniArtikel = {
  id: number;
  ime: string;
  davek: number;
  vrstaArtikla?: string | null;
};

/**
 * Fiksna cena naselja ima prednost. Samo kadar je ta 0, je cena dostavne
 * storitve v šifrantu cena na kilometer. Rezultat se shrani na naročilo, zato
 * kasnejša sprememba cenika ne more spremeniti že odprte dostave.
 */
export function izracunajCenoDostave(
  cenaNaKm: number,
  oddaljenostKm: number,
  fiksnaCenaNaselja = 0,
): number {
  if (fiksnaCenaNaselja > 0) return Number(fiksnaCenaNaselja.toFixed(2));
  return Number((cenaNaKm * oddaljenostKm).toFixed(2));
}

export function ustvariDostavniSnapshot(naslov: DostavniNaslovSnapshotInput) {
  return {
    dostavaUlica: naslov.ulica,
    dostavaHisnaStevilka: naslov.hisnaStevilka,
    dostavaVhod: naslov.vhod ?? null,
    dostavaNadstropje: naslov.nadstropje ?? null,
    dostavaNavodilo: naslov.navodilo ?? null,
    dostavaNaseljeId: naslov.naseljeId,
    dostavaNaseljeNaziv: naslov.naseljeNaziv,
    dostavaCena: Number(naslov.cenaDostave.toFixed(2)),
    dostavaCasMin: naslov.casDostaveMin,
  };
}

/**
 * Dostava ni ločen obračun: gre za navadno postavko naročila z DDV iz
 * nastavljenega storitvenega artikla.
 */
export function ustvariDostavnoPostavko(
  artikel: DostavniArtikel,
  cenaDostave: number,
  jeDdvZavezanec: boolean,
) {
  const cenaKos = Number(cenaDostave.toFixed(2));
  return {
    artikelId: artikel.id,
    ime: artikel.ime,
    kolicina: 1,
    cenaKos,
    cenaKosOriginalna: cenaKos,
    skupaj: cenaKos,
    davek: jeDdvZavezanec ? artikel.davek : 0,
    toGo: false,
    vrstaArtikla: artikel.vrstaArtikla ?? "storitev",
  };
}

export function izracunajPredvidenoDostavo(
  predvidenPrevzem: Date | null,
  dostavaCasMin: number | null,
): Date | null {
  if (!predvidenPrevzem || dostavaCasMin == null) return null;
  return new Date(predvidenPrevzem.getTime() + dostavaCasMin * 60_000);
}