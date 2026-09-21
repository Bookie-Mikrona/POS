import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { createHmac } from "node:crypto";
import { db, izmeneTable, natakariTable } from "@workspace/db";
import { getPosActorSessionSecret } from "../../lib/posActorSessionSecret";
import { writePosActorAudit, type ExecuteSql } from "../../lib/posActorAudit";
import type { PosRequest } from "../../middlewares/pos";
import {
  hashPosPin,
  POS_PIN_LOCK_MS,
  POS_PIN_MAX_FAILURES,
  verifyPosPin,
} from "../../lib/posPin";

const router: IRouter = Router();
const SESSION_MS = 16 * 60 * 60_000;
const audit = async (
  req: Request,
  natakarId: number | null,
  action: string,
  metadata?: object,
  execute: ExecuteSql = query => db.execute(query),
) => {
  const posReq = req as PosRequest;
  await writePosActorAudit(execute, {
    enotaId: posReq.enotaId,
    natakarId,
    actorClerkUserId: posReq.clerkUserId,
    action,
    metadata: metadata as Record<string, unknown> | undefined,
  });
};
const admin = (req: Request) => ["admin", "admin_enote", "superadmin"].includes((req as any).vloga);
router.put("/quick-switch/natakarji/:id/pin", async (req, res): Promise<void> => {
  if (!admin(req)) { res.status(403).json({ error: "Samo administrator lahko nastavi PIN." }); return; }
  const pin = req.body?.pin;
  if (typeof pin !== "string" || !/^\d{4,12}$/.test(pin)) { res.status(400).json({ error: "PIN mora imeti 4 do 12 števk." }); return; }
  const id = Number(req.params.id);
  const [natakar] = await db.select({ id: natakariTable.id }).from(natakariTable).where(and(eq(natakariTable.id, id), eq(natakariTable.companyId, (req as any).companyId), eq(natakariTable.aktiven, true)));
  if (!natakar) { res.status(404).json({ error: "Aktivni natakar ni najden." }); return; }
  await db.transaction(async tx => {
    await tx.update(natakariTable).set({ posPinHash: hashPosPin(pin), posPinFailedAttempts: 0, posPinLockedUntil: null }).where(eq(natakariTable.id, id));
    await audit(req, id, "pin_set", undefined, query => tx.execute(query));
  });
  res.status(204).end();
});
router.post("/quick-switch/switch", async (req, res): Promise<void> => {
  const id = Number(req.body?.natakarId), pin = req.body?.pin;
  if (!Number.isInteger(id) || typeof pin !== "string") { res.status(400).json({ error: "Natakar in PIN sta obvezna." }); return; }
  const [n] = await db.select().from(natakariTable).where(and(eq(natakariTable.id, id), eq(natakariTable.companyId, (req as any).companyId), eq(natakariTable.aktiven, true)));
  if (!n || !n.posPinHash) { await audit(req, null, "switch_failed"); res.status(401).json({ error: "PIN ni veljaven." }); return; }
  if (n.posPinLockedUntil && n.posPinLockedUntil.getTime() > Date.now()) { await audit(req, id, "switch_locked"); res.status(423).json({ error: "PIN je začasno zaklenjen." }); return; }
  if (!verifyPosPin(pin, n.posPinHash)) {
    const failures = n.posPinFailedAttempts + 1, locked = failures >= POS_PIN_MAX_FAILURES ? new Date(Date.now() + POS_PIN_LOCK_MS) : null;
    await db.transaction(async tx => {
      await tx.update(natakariTable).set({ posPinFailedAttempts: failures, posPinLockedUntil: locked }).where(eq(natakariTable.id, id));
      await audit(req, id, "switch_failed", { failures }, query => tx.execute(query));
    });
    res.status(401).json({ error: locked ? "PIN je začasno zaklenjen." : "PIN ni veljaven." }); return;
  }
  const [openShift] = await db.select({ id: izmeneTable.id }).from(izmeneTable)
    .where(and(
      eq(izmeneTable.natakariId, id),
      eq(izmeneTable.enotaId, (req as PosRequest).enotaId),
      isNull(izmeneTable.konec),
    ))
    .limit(1);
  if (!openShift) {
    await audit(req, id, "switch_failed", { reason: "open_shift_required" });
    res.status(409).json({
      code: "OPEN_SHIFT_REQUIRED",
      error: "Pred prijavo na POS odprite izmeno tega natakarja v aktivni enoti.",
    });
    return;
  }
  const secret = getPosActorSessionSecret();
  if (!secret) { res.status(503).json({ error: "POS actor session ni konfiguriran." }); return; }
  const expiresAt = Date.now() + SESSION_MS;
  const encoded = Buffer.from(JSON.stringify({
    n: id,
    s: openShift.id,
    u: (req as PosRequest).enotaId,
    c: (req as PosRequest).companyId,
    e: expiresAt,
  })).toString("base64url");
  const token = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("base64url")}`;
  await db.transaction(async tx => {
    await tx.update(natakariTable).set({ posPinFailedAttempts: 0, posPinLockedUntil: null }).where(eq(natakariTable.id, id));
    await audit(req, id, "switch", undefined, query => tx.execute(query));
  });
  res.json({ token, expiresAt, natakarId: id, izmenaId: openShift.id });
});
router.post("/quick-switch/lock", async (req, res): Promise<void> => { await audit(req, null, "lock"); res.status(204).end(); });
export default router;