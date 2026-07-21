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

// GET /admin/users — VSI Clerk uporabniki + njihove vloge v podjetjih
router.get("/users", async (_req: Request, res: Response): Promise<void> => {
  // 1. Hkrati pridobimo Clerk userje in vloge iz DB
  const [clerkResponse, dbRows] = await Promise.all([
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
  ]);

  // 2. Grupiraj vloge po Clerk userju
  const rolesMap = new Map<string, { companyId: string; naziv: string; role: string; createdAt: Date }[]>();
  for (const row of dbRows) {
    if (!rolesMap.has(row.clerkUserId)) rolesMap.set(row.clerkUserId, []);
    rolesMap.get(row.clerkUserId)!.push({
      companyId: row.companyId,
      naziv: row.companyNaziv,
      role: row.role,
      createdAt: row.createdAt,
    });
  }

  // 3. Sestavi seznam iz vseh Clerk userjev
  const users = clerkResponse.data.map((u) => ({
    clerkUserId: u.id,
    email: u.emailAddresses[0]?.emailAddress ?? "",
    firstName: u.firstName ?? "",
    lastName: u.lastName ?? "",
    imageUrl: u.imageUrl ?? "",
    createdAt: new Date(u.createdAt).toISOString(),
    companies: rolesMap.get(u.id) ?? [],
  }));

  res.json({ users });
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

    res.json({
      naziv: p.Naziv ?? p.NazivKratek ?? "",
      kratekNaziv: p.NazivKratek ?? null,
      naslov: adresni.ulica ?? rawNaslov ?? null,
      postnaStevika: adresni.postnaStevilka ?? null, // ohranimo ime iz DB sheme
      kraj: adresni.kraj ?? null,
    });
  } catch {
    res.status(502).json({ error: "Napaka pri iskanju v registru." });
  }
});

export default router;
