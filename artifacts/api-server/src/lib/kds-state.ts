export type KdsStanje = "zadrzano" | "aktivno" | "bumped" | "ack" | "preklicano";
export type KdsDogodekTip = "materializiran" | "sproscen" | "bump" | "ack" | "preklic";

/** A duplicate request key is a retry, not a second state transition. */
export function canApplyKdsCommand(
  stanje: KdsStanje,
  tip: Extract<KdsDogodekTip, "bump" | "ack">,
  idempotencyKeyAlreadyUsed: boolean,
): boolean {
  if (idempotencyKeyAlreadyUsed) return true;
  return (tip === "bump" && stanje === "aktivno") || (tip === "ack" && stanje === "bumped");
}

/** Keep history deterministic even if a database adapter returns unordered rows. */
export function orderKdsHistory<T extends { zaporedje: number }>(events: T[]): T[] {
  return [...events].sort((a, b) => a.zaporedje - b.zaporedje);
}