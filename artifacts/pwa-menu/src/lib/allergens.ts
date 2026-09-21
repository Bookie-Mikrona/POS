export type Alergen = { koda: string; naziv: string };

export type AlergeniSource = {
  alergeni?: Alergen[] | null;
  alergeniSledi?: Alergen[] | null;
  potrjen?: boolean;
  opozorila?: string[];
};

export function aggregateAllergens(
  base: AlergeniSource | null | undefined,
  modifiers: (AlergeniSource | null | undefined)[]
): {
  vsebuje: Alergen[];
  sledi: Alergen[];
  potrjen: boolean;
  opozorila: string[];
} {
  const vsebujeMap = new Map<string, string>();
  const slediMap = new Map<string, string>();
  let potrjen = base?.potrjen === true;
  const opozorilaSet = new Set<string>();

  const processSource = (src: AlergeniSource | null | undefined) => {
    if (!src) return;

    if (src.potrjen !== true) {
      potrjen = false;
    }

    if (src.opozorila) {
      for (const op of src.opozorila) {
        opozorilaSet.add(op);
      }
    }

    if (src.alergeni) {
      for (const a of src.alergeni) {
        vsebujeMap.set(a.koda, a.naziv);
      }
    }

    if (src.alergeniSledi) {
      for (const a of src.alergeniSledi) {
        slediMap.set(a.koda, a.naziv);
      }
    }
  };

  processSource(base);
  for (const mod of modifiers) {
    processSource(mod);
  }

  // vsebuje premaga sledi
  for (const koda of vsebujeMap.keys()) {
    if (slediMap.has(koda)) {
      slediMap.delete(koda);
    }
  }

  const vsebuje = Array.from(vsebujeMap.entries())
    .map(([koda, naziv]) => ({ koda, naziv }))
    .sort((a, b) => a.naziv.localeCompare(b.naziv));

  const sledi = Array.from(slediMap.entries())
    .map(([koda, naziv]) => ({ koda, naziv }))
    .sort((a, b) => a.naziv.localeCompare(b.naziv));

  return {
    vsebuje,
    sledi,
    potrjen,
    opozorila: Array.from(opozorilaSet),
  };
}
