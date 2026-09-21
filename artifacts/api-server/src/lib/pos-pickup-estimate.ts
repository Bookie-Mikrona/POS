export type PickupEstimateSettings = {
  osnovniCasMin: number;
  cakalnaVrstaMin: number;
  kapaciteta: number;
  najvecCasMin: number;
  zaokrozevanjeMin: number;
};

export type PickupEstimateLine = {
  artikelId?: number | null;
  kategorijaTip?: string | null;
  casPripraveMin: number | null | undefined;
  kolicina: number | null | undefined;
};

export const PRIVZETE_NASTAVITVE_PREVZEMA: PickupEstimateSettings = {
  osnovniCasMin: 5,
  cakalnaVrstaMin: 0,
  kapaciteta: 3,
  najvecCasMin: 30,
  zaokrozevanjeMin: 5,
};

export const PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE: PickupEstimateSettings = {
  osnovniCasMin: 3,
  cakalnaVrstaMin: 0,
  kapaciteta: 2,
  najvecCasMin: 20,
  zaokrozevanjeMin: 1,
};

function celoStevilo(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.round(parsed);
  return rounded < min || rounded > max ? fallback : rounded;
}

export function pickupEstimateSettingsFromMap(settings: Record<string, string>): PickupEstimateSettings {
  return {
    osnovniCasMin: celoStevilo(settings["telefonNarocilaOsnovniCasMin"], PRIVZETE_NASTAVITVE_PREVZEMA.osnovniCasMin, 1, 120),
    cakalnaVrstaMin: celoStevilo(settings["telefonNarocilaCakalnaVrstaMin"], PRIVZETE_NASTAVITVE_PREVZEMA.cakalnaVrstaMin, 0, 60),
    kapaciteta: celoStevilo(settings["telefonNarocilaKapaciteta"], PRIVZETE_NASTAVITVE_PREVZEMA.kapaciteta, 1, 50),
    najvecCasMin: celoStevilo(settings["telefonNarocilaNajvecCasMin"], PRIVZETE_NASTAVITVE_PREVZEMA.najvecCasMin, 5, 240),
    zaokrozevanjeMin: celoStevilo(settings["telefonNarocilaZaokrozevanjeMin"], PRIVZETE_NASTAVITVE_PREVZEMA.zaokrozevanjeMin, 0, 60),
  };
}

export function pickupBeverageEstimateSettingsFromMap(settings: Record<string, string>): PickupEstimateSettings {
  return {
    osnovniCasMin: celoStevilo(settings["telefonNarocilaPijacaOsnovniCasMin"], PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE.osnovniCasMin, 1, 120),
    cakalnaVrstaMin: celoStevilo(settings["telefonNarocilaPijacaCakalnaVrstaMin"], PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE.cakalnaVrstaMin, 0, 60),
    kapaciteta: celoStevilo(settings["telefonNarocilaPijacaKapaciteta"], PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE.kapaciteta, 1, 50),
    najvecCasMin: celoStevilo(settings["telefonNarocilaPijacaNajvecCasMin"], PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE.najvecCasMin, 5, 240),
    zaokrozevanjeMin: celoStevilo(settings["telefonNarocilaPijacaZaokrozevanjeMin"], PRIVZETE_NASTAVITVE_PREVZEMA_PIJACE.zaokrozevanjeMin, 0, 60),
  };
}

/** Samo prodajni artikli določajo tip naročila; child modifikatorji ga ne spremenijo. */
export function jeNarociloSamoPijaca(lines: PickupEstimateLine[]): boolean {
  const artikli = lines.filter((line) => line.artikelId != null);
  return artikli.length > 0 && artikli.every((line) => line.kategorijaTip === "pijaca");
}

export function samoPijace(lines: PickupEstimateLine[]): PickupEstimateLine[] {
  return lines.filter((line) => line.artikelId != null && line.kategorijaTip === "pijaca");
}

function workload(lines: PickupEstimateLine[]): number {
  return lines.reduce((sum, line) => {
    const minutes = Math.max(0, Number(line.casPripraveMin) || 0);
    const quantity = Math.max(0, Number(line.kolicina) || 0);
    return sum + minutes * quantity;
  }, 0);
}

/**
 * Vrne predviden čas prevzema brez branja ure, baze ali nastavitev.
 * Čakalna obremenitev predstavlja samo druge odprte, še-nepripravljene postavke.
 */
export function izracunajPredvidenPrevzem(
  ciljnePostavke: PickupEstimateLine[],
  cakalnaObremenitev: PickupEstimateLine[],
  settings: PickupEstimateSettings,
  referencniCas: Date,
): Date {
  const capacity = Math.max(1, settings.kapaciteta);
  const ownWorkload = workload(ciljnePostavke);
  const ownLongest = ciljnePostavke.reduce(
    (max, line) => Math.max(max, Math.max(0, Number(line.casPripraveMin) || 0)),
    0,
  );
  const queueDelay = Math.ceil(workload(cakalnaObremenitev) / capacity);
  const ownDuration = Math.max(
    settings.osnovniCasMin,
    ownLongest,
    Math.ceil(ownWorkload / capacity),
  );
  const totalMin = Math.min(
    Math.max(settings.osnovniCasMin, settings.najvecCasMin),
    queueDelay + ownDuration + settings.cakalnaVrstaMin,
  );
  const predvidenCasMs = referencniCas.getTime() + totalMin * 60_000;
  if (settings.zaokrozevanjeMin <= 1) return new Date(predvidenCasMs);
  const intervalMs = settings.zaokrozevanjeMin * 60_000;
  return new Date(Math.ceil(predvidenCasMs / intervalMs) * intervalMs);
}