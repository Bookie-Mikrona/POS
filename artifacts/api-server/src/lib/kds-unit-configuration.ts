import { and, eq, sql } from "drizzle-orm";
import {
  db, kdsNastavitveTable, kdsPostajeTable, kdsPrikazovalnikiTable, kdsPrikazovalnikNaročnineTable,
} from "@workspace/db";
import { planStandardKdsDisplays } from "./kds-routing";

type KdsClient = Pick<typeof db, "select" | "insert" | "update" | "delete" | "execute">;

/** Idempotently provisions only the named standard resources for a new unit. */
export async function ensureKdsUnitConfiguration(enotaId: number, client?: KdsClient): Promise<void> {
  if (!client) {
    await db.transaction((tx) => ensureKdsUnitConfiguration(enotaId, tx));
    return;
  }
  // Serialize first-use detection. Without this lock a concurrent request could
  // observe stations inserted by the winner before its settings row and
  // incorrectly classify the new unit as a legacy custom installation.
  await client.execute(sql`SELECT pg_advisory_xact_lock(84321, ${enotaId})`);
  const [existingSettings] = await client.select({ enotaId: kdsNastavitveTable.enotaId }).from(kdsNastavitveTable)
    .where(eq(kdsNastavitveTable.enotaId, enotaId));
  if (existingSettings) return;
  const existingStations = await client.select({
    id: kdsPostajeTable.id, aktivna: kdsPostajeTable.aktivna,
  }).from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaId)).orderBy(kdsPostajeTable.vrstniRed, kdsPostajeTable.id);
  // Older paths may have created arbitrary stations without settings. Preserve
  // those as a custom unit instead of injecting standard screens.
  if (existingStations.length) {
    const fallback = existingStations.find((station) => station.aktivna) ?? existingStations[0];
    if (!fallback.aktivna) await client.update(kdsPostajeTable).set({ aktivna: true }).where(eq(kdsPostajeTable.id, fallback.id));
    await client.insert(kdsNastavitveTable).values({ enotaId, profil: "custom", fallbackPostajaId: fallback.id }).onConflictDoNothing();
    return;
  }
  const standardStations = [
    { ime: "Bar", tip: "bar" as const, vrstniRed: 0 },
    { ime: "Kuhinja", tip: "kitchen" as const, vrstniRed: 1 },
    { ime: "Pica", tip: "pizza" as const, vrstniRed: 2 },
  ];
  for (const station of standardStations) {
    await client.insert(kdsPostajeTable).values({ enotaId, ...station }).onConflictDoNothing();
    await client.update(kdsPostajeTable).set({ tip: station.tip, aktivna: true })
      .where(and(eq(kdsPostajeTable.enotaId, enotaId), eq(kdsPostajeTable.ime, station.ime)));
  }
  const stations = await client.select({ id: kdsPostajeTable.id, ime: kdsPostajeTable.ime })
    .from(kdsPostajeTable).where(eq(kdsPostajeTable.enotaId, enotaId));
  const ids = new Map(stations.map((station) => [station.ime, station.id]));
  for (const display of planStandardKdsDisplays("bar_combined_kitchen")) {
    const vrstniRed = display.ime === "Bar" ? 0 : display.ime === "Kuhinja" ? 1 : 2;
    await client.insert(kdsPrikazovalnikiTable).values({ enotaId, ime: display.ime, vrstniRed, aktiven: display.active }).onConflictDoNothing();
    const [saved] = await client.select({ id: kdsPrikazovalnikiTable.id }).from(kdsPrikazovalnikiTable)
      .where(and(eq(kdsPrikazovalnikiTable.enotaId, enotaId), eq(kdsPrikazovalnikiTable.ime, display.ime)));
    if (!saved) continue;
    await client.update(kdsPrikazovalnikiTable).set({ aktiven: display.active, vrstniRed })
      .where(eq(kdsPrikazovalnikiTable.id, saved.id));
    await client.delete(kdsPrikazovalnikNaročnineTable).where(eq(kdsPrikazovalnikNaročnineTable.prikazovalnikId, saved.id));
    const stationIds = display.stationTypes.map((type) => ids.get(type === "bar" ? "Bar" : type === "kitchen" ? "Kuhinja" : "Pica")).filter((id): id is number => id != null);
    if (stationIds.length) await client.insert(kdsPrikazovalnikNaročnineTable)
      .values(stationIds.map((postajaId) => ({ prikazovalnikId: saved.id, postajaId })))
      .onConflictDoNothing();
  }
  const kitchenId = ids.get("Kuhinja");
  if (!kitchenId) throw new Error("KDS Kitchen station provisioning failed.");
  await client.insert(kdsNastavitveTable).values({
    enotaId, profil: "bar_combined_kitchen", fallbackPostajaId: kitchenId,
  }).onConflictDoNothing();
}