import type { KdsNalog } from "@/hooks/use-kds";

export type KdsCourseToFire = {
  courseNumber: number;
  courseSequence: number;
  pairingGroupId: string;
};

/** One eligible next course per independent menu pairing. */
export function getNextKdsCoursesToFire(nalogi: KdsNalog[]): KdsCourseToFire[] {
  const candidates: KdsCourseToFire[] = [];
  for (const pairingGroupId of new Set(nalogi.map(n => n.pairingGroupId).filter((id): id is string => Boolean(id)))) {
    const paired = nalogi.filter(n => n.pairingGroupId === pairingGroupId);
    const held = paired.filter(n => n.stanje === "zadrzano" && n.courseSequence != null && n.courseNumber != null);
    const sequence = held.reduce<number | undefined>((minimum, n) => {
      const current = n.courseSequence;
      if (current == null) return minimum;
      return minimum == null || current < minimum ? current : minimum;
    }, undefined);
    if (sequence == null || paired.some(n => n.courseSequence != null && n.courseSequence < sequence && n.stanje !== "bumped" && n.stanje !== "ack")) continue;
    const target = held.find(n => n.courseSequence === sequence)!;
    candidates.push({ courseNumber: target.courseNumber!, courseSequence: sequence, pairingGroupId });
  }
  return candidates.sort((a, b) => a.pairingGroupId.localeCompare(b.pairingGroupId));
}

export type MalicaKdsInference = "samo_glavna_jed" | "brez_juhe" | "brez_sladice" | "celotna";

/** Infers Malica composition from the immutable pairing-group encoding. */
export function inferMalicaKdsComposition(pairingGroupId: string | null | undefined): MalicaKdsInference | null {
  if (!pairingGroupId || !pairingGroupId.startsWith("malica:")) return null;
  const match = pairingGroupId.match(/^malica:s([01])m([01])d([01]):/);
  if (!match) return null;
  const hasSoup = match[1] === "1";
  const hasMain = match[2] === "1";
  const hasDessert = match[3] === "1";
  if (hasMain && !hasSoup && !hasDessert) return "samo_glavna_jed";
  if (hasMain && !hasSoup && hasDessert) return "brez_juhe";
  if (hasMain && hasSoup && !hasDessert) return "brez_sladice";
  if (hasMain && hasSoup && hasDessert) return "celotna";
  return null;
}