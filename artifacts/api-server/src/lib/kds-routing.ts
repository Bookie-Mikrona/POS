export function resolveKdsRoutingTargets(mappedStationIds: number[], fallbackStationId: number): {
  stationIds: number[];
  usedFallback: boolean;
} {
  const stationIds = [...new Set(mappedStationIds)];
  return stationIds.length ? { stationIds, usedFallback: false } : { stationIds: [fallbackStationId], usedFallback: true };
}

export type KdsProfile = "bar_combined_kitchen" | "bar_separate_kitchen_pizza";
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