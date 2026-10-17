import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, accountingRolesTable, companiesTable, erpSmtpSettingsTable } from "@workspace/db";
import { GetErpSmtpSettingsResponse, SaveErpSmtpSettingsBody, TestErpSmtpSettingsBody, TestErpSmtpSettingsResponse } from "@workspace/api-zod";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { createErpTransport, encryptSmtpPassword, getErpSmtp, getSmtpRow } from "../lib/erp-smtp-settings";
import { buildEmailSender } from "../lib/email-sender";

const router: IRouter = Router();
const path = "/companies/:companyId/erp-smtp";
const lastTest = new Map<string, number>();

function publicSettings(row: Awaited<ReturnType<typeof getSmtpRow>>) {
  return GetErpSmtpSettingsResponse.parse({
    configured: !!row, host: row?.host ?? "", port: row?.port ?? 465,
    user: row?.user ?? "", from: row?.from ?? "", passwordSet: !!row?.passwordEncrypted,
  });
}

router.use(path, requireAuth, async (req, res, next) => {
  res.setHeader("Cache-Control", "no-store");
  const companyId = String(req.params.companyId);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(companyId)) {
    res.status(400).json({ error: "Neveljavno podjetje." }); return;
  }
  const [role] = await db.select({ role: accountingRolesTable.role }).from(accountingRolesTable)
    .where(and(eq(accountingRolesTable.companyId, companyId),
      eq(accountingRolesTable.clerkUserId, (req as AuthenticatedRequest).clerkUserId))).limit(1);
  if (!role || !["owner", "accountant"].includes(role.role)) {
    res.status(403).json({ error: "SMTP nastavitve lahko urejata lastnik in računovodja podjetja." }); return;
  }
  next();
});

router.get(path, async (req, res): Promise<void> => {
  res.json(publicSettings(await getSmtpRow(String(req.params.companyId))));
});

router.put(path, async (req, res): Promise<void> => {
  const parsed = SaveErpSmtpSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Preverite SMTP strežnik, vrata (465 ali 587), uporabniško ime in e-pošto pošiljatelja." }); return;
  }
  const companyId = String(req.params.companyId);
  const previous = await getSmtpRow(companyId);
  const { password, ...settings } = parsed.data;
  if (!password && !previous) {
    res.status(400).json({ error: "Ob prvem shranjevanju vnesite SMTP geslo." }); return;
  }
  let passwordEncrypted: string;
  try {
    passwordEncrypted = password ? encryptSmtpPassword(password, companyId) : previous!.passwordEncrypted;
  } catch {
    res.status(503).json({ error: "SMTP gesla ni mogoče zaščititi. Obrnite se na skrbnika sistema." }); return;
  }
  const [saved] = await db.insert(erpSmtpSettingsTable).values({ ...settings, companyId, passwordEncrypted })
    .onConflictDoUpdate({ target: erpSmtpSettingsTable.companyId,
      set: { ...settings, passwordEncrypted, updatedAt: new Date() } }).returning();
  res.json(publicSettings(saved));
});

router.post(`${path}/test`, async (req, res): Promise<void> => {
  const parsed = TestErpSmtpSettingsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Vnesite veljaven e-poštni naslov prejemnika." }); return;
  }
  const companyId = String(req.params.companyId);
  const now = Date.now();
  // Bound memory and throttle manual test sends, including concurrent requests.
  for (const [id, time] of lastTest) if (now - time >= 30_000) lastTest.delete(id);
  if (lastTest.has(companyId)) {
    res.setHeader("Retry-After", "30");
    res.status(429).json({ error: "Pred ponovnim testom počakajte 30 sekund." }); return;
  }
  lastTest.set(companyId, now);
  let transport: ReturnType<typeof createErpTransport> | undefined;
  try {
    const smtp = await getErpSmtp(companyId);
    if (!smtp) {
      res.status(409).json({ error: "Najprej shranite SMTP nastavitve." }); return;
    }
    const [company] = await db.select({ naziv: companiesTable.naziv, email: companiesTable.email })
      .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    transport = createErpTransport(smtp);
    await transport.sendMail({
      ...buildEmailSender(smtp.from, parsed.data.recipient, company?.naziv ?? "Bookie ERP",
        { companyName: company?.naziv, companyEmail: company?.email }),
      to: parsed.data.recipient, subject: `Preizkus ERP e-pošte — ${company?.naziv ?? "Bookie ERP"}`,
      text: "Testno sporočilo ERP. SMTP nastavitve omogočajo pošiljanje poročil po e-pošti.",
    });
    res.json(TestErpSmtpSettingsResponse.parse({ success: true }));
  } catch {
    // SMTP errors can contain credentials or server responses; never return them.
    res.status(502).json({ error: "Test ni uspel. Preverite shranjene SMTP podatke in dosegljivost strežnika." });
  } finally {
    transport?.close();
  }
});

export default router;
