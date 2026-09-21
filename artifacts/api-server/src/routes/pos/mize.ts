import { randomBytes } from "node:crypto";
import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, eq, gte, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, enoteTable, mizeTable, narocilaTable, narocnikiTable, prostoriTable, rezervacijeMizTable, rezervacijeMizZgodovinaTable, tlorisPostavkeTable, tlorisiTable } from "@workspace/db";
import {
  CreateMizaBody,
  ShraniRezervacijoMizeBody,
  ShraniRezervacijoMizeParams,
  ShraniRezervacijoMizeResponse,
  SprostiRezervacijoMizeParams,
  UpdateMizaBody,
  UpdateMizaParams,
  ListRezervacijeResponse,
  ListRezervacijaMizeZgodovinaParams,
  ListRezervacijaMizeZgodovinaResponse,
} from "@workspace/api-zod";
import { broadcast } from "../../lib/pos-sse";
import { normalizirajTelefon } from "../../lib/narocniki-telefon";
import { DISPLAY_WINDOW_MS, ORDER_CUTOFF_MS, RESERVATION_SPACING_MS, zakleniMizo } from "../../lib/rezervacijeMiz";
import { getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import { isPosBusinessDayClosed, lockPosBusinessDay } from "../../lib/pos-z-helpers";

const router: IRouter = Router();
const aktivnaMiza = eq(mizeTable.arhivirana, false);

function actor(req: Request): string | null {
  return (req as any).clerkUserId ?? (req as any).userId ?? null;
}

/** Authorize a reservation unit without trusting a caller-supplied unit id. */
async function canAccessReservationUnit(req: Request, targetEnotaId: number): Promise<boolean> {
  const currentEnotaId = (req as any).enotaId ?? 1;
  if (targetEnotaId === currentEnotaId) return true;
  const isCompanyAdmin = ["admin", "superadmin"].includes((req as any).vloga);
  const companyId = (req as any).companyId as string | undefined;
  if (!isCompanyAdmin || !companyId) return false;
  const [unit] = await db.select({ id: enoteTable.id }).from(enoteTable)
    .where(and(eq(enoteTable.id, targetEnotaId), eq(enoteTable.companyId, companyId)));
  return Boolean(unit);
}

async function snapshotMize(tx: any, mizaId: number, enotaId: number) {
  const [miza] = await tx.select({
    stevilka: mizeTable.stevilka, ime: mizeTable.ime, prostorIme: prostoriTable.ime,
  }).from(mizeTable).leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
    .where(and(eq(mizeTable.id, mizaId), eq(mizeTable.enotaId, enotaId), aktivnaMiza));
  return miza;
}

async function zapisiZgodovino(tx: any, input: {
  enotaId: number; mizaId: number; rezervacijaId?: number | null; dogodek: "ustvarjena" | "posodobljena" | "preklicana" | "miza_arhivirana"; actorClerkUserId: string | null; podatki: Record<string, unknown>;
}) {
  await tx.insert(rezervacijeMizZgodovinaTable).values(input);
}

export function requireMizaQrAdmin(req: Request, res: Response, next: NextFunction): void {
  const vloga = (req as any).vloga;
  if (vloga !== "admin" && vloga !== "admin_enote" && vloga !== "superadmin") {
    res.status(403).json({ napaka: "QR meni lahko upravlja samo admin ali admin enote." });
    return;
  }
  next();
}

function jeUniqueViolation(error: unknown): boolean {
  return typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === "23505";
}

async function ustvariQrToken(enotaId: number, mizaId: number): Promise<string | null> {
  for (let poskus = 0; poskus < 5; poskus += 1) {
    const qrToken = randomBytes(32).toString("base64url");
    try {
      const [row] = await db
        .update(mizeTable)
        .set({ qrToken })
        .where(and(eq(mizeTable.id, mizaId), eq(mizeTable.enotaId, enotaId)))
        .returning({ qrToken: mizeTable.qrToken });
      return row?.qrToken ?? null;
    } catch (error) {
      if (!jeUniqueViolation(error) || poskus === 4) throw error;
    }
  }
  return null;
}

async function enrichMize(rows: Array<typeof mizeTable.$inferSelect>, enotaId: number) {
  const reservations = rows.length === 0 ? [] : await db.select().from(rezervacijeMizTable)
    .where(and(eq(rezervacijeMizTable.enotaId, enotaId), inArray(rezervacijeMizTable.mizaId, rows.map((row) => row.id))))
    .orderBy(rezervacijeMizTable.zacetek);
  const now = Date.now();
  return rows.map((miza) => {
    const tableReservations = reservations.filter((reservation) =>
      reservation.mizaId === miza.id
      && reservation.status === "aktivna"
      && reservation.zacetek.getTime() > now - 3 * 60 * 60 * 1000
    );
    const next = tableReservations[0] ?? null;
    const blocked = Boolean(next && next.zacetek.getTime() <= now + ORDER_CUTOFF_MS);
    return {
      ...miza,
      status: miza.status === "zasedena" ? "zasedena" : next && next.zacetek.getTime() <= now + DISPLAY_WINDOW_MS ? "rezervirana" : "prosta",
      // Compatibility view for clients that still understand only one
      // reservation per table: expose the earliest active row.
      rezervacijaNarocnikId: next?.narocnikId ?? null,
      rezervacijaStrankaIme: next?.strankaIme ?? null,
      rezervacijaTelefon: next?.telefon ?? null,
      rezervacijaOpomba: next?.opomba ?? null,
      rezervacijaVeljaDo: next?.zacetek ?? null,
      reservations: tableReservations, noviNarocilaBlokirani: blocked,
      novaNarocilaBlokirana: blocked, rezervacijaNaslednja: next,
    };
  });
}

router.get("/mize", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(mizeTable)
    .where(and(eq(mizeTable.enotaId, tenotaId), aktivnaMiza))
    .orderBy(mizeTable.stevilka);
  res.json(await enrichMize(rows, tenotaId));
});

const razpolozljivostQuery = z.object({
  zacetek: z.coerce.date(),
  steviloOseb: z.coerce.number().int().min(1).max(100),
  prostorId: z.coerce.number().int().positive().optional(),
});

const koledarQuery = z.object({
  od: z.coerce.date().optional(),
  do: z.coerce.date().optional(),
  enotaId: z.coerce.number().int().positive().optional(),
});

/** Calendar/list view is company scoped; a selected unit is merely a filter. */
router.get("/rezervacije", async (req, res): Promise<void> => {
  const parsed = koledarQuery.safeParse(req.query);
  if (!parsed.success || (parsed.data.od && parsed.data.do && parsed.data.od > parsed.data.do)) {
    res.status(400).json({ error: "Obdobje rezervacij ni veljavno." });
    return;
  }
  const companyId = (req as any).companyId as string | undefined;
  const currentEnotaId = (req as any).enotaId ?? 1;
  const requestedEnotaId = parsed.data.enotaId;
  const isCompanyAdmin = ["admin", "superadmin"].includes((req as any).vloga);
  if (requestedEnotaId && !await canAccessReservationUnit(req, requestedEnotaId)) {
    res.status(403).json({ error: "Za pregled druge enote nimate pravic." });
    return;
  }
  if (!requestedEnotaId && isCompanyAdmin && !companyId) {
    res.status(403).json({ error: "Za pregled rezervacij podjetja manjka identiteta podjetja." });
    return;
  }
  const conditions = [
    ...(requestedEnotaId ? [eq(rezervacijeMizTable.enotaId, requestedEnotaId)] : isCompanyAdmin
      ? (companyId ? [eq(enoteTable.companyId, companyId)] : [eq(rezervacijeMizTable.enotaId, currentEnotaId)])
      : [eq(rezervacijeMizTable.enotaId, currentEnotaId)]),
    ...(parsed.data.od ? [gte(rezervacijeMizTable.zacetek, parsed.data.od)] : []),
    ...(parsed.data.do ? [sql`${rezervacijeMizTable.zacetek} <= ${parsed.data.do}`] : []),
  ];
  const rows = await db.select({
    id: rezervacijeMizTable.id, enotaId: rezervacijeMizTable.enotaId, mizaId: rezervacijeMizTable.mizaId,
    mizaStevilka: sql<number | null>`coalesce(${rezervacijeMizTable.mizaStevilkaSnapshot}, ${mizeTable.stevilka})`, mizaIme: sql<string | null>`coalesce(${rezervacijeMizTable.mizaImeSnapshot}, ${mizeTable.ime})`, prostorIme: rezervacijeMizTable.prostorImeSnapshot, strankaIme: rezervacijeMizTable.strankaIme,
    telefon: rezervacijeMizTable.telefon, opomba: rezervacijeMizTable.opomba, zacetek: rezervacijeMizTable.zacetek,
    status: rezervacijeMizTable.status, enotaIme: enoteTable.ime, arhiviranaMiza: mizeTable.arhivirana,
  }).from(rezervacijeMizTable)
    .innerJoin(mizeTable, eq(rezervacijeMizTable.mizaId, mizeTable.id))
    .innerJoin(enoteTable, eq(rezervacijeMizTable.enotaId, enoteTable.id))
    .where(and(...conditions)).orderBy(rezervacijeMizTable.zacetek);
   res.json(ListRezervacijeResponse.parse(rows));
});

router.get("/mize/razpolozljivost", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const parsed = razpolozljivostQuery.safeParse(req.query);
  if (!parsed.success || parsed.data.zacetek.getTime() <= Date.now()) {
    res.status(400).json({ error: "Vnesite veljaven prihodnji začetek in število oseb." });
    return;
  }

  const { zacetek, steviloOseb, prostorId } = parsed.data;
  const mizeWhere = and(
    eq(mizeTable.enotaId, enotaId),
    aktivnaMiza,
    gte(mizeTable.kapaciteta, steviloOseb),
    ...(prostorId === undefined ? [] : [eq(mizeTable.prostorId, prostorId)]),
  );
  const rows = await db.select().from(mizeTable).where(mizeWhere).orderBy(mizeTable.stevilka);
  if (rows.length === 0) {
    res.json([]);
    return;
  }

  const mizaIds = rows.map((row) => row.id);
  const [enriched, odprtaNarocila, prostori] = await Promise.all([
    enrichMize(rows, enotaId),
    db.select({ mizaId: narocilaTable.mizaId })
      .from(narocilaTable)
      .where(and(
        eq(narocilaTable.enotaId, enotaId),
        eq(narocilaTable.status, "odprto"),
        inArray(narocilaTable.mizaId, mizaIds),
      )),
    db.select({ id: prostoriTable.id, ime: prostoriTable.ime })
      .from(prostoriTable)
      .where(eq(prostoriTable.enotaId, enotaId)),
  ]);
  const odprtaPoMizi = new Map<number, number>();
  for (const narocilo of odprtaNarocila) {
    if (narocilo.mizaId == null) continue;
    odprtaPoMizi.set(narocilo.mizaId, (odprtaPoMizi.get(narocilo.mizaId) ?? 0) + 1);
  }
  const prostorImena = new Map(prostori.map((prostor) => [prostor.id, prostor.ime]));

  res.json(enriched.map((miza) => {
    const steviloOdprtihNarocil = odprtaPoMizi.get(miza.id) ?? 0;
    const konfliktnaRezervacija = (miza.reservations ?? []).find((reservation) =>
      reservation.status === "aktivna"
      && Math.abs(reservation.zacetek.getTime() - zacetek.getTime()) < RESERVATION_SPACING_MS
    ) ?? null;
    const jeZasedena = steviloOdprtihNarocil > 0 || miza.status === "zasedena";
    return {
      miza,
      prostorIme: miza.prostorId == null ? null : (prostorImena.get(miza.prostorId) ?? null),
      stanje: jeZasedena ? "zasedena" : konfliktnaRezervacija ? "rezervirana" : "prosta",
      naVoljo: konfliktnaRezervacija === null,
      konfliktnaRezervacija,
      steviloOdprtihNarocil,
    };
  }));
});

router.post("/mize", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = CreateMizaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Podatki mize niso veljavni." });
    return;
  }
  const createStatus = parsed.data.status ?? "prosta";
  const result = await db.transaction(async (tx) => {
    if (createStatus === "zasedena") {
      await lockPosBusinessDay(tx, tenotaId);
      const businessDate = await getCurrentPosBusinessDate(tenotaId, undefined, tx);
      if (await isPosBusinessDayClosed(tx, tenotaId, businessDate)) {
        return { status: "closed" as const };
      }
    }
    const prostorId = parsed.data.prostorId ?? null;
    if (prostorId !== null) {
      const [prostor] = await tx.select({ id: prostoriTable.id })
        .from(prostoriTable)
        .where(and(eq(prostoriTable.id, prostorId), eq(prostoriTable.enotaId, tenotaId)))
        .for("update");
      if (!prostor) return { status: "invalid-room" as const };
    }
    const [inserted] = await tx.insert(mizeTable).values({
      enotaId: tenotaId,
      stevilka: parsed.data.stevilka,
      ime: parsed.data.ime ?? null,
      kapaciteta: parsed.data.kapaciteta ?? 4,
      status: createStatus,
      prostorId,
      oblika: parsed.data.oblika ?? "pravokotnik_h",
    }).returning();
    if (prostorId === null) return { status: "ok" as const, row: inserted! };

    let [layout] = await tx.select().from(tlorisiTable)
      .where(eq(tlorisiTable.prostorId, prostorId))
      .for("update");
    if (!layout) {
      [layout] = await tx.insert(tlorisiTable).values({ prostorId }).returning();
    }
    const existingTables = await tx.select({ id: tlorisPostavkeTable.id })
      .from(tlorisPostavkeTable)
      .where(and(eq(tlorisPostavkeTable.tlorisId, layout.id), eq(tlorisPostavkeTable.vrsta, "table")));
    const index = existingTables.length;
    const x = (index % 6) * 135 + 10;
    const y = Math.floor(index / 6) * 135 + 10;
    const width = 125;
    const height = 75;

    await tx.insert(tlorisPostavkeTable).values({
      id: `auto_${prostorId}_${inserted!.id}`,
      tlorisId: layout.id,
      vrsta: "table",
      mizaId: inserted!.id,
      x,
      y,
      sirina: width,
      visina: height,
      rotacija: 0,
      zIndex: 10,
      zaklenjena: false,
      vidna: true,
      slog: {},
      podatki: { oblika: "pravokotnik_h", automatic: true },
    });
    await tx.update(tlorisiTable).set({
      version: sql`${tlorisiTable.version} + 1`,
      sirina: Math.max(layout.sirina, x + width + 20),
      visina: Math.max(layout.visina, y + height + 20),
      posodobljeno: new Date(),
    }).where(eq(tlorisiTable.id, layout.id));
    const [row] = await tx.update(mizeTable).set({
      posX: x,
      posY: y,
      tlorisSirina: width,
      tlorisVisina: height,
      tlorisRotacija: 0,
    }).where(eq(mizeTable.id, inserted!.id)).returning();
    return { status: "ok" as const, row: row! };
  });
  if (result.status === "closed") {
    res.status(409).json({
      error: "Tekoči poslovni dan je že zaključen z Z-poročilom.",
      code: "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN",
    });
    return;
  }
  if (result.status === "invalid-room") {
    res.status(400).json({ error: "Izbrani prostor ne obstaja v aktivni enoti." });
    return;
  }
  broadcast("update", { type: "miza" });
  res.status(201).json((await enrichMize([result.row], tenotaId))[0]);
});

router.get("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const [row] = await db.select().from(mizeTable)
    .where(and(eq(mizeTable.id, params.data.id), sql`true`, eq(mizeTable.enotaId, tenotaId), aktivnaMiza));
  if (!row) { res.status(404).json({ error: "Miza ni najdena" }); return; }
  res.json((await enrichMize([row], tenotaId))[0]);
});

router.post(
  "/mize/:id/qr-token",
  requireMizaQrAdmin,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const mizaId = Number(req.params.id);
    if (!Number.isInteger(mizaId) || mizaId < 1) {
      res.status(400).json({ error: "Neveljaven ID mize" });
      return;
    }

    const qrToken = await ustvariQrToken(tenotaId, mizaId);
    if (!qrToken) {
      res.status(404).json({ error: "Miza ni najdena" });
      return;
    }

    broadcast("update", { type: "miza", id: mizaId });
    res.json({ qrToken, javniUrl: `/meni/${qrToken}` });
  },
);

router.get(
  "/mize/:id/qr-token",
  requireMizaQrAdmin,
  async (req, res): Promise<void> => {
    const tenotaId = (req as any).enotaId ?? 1;
    const mizaId = Number(req.params.id);
    if (!Number.isInteger(mizaId) || mizaId < 1) {
      res.status(400).json({ error: "Neveljaven ID mize" });
      return;
    }

    const [row] = await db
      .select({ qrToken: mizeTable.qrToken })
      .from(mizeTable)
      .where(and(eq(mizeTable.id, mizaId), eq(mizeTable.enotaId, tenotaId)));
    if (!row) {
      res.status(404).json({ error: "Miza ni najdena" });
      return;
    }

    res.json({
      qrToken: row.qrToken,
      javniUrl: row.qrToken ? `/meni/${row.qrToken}` : null,
    });
  },
);

router.put("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = UpdateMizaParams.safeParse(req.params);
  const parsed = UpdateMizaBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Podatki mize niso veljavni." });
    return;
  }
  if (parsed.data.posX !== undefined || parsed.data.posY !== undefined || parsed.data.oblika !== undefined) {
    res.status(409).json({ error: "Geometrijo mize urejajte izključno prek različice tlorisa prostora.", code: "TLORIS_KANONICEN" });
    return;
  }
  const updateData: Partial<typeof mizeTable.$inferInsert> = {};
  if (parsed.data.stevilka !== undefined) updateData.stevilka = parsed.data.stevilka;
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.kapaciteta !== undefined) updateData.kapaciteta = parsed.data.kapaciteta;
  if (parsed.data.status !== undefined) {
    updateData.status = parsed.data.status as "prosta" | "zasedena";
    updateData.rezervacijaNarocnikId = null;
    updateData.rezervacijaStrankaIme = null;
    updateData.rezervacijaTelefon = null;
    updateData.rezervacijaOpomba = null;
    updateData.rezervacijaVeljaDo = null;
  }
  if (parsed.data.prostorId !== undefined) updateData.prostorId = parsed.data.prostorId;
  if (parsed.data.posX !== undefined) updateData.posX = parsed.data.posX;
  if (parsed.data.posY !== undefined) updateData.posY = parsed.data.posY;
  if (parsed.data.oblika !== undefined) updateData.oblika = parsed.data.oblika;
  const whereClause = parsed.data.status === "prosta"
    ? and(
        eq(mizeTable.id, params.data.id),
        eq(mizeTable.enotaId, tenotaId),
        sql`NOT EXISTS (
          SELECT 1
          FROM ${narocilaTable}
          WHERE ${narocilaTable.mizaId} = ${mizeTable.id}
            AND ${narocilaTable.enotaId} = ${tenotaId}
            AND ${narocilaTable.status} = 'odprto'
        )`,
      )
    : and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId));
  const row = await db.transaction(async (tx) => {
    if (parsed.data.status === "zasedena") {
      await lockPosBusinessDay(tx, tenotaId);
      const businessDate = await getCurrentPosBusinessDate(tenotaId, undefined, tx);
      if (await isPosBusinessDayClosed(tx, tenotaId, businessDate)) return null;
    }
    const [snapshot] = await tx.select({ id: mizeTable.id, prostorId: mizeTable.prostorId, arhivirana: mizeTable.arhivirana })
      .from(mizeTable).where(and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId)));
    if (!snapshot) return undefined;
    const destinationId = parsed.data.prostorId === undefined ? snapshot.prostorId : parsed.data.prostorId;
    const roomChanged = parsed.data.prostorId !== undefined && destinationId !== snapshot.prostorId;
    if (roomChanged) {
      const roomIds = [snapshot.prostorId, destinationId].filter((id): id is number => id !== null).sort((a, b) => a - b);
      const lockedRooms = roomIds.length ? await tx.select({ id: prostoriTable.id }).from(prostoriTable)
        .where(and(inArray(prostoriTable.id, roomIds), eq(prostoriTable.enotaId, tenotaId)))
        .orderBy(asc(prostoriTable.id)).for("update") : [];
      if (destinationId !== null && !lockedRooms.some((room) => room.id === destinationId)) return undefined;
    }
    // Room locks precede the table lock, matching canonical PUT. Re-check the
    // snapshot so a concurrent reassignment cannot make us lock the wrong pair.
    const [before] = await tx.select({ id: mizeTable.id, prostorId: mizeTable.prostorId, arhivirana: mizeTable.arhivirana })
      .from(mizeTable).where(and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId))).for("update");
    if (!before || before.prostorId !== snapshot.prostorId) return undefined;
    const [updated] = await tx.update(mizeTable).set(updateData)
      .where(whereClause)
      .returning();
    if (!updated) return undefined;
    if (roomChanged) {
      const removed = await tx.delete(tlorisPostavkeTable).where(eq(tlorisPostavkeTable.mizaId, updated.id))
        .returning({ tlorisId: tlorisPostavkeTable.tlorisId });
      for (const item of removed) await tx.update(tlorisiTable)
        .set({ version: sql`${tlorisiTable.version} + 1`, posodobljeno: new Date() })
        .where(eq(tlorisiTable.id, item.tlorisId));
      if (destinationId !== null && !updated.arhivirana) {
        let [destinationLayout] = await tx.select().from(tlorisiTable)
          .where(eq(tlorisiTable.prostorId, destinationId)).for("update");
        if (!destinationLayout) [destinationLayout] = await tx.insert(tlorisiTable).values({ prostorId: destinationId }).returning();
        await tx.insert(tlorisPostavkeTable).values({
          id: `auto_${destinationId}_${updated.id}`, tlorisId: destinationLayout.id, vrsta: "table", mizaId: updated.id,
          x: 0, y: 0, sirina: 96, visina: 56, rotacija: 0, zIndex: 0, zaklenjena: false, vidna: true,
          slog: {}, podatki: { oblika: updated.oblika ?? "pravokotnik_h", automatic: true },
        });
        await tx.update(tlorisiTable).set({ version: destinationLayout.version + 1, posodobljeno: new Date() })
          .where(eq(tlorisiTable.id, destinationLayout.id));
        await tx.update(mizeTable).set({
          posX: 0, posY: 0, tlorisSirina: 96, tlorisVisina: 56, tlorisRotacija: 0,
        }).where(eq(mizeTable.id, updated.id));
        return { ...updated, posX: 0, posY: 0, tlorisSirina: 96, tlorisVisina: 56, tlorisRotacija: 0 };
      }
      await tx.update(mizeTable).set({
        posX: null, posY: null, tlorisSirina: null, tlorisVisina: null, tlorisRotacija: null,
      }).where(eq(mizeTable.id, updated.id));
      return { ...updated, posX: null, posY: null, tlorisSirina: null, tlorisVisina: null, tlorisRotacija: null };
    }
    return updated ?? undefined;
  });
  if (row === null) {
    res.status(409).json({
      error: "Tekoči poslovni dan je že zaključen z Z-poročilom.",
      code: "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN",
    });
    return;
  }
  if (!row) {
    const [miza] = await db.select({ id: mizeTable.id })
      .from(mizeTable)
      .where(and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId)));
    if (miza && parsed.data.status === "prosta") {
      res.status(409).json({ error: "Mize z odprtim naročilom ni mogoče sprostiti." });
      return;
    }
    res.status(404).json({ error: "Miza ni najdena" });
    return;
  }
  broadcast("update", { type: "miza", id: params.data.id });
  res.json((await enrichMize([row], tenotaId))[0]);
});

router.put("/mize/:id/rezervacija", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = ShraniRezervacijoMizeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Neveljaven ID mize." });
    return;
  }
  const parsed = ShraniRezervacijoMizeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Vnesite ime oziroma naziv, telefon in veljaven čas rezervacije." });
    return;
  }

  const strankaIme = parsed.data.strankaIme.trim();
  const telefon = parsed.data.telefon.trim();
  const emailJePodan = parsed.data.email !== undefined;
  const strankaOpombeSoPodane = parsed.data.strankaOpombe !== undefined;
  const email = parsed.data.email?.trim() || null;
  const strankaOpombe = parsed.data.strankaOpombe?.trim() || null;
  const opomba = parsed.data.opomba?.trim() || null;
  const veljaDo = parsed.data.zacetek ?? parsed.data.veljaDo;
  if (!strankaIme || !telefon) {
    res.status(400).json({ error: "Ime oziroma naziv in telefonska številka sta obvezna." });
    return;
  }
  if (email && !z.string().email().safeParse(email).success) {
    res.status(400).json({ error: "E-poštni naslov ni veljaven." });
    return;
  }
  let telefonNormaliziran: string;
  try {
    telefonNormaliziran = normalizirajTelefon(telefon);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Telefonska številka ni veljavna." });
    return;
  }
  if (!veljaDo || veljaDo.getTime() <= Date.now()) {
    res.status(400).json({ error: "Čas veljavnosti rezervacije mora biti v prihodnosti." });
    return;
  }

  let row: typeof mizeTable.$inferSelect | undefined;
  try {
    row = await db.transaction(async (tx) => {
      if (!await zakleniMizo(tx, params.data.id, tenotaId)) throw new Error("REZERVACIJA_MIZE_KONFLIKT");
      const [obstojeca] = await tx.select({ id: rezervacijeMizTable.id })
        .from(rezervacijeMizTable)
        .where(and(
          eq(rezervacijeMizTable.enotaId, tenotaId),
          eq(rezervacijeMizTable.mizaId, params.data.id),
          eq(rezervacijeMizTable.status, "aktivna"),
        ))
        .orderBy(rezervacijeMizTable.zacetek)
        .limit(1)
        .for("update");
      const [narocnik] = await tx
        .insert(narocnikiTable)
        .values({
          enotaId: tenotaId,
          ime: strankaIme,
          telefon,
          telefonNormaliziran,
          email,
          opombe: strankaOpombe,
        })
        .onConflictDoUpdate({
          target: [narocnikiTable.enotaId, narocnikiTable.telefonNormaliziran],
          set: {
            ime: strankaIme,
            telefon,
            ...(emailJePodan ? { email } : {}),
            ...(strankaOpombeSoPodane ? { opombe: strankaOpombe } : {}),
            posodobljeno: new Date(),
          },
        })
        .returning({ id: narocnikiTable.id });

      const mejaOd = new Date(veljaDo.getTime() - RESERVATION_SPACING_MS);
      const mejaDo = new Date(veljaDo.getTime() + RESERVATION_SPACING_MS);
      const [konflikt] = await tx.select({ id: rezervacijeMizTable.id }).from(rezervacijeMizTable)
        .where(and(
          eq(rezervacijeMizTable.enotaId, tenotaId),
          eq(rezervacijeMizTable.mizaId, params.data.id),
          eq(rezervacijeMizTable.status, "aktivna"),
          ...(obstojeca ? [ne(rezervacijeMizTable.id, obstojeca.id)] : []),
          sql`${rezervacijeMizTable.zacetek} > ${mejaOd} AND ${rezervacijeMizTable.zacetek} < ${mejaDo}`,
        )).limit(1);
      if (konflikt) throw new Error("REZERVACIJA_MIZE_KONFLIKT");
      if (obstojeca) {
        const [updated] = await tx.update(rezervacijeMizTable).set({
          narocnikId: narocnik.id, strankaIme, telefon, opomba, zacetek: veljaDo,
          posodobljeno: new Date(),
        }).where(eq(rezervacijeMizTable.id, obstojeca.id)).returning();
        await zapisiZgodovino(tx, { enotaId: tenotaId, mizaId: params.data.id, rezervacijaId: obstojeca.id,
          dogodek: "posodobljena", actorClerkUserId: actor(req), podatki: { zacetek: updated?.zacetek, strankaIme } });
      } else {
        const snapshot = await snapshotMize(tx, params.data.id, tenotaId);
        if (!snapshot) throw new Error("REZERVACIJA_MIZE_KONFLIKT");
        const [created] = await tx.insert(rezervacijeMizTable).values({
          enotaId: tenotaId, mizaId: params.data.id, narocnikId: narocnik.id,
          strankaIme, telefon, opomba, zacetek: veljaDo, mizaStevilkaSnapshot: snapshot.stevilka,
          mizaImeSnapshot: snapshot.ime, prostorImeSnapshot: snapshot.prostorIme,
        }).returning();
        await zapisiZgodovino(tx, { enotaId: tenotaId, mizaId: params.data.id, rezervacijaId: created!.id,
          dogodek: "ustvarjena", actorClerkUserId: actor(req), podatki: { zacetek: created!.zacetek, strankaIme } });
      }
      const [miza] = await tx.select().from(mizeTable).where(and(
        eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId),
      ));
      if (!miza) throw new Error("REZERVACIJA_MIZE_KONFLIKT");
      return miza;
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== "REZERVACIJA_MIZE_KONFLIKT") throw error;
  }

  if (!row) {
    const [miza] = await db.select({ id: mizeTable.id })
      .from(mizeTable)
      .where(and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId)));
    if (!miza) {
      res.status(404).json({ error: "Miza ni najdena." });
      return;
    }
    res.status(409).json({ error: "Zasedene mize ali mize z odprtim naročilom ni mogoče rezervirati." });
    return;
  }

  broadcast("update", { type: "miza", id: params.data.id });
  res.json(ShraniRezervacijoMizeResponse.parse((await enrichMize([row], tenotaId))[0]));
});

router.delete("/mize/:id/rezervacija", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = SprostiRezervacijoMizeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Neveljaven ID mize." });
    return;
  }

  const outcome = await db.transaction(async (tx) => {
    if (!await zakleniMizo(tx, params.data.id, tenotaId)) return "missing" as const;
    const [rezervacija] = await tx.select({ id: rezervacijeMizTable.id })
      .from(rezervacijeMizTable)
      .where(and(
        eq(rezervacijeMizTable.enotaId, tenotaId),
        eq(rezervacijeMizTable.mizaId, params.data.id),
        eq(rezervacijeMizTable.status, "aktivna"),
      ))
      .orderBy(rezervacijeMizTable.zacetek)
      .limit(1)
      .for("update");
    if (!rezervacija) return "none" as const;
    await tx.update(rezervacijeMizTable).set({
      status: "sprostena",
      sproscena: new Date(),
      posodobljeno: new Date(),
    }).where(eq(rezervacijeMizTable.id, rezervacija.id));
    await zapisiZgodovino(tx, { enotaId: tenotaId, mizaId: params.data.id, rezervacijaId: rezervacija.id,
      dogodek: "preklicana", actorClerkUserId: actor(req), podatki: {} });
    return "released" as const;
  });

  if (outcome === "missing") {
    res.status(404).json({ error: "Miza ni najdena." });
    return;
  }
  if (outcome === "none") {
    res.status(409).json({ error: "Miza nima aktivne rezervacije." });
    return;
  }

  broadcast("update", { type: "miza", id: params.data.id });
  res.sendStatus(204);
});

const reservationInput = z.object({
  strankaIme: z.string().trim().min(1).max(200),
  telefon: z.string().trim().min(1).max(50),
  zacetek: z.coerce.date().optional(),
  veljaDo: z.coerce.date().optional(), // compatibility with the old singular endpoint
  opomba: z.string().trim().max(2000).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  strankaOpombe: z.string().trim().max(2000).nullable().optional(),
});

async function shraniRezervacijoVRstico(
  enotaId: number, mizaId: number, data: z.infer<typeof reservationInput>, rezervacijaId?: number, actorClerkUserId: string | null = null,
) {
  const zacetek = data.zacetek ?? data.veljaDo;
  if (!zacetek || zacetek.getTime() <= Date.now()) throw new Error("REZERVACIJA_NEVELJAVEN_ZACETEK");
  let normalized: string;
  try { normalized = normalizirajTelefon(data.telefon); } catch { throw new Error("REZERVACIJA_NEVELJAVEN_TELEFON"); }
  return db.transaction(async (tx) => {
    if (!await zakleniMizo(tx, mizaId, enotaId)) throw new Error("REZERVACIJA_MIZA_NE_OBSTAJA");
    const [conflict] = await tx.select({ id: rezervacijeMizTable.id }).from(rezervacijeMizTable).where(and(
      eq(rezervacijeMizTable.enotaId, enotaId), eq(rezervacijeMizTable.mizaId, mizaId),
      eq(rezervacijeMizTable.status, "aktivna"),
      rezervacijaId ? ne(rezervacijeMizTable.id, rezervacijaId) : sql`true`,
      sql`abs(extract(epoch from (${rezervacijeMizTable.zacetek} - ${zacetek}))) < ${RESERVATION_SPACING_MS / 1000}`,
    )).limit(1);
    if (conflict) throw new Error("REZERVACIJA_PREBLIZU");
    const [customer] = await tx.insert(narocnikiTable).values({
      enotaId, ime: data.strankaIme, telefon: data.telefon, telefonNormaliziran: normalized,
      email: data.email ?? null, opombe: data.strankaOpombe ?? null,
    }).onConflictDoUpdate({
      target: [narocnikiTable.enotaId, narocnikiTable.telefonNormaliziran],
      set: { ime: data.strankaIme, telefon: data.telefon, posodobljeno: new Date() },
    }).returning({ id: narocnikiTable.id });
    if (rezervacijaId) {
      const [updated] = await tx.update(rezervacijeMizTable).set({
        narocnikId: customer.id, strankaIme: data.strankaIme, telefon: data.telefon,
        opomba: data.opomba ?? null, zacetek,
      }).where(and(eq(rezervacijeMizTable.id, rezervacijaId), eq(rezervacijeMizTable.enotaId, enotaId),
        eq(rezervacijeMizTable.mizaId, mizaId), eq(rezervacijeMizTable.status, "aktivna"))).returning();
      if (!updated) throw new Error("REZERVACIJA_NI_AKTIVNA");
      await zapisiZgodovino(tx, { enotaId, mizaId, rezervacijaId: updated.id, dogodek: "posodobljena", actorClerkUserId,
        podatki: { zacetek: updated.zacetek, strankaIme: updated.strankaIme } });
      return updated;
    }
    const snapshot = await snapshotMize(tx, mizaId, enotaId);
    if (!snapshot) throw new Error("REZERVACIJA_MIZA_NE_OBSTAJA");
    const [created] = await tx.insert(rezervacijeMizTable).values({
      enotaId, mizaId, narocnikId: customer.id, strankaIme: data.strankaIme,
      telefon: data.telefon, opomba: data.opomba ?? null, zacetek, mizaStevilkaSnapshot: snapshot.stevilka,
      mizaImeSnapshot: snapshot.ime, prostorImeSnapshot: snapshot.prostorIme,
    }).returning();
    await zapisiZgodovino(tx, { enotaId, mizaId, rezervacijaId: created!.id, dogodek: "ustvarjena", actorClerkUserId,
      podatki: { zacetek: created!.zacetek, strankaIme: created!.strankaIme } });
    return created;
  });
}

function reservationError(res: Response, error: unknown): void {
  const code = error instanceof Error ? error.message : "";
  if (code === "REZERVACIJA_MIZA_NE_OBSTAJA") { res.status(404).json({ error: "Miza ni najdena." }); return; }
  if (code === "REZERVACIJA_PREBLIZU") { res.status(409).json({ error: "Začetki rezervacij iste mize morajo biti vsaj tri ure narazen.", code }); return; }
  if (code === "REZERVACIJA_NI_AKTIVNA") { res.status(409).json({ error: "Aktivne rezervacije ni mogoče najti.", code }); return; }
  if (code === "REZERVACIJA_NEVELJAVEN_ZACETEK") { res.status(400).json({ error: "Termin oziroma začetek rezervacije mora biti v prihodnosti.", code }); return; }
  res.status(400).json({ error: "Telefonska številka ni veljavna.", code });
}

router.get("/mize/:id/rezervacije", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1; const mizaId = Number(req.params.id);
  const [miza] = await db.select({ id: mizeTable.id }).from(mizeTable).where(and(eq(mizeTable.id, mizaId), eq(mizeTable.enotaId, enotaId)));
  if (!miza) { res.status(404).json({ error: "Miza ni najdena." }); return; }
  res.json(await db.select().from(rezervacijeMizTable).where(and(eq(rezervacijeMizTable.enotaId, enotaId), eq(rezervacijeMizTable.mizaId, mizaId))).orderBy(rezervacijeMizTable.zacetek));
});
router.post("/mize/:id/rezervacije", async (req, res): Promise<void> => {
  const parsed = reservationInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Vnesite stranko, telefon in začetek termina." }); return; }
  try { const row = await shraniRezervacijoVRstico((req as any).enotaId ?? 1, Number(req.params.id), parsed.data, undefined, actor(req)); broadcast("update", { type: "miza", id: Number(req.params.id) }); res.status(201).json(row); } catch (error) { reservationError(res, error); }
});
router.put("/mize/:id/rezervacije/:rezervacijaId", async (req, res): Promise<void> => {
  const parsed = reservationInput.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: "Podatki termina niso veljavni." }); return; }
  try { const row = await shraniRezervacijoVRstico((req as any).enotaId ?? 1, Number(req.params.id), parsed.data, Number(req.params.rezervacijaId), actor(req)); broadcast("update", { type: "miza", id: Number(req.params.id) }); res.json(row); } catch (error) { reservationError(res, error); }
});
router.delete("/mize/:id/rezervacije/:rezervacijaId", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1; const mizaId = Number(req.params.id); const id = Number(req.params.rezervacijaId);
  const [row] = await db.transaction(async (tx) => {
    if (!await zakleniMizo(tx, mizaId, enotaId)) return [];
    const updated = await tx.update(rezervacijeMizTable).set({ status: "sprostena", sproscena: new Date(), posodobljeno: new Date() }).where(and(
      eq(rezervacijeMizTable.id, id), eq(rezervacijeMizTable.enotaId, enotaId), eq(rezervacijeMizTable.mizaId, mizaId), eq(rezervacijeMizTable.status, "aktivna"),
    )).returning({ id: rezervacijeMizTable.id });
    if (updated[0]) await zapisiZgodovino(tx, { enotaId, mizaId, rezervacijaId: id, dogodek: "preklicana", actorClerkUserId: actor(req), podatki: {} });
    return updated;
  });
  if (!row) { res.status(404).json({ error: "Aktivna rezervacija ni najdena." }); return; }
  broadcast("update", { type: "miza", id: mizaId }); res.sendStatus(204);
});

router.get("/mize/:id/rezervacije/:rezervacijaId/zgodovina", async (req, res): Promise<void> => {
  const params = ListRezervacijaMizeZgodovinaParams.safeParse(req.params);
  if (!params.success) { res.status(400).json({ error: "Neveljaven ID rezervacije." }); return; }
  const [reservation] = await db.select({ id: rezervacijeMizTable.id, enotaId: rezervacijeMizTable.enotaId }).from(rezervacijeMizTable).where(and(
    eq(rezervacijeMizTable.id, params.data.rezervacijaId), eq(rezervacijeMizTable.mizaId, params.data.id),
  ));
  if (!reservation) { res.status(404).json({ error: "Rezervacija ni najdena." }); return; }
  if (!await canAccessReservationUnit(req, reservation.enotaId)) {
    res.status(403).json({ error: "Za zgodovino druge enote nimate pravic." });
    return;
  }
  const rows = await db.select().from(rezervacijeMizZgodovinaTable).where(and(
    eq(rezervacijeMizZgodovinaTable.enotaId, reservation.enotaId), eq(rezervacijeMizZgodovinaTable.rezervacijaId, reservation.id),
  )).orderBy(rezervacijeMizZgodovinaTable.ustvarjeno);
  res.json(ListRezervacijaMizeZgodovinaResponse.parse(rows));
});

const bulkPozicijaBody = z.union([
  z.object({
    reset: z.literal(true),
    prostorId: z.number().int().positive(),
  }),
  z.object({
    reset: z.literal(false).optional(),
    pozicije: z.array(z.object({
      id: z.number().int().positive(),
      posX: z.number().finite(),
      posY: z.number().finite(),
      oblika: z.enum(["kvadrat", "pravokotnik_h", "pravokotnik_v", "okrogla"]).optional(),
    })).min(1),
  }),
]);

router.patch("/mize/bulk-pozicija", requireMizaQrAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = bulkPozicijaBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Podatki tlorisa niso veljavni." });
    return;
  }
  // This endpoint predates versioned layouts. Applying it beside a canonical
  // editor would silently lose a concurrent edit, so geometry is fail-closed.
  res.status(409).json({ error: "Geometrijo miz urejajte izključno prek različice tlorisa prostora.", code: "TLORIS_KANONICEN" });
  return;
});

router.delete("/mize/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const archived = await db.transaction(async (tx) => {
    if (!await zakleniMizo(tx, params.data.id, tenotaId)) return false;
    // Must be checked only after the table lock: an order cannot race between
    // the pre-check and archival. Lock order remains table → order.
    const [odprto] = await tx.select({ id: narocilaTable.id }).from(narocilaTable).where(and(
      eq(narocilaTable.mizaId, params.data.id), eq(narocilaTable.enotaId, tenotaId), eq(narocilaTable.status, "odprto"),
    )).limit(1).for("update");
    if (odprto) return null;
    const [miza] = await tx.update(mizeTable).set({ arhivirana: true, arhiviranaOb: new Date(), qrToken: null })
      .where(and(eq(mizeTable.id, params.data.id), eq(mizeTable.enotaId, tenotaId), aktivnaMiza)).returning();
    if (!miza) return false;
    // Archiving is a transactional lifecycle operation: remove the item so an
    // operational layout can never select an archived table.
    const removed = await tx.delete(tlorisPostavkeTable).where(eq(tlorisPostavkeTable.mizaId, miza.id))
      .returning({ tlorisId: tlorisPostavkeTable.tlorisId });
    for (const item of removed) await tx.update(tlorisiTable)
      .set({ version: sql`${tlorisiTable.version} + 1`, posodobljeno: new Date() })
      .where(eq(tlorisiTable.id, item.tlorisId));
    const reservations = await tx.select({ id: rezervacijeMizTable.id }).from(rezervacijeMizTable)
      .where(and(eq(rezervacijeMizTable.enotaId, tenotaId), eq(rezervacijeMizTable.mizaId, miza.id)));
    for (const reservation of reservations) {
      await zapisiZgodovino(tx, { enotaId: tenotaId, mizaId: miza.id, rezervacijaId: reservation.id,
        dogodek: "miza_arhivirana", actorClerkUserId: actor(req), podatki: { mizaStevilka: miza.stevilka, mizaIme: miza.ime } });
    }
    return true;
  });
  if (archived === null) {
    res.status(409).json({ error: "Mize ni mogoče izbrisati — ima odprta naročila." });
    return;
  }
  if (!archived) {
    res.status(404).json({ error: "Miza ni najdena." });
    return;
  }
  broadcast("update", { type: "miza" });
  res.sendStatus(204);
});

export default router;
