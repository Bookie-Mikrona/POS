import { Router, type IRouter } from "express";
import { and, count, desc, eq, gte, inArray, isNull, ne, sql } from "drizzle-orm";
import { artikliTable, db, narocilaTable, pogostiArtikliRocnoTable, postavkeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

/** Največ artiklov na zavihku »Pogosto«. */
export const POGOSTO_STEVILO = 24;
/** Zgodovina naročil za samodejni izračun (dni). */
export const POGOSTO_OBDOBJE_DNI = 60;

/** Pripeti artikli so vedno na vrhu, nato samodejni vrstni red brez skritih; skupaj največ `limit`. */
export function sestaviPogosto(
  samodejno: number[],
  rocno: Array<{ artikelId: number; akcija: "pripni" | "skrij" }>,
  limit = POGOSTO_STEVILO,
): number[] {
  const pripeti = rocno.filter((r) => r.akcija === "pripni").map((r) => r.artikelId);
  const skriti = new Set(rocno.filter((r) => r.akcija === "skrij").map((r) => r.artikelId));
  const pripetiSet = new Set(pripeti);
  const rezultat = [...pripeti];
  for (const id of samodejno) {
    if (rezultat.length >= limit) break;
    if (!skriti.has(id) && !pripetiSet.has(id)) rezultat.push(id);
  }
  return rezultat.slice(0, limit);
}

async function samodejnoPogosto(enotaId: number): Promise<number[]> {
  const od = new Date(Date.now() - POGOSTO_OBDOBJE_DNI * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ artikelId: postavkeTable.artikelId, skupaj: sql<number>`sum(${postavkeTable.kolicina})` })
    .from(postavkeTable)
    .innerJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
    .innerJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .where(and(
      eq(narocilaTable.enotaId, enotaId),
      eq(artikliTable.enotaId, enotaId),
      ne(narocilaTable.status, "preklicano"),
      gte(narocilaTable.ustvarjeno, od),
      isNull(postavkeTable.modifikatorId),
      isNull(postavkeTable.parentPostavkaId),
      eq(artikliTable.aktiven, true),
    ))
    .groupBy(postavkeTable.artikelId)
    .orderBy(desc(sql`sum(${postavkeTable.kolicina})`), postavkeTable.artikelId)
    .limit(POGOSTO_STEVILO * 2);
  return rows.map((r) => r.artikelId).filter((id): id is number => id != null);
}

router.get("/artikli/pogosto", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const rocno = await db.select({ artikelId: pogostiArtikliRocnoTable.artikelId, akcija: pogostiArtikliRocnoTable.akcija })
    .from(pogostiArtikliRocnoTable).where(eq(pogostiArtikliRocnoTable.enotaId, enotaId));
  const samodejno = await samodejnoPogosto(enotaId);
  res.json({ artikelIds: sestaviPogosto(samodejno, rocno), rocno });
});

router.put("/artikli/pogosto", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const body = (req.body ?? {}) as { pripni?: unknown; skrij?: unknown };
  const toIds = (v: unknown): number[] | null => {
    if (v === undefined) return [];
    if (!Array.isArray(v) || v.length > 200 || !v.every((x) => Number.isInteger(x) && x > 0)) return null;
    return Array.from(new Set(v as number[]));
  };
  const pripni = toIds(body.pripni);
  const skrij = toIds(body.skrij);
  if (!pripni || !skrij) { res.status(400).json({ error: "Neveljaven seznam artiklov." }); return; }
  if (pripni.some((id) => skrij.includes(id))) {
    res.status(400).json({ error: "Artikel ne more biti hkrati pripet in skrit." }); return;
  }
  const vsi = [...pripni, ...skrij];
  await db.transaction(async (tx) => {
    if (vsi.length > 0) {
      const [{ n }] = await tx.select({ n: count() }).from(artikliTable)
        .where(and(eq(artikliTable.enotaId, enotaId), inArray(artikliTable.id, vsi)));
      if (Number(n) !== vsi.length) throw Object.assign(new Error("ARTIKEL_NI_NAJDEN"), { status: 400 });
    }
    await tx.delete(pogostiArtikliRocnoTable).where(eq(pogostiArtikliRocnoTable.enotaId, enotaId));
    if (vsi.length > 0) {
      await tx.insert(pogostiArtikliRocnoTable).values([
        ...pripni.map((artikelId) => ({ enotaId, artikelId, akcija: "pripni" as const })),
        ...skrij.map((artikelId) => ({ enotaId, artikelId, akcija: "skrij" as const })),
      ]);
    }
  }).catch((e) => {
    if (e?.message === "ARTIKEL_NI_NAJDEN") { res.status(400).json({ error: "Artikel ni najden." }); return; }
    throw e;
  });
  if (res.headersSent) return;
  res.sendStatus(204);
});

/** Vklop/izklop prikaza zaloge (samo prezentacija; strežniško preverjanje razpoložljivosti ostane nespremenjeno). */
router.put("/artikli/spremljaj-porcije", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const { artikelId, vklopljeno } = (req.body ?? {}) as { artikelId?: unknown; vklopljeno?: unknown };
  if (!Number.isInteger(artikelId) || (artikelId as number) < 1 || typeof vklopljeno !== "boolean") {
    res.status(400).json({ error: "Neveljavni podatki." });
    return;
  }
  const rows = await db.update(artikliTable)
    .set({ spremljajPorcije: vklopljeno })
    .where(and(eq(artikliTable.id, artikelId as number), eq(artikliTable.enotaId, enotaId)))
    .returning({ id: artikliTable.id });
  if (rows.length === 0) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  res.sendStatus(204);
});

export default router;
