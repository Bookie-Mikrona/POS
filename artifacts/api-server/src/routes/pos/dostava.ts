import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, dostavaStatusZgodovinaTable, dostavniKurirjiTable, narocilaTable } from "@workspace/db";
import { broadcastToUnit } from "../../lib/pos-sse";
import { jeDostavaStatus, jeVeljavenDostavniPrehod, type DostavaStatus } from "../../lib/dostava-status";

const router: IRouter = Router();
const VLOGE_ZA_UPRAVLJANJE_KURIRJEV = ["admin", "admin_enote", "superadmin"];

function zahtevaUpravljanjeKurirjev(req: Request, res: Response): boolean {
  if (!VLOGE_ZA_UPRAVLJANJE_KURIRJEV.includes((req as any).vloga)) {
    res.status(403).json({
      error: "Upravljanje kurirjev zahteva skrbniško vlogo.",
      code: "KURIRJI_ADMIN_REQUIRED",
    });
    return false;
  }
  return true;
}

const CourierBody = z.object({ ime: z.string().trim().min(1).max(120), telefon: z.string().trim().max(50).optional().nullable() });
const StatusBody = z.object({
  status: z.string(),
  kurirId: z.coerce.number().int().positive().optional().nullable(),
  idempotencyKey: z.string().trim().min(8).max(200),
});

router.get("/dostava/kurirji", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  res.json(await db.select().from(dostavniKurirjiTable)
    .where(eq(dostavniKurirjiTable.enotaId, enotaId)).orderBy(dostavniKurirjiTable.ime));
});

router.post("/dostava/kurirji", async (req, res): Promise<void> => {
  if (!zahtevaUpravljanjeKurirjev(req, res)) return;
  const enotaId = (req as any).enotaId as number;
  const parsed = CourierBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Podatki kurirja niso veljavni." }); return; }
  try {
    const [kurir] = await db.insert(dostavniKurirjiTable).values({ enotaId, ...parsed.data }).returning();
    res.status(201).json(kurir);
  } catch (error: any) {
    if (error?.code === "23505") { res.status(409).json({ error: "Kurir s tem imenom že obstaja." }); return; }
    throw error;
  }
});

router.patch("/dostava/kurirji/:id", async (req, res): Promise<void> => {
  if (!zahtevaUpravljanjeKurirjev(req, res)) return;
  const enotaId = (req as any).enotaId as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || typeof req.body?.aktiven !== "boolean") { res.status(400).json({ error: "Podatki kurirja niso veljavni." }); return; }
  const [kurir] = await db.update(dostavniKurirjiTable).set({ aktiven: req.body.aktiven })
    .where(and(eq(dostavniKurirjiTable.id, id), eq(dostavniKurirjiTable.enotaId, enotaId))).returning();
  if (!kurir) { res.status(404).json({ error: "Kurir ni najden." }); return; }
  res.json(kurir);
});

router.get("/narocila/:id/dostava-zgodovina", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const [order] = await db.select({ id: narocilaTable.id }).from(narocilaTable)
    .where(and(eq(narocilaTable.id, id), eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.nacinIzpolnitve, "dostava")));
  if (!order) { res.status(404).json({ error: "Dostavno naročilo ni najdeno." }); return; }
  res.json(await db.select({
    id: dostavaStatusZgodovinaTable.id,
    narociloId: dostavaStatusZgodovinaTable.narociloId,
    enotaId: dostavaStatusZgodovinaTable.enotaId,
    status: dostavaStatusZgodovinaTable.status,
    kurirId: dostavaStatusZgodovinaTable.kurirId,
    idempotencyKey: dostavaStatusZgodovinaTable.idempotencyKey,
    actorId: dostavaStatusZgodovinaTable.actorId,
    ustvarjeno: dostavaStatusZgodovinaTable.ustvarjeno,
    kurirIme: dostavniKurirjiTable.ime,
  }).from(dostavaStatusZgodovinaTable)
    .leftJoin(dostavniKurirjiTable, eq(dostavaStatusZgodovinaTable.kurirId, dostavniKurirjiTable.id))
    .where(and(eq(dostavaStatusZgodovinaTable.narociloId, id), eq(dostavaStatusZgodovinaTable.enotaId, enotaId)))
    .orderBy(dostavaStatusZgodovinaTable.id));
});

router.post("/narocila/:id/dostava-status", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const id = Number(req.params.id);
  const parsed = StatusBody.safeParse(req.body);
  if (!Number.isInteger(id) || !parsed.success || !jeDostavaStatus(parsed.success ? parsed.data.status : "")) {
    res.status(400).json({ error: "Status dostave ali idempotency ključ nista veljavna." }); return;
  }
  const input = parsed.data;
  const naslednjiStatus = input.status as DostavaStatus;
  const actorId = typeof (req as any).posUporabnik?.id === "number" ? (req as any).posUporabnik.id : null;
  try {
    const result = await db.transaction(async (tx) => {
      const [repeat] = await tx.select({ status: dostavaStatusZgodovinaTable.status }).from(dostavaStatusZgodovinaTable)
        .where(and(eq(dostavaStatusZgodovinaTable.narociloId, id), eq(dostavaStatusZgodovinaTable.idempotencyKey, input.idempotencyKey))).limit(1);
      if (repeat) return { repeat: true, status: repeat.status };
      const [order] = await tx.select().from(narocilaTable)
        .where(and(eq(narocilaTable.id, id), eq(narocilaTable.enotaId, enotaId), eq(narocilaTable.nacinIzpolnitve, "dostava"))).for("update");
      if (!order || !order.dostavaStatus || !jeDostavaStatus(order.dostavaStatus)) throw new Error("DOSTAVA_NI_NAJDENA");
      const [repeatAfterLock] = await tx.select({ status: dostavaStatusZgodovinaTable.status }).from(dostavaStatusZgodovinaTable)
        .where(and(eq(dostavaStatusZgodovinaTable.narociloId, id), eq(dostavaStatusZgodovinaTable.idempotencyKey, input.idempotencyKey))).limit(1);
      if (repeatAfterLock) return { repeat: true, status: repeatAfterLock.status };
      if (!jeVeljavenDostavniPrehod(order.dostavaStatus, naslednjiStatus)) throw new Error("NEVELJAVEN_PREHOD_DOSTAVE");
      const kurirId = input.status === "prevzel_kurir"
        ? (input.kurirId ?? order.dostavaKurirId)
        : order.dostavaKurirId;
      if (input.status === "prevzel_kurir" && !kurirId) throw new Error("KURIR_JE_OBVEZEN");
      if (kurirId && input.status === "prevzel_kurir") {
        const [kurir] = await tx.select({ id: dostavniKurirjiTable.id }).from(dostavniKurirjiTable).where(and(
          eq(dostavniKurirjiTable.id, kurirId), eq(dostavniKurirjiTable.enotaId, enotaId), eq(dostavniKurirjiTable.aktiven, true),
        ));
        if (!kurir) throw new Error("KURIR_NI_NA_VOLJO");
      }
      await tx.update(narocilaTable).set({ dostavaStatus: naslednjiStatus, dostavaKurirId: kurirId ?? null })
        .where(eq(narocilaTable.id, id));
      await tx.insert(dostavaStatusZgodovinaTable).values({ narociloId: id, enotaId, status: naslednjiStatus, kurirId: kurirId ?? null, idempotencyKey: input.idempotencyKey, actorId });
      return { repeat: false, status: naslednjiStatus };
    });
    if (!result.repeat) broadcastToUnit(enotaId, "update", { type: "narocilo", id });
    res.json({ id, status: result.status, idempotent: result.repeat });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      DOSTAVA_NI_NAJDENA: "Dostavno naročilo ni najdeno.", NEVELJAVEN_PREHOD_DOSTAVE: "Prehod statusa dostave ni dovoljen.",
      KURIR_JE_OBVEZEN: "Pred prevzemom določite aktivnega kurirja.", KURIR_NI_NA_VOLJO: "Kurir ni aktiven v izbrani enoti.",
    };
    if (messages[code]) { res.status(code === "DOSTAVA_NI_NAJDENA" ? 404 : 409).json({ error: messages[code], code }); return; }
    throw error;
  }
});

export default router;