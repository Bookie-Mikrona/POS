/**
 * Super admin routes — /admin/*
 * Dostopno samo za super adminov (env SUPER_ADMIN_IDS).
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, companiesTable, accountingRolesTable, companyModulesTable, systemSettingsTable, posUporabnikiTable, enoteTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { CreateCompanyBody, AssignRoleBody } from "@workspace/api-zod";
import { clerkClient } from "@clerk/express";

const router: IRouter = Router();

// Vse admin poti zahtevajo prijavo + super admin vlogo
router.use(requireAuth, requireSuperAdmin);

// ── Podjetja ──────────────────────────────────────────────────────────────────

// GET /admin/companies — seznam vseh podjetij v sistemu z aktivnimi moduli
router.get("/companies", async (_req: Request, res: Response): Promise<void> => {
  const companies = await db
    .select({
      id: companiesTable.id,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
      naziv: companiesTable.naziv,
      kratekNaziv: companiesTable.kratekNaziv,
      naslov: companiesTable.naslov,
      postnaStevika: companiesTable.postnaStevika,
      kraj: companiesTable.kraj,
      createdAt: companiesTable.createdAt,
    })
    .from(companiesTable)
    .orderBy(desc(companiesTable.createdAt));

  // Pridobi module za vsako podjetje
  const modules = await db
    .select({
      companyId: companyModulesTable.companyId,
      module: companyModulesTable.module,
      enabledAt: companyModulesTable.enabledAt,
    })
    .from(companyModulesTable);

  // Pridobi število uporabnikov na podjetje (ERP + POS skupaj, brez podvajanja)
  const erpRoles = await db
    .select({ companyId: accountingRolesTable.companyId, clerkUserId: accountingRolesTable.clerkUserId })
    .from(accountingRolesTable);

  const posRoles = await db
    .select({ companyId: posUporabnikiTable.companyId, clerkUserId: posUporabnikiTable.clerkUserId })
    .from(posUporabnikiTable)
    .where(eq(posUporabnikiTable.aktiven, true));

  const companiesWithModules = companies.map((c) => {
    const erpUsers = new Set(erpRoles.filter((r) => r.companyId === c.id).map((r) => r.clerkUserId));
    const posUsers = new Set(posRoles.filter((r) => r.companyId === c.id).map((r) => r.clerkUserId));
    const allUsers = new Set([...erpUsers, ...posUsers]);
    return {
      ...c,
      modules: modules.filter((m) => m.companyId === c.id).map((m) => m.module),
      userCount: allUsers.size,
    };
  });

  res.json({ companies: companiesWithModules });
});

// POST /admin/companies — ustvari novo podjetje (brez lastnika — super admin ga doda ročno)
router.post("/companies", async (req: Request, res: Response): Promise<void> => {
  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, parsed.data.podjetjeDavcna))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Podjetje s to davčno številko že obstaja" });
    return;
  }

  const [company] = await db
    .insert(companiesTable)
    .values(parsed.data)
    .returning();

  res.status(201).json(company);
});

// DELETE /admin/companies/:id — izbriši podjetje (kaskadno počisti vloge, module)
router.delete("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  // Prepreči brisanje ERP lastnika
  const [ownerSetting] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, "erp_owner_company_id"))
    .limit(1);

  if (ownerSetting?.value === companyId) {
    res.status(409).json({ error: "Tega podjetja ni mogoče izbrisati — je lastnik ERP paketa." });
    return;
  }

  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  res.status(204).send();
});

// ── Moduli ────────────────────────────────────────────────────────────────────

// POST /admin/companies/:id/modules — aktiviraj modul za podjetje
router.post("/companies/:id/modules", async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { module } = req.body as { module?: string };

  if (!module || !["erp", "pos"].includes(module)) {
    res.status(400).json({ error: "Neveljaven modul. Dovoljeni: erp, pos" });
    return;
  }

  const [row] = await db
    .insert(companyModulesTable)
    .values({ companyId, module: module as "erp" | "pos", enabledBy: authReq.clerkUserId })
    .onConflictDoNothing()
    .returning();

  res.status(201).json(row ?? { companyId, module, note: "Modul že aktiven" });
});

// DELETE /admin/companies/:id/modules/:module — deaktiviraj modul
router.delete("/companies/:id/modules/:module", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const module = Array.isArray(req.params.module) ? req.params.module[0] : req.params.module;

  await db
    .delete(companyModulesTable)
    .where(
      and(
        eq(companyModulesTable.companyId, companyId),
        eq(companyModulesTable.module, module as "erp" | "pos"),
      ),
    );

  res.status(204).send();
});

// ── Uporabniki ────────────────────────────────────────────────────────────────

// GET /admin/users — VSI Clerk uporabniki + njihove vloge v podjetjih (ERP + POS)
router.get("/users", async (_req: Request, res: Response): Promise<void> => {
  // 1. Hkrati pridobimo Clerk userje, ERP vloge in POS vloge
  const [clerkResponse, erpRows, posRows] = await Promise.all([
    clerkClient.users.getUserList({ limit: 500, orderBy: "-created_at" }),
    db
      .select({
        clerkUserId: accountingRolesTable.clerkUserId,
        companyId: accountingRolesTable.companyId,
        companyNaziv: companiesTable.naziv,
        role: accountingRolesTable.role,
        createdAt: accountingRolesTable.createdAt,
      })
      .from(accountingRolesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, accountingRolesTable.companyId)),
    db
      .select({
        clerkUserId: posUporabnikiTable.clerkUserId,
        companyId: posUporabnikiTable.companyId,
        companyNaziv: companiesTable.naziv,
        vloga: posUporabnikiTable.vloga,
        aktiven: posUporabnikiTable.aktiven,
        ustvarjeno: posUporabnikiTable.ustvarjeno,
      })
      .from(posUporabnikiTable)
      .innerJoin(companiesTable, eq(companiesTable.id, posUporabnikiTable.companyId))
      .where(eq(posUporabnikiTable.aktiven, true)),
  ]);

  // 2. Grupiraj vloge po Clerk userju
  const rolesMap = new Map<string, { companyId: string; naziv: string; role: string; sistem: "erp" | "pos"; createdAt: Date }[]>();

  for (const row of erpRows) {
    if (!rolesMap.has(row.clerkUserId)) rolesMap.set(row.clerkUserId, []);
    rolesMap.get(row.clerkUserId)!.push({
      companyId: row.companyId,
      naziv: row.companyNaziv,
      role: row.role,
      sistem: "erp",
      createdAt: row.createdAt,
    });
  }

  for (const row of posRows) {
    if (!rolesMap.has(row.clerkUserId)) rolesMap.set(row.clerkUserId, []);
    // Prepreči podvojene vnose (isti user, isto podjetje, isti sistem)
    const obstoječi = rolesMap.get(row.clerkUserId)!;
    const jeŽe = obstoječi.some((r) => r.companyId === String(row.companyId) && r.sistem === "pos");
    if (!jeŽe) {
      obstoječi.push({
        companyId: String(row.companyId),
        naziv: row.companyNaziv,
        role: row.vloga ?? "blagajnik",
        sistem: "pos",
        createdAt: row.ustvarjeno ?? new Date(),
      });
    }
  }

  // 3. Sestavi seznam iz vseh Clerk userjev
  const users = clerkResponse.data.map((u) => ({
    clerkUserId: u.id,
    email: u.emailAddresses[0]?.emailAddress ?? "",
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    imageUrl: u.imageUrl ?? "",
    createdAt: new Date(u.createdAt).toISOString(),
    lastActiveAt: u.lastActiveAt ? new Date(u.lastActiveAt).toISOString() : null,
    banned: u.banned ?? false,
    companies: rolesMap.get(u.id) ?? [],
  }));

  res.json({ users });
});

// POST /admin/users/:clerkUserId/ban — blokiraj prijavo uporabnika
router.post("/users/:clerkUserId/ban", async (req: Request, res: Response): Promise<void> => {
  const { clerkUserId } = req.params;
  await clerkClient.users.banUser(clerkUserId);
  res.json({ ok: true });
});

// POST /admin/users/:clerkUserId/unban — odblokiraj prijavo uporabnika
router.post("/users/:clerkUserId/unban", async (req: Request, res: Response): Promise<void> => {
  const { clerkUserId } = req.params;
  await clerkClient.users.unbanUser(clerkUserId);
  res.json({ ok: true });
});

// ── Pomožna funkcija: pretvori latestActivity v prijazen objekt ───────────────
function mapActivity(s: { id: string; clientId: string; userId: string; status: string; lastActiveAt: number; expireAt: number; createdAt: number; latestActivity?: { isMobile?: boolean; browserName?: string; browserVersion?: string; deviceType?: string; ipAddress?: string; city?: string; country?: string } | null }) {
  const a = s.latestActivity;
  return {
    sessionId: s.id,
    clientId: s.clientId,
    userId: s.userId,
    status: s.status,
    lastActiveAt: new Date(s.lastActiveAt).toISOString(),
    expireAt: new Date(s.expireAt).toISOString(),
    createdAt: new Date(s.createdAt).toISOString(),
    brskalnik: a?.browserName ?? null,
    brskalnikVerzija: a?.browserVersion ?? null,
    naprava: a?.deviceType ?? null,
    jeMobilen: a?.isMobile ?? false,
    ip: a?.ipAddress ?? null,
    mesto: a?.city ?? null,
    drzava: a?.country ?? null,
  };
}

// GET /admin/users/:clerkUserId/sessions — vse seje (vsa stanja) enega uporabnika
router.get("/users/:clerkUserId/sessions", async (req: Request, res: Response): Promise<void> => {
  const { clerkUserId } = req.params;

  // Pridobi vse seje (brez filtra statusa = aktivne + historične)
  const resp = await clerkClient.sessions.getSessionList({
    userId: clerkUserId,
    limit: 100,
  }).catch(() => ({ data: [] }));

  const sessions = resp.data
    .map((s) => mapActivity(s))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ sessions });
});

// GET /admin/sessions — vse aktivne seje
router.get("/sessions", async (_req: Request, res: Response): Promise<void> => {
  const usersResp = await clerkClient.users.getUserList({ limit: 500 });

  const perUserSessions = await Promise.all(
    usersResp.data.map((u) =>
      clerkClient.sessions
        .getSessionList({ userId: u.id, status: "active", limit: 100 })
        .then((r) => r.data.map((s) => ({
          ...mapActivity(s),
          email: u.emailAddresses[0]?.emailAddress ?? "",
          firstName: u.firstName ?? "",
          lastName: u.lastName ?? "",
        })))
        .catch(() => [])
    )
  );

  const sessions = perUserSessions
    .flat()
    .sort((a, b) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime());

  res.json({ sessions });
});

// DELETE /admin/sessions/:sessionId — prekini eno sejo
router.delete("/sessions/:sessionId", async (req: Request, res: Response): Promise<void> => {
  const { sessionId } = req.params;
  await clerkClient.sessions.revokeSession(sessionId);
  res.json({ ok: true });
});

// GET /admin/devices — vse naprave (aktivne + nedavne) grupirane po clientId
router.get("/devices", async (_req: Request, res: Response): Promise<void> => {
  const usersResp = await clerkClient.users.getUserList({ limit: 500 });

  // Pridobimo vse nedavne seje za vsakega userja (brez filtra statusa → zadnjih 50)
  const perUserSessions = await Promise.all(
    usersResp.data.map(async (u) => {
      const [activeSessions, recentSessions] = await Promise.all([
        clerkClient.sessions
          .getSessionList({ userId: u.id, status: "active", limit: 50 })
          .then((r) => r.data)
          .catch(() => []),
        clerkClient.sessions
          .getSessionList({ userId: u.id, limit: 50 })
          .then((r) => r.data)
          .catch(() => []),
      ]);
      // Združi, odstranjuj podvojene
      const all = [...activeSessions];
      for (const s of recentSessions) {
        if (!all.find((a) => a.id === s.id)) all.push(s);
      }
      return all.map((s) => ({
        ...mapActivity(s),
        email: u.emailAddresses[0]?.emailAddress ?? "",
        firstName: u.firstName ?? "",
        lastName: u.lastName ?? "",
      }));
    })
  );

  const allSessions = perUserSessions.flat();

  // Grupiraj po clientId
  const deviceMap = new Map<string, typeof allSessions>();
  for (const s of allSessions) {
    if (!deviceMap.has(s.clientId)) deviceMap.set(s.clientId, []);
    deviceMap.get(s.clientId)!.push(s);
  }

  const devices = Array.from(deviceMap.entries()).map(([clientId, seje]) => {
    // Vzemi podatke naprave iz najnovejše seje z latestActivity podatki
    const najNovejsa = seje.sort((a, b) =>
      new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime()
    )[0];
    const aktivneSeje = seje.filter((s) => s.status === "active");
    const jeAktivna = aktivneSeje.length > 0;

    return {
      clientId,
      jeAktivna,
      brskalnik: najNovejsa.brskalnik,
      brskalnikVerzija: najNovejsa.brskalnikVerzija,
      naprava: najNovejsa.naprava,
      jeMobilen: najNovejsa.jeMobilen,
      ip: najNovejsa.ip,
      mesto: najNovejsa.mesto,
      drzava: najNovejsa.drzava,
      zadnjaAktivnost: najNovejsa.lastActiveAt,
      prvaPrijava: seje.reduce((min, s) =>
        new Date(s.createdAt) < new Date(min) ? s.createdAt : min, seje[0].createdAt
      ),
      // Uporabniki, ki so imeli seje na tej napravi
      uporabniki: Array.from(
        new Map(seje.map((s) => [s.userId, { userId: s.userId, email: s.email, firstName: s.firstName, lastName: s.lastName }])).values()
      ),
      // Vse aktivne sejeId-ji za to napravo
      aktivneSejeId: aktivneSeje.map((s) => s.sessionId),
    };
  }).sort((a, b) =>
    new Date(b.zadnjaAktivnost).getTime() - new Date(a.zadnjaAktivnost).getTime()
  );

  res.json({ devices });
});

// DELETE /admin/clients/:clientId/sessions — prekini vse aktivne seje naprave
router.delete("/clients/:clientId/sessions", async (req: Request, res: Response): Promise<void> => {
  const { clientId } = req.params;

  // Poiščemo vse aktivne seje za ta clientId
  const sessionsResp = await clerkClient.sessions
    .getSessionList({ clientId, status: "active", limit: 100 })
    .catch(() => ({ data: [] }));

  await Promise.all(
    sessionsResp.data.map((s) =>
      clerkClient.sessions.revokeSession(s.id).catch(() => {})
    )
  );

  res.json({ ok: true, razveljavljenoSej: sessionsResp.data.length });
});

// POST /admin/companies/:id/roles — dodeli dostop do podjetja kateremukoli userju
router.post("/companies/:id/roles", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

  const parsed = AssignRoleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [role] = await db
    .insert(accountingRolesTable)
    .values({ clerkUserId: parsed.data.clerkUserId, companyId, role: parsed.data.role })
    .onConflictDoUpdate({
      target: [accountingRolesTable.clerkUserId, accountingRolesTable.companyId],
      set: { role: parsed.data.role, updatedAt: new Date() },
    })
    .returning();

  res.json(role);
});

// DELETE /admin/companies/:id/roles/:clerkUserId — odstrani dostop
router.delete("/companies/:id/roles/:clerkUserId", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const clerkUserId = Array.isArray(req.params.clerkUserId) ? req.params.clerkUserId[0] : req.params.clerkUserId;

  await db
    .delete(accountingRolesTable)
    .where(
      and(
        eq(accountingRolesTable.clerkUserId, clerkUserId),
        eq(accountingRolesTable.companyId, companyId),
      ),
    );

  res.status(204).send();
});

// ── Sistemske nastavitve ──────────────────────────────────────────────────────

const ERP_OWNER_KEY = "erp_owner_company_id";

// GET /admin/system — vrne lastnika ERP paketa (ali null če setup še ni narejen)
router.get("/system", async (_req: Request, res: Response): Promise<void> => {
  const [setting] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, ERP_OWNER_KEY))
    .limit(1);

  if (!setting) {
    res.json({ erpOwnerCompanyId: null, company: null });
    return;
  }

  const [company] = await db
    .select()
    .from(companiesTable)
    .where(eq(companiesTable.id, setting.value))
    .limit(1);

  // Pridobi module za to podjetje
  const modules = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(eq(companyModulesTable.companyId, setting.value));

  res.json({
    erpOwnerCompanyId: setting.value,
    company: company ? { ...company, modules: modules.map(m => m.module), role: "owner" } : null,
  });
});

// POST /admin/system/setup — prva nastavitev: ustvari lastnika ERP paketa
router.post("/system/setup", async (req: Request, res: Response): Promise<void> => {
  const authReq = req as AuthenticatedRequest;

  // Prepreči ponoven setup
  const [existing] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, ERP_OWNER_KEY))
    .limit(1);

  if (existing) {
    res.status(409).json({ error: "Sistem je že nastavljen. ERP lastnik je že določen." });
    return;
  }

  // Če obstaja `companyId` v body → použij obstoječe podjetje direktno
  const existingId = (req.body as { companyId?: string }).companyId;
  let company: typeof companiesTable.$inferSelect;

  if (existingId) {
    const [found] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.id, existingId))
      .limit(1);
    if (!found) {
      res.status(404).json({ error: "Podjetje ne obstaja." });
      return;
    }
    company = found;
  } else {
    const parsed2 = CreateCompanyBody.safeParse(req.body);
    if (!parsed2.success) {
      res.status(400).json({ error: parsed2.error.message });
      return;
    }

    // Preveri ali davčna že obstaja — če da, použij obstoječe
    const [dup] = await db
      .select()
      .from(companiesTable)
      .where(eq(companiesTable.podjetjeDavcna, parsed2.data.podjetjeDavcna))
      .limit(1);

    if (dup) {
      company = dup;
    } else {
      const [created] = await db
        .insert(companiesTable)
        .values(parsed2.data)
        .returning();
      company = created;
    }
  }

  // Dodeli super adminu vlogo lastnika
  await db
    .insert(accountingRolesTable)
    .values({ clerkUserId: authReq.clerkUserId, companyId: company.id, role: "owner" })
    .onConflictDoNothing();

  // Aktiviraj ERP modul
  await db
    .insert(companyModulesTable)
    .values({ companyId: company.id, module: "erp", enabledBy: authReq.clerkUserId })
    .onConflictDoNothing();

  // Shrani nastavitev
  await db
    .insert(systemSettingsTable)
    .values({ key: ERP_OWNER_KEY, value: company.id });

  const modules = ["erp"];
  res.status(201).json({ ...company, modules, role: "owner" });
});

// ── Iskanje podjetja po davčni številki (inetis register) ─────────────────────

function razclenitNaslov(naslov: string): { ulica: string | null; postnaStevilka: string | null; kraj: string | null } {
  const idx = naslov.lastIndexOf(", ");
  if (idx === -1) return { ulica: naslov.trim() || null, postnaStevilka: null, kraj: null };
  const ulica = naslov.slice(0, idx).trim();
  const rest = naslov.slice(idx + 2).trim();
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) return { ulica: ulica || null, postnaStevilka: rest || null, kraj: null };
  return {
    ulica: ulica || null,
    postnaStevilka: rest.slice(0, spaceIdx),
    kraj: rest.slice(spaceIdx + 1).trim() || null,
  };
}

// ── POS uporabniki (admin panel) ──────────────────────────────────────────────

// GET /admin/companies/:id/enote — seznam enot za podjetje (za dropdown)
router.get("/companies/:id/enote", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rows = await db
    .select({ id: enoteTable.id, ime: enoteTable.ime, aktiven: enoteTable.aktiven })
    .from(enoteTable)
    .where(eq(enoteTable.companyId, companyId));
  res.json({ enote: rows });
});

// GET /admin/companies/:id/pos-roles — seznam POS uporabnikov za podjetje
router.get("/companies/:id/pos-roles", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rows = await db
    .select({
      id: posUporabnikiTable.id,
      clerkUserId: posUporabnikiTable.clerkUserId,
      vloga: posUporabnikiTable.vloga,
      ime: posUporabnikiTable.ime,
      priimek: posUporabnikiTable.priimek,
      aktiven: posUporabnikiTable.aktiven,
      enotaId: posUporabnikiTable.enotaId,
      enotaIme: enoteTable.ime,
    })
    .from(posUporabnikiTable)
    .leftJoin(enoteTable, eq(posUporabnikiTable.enotaId, enoteTable.id))
    .where(eq(posUporabnikiTable.companyId, companyId));
  res.json({ users: rows });
});

// POST /admin/companies/:id/pos-roles — dodeli POS vlogo
router.post("/companies/:id/pos-roles", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const { clerkUserId, vloga, enotaId } = req.body as { clerkUserId: string; vloga: string; enotaId?: number | null };

  if (!clerkUserId || !vloga) { res.status(400).json({ error: "Manjkata clerkUserId ali vloga." }); return; }
  if (!["admin", "admin_enote", "uporabnik"].includes(vloga)) { res.status(400).json({ error: "Neveljavna vloga." }); return; }
  if ((vloga === "admin_enote" || vloga === "uporabnik") && !enotaId) {
    res.status(400).json({ error: "Za to vlogo je enota obvezna." }); return;
  }

  // Pridobi ime in priimek iz Clerk
  let ime = "";
  let priimek = "";
  try {
    const clerkUser = await clerkClient.users.getUser(clerkUserId);
    ime = clerkUser.firstName ?? "";
    priimek = clerkUser.lastName ?? "";
    if (!ime && !priimek) {
      const email = clerkUser.emailAddresses[0]?.emailAddress ?? "";
      ime = email.split("@")[0] ?? "";
    }
  } catch { /* pustimo prazno če Clerk ne vrne */ }

  const [row] = await db
    .insert(posUporabnikiTable)
    .values({
      clerkUserId,
      companyId,
      vloga,
      enotaId: vloga === "admin" ? null : (enotaId ?? null),
      ime,
      priimek,
      aktiven: true,
    })
    .onConflictDoUpdate({
      target: [posUporabnikiTable.clerkUserId, posUporabnikiTable.companyId],
      set: { vloga, enotaId: vloga === "admin" ? null : (enotaId ?? null), ime, priimek, aktiven: true },
    })
    .returning();

  res.json(row);
});

// DELETE /admin/companies/:id/pos-roles/:clerkUserId — odstrani POS dostop
router.delete("/companies/:id/pos-roles/:clerkUserId", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const clerkUserId = Array.isArray(req.params.clerkUserId) ? req.params.clerkUserId[0] : req.params.clerkUserId;

  await db
    .delete(posUporabnikiTable)
    .where(and(eq(posUporabnikiTable.clerkUserId, clerkUserId), eq(posUporabnikiTable.companyId, companyId)));

  res.status(204).send();
});

// GET /admin/companies/:id — podrobnosti podjetja (za admin panel)
router.get("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }
  const modules = await db.select({ module: companyModulesTable.module }).from(companyModulesTable).where(eq(companyModulesTable.companyId, companyId));
  res.json({ ...company, modules: modules.map((m) => m.module) });
});

// PATCH /admin/companies/:id — posodobi podatke podjetja (super admin)
router.patch("/companies/:id", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const b = (req.body ?? {}) as Record<string, unknown>;
  const data: Partial<typeof companiesTable.$inferInsert> = {};

  if ("naziv" in b) {
    if (typeof b.naziv !== "string" || b.naziv.trim() === "") { res.status(400).json({ error: "naziv mora biti neprazen niz" }); return; }
    data.naziv = b.naziv.trim();
  }
  const stringFields = [
    "kratekNaziv", "naslov", "ulica", "postnaStevika", "kraj", "drzava", "kodaDrzave",
    "maticnaStevilka", "idZaDdv", "email", "telefon", "www",
    "eRacunOmrezje", "eRacunEmail", "eRacunNaslov", "eRacunSifraPu", "eRacunBic",
  ] as const;
  for (const f of stringFields) {
    if (f in b) {
      if (b[f] !== null && typeof b[f] !== "string") { res.status(400).json({ error: `${f} mora biti niz ali null` }); return; }
      (data as Record<string, unknown>)[f] = b[f] as string | null;
    }
  }
  for (const f of ["zavezanecDdv", "eRacunPrejemnik"] as const) {
    if (f in b) {
      if (b[f] !== null && typeof b[f] !== "boolean") { res.status(400).json({ error: `${f} mora biti boolean ali null` }); return; }
      (data as Record<string, unknown>)[f] = b[f] as boolean | null;
    }
  }
  if ("trr" in b) {
    if (b.trr === null) { data.trr = null; }
    else if (Array.isArray(b.trr)) { data.trr = b.trr as Array<{ iban: string; bic: string }>; }
    else { res.status(400).json({ error: "trr mora biti seznam ali null" }); return; }
  }

  data.updatedAt = new Date();
  const [updated] = await db.update(companiesTable).set(data).where(eq(companiesTable.id, companyId)).returning();
  if (!updated) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }
  res.json(updated);
});

// POST /admin/companies/:id/osvezi — osveži podatke iz Inetis + UJP + AJPES
router.post("/companies/:id/osvezi", async (req: Request, res: Response): Promise<void> => {
  const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
  if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

  const davcna = company.podjetjeDavcna.replace(/^SI/i, "");
  if (!/^\d{8}$/.test(davcna)) { res.status(400).json({ error: "Neveljavna davčna številka." }); return; }

  const inetisRes = await fetch(
    `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(davcna)}`,
    { signal: AbortSignal.timeout(8000) }
  ).catch(() => null);
  if (!inetisRes?.ok) { res.status(502).json({ error: "Register Inetis ni dosegljiv." }); return; }

  const inetisData = await inetisRes.json() as {
    status: string;
    list: Array<{
      Naziv?: string; NazivKratek?: string; Naslov?: string;
      DavcnaStevilka?: string; MaticnaStevilka?: string; ZavezanecZaDDV?: boolean;
      TransakcijskiRacuni?: Array<{ TRRSurovi?: string; Banka?: string; Zaprt?: boolean }>;
    }> | null;
  };
  if (inetisData.status !== "ok" || !inetisData.list?.length) {
    res.status(404).json({ error: "Podjetje ni najdeno v registru." }); return;
  }

  const p = inetisData.list[0]!;
  const rawNaslov = p.Naslov ?? null;
  const adresni = rawNaslov ? razclenitNaslov(rawNaslov) : { ulica: null, postnaStevilka: null, kraj: null };

  const BANCNI_BIC: Record<string, string> = {
    "NLB": "LJBASI2X", "Nova KBM": "KBMASI2X", "SKB": "SKBASI2X",
    "Addiko": "HAABSI22", "OTP banka": "OTPVSI2X", "UniCredit Banka": "BACXSI22",
    "Banka Intesa Sanpaolo": "BISISI22", "Gorenjska banka": "GBKPSI2X",
  };
  function trrIban(surovi: string) {
    const mod = BigInt(surovi + "281800") % 97n;
    const check = String(98n - mod).padStart(2, "0");
    return `SI${check}${surovi}`;
  }
  const trrji = (p.TransakcijskiRacuni ?? [])
    .filter((t) => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
    .map((t) => {
      const iban = trrIban(t.TRRSurovi!);
      const bic = iban.startsWith("SI5601") ? "BSLJSI2X" : ((t.Banka && BANCNI_BIC[t.Banka]) ? BANCNI_BIC[t.Banka]! : "");
      return { iban, bic };
    });

  const maticna = p.MaticnaStevilka ?? company.maticnaStevilka ?? null;
  const [ujpRes, ajpesRes] = await Promise.all([
    fetch(`https://storitve.ujp.gov.si/b2b/cl/isci?format=json&tip=1&davcna=${davcna}`, { signal: AbortSignal.timeout(8000) })
      .then((r) => r.ok ? r.json() : null).catch(() => null),
    (async () => {
      if (!maticna) return null;
      try { const { poisciVAjpes } = await import("./ajpes"); return await poisciVAjpes(maticna); }
      catch { return null; }
    })(),
  ]);

  let eRacunPosodobitev: Partial<typeof companiesTable.$inferInsert> = {};
  if (ujpRes && Array.isArray((ujpRes as { seznam?: unknown[] }).seznam) && (ujpRes as { seznam: unknown[] }).seznam.length > 0) {
    const u = (ujpRes as { seznam: Array<{ trrSt?: string; sifraPu?: string }> }).seznam[0]!;
    const surovi = u.trrSt ?? "";
    const ujpIban = /^\d{15}$/.test(surovi) ? trrIban(surovi) : surovi;
    eRacunPosodobitev = {
      eRacunPrejemnik: true, eRacunOmrezje: "UJP", eRacunNaslov: ujpIban || null,
      eRacunSifraPu: u.sifraPu || null,
      eRacunBic: ujpIban.replace(/\s/g, "").toUpperCase().startsWith("SI5601") ? "BSLJSI2X" : null,
    };
  }

  const updateData: Partial<typeof companiesTable.$inferInsert> = {
    naziv: p.Naziv ?? p.NazivKratek ?? company.naziv,
    kratekNaziv: p.NazivKratek ?? company.kratekNaziv,
    naslov: rawNaslov ?? company.naslov,
    ulica: adresni.ulica ?? company.ulica,
    postnaStevika: adresni.postnaStevilka ?? company.postnaStevika,
    kraj: adresni.kraj ?? company.kraj,
    drzava: company.drzava ?? "Slovenija",
    kodaDrzave: company.kodaDrzave ?? "SI",
    maticnaStevilka: maticna,
    idZaDdv: p.DavcnaStevilka ?? company.idZaDdv,
    zavezanecDdv: p.ZavezanecZaDDV ?? company.zavezanecDdv,
    trr: trrji.length > 0 ? trrji : (company.trr ?? null),
    ...(ajpesRes?.email && !company.email ? { email: ajpesRes.email } : {}),
    ...eRacunPosodobitev,
    updatedAt: new Date(),
  };

  const [updated] = await db.update(companiesTable).set(updateData).where(eq(companiesTable.id, companyId)).returning();
  res.json(updated);
});

// ── Iskanje podjetja po davčni številki ──────────────────────────────────────

// GET /admin/podjetje/poisci?davcna=XXXXXXXX
router.get("/podjetje/poisci", async (req: Request, res: Response): Promise<void> => {
  const davcna = typeof req.query.davcna === "string" ? req.query.davcna.replace(/^SI/i, "").trim() : "";
  if (!/^\d{8}$/.test(davcna)) {
    res.status(400).json({ error: "Davčna številka mora imeti točno 8 številk." });
    return;
  }

  try {
    const r = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(davcna)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) { res.status(502).json({ error: "Register ni dosegljiv." }); return; }

    const data = await r.json() as {
      status: string;
      list: Array<{
        Naziv?: string;
        NazivKratek?: string;
        Naslov?: string;
        DavcnaStevilkaKratka?: string;
      }> | null;
    };

    if (data.status !== "ok" || !data.list?.length) {
      res.status(404).json({ error: "Podjetje s to davčno številko ni bilo najdeno v registru." });
      return;
    }

    const p = data.list[0]!;
    const rawNaslov = p.Naslov ?? null;
    const adresni = rawNaslov ? razclenitNaslov(rawNaslov) : { ulica: null, postnaStevilka: null, kraj: null };

    const trrji = (p.TransakcijskiRacuni ?? [])
      .filter((t: { TRRSurovi?: string; Zaprt?: boolean }) => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi ?? ""))
      .map((t: { TRRSurovi?: string; Banka?: string }) => {
        const surovi = t.TRRSurovi!;
        const rearranged = surovi + "281800";
        const mod = BigInt(rearranged) % 97n;
        const check = String(98n - mod).padStart(2, "0");
        const iban = `SI${check}${surovi}`;
        const BANCNI_BIC: Record<string, string> = {
          "NLB": "LJBASI2X", "Nova KBM": "KBMASI2X", "SKB": "SKBASI2X",
          "Addiko": "HAABSI22", "OTP banka": "OTPVSI2X", "UniCredit Banka": "BACXSI22",
          "Banka Intesa Sanpaolo": "BISISI22", "Gorenjska banka": "GBKPSI2X",
        };
        return { iban, bic: (t.Banka && BANCNI_BIC[t.Banka]) ? BANCNI_BIC[t.Banka]! : "" };
      });

    res.json({
      naziv: p.Naziv ?? p.NazivKratek ?? "",
      kratekNaziv: p.NazivKratek ?? null,
      naslov: adresni.ulica ?? rawNaslov ?? null,
      postnaStevika: adresni.postnaStevilka ?? null,
      kraj: adresni.kraj ?? null,
      maticnaStevilka: (p as { MaticnaStevilka?: string }).MaticnaStevilka ?? null,
      trr: trrji,
    });
  } catch {
    res.status(502).json({ error: "Napaka pri iskanju v registru." });
  }
});

export default router;
