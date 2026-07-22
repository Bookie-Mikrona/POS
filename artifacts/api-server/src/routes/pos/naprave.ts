import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, napraveTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";

const router: IRouter = Router();

function sanitizeTerminalConfig(nastavitveJson: string | null | undefined): Record<string, unknown> | null {
  if (!nastavitveJson) return null;
  try {
    const raw = JSON.parse(nastavitveJson) as Record<string, unknown>;
    return {
      terminalAktiven:          Boolean(raw.terminalAktiven ?? false),
      terminalIp:               String(raw.terminalIp ?? "192.168.1.100"),
      terminalPort:             Number(raw.terminalPort ?? 9000),
      terminalTimeoutMs:        Number(raw.terminalTimeoutMs ?? 30000),
      paytenAndroidAktiven:     Boolean(raw.paytenAndroidAktiven ?? false),
      paytenAndroidPackageName: String(raw.paytenAndroidPackageName ?? "com.payten.mpos"),
      sumupAktiven:             Boolean(raw.sumupAktiven ?? false),
      sumupTerminalSerial:      String(raw.sumupTerminalSerial ?? ""),
      sumupApiKeyNastavljen:    !!(raw.sumupApiKey),
      vivaAktiven:              Boolean(raw.vivaAktiven ?? false),
      vivaClientId:             String(raw.vivaClientId ?? ""),
      vivaClientSecretNastavljen: !!(raw.vivaClientSecret),
      vivaSourceCode:           String(raw.vivaSourceCode ?? ""),
      vivaDemoNacin:            Boolean(raw.vivaDemoNacin ?? false),
      vivaTerminalAktiven:      Boolean(raw.vivaTerminalAktiven ?? false),
      vivaTerminalId:           String(raw.vivaTerminalId ?? ""),
      vivaAndroidTerminalAktiven: Boolean(raw.vivaAndroidTerminalAktiven ?? false),
      vivaAndroidSourceCode:    String(raw.vivaAndroidSourceCode ?? ""),
      vivaTapToPayAktiven:      Boolean(raw.vivaTapToPayAktiven ?? false),
      vivaTapToPaySourceCode:   String(raw.vivaTapToPaySourceCode ?? ""),
      agentTiskalnikIme:        String(raw.agentTiskalnikIme ?? ""),
      tiskalnikSirina:          Number(raw.tiskalnikSirina ?? 58)};
  } catch {
    return null;
  }
}

function napravaToResponse(row: typeof napraveTable.$inferSelect) {
  return {
    ...row,
    nastavitveJson: undefined,
    terminalConfig: sanitizeTerminalConfig(row.nastavitveJson)};
}

router.get("/naprave", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(napraveTable).where(
    and(eq(napraveTable.enotaId, tenotaId))
  );
  res.json(rows.map(napravaToResponse));
});

router.post("/naprave/registracija", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error }); return; }

  const { napravaKljuc, ime } = parsed.data;

  const existing = await db.select().from(napraveTable).where(
    and(eq(napraveTable.enotaId, tenotaId),
      eq(napraveTable.napravaKljuc, napravaKljuc)
    )
  );

  let naprava: typeof napraveTable.$inferSelect;
  if (existing.length > 0) {
    const [updated] = await db.update(napraveTable)
      .set({ ime })
      .where(eq(napraveTable.id, existing[0].id))
      .returning();
    naprava = updated;
  } else {
    const [created] = await db.insert(napraveTable).values({
      enotaId: tenotaId,
      ime,
      napravaKljuc}).returning();
    naprava = created;
  }

  const isNew = existing.length === 0;
  res.status(isNew ? 201 : 200).json(napravaToResponse(naprava));
});

router.put("/naprave/terminali", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  // Naprava se identificira prek X-Naprava-Id headerja (nastavi ga frontend z getNapravaId())
  const napravaKljuc = req.headers["x-naprava-id"] as string | undefined;

  if (!napravaKljuc) {
    res.status(404).json({ error: "Naprava ni registrirana. Osvežite stran." });
    return;
  }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [obstojecaNaprava] = await db.select().from(napraveTable).where(
    and(eq(napraveTable.enotaId, tenotaId),
      eq(napraveTable.napravaKljuc, napravaKljuc)
    )
  );

  if (!obstojecaNaprava) {
    res.status(404).json({ error: "Naprava ni najdena." });
    return;
  }

  let obstojeciConfig: Record<string, unknown> = {};
  if (obstojecaNaprava.nastavitveJson) {
    try { obstojeciConfig = JSON.parse(obstojecaNaprava.nastavitveJson) as Record<string, unknown>; } catch { /* nič */ }
  }

  const d = parsed.data;
  const novConfig: Record<string, unknown> = { ...obstojeciConfig };

  if (d.terminalAktiven !== undefined)          novConfig.terminalAktiven          = d.terminalAktiven;
  if (d.terminalIp !== undefined)               novConfig.terminalIp               = d.terminalIp;
  if (d.terminalPort !== undefined)             novConfig.terminalPort             = d.terminalPort;
  if (d.terminalTimeoutMs !== undefined)        novConfig.terminalTimeoutMs        = d.terminalTimeoutMs;
  if (d.paytenAndroidAktiven !== undefined)     novConfig.paytenAndroidAktiven     = d.paytenAndroidAktiven;
  if (d.paytenAndroidPackageName !== undefined) novConfig.paytenAndroidPackageName = d.paytenAndroidPackageName;
  if (d.sumupAktiven !== undefined)             novConfig.sumupAktiven             = d.sumupAktiven;
  if (d.sumupTerminalSerial !== undefined)      novConfig.sumupTerminalSerial      = d.sumupTerminalSerial;
  if (d.sumupApiKey && d.sumupApiKey.trim() !== "")             novConfig.sumupApiKey       = d.sumupApiKey.trim();
  if (d.vivaAktiven !== undefined)              novConfig.vivaAktiven              = d.vivaAktiven;
  if (d.vivaClientId !== undefined)             novConfig.vivaClientId             = d.vivaClientId;
  if (d.vivaSourceCode !== undefined)           novConfig.vivaSourceCode           = d.vivaSourceCode;
  if (d.vivaDemoNacin !== undefined)            novConfig.vivaDemoNacin            = d.vivaDemoNacin;
  if (d.vivaClientSecret && d.vivaClientSecret.trim() !== "")  novConfig.vivaClientSecret = d.vivaClientSecret.trim();
  if (d.vivaTerminalAktiven !== undefined)      novConfig.vivaTerminalAktiven      = d.vivaTerminalAktiven;
  if (d.vivaTerminalId !== undefined)           novConfig.vivaTerminalId           = d.vivaTerminalId;
  if (d.vivaAndroidTerminalAktiven !== undefined) novConfig.vivaAndroidTerminalAktiven = d.vivaAndroidTerminalAktiven;
  if (d.vivaAndroidSourceCode !== undefined)    novConfig.vivaAndroidSourceCode    = d.vivaAndroidSourceCode;
  if (d.vivaTapToPayAktiven !== undefined)      novConfig.vivaTapToPayAktiven      = d.vivaTapToPayAktiven;
  if (d.vivaTapToPaySourceCode !== undefined)   novConfig.vivaTapToPaySourceCode   = d.vivaTapToPaySourceCode;
  if (d.agentTiskalnikIme !== undefined)        novConfig.agentTiskalnikIme        = d.agentTiskalnikIme;
  if (d.tiskalnikSirina !== undefined)          novConfig.tiskalnikSirina          = d.tiskalnikSirina;

  const [updated] = await db.update(napraveTable)
    .set({ nastavitveJson: JSON.stringify(novConfig) })
    .where(eq(napraveTable.id, obstojecaNaprava.id))
    .returning();

  res.json(napravaToResponse(updated));
});

router.put("/naprave/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error }); return; }

  const [updated] = await db.update(napraveTable)
    .set(parsed.data)
    .where(and(
      eq(napraveTable.id, id),
      sql`true`,
      eq(napraveTable.enotaId, tenotaId)
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Naprava ni najdena" }); return; }
  res.json(napravaToResponse(updated));
});

router.delete("/naprave/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [deleted] = await db.delete(napraveTable)
    .where(and(
      eq(napraveTable.id, id),
      sql`true`,
      eq(napraveTable.enotaId, tenotaId)
    ))
    .returning();

  if (!deleted) { res.status(404).json({ error: "Naprava ni najdena" }); return; }
  res.status(204).send();
});

export default router;
export { sanitizeTerminalConfig };
