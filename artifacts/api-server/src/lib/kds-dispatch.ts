import { and, eq, sql } from "drizzle-orm";
import { kdsIzdajaDogodkiTable } from "@workspace/db";

type KdsExecutor = {
  execute: (query: any) => Promise<unknown>;
  select: any;
};

export class KdsOrderAlreadyDispatchedError extends Error {
  readonly code = "KDS_NAROCILO_JE_PREDANO";
  constructor() { super("Sestave naročila po predaji ni več mogoče spreminjati."); }
}

/** Locks an order consistently across composition and dispatch transactions. */
export async function lockKdsOrder(tx: KdsExecutor, narociloId: number): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(494, ${narociloId})`);
}

/** Must execute after lockKdsOrder and inside the caller's transaction. */
export async function assertKdsOrderNotDispatched(tx: KdsExecutor, narociloId: number, enotaId: number): Promise<void> {
  const [event] = await tx.select({ id: kdsIzdajaDogodkiTable.id }).from(kdsIzdajaDogodkiTable)
    .where(and(eq(kdsIzdajaDogodkiTable.narociloId, narociloId), eq(kdsIzdajaDogodkiTable.enotaId, enotaId)));
  if (event) throw new KdsOrderAlreadyDispatchedError();
}

export type KdsDispatchTicketState = "zadrzano" | "aktivno" | "bumped" | "ack" | "preklicano";
export function isDispatchEligible(states: readonly KdsDispatchTicketState[]): boolean {
  return states.length > 0 && states.every((state) => state === "bumped");
}