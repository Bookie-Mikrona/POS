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