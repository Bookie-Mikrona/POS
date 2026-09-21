import type { KdsNalog } from "@/hooks/use-kds";

export type KdsPairingPostavka = {
  id: number;
  ime: string;
  pairingGroupId?: string | null;
  courseSequence?: number | null;
  kategorijaIme?: string | null;
  enotaMere?: string | null;
};

export function isBarOnlyStation(stationTypes?: readonly string[]): boolean {
  return stationTypes?.length === 1 && stationTypes[0] === "bar";
}

export function getKdsStationStatusLabel(nalog: Pick<KdsNalog, "stanje" | "courseNumber" | "courseSequence">, barOnly: boolean): string {
  if (!barOnly) {
    if (nalog.stanje === "zadrzano") return "HOLD · Na čakanju";
    if (nalog.stanje === "aktivno") return "FIRE · V pripravi";
    return "";
  }
  if (nalog.stanje === "aktivno") return "FIRE · READY TO POUR";
  if (nalog.stanje === "zadrzano") {
    const course = nalog.courseNumber ?? nalog.courseSequence;
    return course == null ? "PENDING · Čaka na FIRE" : `PENDING · Čaka na FIRE ${course}. hoda`;
  }
  return "SERVED · Postreženo";
}

/** The matching menu line has the same immutable pairing identity, but another order-line id. */
export function getPairedFoodName(wine: KdsPairingPostavka, postavke: readonly KdsPairingPostavka[]): string | undefined {
  if (!wine.pairingGroupId || wine.courseSequence == null) return undefined;
  const candidates = postavke.filter((line) =>
    line.id !== wine.id
    && line.pairingGroupId === wine.pairingGroupId
    && line.courseSequence === wine.courseSequence,
  );
  // A paired course normally contains exactly food and wine. If a menu has an
  // additional line, prefer its food-category line without guessing from names.
  return (candidates.find((line) => line.kategorijaIme?.toLocaleLowerCase("sl").includes("hrana")) ?? candidates[0])?.ime;
}

/** Shows a familiar wine serving measure even when it is supplied in the item name. */
export function getBarServingSize(itemName: string, unit?: string | null): string | undefined {
  const source = `${itemName} ${unit ?? ""}`.toLocaleLowerCase("sl");
  if (/\b1\s*dcl\b/.test(source) || /\b0[,.]1\s*l\b/.test(source)) return "1 dcl";
  return unit?.trim() || undefined;
}

export function getKdsPriority(stanje: KdsNalog["stanje"], barOnly: boolean): number {
  if (!barOnly) return 0;
  if (stanje === "aktivno") return 0;
  if (stanje === "zadrzano") return 1;
  return 2;
}

export function sortKdsNalogiForStation(nalogi: readonly KdsNalog[], barOnly: boolean): KdsNalog[] {
  return [...nalogi].sort((a, b) => {
    const priority = getKdsPriority(a.stanje, barOnly) - getKdsPriority(b.stanje, barOnly);
    if (priority !== 0) return priority;
    const sequence = (a.courseSequence ?? Number.MAX_SAFE_INTEGER) - (b.courseSequence ?? Number.MAX_SAFE_INTEGER);
    if (sequence !== 0) return sequence;
    return a.id - b.id;
  });
}