import { and, eq, ne } from "drizzle-orm";
import { db, kdsNalogiTable, kdsPostajeTable, mizeTable, narocilaTable, postavkeTable, prostoriTable } from "@workspace/db";
import { includedKdsTicket } from "./kds-exclusion";
import { broadcastToDevice } from "./pos-sse";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type Ticket = { id: number; enotaId: number; narociloId: number; postavkaId: number | null };

/** Called under the order lock, after a real bump, so concurrent stations and
 * command retries cannot announce a partial or duplicate completion. */
export async function getKdsReadyNotification(tx: Transaction, ticket: Ticket) {
  if (ticket.postavkaId == null) return null;
  const stations = await tx.select({ stanje: kdsNalogiTable.stanje, tip: kdsPostajeTable.tip })
    .from(kdsNalogiTable)
    .innerJoin(kdsPostajeTable, and(
      eq(kdsPostajeTable.id, kdsNalogiTable.postajaId),
      eq(kdsPostajeTable.enotaId, ticket.enotaId),
    ))
    .where(and(
      eq(kdsNalogiTable.enotaId, ticket.enotaId),
      eq(kdsNalogiTable.narociloId, ticket.narociloId),
      eq(kdsNalogiTable.postavkaId, ticket.postavkaId),
      ne(kdsNalogiTable.stanje, "preklicano"),
      includedKdsTicket(),
    ));
  if (!stations.length || stations.some(station => station.stanje !== "bumped" && station.stanje !== "ack")) return null;

  const [line] = await tx.select({
    postavkaId: postavkeTable.id, narociloId: postavkeTable.narociloId,
    ime: postavkeTable.ime, kolicina: postavkeTable.kolicina, opomba: postavkeTable.opomba,
    napravaId: postavkeTable.napravaId,
    mizaIme: mizeTable.ime, mizaStevilka: mizeTable.stevilka,
    prostorId: mizeTable.prostorId, prostorIme: prostoriTable.ime,
  }).from(postavkeTable)
    .innerJoin(narocilaTable, eq(narocilaTable.id, postavkeTable.narociloId))
    .leftJoin(mizeTable, eq(mizeTable.id, narocilaTable.mizaId))
    .leftJoin(prostoriTable, eq(prostoriTable.id, mizeTable.prostorId))
    .where(and(
      eq(postavkeTable.id, ticket.postavkaId),
      eq(postavkeTable.narociloId, ticket.narociloId),
      eq(narocilaTable.enotaId, ticket.enotaId),
      eq(narocilaTable.status, "odprto"),
    ));
  // No unit-wide fallback: a missing origin must not ring unrelated devices.
  if (!line?.napravaId) return null;
  return {
    ...line,
    kolicina: Number(line.kolicina),
    notificationId: `kds-ready-${ticket.id}`,
    vir: stations.every(station => station.tip === "bar") ? "tocilnica" as const : "kuhinja" as const,
  };
}

export function sendKdsReadyNotification(enotaId: number, notification: NonNullable<Awaited<ReturnType<typeof getKdsReadyNotification>>>) {
  const { napravaId, ...payload } = notification;
  broadcastToDevice(enotaId, napravaId!, "postavkaPripravljena", payload);
}