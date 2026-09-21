import { Router, type IRouter } from "express";
import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { artikliTable, db, izdajnicePostavkeTable, izdajniceTable, zalogaGibiTable, zalogeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import type { PosRequest } from "../../middlewares/pos";
import { broadcast } from "../../lib/pos-sse";
import { getZalogeObDatumu, recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { appendStockMovementReversals } from "../../lib/stockMovementHistory";

const router: IRouter = Router();

/** Ročne izdajnice se knjižijo ob 23:58:00 UTC — pred inventuro (23:59:59). */
function endOfDayIzdajnica(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d, 23, 58, 0, 0));
}

async function nextStevilkaIzdajnica(year: number, enotaId: number): Promise<string> {
  const yy = String(year).slice(-2);
  const prefix = `IZ${yy}`;
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka, 5) AS INTEGER)), 0) + 1 AS next FROM izdajnice WHERE stevilka LIKE ${`${prefix}%`} AND LENGTH(stevilka) = 10 AND enota_id = ${enotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${prefix}${String(nextSeq).padStart(6, "0")}`;
}

router.get("/izdajnice", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      id: izdajniceTable.id,
      stevilka: izdajniceTable.stevilka,
      datum: izdajniceTable.datum,
      opomba: izdajniceTable.opomba,
      ustvarjeno: izdajniceTable.ustvarjeno,
      steviloPostavk: count(izdajnicePostavkeTable.id),
    })
    .from(izdajniceTable)
    .leftJoin(izdajnicePostavkeTable, eq(izdajnicePostavkeTable.izdajnicaId, izdajniceTable.id))
    .where(eq(izdajniceTable.enotaId, enotaId))
    .groupBy(izdajniceTable.id)
    .orderBy(desc(izdajniceTable.datum));
  res.json(rows);
});

router.post("/izdajnice", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const { datum, opomba, postavke } = req.body;

  if (!postavke || postavke.length === 0) {
    res.status(400).json({ error: "Izdajnica mora imeti vsaj eno postavko" }); return;
  }

  const artikelIds: number[] = postavke.map((p: any) => p.artikelId);
  const artikliRows = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
    .from(artikliTable)
    .where(and(inArray(artikliTable.id, artikelIds), eq(artikliTable.enotaId, enotaId)));
  const foundIds = new Set(artikliRows.map(a => a.id));
  const missingIds = artikelIds.filter((id: number) => !foundIds.has(id));
  if (missingIds.length > 0) {
    res.status(403).json({ error: "Nekateri artikli ne pripadajo temu podjetju" }); return;
  }
  const artikelMap = new Map(artikliRows.map(a => [a.id, a]));

  const docDatum = datum ? endOfDayIzdajnica(datum) : new Date();
  const stevilka = await nextStevilkaIzdajnica(docDatum.getFullYear(), enotaId);

  const { izdajnica, postavkeResult } = await db.transaction(async (tx) => {
    const [izdajnica] = await tx.insert(izdajniceTable).values({
      enotaId,
      stevilka,
      datum: docDatum,
      opomba: opomba ?? null,
    }).returning();

    const zalogeRows = await tx
      .select({ artikelId: zalogeTable.artikelId, cenaKos: zalogeTable.povprecnaCena })
      .from(zalogeTable)
      .where(inArray(zalogeTable.artikelId, artikelIds));
    const cenaMap = new Map(zalogeRows.map(row => [
      row.artikelId,
      row.cenaKos == null ? null : Number(row.cenaKos),
    ]));

    const postavkeResult = [];
    for (const p of postavke) {
      const kolicina = Number(p.kolicina) || 0;
      if (kolicina <= 0) continue;
      const cenaKos = cenaMap.get(p.artikelId) ?? null;

      const [pp] = await tx.insert(izdajnicePostavkeTable).values({
        izdajnicaId: izdajnica.id,
        artikelId: p.artikelId,
        kolicina: String(kolicina),
      }).returning();

      // Negativna količina → zmanjša zalogo
      await tx.insert(zalogaGibiTable).values({
        artikelId: p.artikelId,
        tip: "izdajnica",
        kolicina: String(-kolicina),
        cenaKos: cenaKos == null ? null : String(cenaKos),
        vrednost: cenaKos == null ? null : String(-kolicina * cenaKos),
        opomba: opomba ?? null,
        referencaId: izdajnica.id,
        actorSnapshot,
        effectiveAtSnapshot: docDatum,
        sourceSnapshot: "izdajnica",
      });

      const art = artikelMap.get(p.artikelId);
      postavkeResult.push({
        id: pp.id,
        artikelId: p.artikelId,
        artikelIme: art?.ime ?? "–",
        imeZaNabavo: art?.imeZaNabavo ?? null,
        enotaMere: art?.enotaMere ?? null,
        kolicina,
      });
    }

    await recomputeZaloge(artikelIds, tx);
    return { izdajnica, postavkeResult };
  });

  broadcast("update", { type: "zaloge" });
  res.status(201).json({
    id: izdajnica.id,
    stevilka: izdajnica.stevilka,
    datum: izdajnica.datum,
    opomba: izdajnica.opomba,
    ustvarjeno: izdajnica.ustvarjeno,
    postavke: postavkeResult,
  });
});

router.get("/izdajnice/:id", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [izdajnica] = await db
    .select()
    .from(izdajniceTable)
    .where(and(eq(izdajniceTable.id, id), eq(izdajniceTable.enotaId, enotaId)));
  if (!izdajnica) { res.status(404).json({ error: "Izdajnica ni najdena" }); return; }

  const postavke = await db
    .select({
      id: izdajnicePostavkeTable.id,
      artikelId: izdajnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: izdajnicePostavkeTable.kolicina,
    })
    .from(izdajnicePostavkeTable)
    .leftJoin(artikliTable, eq(izdajnicePostavkeTable.artikelId, artikliTable.id))
    .where(eq(izdajnicePostavkeTable.izdajnicaId, id));

  res.json({
    id: izdajnica.id,
    stevilka: izdajnica.stevilka,
    datum: izdajnica.datum,
    opomba: izdajnica.opomba,
    ustvarjeno: izdajnica.ustvarjeno,
    postavke: postavke.map(p => ({
      ...p,
      artikelIme: p.artikelIme ?? "–",
      kolicina: Number(p.kolicina),
    })),
  });
});

router.put("/izdajnice/:id", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(izdajniceTable)
    .where(and(eq(izdajniceTable.id, id), eq(izdajniceTable.enotaId, enotaId)));
  if (!existing) { res.status(404).json({ error: "Izdajnica ni najdena" }); return; }

  const { datum, opomba, postavke } = req.body;
  let didUpdatePostavke = false;

  await db.transaction(async (tx) => {
    const txUpdates: Partial<typeof existing> = {};
    if (datum !== undefined) txUpdates.datum = endOfDayIzdajnica(datum);
    if (opomba !== undefined) txUpdates.opomba = opomba;

    if (postavke !== undefined) {
      if (!postavke.length) throw new Error("Izdajnica mora imeti vsaj eno postavko");

      const artikelIds: number[] = postavke.map((p: any) => p.artikelId);
      const artikliRows = await db.select({ id: artikliTable.id, ime: artikliTable.ime, imeZaNabavo: artikliTable.imeZaNabavo, enotaMere: artikliTable.enotaMere })
        .from(artikliTable)
        .where(and(inArray(artikliTable.id, artikelIds), eq(artikliTable.enotaId, enotaId)));
      const foundIds = new Set(artikliRows.map(a => a.id));
      const missing = artikelIds.filter((aid: number) => !foundIds.has(aid));
      if (missing.length > 0) throw new Error("Nekateri artikli ne pripadajo temu podjetju");

      const oldPostavke = await tx.select().from(izdajnicePostavkeTable).where(eq(izdajnicePostavkeTable.izdajnicaId, id));
      const oldArtikleIds = oldPostavke.map(p => p.artikelId);

      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["izdajnica"],
        actorSnapshot,
        reversalSourceSnapshot: "izdajnica_reversal",
        note: `Razveljavitev izdajnice #${id} zaradi urejanja`,
        legacyKind: "izdajnica",
      });
      await tx.delete(izdajnicePostavkeTable).where(eq(izdajnicePostavkeTable.izdajnicaId, id));

      const zalogeRows = await tx
        .select({ artikelId: zalogeTable.artikelId, cenaKos: zalogeTable.povprecnaCena })
        .from(zalogeTable)
        .where(inArray(zalogeTable.artikelId, artikelIds));
      const cenaMap = new Map(zalogeRows.map(row => [
        row.artikelId,
        row.cenaKos == null ? null : Number(row.cenaKos),
      ]));

      const newArtikleIds: number[] = [];
      for (const p of postavke) {
        const kolicina = Number(p.kolicina) || 0;
        if (kolicina <= 0) continue;
        const cenaKos = cenaMap.get(p.artikelId) ?? null;
        await tx.insert(izdajnicePostavkeTable).values({
          izdajnicaId: id,
          artikelId: p.artikelId,
          kolicina: String(kolicina),
        });
        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "izdajnica",
          kolicina: String(-kolicina),
          cenaKos: cenaKos == null ? null : String(cenaKos),
          vrednost: cenaKos == null ? null : String(-kolicina * cenaKos),
          opomba: opomba ?? existing.opomba ?? null,
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: datum !== undefined
            ? endOfDayIzdajnica(datum)
            : existing.datum,
          sourceSnapshot: "izdajnica",
        });
        newArtikleIds.push(p.artikelId);
      }

      const allAffectedIds = [...new Set([...oldArtikleIds, ...reversedArtikelIds, ...newArtikleIds])];
      await recomputeZaloge(allAffectedIds, tx);
      didUpdatePostavke = true;
    } else if (datum !== undefined && txUpdates.datum!.getTime() !== existing.datum.getTime()) {
      const newEffectiveDate = txUpdates.datum!;
      const existingPostavke = await tx.select().from(izdajnicePostavkeTable)
        .where(eq(izdajnicePostavkeTable.izdajnicaId, id));
      const artikelIds = existingPostavke.flatMap((p) => p.artikelId == null ? [] : [p.artikelId]);
      const reversedArtikelIds = await appendStockMovementReversals(tx, {
        referenceId: id,
        sourceSnapshots: ["izdajnica"],
        actorSnapshot,
        reversalSourceSnapshot: "izdajnica_reversal",
        note: `Razveljavitev izdajnice #${id} zaradi spremembe datuma`,
        legacyKind: "izdajnica",
      });
      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
      const zalogaObDatumu = await getZalogeObDatumu(artikelIds, newEffectiveDate, tx);
      for (const p of existingPostavke) {
        if (p.artikelId == null) continue;
        const kolicina = Number(p.kolicina);
        const cenaKos = zalogaObDatumu.get(p.artikelId)?.cenaKos ?? null;
        await tx.insert(zalogaGibiTable).values({
          artikelId: p.artikelId,
          tip: "izdajnica",
          kolicina: String(-kolicina),
          cenaKos: cenaKos == null ? null : String(cenaKos),
          vrednost: cenaKos == null ? null : String(-kolicina * cenaKos),
          opomba: opomba ?? existing.opomba ?? null,
          referencaId: id,
          actorSnapshot,
          effectiveAtSnapshot: newEffectiveDate,
          sourceSnapshot: "izdajnica",
        });
      }
      await recomputeZaloge([...new Set([...artikelIds, ...reversedArtikelIds])], tx);
      didUpdatePostavke = true;
    }

    await tx.update(izdajniceTable).set(txUpdates)
      .where(and(eq(izdajniceTable.id, id), eq(izdajniceTable.enotaId, enotaId)));
  });

  if (didUpdatePostavke) broadcast("update", { type: "zaloge" });

  const [updated] = await db.select().from(izdajniceTable).where(eq(izdajniceTable.id, id));
  const postavkeRows = await db
    .select({
      id: izdajnicePostavkeTable.id,
      artikelId: izdajnicePostavkeTable.artikelId,
      artikelIme: artikliTable.ime,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      kolicina: izdajnicePostavkeTable.kolicina,
    })
    .from(izdajnicePostavkeTable)
    .leftJoin(artikliTable, eq(izdajnicePostavkeTable.artikelId, artikliTable.id))
    .where(eq(izdajnicePostavkeTable.izdajnicaId, id));

  res.json({
    id: updated.id,
    stevilka: updated.stevilka,
    datum: updated.datum,
    opomba: updated.opomba,
    ustvarjeno: updated.ustvarjeno,
    postavke: postavkeRows.map(p => ({ ...p, artikelIme: p.artikelIme ?? "–", kolicina: Number(p.kolicina) })),
  });
});

router.delete("/izdajnice/:id", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const actorSnapshot = (req as PosRequest).clerkUserId;
  const id = parseInt(String(req.params.id));
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [existing] = await db.select().from(izdajniceTable)
    .where(and(eq(izdajniceTable.id, id), eq(izdajniceTable.enotaId, enotaId)));
  if (!existing) { res.status(404).json({ error: "Izdajnica ni najdena" }); return; }

  const postavke = await db.select().from(izdajnicePostavkeTable).where(eq(izdajnicePostavkeTable.izdajnicaId, id));
  const artikelIds = postavke.map(p => p.artikelId);

  await db.transaction(async (tx) => {
    const reversedArtikelIds = await appendStockMovementReversals(tx, {
      referenceId: id,
      sourceSnapshots: ["izdajnica"],
      actorSnapshot,
      reversalSourceSnapshot: "izdajnica_reversal",
      note: `Razveljavitev izbrisane izdajnice #${id}`,
      legacyKind: "izdajnica",
    });
    await tx.delete(izdajnicePostavkeTable).where(eq(izdajnicePostavkeTable.izdajnicaId, id));
    await tx.delete(izdajniceTable).where(and(eq(izdajniceTable.id, id), eq(izdajniceTable.enotaId, enotaId)));
    const allAffectedIds = [...new Set([...artikelIds, ...reversedArtikelIds])];
    if (allAffectedIds.length > 0) await recomputeZaloge(allAffectedIds, tx);
  });

  broadcast("update", { type: "zaloge" });
  res.status(204).send();
});

export default router;
