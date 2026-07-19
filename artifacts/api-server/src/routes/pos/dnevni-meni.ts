import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, gte, lte } from "drizzle-orm";
import { db, dnevniMeniTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

router.get("/dnevni-meni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true as const, data: req.query };
  if (!parsed.success) {
    res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
    return;
  }
  const rows = await db.select().from(dnevniMeniTable).where(
    and(eq(dnevniMeniTable.enotaId, tenotaId),
      gte(dnevniMeniTable.datum, String(parsed.data.od ?? '')),
      lte(dnevniMeniTable.datum, String(parsed.data.do ?? '')),
    )
  );
  res.json(rows.map(r => ({
    id: r.id,
    datum: r.datum,
    artikelId: r.artikelId,
    modifikatorId: r.modifikatorId})));
});

router.put("/dnevni-meni/kopiraj", requireEnota, async (_req, res): Promise<void> => {
  res.status(405).json({ error: "Uporabi POST /dnevni-meni/kopiraj" });
});

router.post("/dnevni-meni/kopiraj", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
    return;
  }

  const izDatumStr = parsed.data.izDatum;
  const doDatumStr = parsed.data.doDatum;

  const izDate = new Date(izDatumStr);
  const doDate = new Date(doDatumStr);
  const diffDni = Math.round((doDate.getTime() - izDate.getTime()) / (1000 * 60 * 60 * 24));

  const izKonec = new Date(izDate);
  izKonec.setDate(izKonec.getDate() + 6);
  const izKonecStr = izKonec.toISOString().slice(0, 10);

  const viriVnosi = await db.select().from(dnevniMeniTable).where(
    and(eq(dnevniMeniTable.enotaId, tenotaId),
      gte(dnevniMeniTable.datum, izDatumStr),
      lte(dnevniMeniTable.datum, izKonecStr),
    )
  );

  if (viriVnosi.length === 0) {
    res.json({ kopirano: 0 });
    return;
  }

  const noviVnosi = viriVnosi.map(v => {
    const d = new Date(v.datum);
    d.setDate(d.getDate() + diffDni);
    return {
      enotaId: tenotaId,
      datum: d.toISOString().slice(0, 10),
      artikelId: v.artikelId,
      modifikatorId: v.modifikatorId};
  });

  await db.insert(dnevniMeniTable).values(noviVnosi).onConflictDoNothing();
  res.json({ kopirano: noviVnosi.length });
});

router.put("/dnevni-meni/:datum/:artikelId", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: {
    datum: req.params.datum,
    artikelId: Number(req.params.artikelId)} };
  if (!params.success) {
    res.status(400).json({ error: (params as any).error.message });
    return;
  }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
    return;
  }

  const { datum, artikelId } = params.data;
  const { modifikatorIds } = parsed.data;

  await db.delete(dnevniMeniTable).where(
    and(eq(dnevniMeniTable.enotaId, tenotaId),
      eq(dnevniMeniTable.datum, String(datum)),
      eq(dnevniMeniTable.artikelId, Number(artikelId)),
    )
  );

  if (modifikatorIds.length > 0) {
    await db.insert(dnevniMeniTable).values(
      modifikatorIds.map((modId: number) => ({
        enotaId: tenotaId,
        datum,
        artikelId,
        modifikatorId: modId}))
    ).onConflictDoNothing();
  }

  const rows = await db.select().from(dnevniMeniTable).where(
    and(eq(dnevniMeniTable.enotaId, tenotaId),
      eq(dnevniMeniTable.datum, String(datum)),
      eq(dnevniMeniTable.artikelId, Number(artikelId)),
    )
  );

  res.json(rows.map(r => ({
    id: r.id,
    datum: r.datum,
    artikelId: r.artikelId,
    modifikatorId: r.modifikatorId})));
});

export default router;
