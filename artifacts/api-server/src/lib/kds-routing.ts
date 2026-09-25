export function resolveKdsRoutingTargets(mappedStationIds: number[], fallbackStationId: number): {
  stationIds: number[];
  usedFallback: boolean;
} {
  const stationIds = [...new Set(mappedStationIds)];
  return stationIds.length ? { stationIds, usedFallback: false } : { stationIds: [fallbackStationId], usedFallback: true };
}

export type KdsProfile = "bar_combined_kitchen" | "bar_separate_kitchen_pizza";
export type PreparationKind = "pica" | "hrana" | "pijaca";

/** Legacy articles have no per-article station kind; infer only from operational labels. */
export function resolvePreparationKind(article: {
  pripravaVrsta?: PreparationKind | null;
  jePica?: boolean | null;
  kategorijaIme?: string | null;
  kategorijaTip?: string | null;
}): PreparationKind | null {
  if (article.jePica || article.pripravaVrsta === "pica") return "pica";
  if (article.pripravaVrsta) return article.pripravaVrsta;
  if (article.kategorijaTip === "pijaca") return "pijaca";
  if (article.kategorijaTip === "hrana") return "hrana";
  const name = (article.kategorijaIme ?? "").toLocaleLowerCase("sl");
  if (/\b(pic[aeo]|pizza|pizz[aeo])\b/u.test(name)) return "pica";
  if (/pijač|pijac|pivo|vino|žgan|zgan|napit|kava|bar\b/u.test(name)) return "pijaca";
  if (/embalaž|embalaz|bon|daril/u.test(name)) return null;
  return name ? "hrana" : null;
}

export function preparationStationType(kind: PreparationKind): "bar" | "kitchen" | "pizza" {
  return kind === "pijaca" ? "bar" : kind === "pica" ? "pizza" : "kitchen";
}

/** Manual station mappings win; otherwise use the article kind before the unit fallback. */
export function choosePreparationStations(
  mappedIds: number[], typedStationId: number | null, fallbackStationId: number,
): { stationIds: number[]; usedFallback: boolean } {
  return resolveKdsRoutingTargets(mappedIds.length ? mappedIds : typedStationId == null ? [] : [typedStationId], fallbackStationId);
}

export function planStandardKdsDisplays(profile: KdsProfile) {
  const base = [{ ime: "Bar", active: true, stationTypes: ["bar"] }];
  return profile === "bar_combined_kitchen"
    ? [...base, { ime: "Kuhinja", active: true, stationTypes: ["kitchen", "pizza"] }, { ime: "Pica", active: false, stationTypes: [] }]
    : [...base, { ime: "Kuhinja", active: true, stationTypes: ["kitchen"] }, { ime: "Pica", active: true, stationTypes: ["pizza"] }];
}

/** Tickets remain actionable until acknowledged; bumped is not terminal. */
export function isOutstandingKdsState(stanje: "aktivno" | "bumped" | "ack"): boolean {
  return stanje === "aktivno" || stanje === "bumped";
}