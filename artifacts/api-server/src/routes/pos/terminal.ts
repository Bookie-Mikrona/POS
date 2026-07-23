import { Router, type IRouter } from "express";
import { randomUUID } from "crypto";
import { eq, and, count } from "drizzle-orm";
import { posljiNaTerminal, testTerminalPovezave } from "../../lib/pos-payten";
import { ustvariCheckout, posredujNaTerminal, preveriStatus as preveriSumupStatus } from "../../lib/pos-sumup";
import { ustvariNarocilo, preveriStatus as preveriVivaStatus, smartCheckoutUrl, posljiNaTerminal as posljiNaVivaTerminal, preveriTerminalStatus, stornirajVivaTerminal } from "../../lib/pos-viva";
import { db, vivaVracilaTable, racuniTable, napraveTable } from "@workspace/db";

interface DeviceTerminalConfig {
  terminalAktiven: boolean;
  terminalIp: string;
  terminalPort: number;
  terminalTimeoutMs: number;
  paytenAndroidAktiven: boolean;
  paytenAndroidPackageName: string;
  sumupAktiven: boolean;
  sumupTerminalSerial: string;
  sumupApiKey: string;
  vivaAktiven: boolean;
  vivaClientId: string;
  vivaClientSecret: string;
  vivaSourceCode: string;
  vivaDemoNacin: boolean;
  vivaTerminalAktiven: boolean;
  vivaTerminalId: string;
  vivaAndroidTerminalAktiven: boolean;
  vivaAndroidSourceCode: string;
  vivaTapToPayAktiven: boolean;
  vivaTapToPaySourceCode: string;
}

const TC_EMPTY: DeviceTerminalConfig = {
  terminalAktiven: false,
  terminalIp: "192.168.1.100",
  terminalPort: 9000,
  terminalTimeoutMs: 30000,
  paytenAndroidAktiven: false,
  paytenAndroidPackageName: "com.payten.mpos",
  sumupAktiven: false,
  sumupTerminalSerial: "",
  sumupApiKey: "",
  vivaAktiven: false,
  vivaClientId: "",
  vivaClientSecret: "",
  vivaSourceCode: "",
  vivaDemoNacin: false,
  vivaTerminalAktiven: false,
  vivaTerminalId: "",
  vivaAndroidTerminalAktiven: false,
  vivaAndroidSourceCode: "",
  vivaTapToPayAktiven: false,
  vivaTapToPaySourceCode: "",
};

async function getDeviceTerminalConfig(
  tenotaId: number,
  napravaKljuc: string | undefined
): Promise<DeviceTerminalConfig> {
  if (!napravaKljuc) return { ...TC_EMPTY };
  const [naprava] = await db.select({ nastavitveJson: napraveTable.nastavitveJson })
    .from(napraveTable)
    .where(and(
      eq(napraveTable.enotaId, tenotaId),
      eq(napraveTable.napravaKljuc, napravaKljuc)
    ));
  if (!naprava?.nastavitveJson) return { ...TC_EMPTY };
  try {
    const raw = JSON.parse(naprava.nastavitveJson) as Record<string, unknown>;
    return {
      terminalAktiven:            Boolean(raw.terminalAktiven ?? false),
      terminalIp:                 String(raw.terminalIp ?? "192.168.1.100"),
      terminalPort:               Number(raw.terminalPort ?? 9000),
      terminalTimeoutMs:          Number(raw.terminalTimeoutMs ?? 30000),
      paytenAndroidAktiven:       Boolean(raw.paytenAndroidAktiven ?? false),
      paytenAndroidPackageName:   String(raw.paytenAndroidPackageName ?? "com.payten.mpos"),
      sumupAktiven:               Boolean(raw.sumupAktiven ?? false),
      sumupTerminalSerial:        String(raw.sumupTerminalSerial ?? ""),
      sumupApiKey:                String(raw.sumupApiKey ?? ""),
      vivaAktiven:                Boolean(raw.vivaAktiven ?? false),
      vivaClientId:               String(raw.vivaClientId ?? ""),
      vivaClientSecret:           String(raw.vivaClientSecret ?? ""),
      vivaSourceCode:             String(raw.vivaSourceCode ?? ""),
      vivaDemoNacin:              Boolean(raw.vivaDemoNacin ?? false),
      vivaTerminalAktiven:        Boolean(raw.vivaTerminalAktiven ?? false),
      vivaTerminalId:             String(raw.vivaTerminalId ?? ""),
      vivaAndroidTerminalAktiven: Boolean(raw.vivaAndroidTerminalAktiven ?? false),
      vivaAndroidSourceCode:      String(raw.vivaAndroidSourceCode ?? ""),
      vivaTapToPayAktiven:        Boolean(raw.vivaTapToPayAktiven ?? false),
      vivaTapToPaySourceCode:     String(raw.vivaTapToPaySourceCode ?? ""),
    };
  } catch {
    return { ...TC_EMPTY };
  }
}

const router: IRouter = Router();

// ── POST /terminal/pay — Payten TCP terminal ──────────────────────────────────
router.post("/terminal/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.terminalAktiven) {
    res.status(400).json({ error: "Payten terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  const znesekCenti = Math.round((body.znesek ?? 0) * 100);

  const odgovor = await posljiNaTerminal(
    { ip: tc.terminalIp, port: tc.terminalPort, timeoutMs: tc.terminalTimeoutMs },
    { znesek: znesekCenti, valuta: "978", referencnaStev: String(body.narociloId ?? 0) }
  );

  res.json({
    status:              odgovor.status,
    avtorizacijskaKoda:  odgovor.avtorizacijskaKoda ?? null,
    referenca:           odgovor.referenca ?? null,
    kartica:             odgovor.kartica ?? null,
    maskiranPan:         odgovor.maskiranPan ?? null,
    znesek:              odgovor.znesek ?? null,
    surovOdgovor:        odgovor.surovOdgovor,
    napaka:              odgovor.napaka ?? null,
  });
});

// ── GET /terminal/test — preveri Payten TCP povezavo ─────────────────────────
router.get("/terminal/test", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.terminalAktiven) {
    res.json({ uspeh: false, napaka: "Terminal ni aktiviran v nastavitvah naprave." });
    return;
  }

  const result = await testTerminalPovezave({
    ip: tc.terminalIp,
    port: tc.terminalPort,
    timeoutMs: 5000,
  });

  res.json({ uspeh: result.uspeh, napaka: result.napaka ?? null });
});

// ── POST /terminal/sumup/pay — SumUp checkout ─────────────────────────────────
router.post("/terminal/sumup/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.sumupAktiven) {
    res.status(400).json({ error: "SumUp terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.sumupApiKey) {
    res.status(400).json({ error: "SumUp API ključ ni nastavljen. Dodajte ga v nastavitvah naprave." });
    return;
  }

  const referenca = `pos-${body.narociloId ?? 0}-${Date.now()}`;

  try {
    const checkoutId = await ustvariCheckout(body.znesek ?? 0, referenca, tc.sumupApiKey);
    if (tc.sumupTerminalSerial) {
      await posredujNaTerminal(checkoutId, tc.sumupTerminalSerial, tc.sumupApiKey);
    }
    res.json({ checkoutId });
  } catch (err) {
    req.log.error({ err }, "SumUp pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "SumUp napaka" });
  }
});

// ── GET /terminal/sumup/status/:checkoutId ────────────────────────────────────
router.get("/terminal/sumup/status/:checkoutId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { checkoutId } = req.params;

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.sumupApiKey) {
    res.status(400).json({ status: "FAILED", napaka: "SumUp API ključ ni nastavljen" });
    return;
  }

  try {
    const status = await preveriSumupStatus(checkoutId, tc.sumupApiKey);
    res.json({ status, napaka: null });
  } catch (err) {
    req.log.error({ err }, "SumUp status napaka");
    res.json({ status: "FAILED", napaka: err instanceof Error ? err.message : "SumUp napaka" });
  }
});

// ── POST /terminal/viva/pay — Viva Wallet smart checkout ─────────────────────
router.post("/terminal/viva/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; narociloId?: number };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaAktiven) {
    res.status(400).json({ error: "Viva Wallet ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Wallet Client ID ali Client Secret ni nastavljen." });
    return;
  }

  const referenca = `pos-${body.narociloId ?? 0}-${Date.now()}`;

  try {
    const orderCode = await ustvariNarocilo(
      body.znesek ?? 0, referenca, tc.vivaSourceCode,
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );
    const checkoutUrl = smartCheckoutUrl(orderCode, tc.vivaDemoNacin);
    res.json({ orderCode, checkoutUrl });
  } catch (err) {
    req.log.error({ err }, "Viva Wallet pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "Viva Wallet napaka" });
  }
});

// ── GET /terminal/viva/status/:orderCode ──────────────────────────────────────
router.get("/terminal/viva/status/:orderCode", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { orderCode } = req.params;

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const status = await preveriVivaStatus(orderCode, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin);
    res.json({ status, napaka: null });
  } catch (err) {
    req.log.error({ err }, "Viva Wallet status napaka");
    res.json({ status: "FAILED", napaka: err instanceof Error ? err.message : "Viva Wallet napaka" });
  }
});

// ── POST /terminal/viva/terminal/pay — Viva POS terminal ─────────────────────
router.post("/terminal/viva/terminal/pay", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaTerminalAktiven) {
    res.status(400).json({ error: "Viva Terminal ni aktiviran. Vklopite ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaTerminalId) {
    res.status(400).json({ error: "Viva Terminal ID ni nastavljen. Dodajte ga v nastavitvah naprave." });
    return;
  }

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Wallet Client ID ali Client Secret ni nastavljen." });
    return;
  }

  const sessionId = randomUUID();

  try {
    await posljiNaVivaTerminal(
      body.znesek ?? 0, sessionId, tc.vivaTerminalId,
      tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );
    res.json({ sessionId });
  } catch (err) {
    req.log.error({ err }, "Viva Terminal pay napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "Viva Terminal napaka" });
  }
});

// ── GET /terminal/viva/terminal/status/:sessionId ────────────────────────────
router.get("/terminal/viva/terminal/status/:sessionId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { sessionId } = req.params;

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const odgovor = await preveriTerminalStatus(sessionId, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin);
    res.json({ status: odgovor.status, napaka: odgovor.napaka ?? null });
  } catch (err) {
    req.log.error({ err }, "Viva Terminal status napaka");
    res.json({ status: "FAILED", napaka: err instanceof Error ? err.message : "Viva Terminal napaka" });
  }
});

// ── DELETE /terminal/viva/terminal/refund — storniraj Viva terminal plačilo ──
const MAX_VRACILA = 3;

router.delete("/terminal/viva/terminal/refund", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as { znesek?: number; originalSessionId?: string; identifikator?: string };

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaTerminalAktiven) {
    res.status(400).json({ error: "Viva Terminal ni aktiviran." });
    return;
  }

  if (!tc.vivaTerminalId || !tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ error: "Viva Terminal ni pravilno nastavljen." });
    return;
  }

  const refundSessionId = randomUUID();
  const identifikator = body.identifikator ?? refundSessionId;

  // Preveri število obstoječih vračil za ta račun
  let racunId: number | null = null;
  if (body.originalSessionId) {
    const racun = await db.query.racuniTable.findFirst({
      where: and(
        eq(racuniTable.vivaTerminalSessionId, body.originalSessionId),
        eq(racuniTable.enotaId, tenotaId),
      ),
      columns: { id: true },
    });
    racunId = racun?.id ?? null;
  }

  if (racunId !== null) {
    const [{ value: steviloVracil }] = await db.select({ value: count() })
      .from(vivaVracilaTable)
      .where(and(
        eq(vivaVracilaTable.racunId, racunId),
        eq(vivaVracilaTable.enotaId, tenotaId),
      ));
    if (steviloVracil >= MAX_VRACILA) {
      res.status(409).json({ error: `Doseženo je največje število poskusov vračila (${MAX_VRACILA}). Vračilo ni možno.` });
      return;
    }
  }

  try {
    await stornirajVivaTerminal(
      body.znesek ?? 0, refundSessionId, identifikator,
      tc.vivaTerminalId, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin
    );

    if (racunId !== null) {
      await db.insert(vivaVracilaTable).values({
        racunId,
        enotaId: tenotaId,
        refundSessionId,
        znesek: String(body.znesek ?? 0),
        status: "pending",
      });
    }

    res.json({ sessionId: refundSessionId });
  } catch (err) {
    req.log.error({ err }, "Viva Terminal refund napaka");
    res.status(502).json({ error: err instanceof Error ? err.message : "Viva Terminal storno napaka" });
  }
});

// ── GET /terminal/viva/terminal/refund/status/:sessionId ─────────────────────
router.get("/terminal/viva/terminal/refund/status/:sessionId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { sessionId } = req.params;

  const tc = await getDeviceTerminalConfig(tenotaId, (req as any).napravaKljuc);

  if (!tc.vivaClientId || !tc.vivaClientSecret) {
    res.status(400).json({ status: "FAILED", napaka: "Viva Wallet Client ID ali Secret ni nastavljen" });
    return;
  }

  try {
    const odgovor = await preveriTerminalStatus(sessionId, tc.vivaClientId, tc.vivaClientSecret, tc.vivaDemoNacin);

    if (odgovor.status === "PAID" || odgovor.status === "FAILED") {
      const dbStatus = odgovor.status === "PAID" ? "paid" : "failed";
      await db.update(vivaVracilaTable)
        .set({ status: dbStatus, napaka: odgovor.napaka ?? null, zakljucenoAt: new Date() })
        .where(and(
          eq(vivaVracilaTable.refundSessionId, sessionId),
          eq(vivaVracilaTable.enotaId, tenotaId),
        ));
    }

    res.json({ status: odgovor.status, napaka: odgovor.napaka ?? null });
  } catch (err) {
    const napakaSporocilo = err instanceof Error ? err.message : "Viva Terminal napaka";
    await db.update(vivaVracilaTable)
      .set({ status: "failed", napaka: napakaSporocilo, zakljucenoAt: new Date() })
      .where(and(
        eq(vivaVracilaTable.refundSessionId, sessionId),
        eq(vivaVracilaTable.enotaId, tenotaId),
      )).catch(() => {});
    req.log.error({ err }, "Viva Terminal refund status napaka");
    res.json({ status: "FAILED", napaka: napakaSporocilo });
  }
});

export default router;
