import type { Izmena } from "@workspace/api-client-react";

export function availableShiftOperators(shifts: Izmena[] | undefined): Izmena[] {
  return (shifts ?? []).filter(shift => shift.naOdmoru !== true);
}