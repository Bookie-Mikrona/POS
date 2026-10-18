import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { createPlatformSmtpTransport, getPlatformSmtpStatus } from "../lib/platform-smtp";
import { TestPlatformEmailBody, GetPlatformEmailResponse } from "@workspace/api-zod";

const router: IRouter = Router();
// Shared across all administrators in this server process; reserve before awaiting.
let nextTestAt = 0;
let inFlight = false;
router.use(requireAuth, requireSuperAdmin, (_req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  next();
});

router.get("/", (_req, res): void => {
  res.json(GetPlatformEmailResponse.parse(getPlatformSmtpStatus()));
});

router.post("/test", async (req, res): Promise<void> => {
  const parsed = TestPlatformEmailBody.safeParse(req.body);
  if (!parsed.success || parsed.data.recipient !== parsed.data.confirmRecipient || !parsed.data.confirmed) {
    res.status(400).json({ error: "Vnesite en e-poštni naslov, ga ponovite in izrecno potrdite pošiljanje." });
    return;
  }
  if (!getPlatformSmtpStatus().configured) {
    res.status(503).json({ error: "Globalno pošiljanje ni konfigurirano. Preverite zaščitene SMTP nastavitve platforme." });
    return;
  }
  const retryAfter = Math.max(1, Math.ceil((nextTestAt - Date.now()) / 1000));
  if (inFlight || Date.now() < nextTestAt) {
    res.setHeader("Retry-After", retryAfter);
    res.status(429).json({ error: "Preizkus je že v teku ali je bil pravkar izveden. Poskusite čez eno minuto." });
    return;
  }
  nextTestAt = Date.now() + 60_000;
  inFlight = true;
  let transport: ReturnType<typeof createPlatformSmtpTransport> | undefined;
  try {
    transport = createPlatformSmtpTransport();
    const result = await transport.sendMail({
      from: process.env.SMTP_FROM!.trim(),
      to: parsed.data.recipient,
      subject: "Bookie — preizkus globalnega pošiljanja",
      text: "To je izrecno potrjen preizkus globalnega pošiljanja platforme Bookie. Nastavitve podjetij in POS enot niso bile uporabljene ali spremenjene.",
    });
    if (!result.accepted?.length || result.rejected?.length) throw new Error("Recipient not accepted");
    res.json({ ok: true });
  } catch {
    // SMTP errors can contain secrets or server response text; never expose them.
    res.status(502).json({ error: "SMTP strežnik preizkusa ni potrdil. Preverite konfiguracijo in povezavo; pred ponovitvijo preverite tudi nabiralnik." });
  } finally {
    transport?.close();
    inFlight = false;
  }
});

export default router;
