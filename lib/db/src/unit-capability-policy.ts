import type { UnitCapability } from "./schema/pos/enote";

/** Čista skupna politika: varna za strežnik in brskalnik, brez povezave z bazo. */
export const UNIT_CAPABILITY_DEPENDENCIES = [
  { capability: "delivery", requires: "phone_orders" },
  { capability: "reservations", requires: "tables" },
  { capability: "multi_course", requires: "kitchen" },
] as const satisfies readonly { capability: UnitCapability; requires: UnitCapability }[];

export function getMissingCapabilityDependencies(capabilities: readonly string[]) {
  const selected = new Set(capabilities);
  return UNIT_CAPABILITY_DEPENDENCIES.filter(
    dependency => selected.has(dependency.capability) && !selected.has(dependency.requires),
  );
}

const dependencyLabels: Partial<Record<UnitCapability, string>> = {
  delivery: "Dostava", phone_orders: "Telefonska naročila",
  reservations: "Rezervacije", tables: "Mize",
  multi_course: "Večhodni meniji", kitchen: "Kuhinja",
};

export function capabilityDependencyMessage(
  missing: ReturnType<typeof getMissingCapabilityDependencies>,
): string {
  return missing.map(({ capability, requires }) =>
    `Funkcija »${dependencyLabels[capability]}« zahteva funkcijo »${dependencyLabels[requires]}«.`,
  ).join(" ");
}
