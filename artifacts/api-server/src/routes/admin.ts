/**
 * Super admin routes — /admin/*
 * Dostopno samo za super adminov (env SUPER_ADMIN_IDS).
 */
import { Router, type Request, type Response, type IRouter } from "express";
import { eq, desc, and } from "drizzle-orm";
import { db, companiesTable, accountingRolesTable, companyModulesTable, systemSettingsTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";
import { CreateCompanyBody, AssignRoleBody } from "@workspace/api-zod";

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

  // Pridobi število uporabnikov na podjetje
  const roles = await db
    .select({
      companyId: accountingRolesTable.companyId,
      clerkUserId: accountingRolesTable.clerkUserId,
    })
    .from(accountingRolesTable);

  const companiesWithModules = companies.map((c) => ({
    ...c,
    modules: modules.filter((m) => m.companyId === c.id).map((m) => m.module),
    userCount: roles.filter((r) => r.companyId === c.id).length,
  }));

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

// GET /admin/users — vsi Clerk user IDji z vlogami (za pregled, kdo ima dostop)
router.get("/users", async (_req: Request, res: Response): Promise<void> => {
  const rows = await db
    .select({
      clerkUserId: accountingRolesTable.clerkUserId,
      companyId: accountingRolesTable.companyId,
      companyNaziv: companiesTable.naziv,
      role: accountingRolesTable.role,
      createdAt: accountingRolesTable.createdAt,
    })
    .from(accountingRolesTable)
    .innerJoin(companiesTable, eq(companiesTable.id, accountingRolesTable.companyId))
    .orderBy(accountingRolesTable.clerkUserId);

  // Grupiraj po userju
  const userMap = new Map<string, { clerkUserId: string; companies: { companyId: string; naziv: string; role: string; createdAt: Date }[] }>();
  for (const row of rows) {
    if (!userMap.has(row.clerkUserId)) {
      userMap.set(row.clerkUserId, { clerkUserId: row.clerkUserId, companies: [] });
    }
    userMap.get(row.clerkUserId)!.companies.push({
      companyId: row.companyId,
      naziv: row.companyNaziv,
      role: row.role,
      createdAt: row.createdAt,
    });
  }

  res.json({ users: Array.from(userMap.values()) });
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

  const parsed = CreateCompanyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Preveri ali davčna že obstaja
  const [dup] = await db
    .select({ id: companiesTable.id })
    .from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, parsed.data.podjetjeDavcna))
    .limit(1);

  if (dup) {
    res.status(409).json({ error: "Podjetje s to davčno številko že obstaja." });
    return;
  }

  // Ustvari podjetje
  const [company] = await db
    .insert(companiesTable)
    .values(parsed.data)
    .returning();

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

export default router;
