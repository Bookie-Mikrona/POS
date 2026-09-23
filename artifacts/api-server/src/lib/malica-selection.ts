export type SelectedCourse = { id: number; courseType: "soup" | "dessert"; artikelId: number; quantity?: number | string; enabled?: boolean; remainingQuantity?: number; preparedAvailable?: boolean };
export type ClassifiedMalicaSelection = { selected: SelectedCourse[]; included: SelectedCourse[]; extras: SelectedCourse[] };

/** Canonical ordered selection semantics shared by quote and sale. */
export function classifyMalicaSelection(
  soupIds: number[] = [], dessertIds: number[] = [], rows: SelectedCourse[],
): ClassifiedMalicaSelection {
  const requested = [...soupIds, ...dessertIds];
  if (new Set(requested).size !== requested.length) throw new Error("DUPLICATE_COURSE_SELECTION");
  const byId = new Map(rows.map(row => [row.id, row]));
  const selected = requested.map(id => {
    const row = byId.get(id);
    if (!row) throw new Error("COURSE_NOT_ON_OFFER");
    if (!row.enabled) throw new Error("COURSE_DISABLED");
    if (row.remainingQuantity != null && row.remainingQuantity < 1) throw new Error("COURSE_UNAVAILABLE");
    if (row.preparedAvailable === false) throw new Error("COURSE_PREPARED_UNAVAILABLE");
    if ((soupIds.includes(id) && row.courseType !== "soup") || (dessertIds.includes(id) && row.courseType !== "dessert")) throw new Error("COURSE_TYPE_MISMATCH");
    return row;
  });
  const included: SelectedCourse[] = [];
  for (const type of ["soup", "dessert"] as const) {
    const first = selected.find(row => row.courseType === type);
    if (first) included.push(first);
  }
  return { selected, included, extras: selected.filter(row => !included.some(item => item.id === row.id)) };
}