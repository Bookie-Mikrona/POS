export const DOSTAVA_STATUSI = [
  "prejeto", "potrjeno", "v_pripravi", "pripravljeno",
  "prevzel_kurir", "dostavljeno", "preklicano",
] as const;
export type DostavaStatus = typeof DOSTAVA_STATUSI[number];

const PREHODI: Record<DostavaStatus, readonly DostavaStatus[]> = {
  prejeto: ["potrjeno", "preklicano"],
  potrjeno: ["v_pripravi", "preklicano"],
  v_pripravi: ["pripravljeno", "preklicano"],
  pripravljeno: ["prevzel_kurir", "preklicano"],
  prevzel_kurir: ["dostavljeno"],
  dostavljeno: [],
  preklicano: [],
};

export function jeDostavaStatus(value: unknown): value is DostavaStatus {
  return typeof value === "string" && (DOSTAVA_STATUSI as readonly string[]).includes(value);
}

export function jeVeljavenDostavniPrehod(iz: DostavaStatus, v: DostavaStatus): boolean {
  return PREHODI[iz].includes(v);
}