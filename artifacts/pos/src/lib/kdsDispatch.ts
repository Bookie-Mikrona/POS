export type KdsTicketState = "zadrzano" | "aktivno" | "bumped" | "ack" | "preklicano";

export function canAcknowledgeKdsTicket(
  state: KdsTicketState,
  dispatchOmogocen: boolean,
): boolean {
  return state === "bumped" && !dispatchOmogocen;
}