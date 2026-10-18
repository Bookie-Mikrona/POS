import type { ZacetnaZalogaFull } from "@workspace/api-client-react";

export function openingStockBookingNotice(
  result: Pick<ZacetnaZalogaFull, "bookingRef" | "bookingSkipped" | "bookingWarnings">,
): string | undefined {
  if (result.bookingRef) {
    return [
      `Ustvarjen osnutek temeljnice (${result.bookingRef}).`,
      ...(result.bookingWarnings ?? []),
    ].join(" ");
  }
  if (result.bookingSkipped) {
    return `ERP knjiženje preskočeno: ${result.bookingSkipped}`;
  }
  return undefined;
}
