import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, sql } from "drizzle-orm";
import { db, napraveTable, enoteTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { createHmac } from "node:crypto";
import { preberiVivaPoverilnicePodjetja, shraniVivaPoverilnicePodjetja } from "../../lib/viva-company-credentials";

const router: IRouter = Router();

const VELJAVNE_KODNE_STRANI = ["cp1250", "wpc1250", "cp852", "ascii-translit", "bitmap"] as const;
type KodnaStranica = typeof VELJAVNE_KODNE_STRANI[number];

function sanitizeTerminalConfig(nastavitveJson: string | null | undefined): Record<string, unknown> | null {
  if (!nastavitveJson) return null;
  try {
    const raw = JSON.parse(nastavitveJson) as Record<string, unknown>;
    // tiskalnikCodePage: vrni samo veljavne vrednosti, sicer undefined (ne dodaj polja)
    const cp: KodnaStranica | undefined = typeof raw.tiskalnikCodePage === "string" &&
      (VELJAVNE_KODNE_STRANI as readonly string[]).includes(raw.tiskalnikCodePage)
        ? raw.tiskalnikCodePage as KodnaStranica : undefined;
    return {
      terminalAktiven:            Boolean(raw.terminalAktiven ?? false),
      terminalIp:                 String(raw.terminalIp ?? "192.168.1.100"),
      terminalPort:               Number(raw.terminalPort ?? 9000),
      terminalTimeoutMs:          Number(raw.terminalTimeoutMs ?? 30000),
      paytenAndroidAktiven:       Boolean(raw.paytenAndroidAktiven ?? false),
      // The native Bookie Bridge owns its package identity; never expose a
      // configurable arbitrary Android package in the active payment flow.
      paytenBridgePaired:         Boolean(raw.paytenBridgeKeyId && raw.paytenBridgePublicKey),
      ...(typeof raw.paytenBridgeKeyId === "string" ? { paytenBridgeKeyId: raw.paytenBridgeKeyId } : {}),
      sumupAktiven:               Boolean(raw.sumupAktiven ?? false),
      sumupTerminalSerial:        String(raw.sumupTerminalSerial ?? ""),
      sumupApiKeyNastavljen:      !!(raw.sumupApiKey),
      vivaAktiven:                Boolean(raw.vivaAktiven ?? false),
      vivaClientId:               String(raw.vivaClientId ?? ""),
      vivaClientSecretNastavljen: !!(raw.vivaClientSecret),
      vivaSourceCode:             String(raw.vivaSourceCode ?? ""),
      vivaDemoNacin:              Boolean(raw.vivaDemoNacin ?? false),
      vivaTerminalAktiven:        Boolean(raw.vivaTerminalAktiven ?? false),
      vivaTerminalId:             String(raw.vivaTerminalId ?? ""),
      vivaAndroidTerminalAktiven: Boolean(raw.vivaAndroidTerminalAktiven ?? false),
      vivaAndroidSourceCode:      String(raw.vivaAndroidSourceCode ?? ""),
      vivaTapToPayAktiven:        Boolean(raw.vivaTapToPayAktiven ?? false),
      vivaTapToPaySourceCode:     String(raw.vivaTapToPaySourceCode ?? ""),
      agentTiskalnikIme:          String(raw.agentTiskalnikIme ?? ""),
      aiSvetovalecAktiven:        Boolean(raw.aiSvetovalecAktiven ?? false),
      // tiskalnikSirina: brez privzetka 58 — undefined pomeni "samodejno zaznaj"
      ...(raw.tiskalnikSirina != null ? { tiskalnikSirina: Number(raw.tiskalnikSirina) as 30 | 32 | 58 | 80 } : {}),
      // tiskalnikCodePage: samo veljavne vrednosti; undefined če ni nastavljeno ali ni veljavno
      ...(cp !== undefined ? { tiskalnikCodePage: cp } : {}),
      // tiskalnikTip: "windows" ali undefined; prazno/manjkajoče → ne vrnemo polja
      ...(raw.tiskalnikTip ? { tiskalnikTip: String(raw.tiskalnikTip) } : {}),
    };
  } catch {
    return null;
  }
}

const DOVOLJENI_PRIKAZ: Record<"prikazMenija" | "gostotaArtiklov" | "prikazNarocila", readonly string[]> = {
  prikazMenija: ["trenutno", "A", "B", "C"],
  gostotaArtiklov: ["privzeto", "kompaktno", "seznam", "velika"],
  prikazNarocila: ["staro", "novo"],
};

/** Vrne ime prvega polja prikaza z neveljavno vrednostjo (ali null). */
export function neveljavnoPoljePrikaza(telo: Record<string, unknown>): string | null {
  for (const [polje, dovoljene] of Object.entries(DOVOLJENI_PRIKAZ)) {
    const vrednost = telo[polje];
    if (vrednost !== undefined && !(typeof vrednost === "string" && dovoljene.includes(vrednost))) return polje;
  }
  return null;
}

function createAiAccessToken(row: typeof napraveTable.$inferSelect): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) return "";
  const payload = Buffer.from(`${row.id}:${row.enotaId}:${row.napravaKljuc}`).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function napravaToResponse(row: typeof napraveTable.$inferSelect, includePrivateIdentity = false) {
  return {
    ...row,
    napravaKljuc: includePrivateIdentity ? row.napravaKljuc : "",
    ...(includePrivateIdentity ? { aiAccessToken: createAiAccessToken(row) } : {}),
    nastavitveJson: undefined,
    terminalConfig: sanitizeTerminalConfig(row.nastavitveJson)};
}

/**
 * Viva Client ID/Secret sta poverilnici podjetja. Strežnik jih pri plačilu že
 * podeduje od katerekoli naprave podjetja (glej terminal.ts); tu enako
 * prikažemo v nastavitvah, da jih ni treba vnašati na vsaki napravi.
 * Skrivnosti se nikoli ne vrne, samo ali je nastavljena.
 */
async function skupnaViva(enotaId: number): Promise<{ vivaClientId: string; vivaClientSecretNastavljen: boolean; vivaDemoNacin: boolean } | null> {
  const [enota] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, enotaId));
  if (!enota) return null;
  const podjetje = await preberiVivaPoverilnicePodjetja(enota.companyId);
  if (podjetje) return { vivaClientId: podjetje.clientId, vivaClientSecretNastavljen: true, vivaDemoNacin: podjetje.demoNacin };
  const naprave = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .innerJoin(enoteTable, eq(enoteTable.id, napraveTable.enotaId))
    .where(eq(enoteTable.companyId, enota.companyId));
  for (const n of naprave) {
    if (!n.nastavitveJson) continue;
    try {
      const raw = JSON.parse(n.nastavitveJson) as Record<string, unknown>;
      if (String(raw.vivaClientId ?? "").trim() && String(raw.vivaClientSecret ?? "").trim()) {
        return { vivaClientId: String(raw.vivaClientId), vivaClientSecretNastavljen: true, vivaDemoNacin: Boolean(raw.vivaDemoNacin ?? false) };
      }
    } catch { /* neveljavna konfiguracija ene naprave ne blokira drugih */ }
  }
  return null;
}

async function napravaToResponseSkupno(row: typeof napraveTable.$inferSelect, includePrivateIdentity = false) {
  const odgovor = napravaToResponse(row, includePrivateIdentity);
  const tc = odgovor.terminalConfig as Record<string, unknown> | null;
  const skupno = await skupnaViva(row.enotaId);
  if (!skupno) return odgovor;
  return { ...odgovor, terminalConfig: { ...(tc ?? {}), ...skupno } };
}

router.get("/naprave", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db.select().from(napraveTable).where(
    and(eq(napraveTable.enotaId, tenotaId))
  );
  res.json(await Promise.all(rows.map((row) => napravaToResponseSkupno(row))));
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
  res.status(isNew ? 201 : 200).json(await napravaToResponseSkupno(naprava, true));
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
  if (Object.hasOwn(req.body ?? {}, "paytenBridgeKeyId") || Object.hasOwn(req.body ?? {}, "paytenBridgePublicKey") || Object.hasOwn(req.body ?? {}, "nastavitveJson")) {
    res.status(403).json({ error: "Payten Bridge ključ upravlja samo varen postopek sparjanja." }); return;
  }

  let [obstojecaNaprava] = await db.select().from(napraveTable).where(
    and(eq(napraveTable.enotaId, tenotaId),
      eq(napraveTable.napravaKljuc, napravaKljuc)
    )
  );

  // Naprava ni v DB — samodejno jo registriraj (upsert), nato nadaljuj z nastavitvami.
  // To reši primer ko je bila naprava registrirana v drugem okolju (dev/prod),
  // ali ko je prišlo do race conditiona (nastavitve odprte pred koncem registracije).
  if (!obstojecaNaprava) {
    const ua = req.headers["user-agent"] ?? "";
    const imeNaprave = /Windows/.test(ua) ? "Windows naprava"
      : /Android/.test(ua) ? "Android naprava"
      : /iPad/.test(ua) ? "iPad"
      : /iPhone/.test(ua) ? "iPhone"
      : /Macintosh|Mac OS X/.test(ua) ? "Mac naprava"
      : "Naprava";
    const [created] = await db.insert(napraveTable)
      .values({ enotaId: tenotaId, napravaKljuc, ime: imeNaprave })
      .onConflictDoUpdate({
        target: [napraveTable.enotaId, napraveTable.napravaKljuc],
        set: { ime: imeNaprave },
      })
      .returning();
    obstojecaNaprava = created;
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
  if (d.vivaSourceCode !== undefined)           novConfig.vivaSourceCode           = d.vivaSourceCode;

  // Client ID, Client Secret in demo način so poverilnice podjetja: shrani jih na ravni podjetja.
  // Obstoječih kopij na napravah ne brišemo.
  if (d.vivaClientId !== undefined || d.vivaDemoNacin !== undefined || (d.vivaClientSecret && d.vivaClientSecret.trim() !== "")) {
    const [enota] = await db.select({ companyId: enoteTable.companyId }).from(enoteTable).where(eq(enoteTable.id, tenotaId));
    if (enota) {
      const trenutne = await preberiVivaPoverilnicePodjetja(enota.companyId);
      const skupno = trenutne ?? await (async () => {
        const naprave = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
          .from(napraveTable).innerJoin(enoteTable, eq(enoteTable.id, napraveTable.enotaId))
          .where(eq(enoteTable.companyId, enota.companyId));
        for (const n of naprave) {
          try {
            const raw = JSON.parse(n.nastavitveJson ?? "{}") as Record<string, unknown>;
            if (String(raw.vivaClientId ?? "").trim() && String(raw.vivaClientSecret ?? "").trim()) {
              return { clientId: String(raw.vivaClientId), clientSecret: String(raw.vivaClientSecret), demoNacin: Boolean(raw.vivaDemoNacin) };
            }
          } catch { /* preskoči */ }
        }
        return null;
      })();
      const clientId = d.vivaClientId !== undefined && d.vivaClientId.trim() !== "" ? d.vivaClientId.trim() : skupno?.clientId ?? "";
      const clientSecret = d.vivaClientSecret && d.vivaClientSecret.trim() !== "" ? d.vivaClientSecret.trim() : skupno?.clientSecret ?? "";
      const demoNacin = d.vivaDemoNacin !== undefined ? Boolean(d.vivaDemoNacin) : skupno?.demoNacin ?? false;
      if (clientId && clientSecret) await shraniVivaPoverilnicePodjetja(enota.companyId, { clientId, clientSecret, demoNacin });
    }
  }
  if (d.vivaTerminalAktiven !== undefined)      novConfig.vivaTerminalAktiven      = d.vivaTerminalAktiven;
  if (d.vivaTerminalId !== undefined)           novConfig.vivaTerminalId           = d.vivaTerminalId;
  if (d.vivaAndroidTerminalAktiven !== undefined) novConfig.vivaAndroidTerminalAktiven = d.vivaAndroidTerminalAktiven;
  if (d.vivaAndroidSourceCode !== undefined)    novConfig.vivaAndroidSourceCode    = d.vivaAndroidSourceCode;
  if (d.vivaTapToPayAktiven !== undefined)      novConfig.vivaTapToPayAktiven      = d.vivaTapToPayAktiven;
  if (d.vivaTapToPaySourceCode !== undefined)   novConfig.vivaTapToPaySourceCode   = d.vivaTapToPaySourceCode;
  if (d.agentTiskalnikIme !== undefined)        novConfig.agentTiskalnikIme        = d.agentTiskalnikIme;
  if (d.aiSvetovalecAktiven !== undefined)      novConfig.aiSvetovalecAktiven      = Boolean(d.aiSvetovalecAktiven);
  if (d.tiskalnikSirina !== undefined)          novConfig.tiskalnikSirina          = d.tiskalnikSirina;
  if (d.tiskalnikCodePage !== undefined)        novConfig.tiskalnikCodePage        = d.tiskalnikCodePage;

  const [updated] = await db.update(napraveTable)
    .set({ nastavitveJson: JSON.stringify(novConfig) })
    .where(eq(napraveTable.id, obstojecaNaprava.id))
    .returning();

  res.json(await napravaToResponseSkupno(updated));
});

router.put("/naprave/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(String(req.params.id), 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }
  if (Object.hasOwn(req.body ?? {}, "nastavitveJson") || Object.hasOwn(req.body ?? {}, "paytenBridgeKeyId") || Object.hasOwn(req.body ?? {}, "paytenBridgePublicKey")) {
    res.status(403).json({ error: "Payten Bridge ključ upravlja samo varen postopek sparjanja." }); return;
  }

  const { tiskalnikSirina, tiskalnikCodePage, tiskalnikTip, aiSvetovalecAktiven, ...ostalo } = req.body as Record<string, unknown>;

  // Prikaz na napravi: samo znane vrednosti (prezentacijski sloj, ne vpliva na naročanje ali račun).
  const neveljavnoPolje = neveljavnoPoljePrikaza(ostalo);
  if (neveljavnoPolje) {
    res.status(400).json({ error: `Neveljavna vrednost za ${neveljavnoPolje}.` });
    return;
  }

  // Nastavitve tiskalnika se shranjujejo v nastavitveJson (ne kot stolpec).
  // null = IZBRIŠI ključ iz konfiguracije (samodejno zaznaj / počisti).
  // undefined = pusti kakršen je (polje ni bilo v payloadu).
  // vrednost = nastavi/posodobi.
  let nastavitveJsonUpdate: string | undefined;
  if (tiskalnikSirina !== undefined || tiskalnikCodePage !== undefined || tiskalnikTip !== undefined || aiSvetovalecAktiven !== undefined) {
    const [obstoječa] = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
      .from(napraveTable).where(eq(napraveTable.id, id)).limit(1);
    let merged: Record<string, unknown> = {};
    if (obstoječa?.nastavitveJson) {
      try { merged = JSON.parse(obstoječa.nastavitveJson) as Record<string, unknown>; } catch { /* nič */ }
    }
    // tiskalnikSirina: null → izbriši (samodejno), vrednost → nastavi, undefined → pusti
    if (tiskalnikSirina === null)      { delete merged.tiskalnikSirina; }
    else if (tiskalnikSirina !== undefined) { merged.tiskalnikSirina = tiskalnikSirina; }
    // tiskalnikCodePage: null ali "" → izbriši, vrednost → nastavi
    if (tiskalnikCodePage === null || tiskalnikCodePage === "") { delete merged.tiskalnikCodePage; }
    else if (tiskalnikCodePage !== undefined) { merged.tiskalnikCodePage = tiskalnikCodePage; }
    // tiskalnikTip: null ali "" → izbriši (ne-Windows), vrednost → nastavi
    if (tiskalnikTip === null || tiskalnikTip === "") { delete merged.tiskalnikTip; }
    else if (tiskalnikTip !== undefined) { merged.tiskalnikTip = tiskalnikTip; }
    if (aiSvetovalecAktiven !== undefined) {
      merged.aiSvetovalecAktiven = Boolean(aiSvetovalecAktiven);
    }
    nastavitveJsonUpdate = JSON.stringify(merged);
  }

  const [updated] = await db.update(napraveTable)
    .set({ ...ostalo, ...(nastavitveJsonUpdate !== undefined ? { nastavitveJson: nastavitveJsonUpdate } : {}) })
    .where(and(
      eq(napraveTable.id, id),
      sql`true`,
      eq(napraveTable.enotaId, tenotaId)
    ))
    .returning();

  if (!updated) { res.status(404).json({ error: "Naprava ni najdena" }); return; }
  res.json(await napravaToResponseSkupno(updated));
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
