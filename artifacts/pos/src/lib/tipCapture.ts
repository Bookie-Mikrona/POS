export type TipCaptureMethod = "cash" | "card";

/**
 * Adds a voluntarily entered tip to its actual collection channel.  The sale
 * amounts remain untouched, so a mixed sale can collect its tip in either
 * cash or on the card.
 */
export function applyTipCapture(
  saleCash: number,
  saleCard: number,
  tip: number,
  method: TipCaptureMethod,
): { cash: number; card: number } {
  const roundedTip = Math.round(Math.max(0, tip) * 100) / 100;
  return {
    cash: Math.round((saleCash + (method === "cash" ? roundedTip : 0)) * 100) / 100,
    card: Math.round((saleCard + (method === "card" ? roundedTip : 0)) * 100) / 100,
  };
}

export function tipPolicyNotice(): string {
  return "Davčna in računovodska obravnava se določi po veljavni politiki podjetja ob izdaji računa.";
}