import { and, eq, lte } from "drizzle-orm";
import { db, rezervacijeMizTable } from "@workspace/db";
import { logger } from "./logger";
import { broadcast } from "./pos-sse";
import { EXPIRY_WINDOW_MS } from "./rezervacijeMiz";

export async function sprostiPotekleRezervacije(zdaj = new Date()): Promise<number[]> {
  const sproscene = await db
    .update(rezervacijeMizTable)
    .set({ status: "potekla", potekla: zdaj })
    .where(and(
      eq(rezervacijeMizTable.status, "aktivna"),
      lte(rezervacijeMizTable.zacetek, new Date(zdaj.getTime() - EXPIRY_WINDOW_MS)),
    ))
    .returning({ id: rezervacijeMizTable.mizaId });

  if (sproscene.length > 0) {
    broadcast("update", { type: "miza", ids: sproscene.map((miza) => miza.id) });
    logger.info(
      { mizaIds: sproscene.map((miza) => miza.id), stevilo: sproscene.length },
      "Rezervacije miz: potekle rezervacije sproščene",
    );
  }

  return sproscene.map((miza) => miza.id);
}

async function preveri(): Promise<void> {
  try {
    await sprostiPotekleRezervacije();
  } catch (err) {
    logger.error({ err }, "Rezervacije miz: napaka pri sproščanju potečenih rezervacij");
  }
}

export function zazeniSproscanjeRezervacijMiz(): void {
  logger.info("Rezervacije miz: urnik nastavljen (preverjanje vsako minuto)");
  void preveri();

  const zdaj = new Date();
  const msDoNaslednjeMinute = (60 - zdaj.getSeconds()) * 1000 - zdaj.getMilliseconds() + 500;
  setTimeout(() => {
    void preveri();
    setInterval(() => { void preveri(); }, 60_000);
  }, msDoNaslednjeMinute);
}