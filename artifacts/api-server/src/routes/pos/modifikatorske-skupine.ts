import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, eq, inArray, ne, sql } from "drizzle-orm";
import { artModSkupineTable, artikliTable, db, modNormativiTable, modSkupineTable, modifikatorjiTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

async function fetchSkupinaFull(skupinaId: number) {
  const skupina = await db
    .select()
    .from(modSkupineTable)
    .where(eq(modSkupineTable.id, skupinaId))
    .then((r) => r[0]);
  if (!skupina) return null;

  const modifikatorji = await db
    .select()
    .from(modifikatorjiTable)
    .where(eq(modifikatorjiTable.skupinaId, skupinaId))
    .orderBy(asc(modifikatorjiTable.vrstniRed), asc(modifikatorjiTable.id));

  return {
    id: skupina.id,
    ime: skupina.ime,
    obvezna: skupina.obvezna,
    minIzbir: skupina.minIzbir,
    maxIzbir: skupina.maxIzbir,
    vrstniRed: skupina.vrstniRed,
    modifikatorji: modifikatorji.map((m) => ({
      id: m.id,
      skupinaId: m.skupinaId,
      ime: m.ime,
      cenaDodatek: Number(m.cenaDodatek),
      aktiven: m.aktiven,
      vrstniRed: m.vrstniRed}))};
}

router.get("/modifikatorske-skupine", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const rows = await db
    .select()
    .from(modSkupineTable)
    .where(
      and(eq(modSkupineTable.enotaId, tenotaId)
      )
    )
    .orderBy(asc(modSkupineTable.vrstniRed), asc(modSkupineTable.id));

  const mapped = rows.map((s) => ({
    id: s.id,
    ime: s.ime,
    obvezna: s.obvezna,
    minIzbir: s.minIzbir,
    maxIzbir: s.maxIzbir,
    vrstniRed: s.vrstniRed}));

  res.json(mapped);
});

router.post(
  "/modifikatorske-skupine",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [inserted] = await db
      .insert(modSkupineTable)
      .values({
        enotaId: tenotaId,
        ime: parsed.data.ime,
        obvezna: parsed.data.obvezna ?? false,
        minIzbir: parsed.data.minIzbir ?? 0,
        maxIzbir: parsed.data.maxIzbir ?? 1,
        vrstniRed: parsed.data.vrstniRed ?? 0})
      .returning();

    res.status(201).json({
      id: inserted.id,
      ime: inserted.ime,
      obvezna: inserted.obvezna,
      minIzbir: inserted.minIzbir,
      maxIzbir: inserted.maxIzbir,
      vrstniRed: inserted.vrstniRed});
  }
);

router.get(
  "/modifikatorske-skupine/:id",
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }

    const [skupina] = await db
      .select()
      .from(modSkupineTable)
      .where(
        and(
          eq(modSkupineTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!skupina) {
      res.status(404).json({ error: "Skupina ni najdena" });
      return;
    }

    const full = await fetchSkupinaFull(skupina.id);
    res.json((full));
  }
);

router.patch(
  "/modifikatorske-skupine/:id",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [existing] = await db
      .select()
      .from(modSkupineTable)
      .where(
        and(
          eq(modSkupineTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Skupina ni najdena" });
      return;
    }

    const updates: Partial<typeof modSkupineTable.$inferInsert> = {};
    if (parsed.data.ime !== undefined) updates.ime = parsed.data.ime;
    if (parsed.data.obvezna !== undefined) updates.obvezna = parsed.data.obvezna;
    if (parsed.data.minIzbir !== undefined) updates.minIzbir = parsed.data.minIzbir;
    if (parsed.data.maxIzbir !== undefined) updates.maxIzbir = parsed.data.maxIzbir;
    if (parsed.data.vrstniRed !== undefined) updates.vrstniRed = parsed.data.vrstniRed;

    const [updated] = await db
      .update(modSkupineTable)
      .set(updates)
      .where(eq(modSkupineTable.id, params.data.id))
      .returning();

    res.json({
      id: updated.id,
      ime: updated.ime,
      obvezna: updated.obvezna,
      minIzbir: updated.minIzbir,
      maxIzbir: updated.maxIzbir,
      vrstniRed: updated.vrstniRed});
  }
);

router.delete(
  "/modifikatorske-skupine/:id",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }

    const [existing] = await db
      .select()
      .from(modSkupineTable)
      .where(
        and(
          eq(modSkupineTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Skupina ni najdena" });
      return;
    }

    await db
      .delete(modSkupineTable)
      .where(eq(modSkupineTable.id, params.data.id));

    res.status(204).end();
  }
);

router.post(
  "/modifikatorske-skupine/:id/modifikatorji",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [skupina] = await db
      .select()
      .from(modSkupineTable)
      .where(
        and(
          eq(modSkupineTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!skupina) {
      res.status(404).json({ error: "Skupina ni najdena" });
      return;
    }

    const [inserted] = await db
      .insert(modifikatorjiTable)
      .values({
        skupinaId: params.data.id,
        ime: parsed.data.ime,
        cenaDodatek: String(parsed.data.cenaDodatek ?? 0),
        aktiven: parsed.data.aktiven ?? true,
        vrstniRed: parsed.data.vrstniRed ?? 0})
      .returning();

    res.status(201).json({
      id: inserted.id,
      skupinaId: inserted.skupinaId,
      ime: inserted.ime,
      cenaDodatek: Number(inserted.cenaDodatek),
      aktiven: inserted.aktiven,
      vrstniRed: inserted.vrstniRed});
  }
);

router.patch(
  "/modifikatorji/:id",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [existing] = await db
      .select({
        id: modifikatorjiTable.id,
        skupinaId: modifikatorjiTable.skupinaId,
        enotaId: modSkupineTable.enotaId})
      .from(modifikatorjiTable)
      .innerJoin(modSkupineTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(modifikatorjiTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Modifikator ni najden" });
      return;
    }

    const updates: Partial<typeof modifikatorjiTable.$inferInsert> = {};
    if (parsed.data.ime !== undefined) updates.ime = parsed.data.ime;
    if (parsed.data.cenaDodatek !== undefined) updates.cenaDodatek = String(parsed.data.cenaDodatek);
    if (parsed.data.aktiven !== undefined) updates.aktiven = parsed.data.aktiven;
    if (parsed.data.vrstniRed !== undefined) updates.vrstniRed = parsed.data.vrstniRed;

    const [updated] = await db
      .update(modifikatorjiTable)
      .set(updates)
      .where(eq(modifikatorjiTable.id, params.data.id))
      .returning();

    res.json({
      id: updated.id,
      skupinaId: updated.skupinaId,
      ime: updated.ime,
      cenaDodatek: Number(updated.cenaDodatek),
      aktiven: updated.aktiven,
      vrstniRed: updated.vrstniRed});
  }
);

router.delete(
  "/modifikatorji/:id",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }

    const [existing] = await db
      .select({
        id: modifikatorjiTable.id,
        enotaId: modSkupineTable.enotaId})
      .from(modifikatorjiTable)
      .innerJoin(modSkupineTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(modifikatorjiTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Modifikator ni najden" });
      return;
    }

    await db
      .delete(modifikatorjiTable)
      .where(eq(modifikatorjiTable.id, params.data.id));

    res.status(204).end();
  }
);

router.get(
  "/artikli/:id/modifikatorske-skupine",
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }

    const [artikel] = await db
      .select()
      .from(artikliTable)
      .where(
        and(
          eq(artikliTable.id, params.data.id),
          sql`true`,
          eq(artikliTable.enotaId, tenotaId)
        )
      );
    if (!artikel) {
      res.status(404).json({ error: "Artikel ni najden" });
      return;
    }

    const vezave = await db
      .select({ skupinaId: artModSkupineTable.skupinaId })
      .from(artModSkupineTable)
      .where(eq(artModSkupineTable.artikelId, params.data.id))
      .orderBy(asc(artModSkupineTable.vrstniRed));

    const skupineWithMod = await Promise.all(
      vezave.map((v) => fetchSkupinaFull(v.skupinaId))
    );
    const result = skupineWithMod.filter(Boolean);

    res.json((result));
  }
);

router.put(
  "/artikli/:id/modifikatorske-skupine",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [artikel] = await db
      .select()
      .from(artikliTable)
      .where(
        and(
          eq(artikliTable.id, params.data.id),
          sql`true`,
          eq(artikliTable.enotaId, tenotaId)
        )
      );
    if (!artikel) {
      res.status(404).json({ error: "Artikel ni najden" });
      return;
    }

    await db.transaction(async (tx) => {
      // Verify all skupineIds belong to this tenant before insert
      if (parsed.data.skupineIds.length > 0) {
        const validSkupine = await tx
          .select({ id: modSkupineTable.id })
          .from(modSkupineTable)
          .where(
            and(
              inArray(modSkupineTable.id, parsed.data.skupineIds),
              sql`true`,
              eq(modSkupineTable.enotaId, tenotaId),
            )
          );
        if (validSkupine.length !== parsed.data.skupineIds.length) {
          res.status(400).json({ error: "Nekatere modifikatorske skupine ne obstajajo ali ne pripadajo tej enoti" });
          return;
        }
      }

      await tx
        .delete(artModSkupineTable)
        .where(eq(artModSkupineTable.artikelId, params.data.id));

      if (parsed.data.skupineIds.length > 0) {
        await tx.insert(artModSkupineTable).values(
          parsed.data.skupineIds.map((skupinaId: number, idx: number) => ({
            artikelId: params.data.id,
            skupinaId,
            vrstniRed: idx}))
        );
      }
    });

    res.status(204).end();
  }
);

router.get(
  "/modifikatorji/:id/normativi",
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }

    const [existing] = await db
      .select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .innerJoin(modSkupineTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(modifikatorjiTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Modifikator ni najden" });
      return;
    }

    const normativi = await db
      .select({
        id: modNormativiTable.id,
        vhodniArtikelId: modNormativiTable.vhodniArtikelId,
        artikelIme: artikliTable.ime,
        kolicina: modNormativiTable.kolicina})
      .from(modNormativiTable)
      .innerJoin(artikliTable, eq(modNormativiTable.vhodniArtikelId, artikliTable.id))
      .where(eq(modNormativiTable.modifikatorId, params.data.id))
      .orderBy(asc(modNormativiTable.vrstniRed));

    res.json(normativi.map((n: any) => ({
      id: n.id,
      vhodniArtikelId: n.vhodniArtikelId,
      artikelIme: n.artikelIme,
      kolicina: Number(n.kolicina)})));
  }
);

router.put(
  "/modifikatorji/:id/normativi",
  requireEnota,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const params = { success: true as const, data: { id: Number(req.params.id) } };
    if (!params.success) {
      res.status(400).json({ error: (params as any).error.message });
      return;
    }
    const parsed = { success: true, data: req.body };
    if (!parsed.success) {
      res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" });
      return;
    }

    const [existing] = await db
      .select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .innerJoin(modSkupineTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(modifikatorjiTable.id, params.data.id),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId)
        )
      );
    if (!existing) {
      res.status(404).json({ error: "Modifikator ni najden" });
      return;
    }

    if (parsed.data.normativi.length > 0) {
      const artikelIds = parsed.data.normativi.map((n: any) => n.vhodniArtikelId);
      const validArtikli = await db
        .select({ id: artikliTable.id })
        .from(artikliTable)
        .where(
          and(
            inArray(artikliTable.id, artikelIds),
            sql`true`,
            eq(artikliTable.enotaId, tenotaId)
          )
        );
      if (validArtikli.length !== artikelIds.length) {
        res.status(400).json({ error: "Nekatere sestavine ne obstajajo" });
        return;
      }
    }

    await db.delete(modNormativiTable).where(eq(modNormativiTable.modifikatorId, params.data.id));

    if (parsed.data.normativi.length > 0) {
      await db.insert(modNormativiTable).values(
        parsed.data.normativi.map((n: any, idx: number) => ({
          modifikatorId: params.data.id,
          vhodniArtikelId: n.vhodniArtikelId,
          kolicina: String(n.kolicina),
          vrstniRed: idx}))
      );
    }

    res.status(204).end();
  }
);

export default router;
