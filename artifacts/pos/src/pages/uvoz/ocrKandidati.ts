interface OcrOpozorilo {
  koda?: string;
}

interface OcrKandidatArtikel {
  ime: string;
  imeZaNabavo?: string | null;
  povratnaEmbalaza?: boolean;
}

export function jeOcrVrsticaEmbalaze(opozorila: OcrOpozorilo[] | string | null): boolean {
  let seznam: OcrOpozorilo[] = [];
  if (Array.isArray(opozorila)) {
    seznam = opozorila;
  } else if (opozorila) {
    try {
      const parsed = JSON.parse(opozorila) as unknown;
      seznam = Array.isArray(parsed) ? parsed as OcrOpozorilo[] : [];
    } catch {
      seznam = [];
    }
  }
  return seznam.some(opozorilo => opozorilo.koda === "EMB001");
}

export function artikelJeKandidatZaOcrVrstico(
  artikel: OcrKandidatArtikel,
  opozorila: OcrOpozorilo[] | string | null,
  iskalniNiz: string,
): boolean {
  const jeEmbalaza = jeOcrVrsticaEmbalaze(opozorila);
  if (Boolean(artikel.povratnaEmbalaza) !== jeEmbalaza) return false;

  const q = iskalniNiz.toLowerCase().trim();
  const nabavniNaziv = (artikel.imeZaNabavo ?? artikel.ime).toLowerCase();
  return nabavniNaziv.includes(q) || artikel.ime.toLowerCase().includes(q);
}