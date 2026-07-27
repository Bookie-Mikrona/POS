import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import { db, companiesTable, accountingRolesTable, companyModulesTable, posUporabnikiTable } from "@workspace/db";
import {
  CreateCompanyBody,
  AssignRoleBody,
} from "@workspace/api-zod";

interface TrrEntry { iban: string; bic: string; }

interface UpdateCompanyFields {
  naziv?: string;
  kratekNaziv?: string | null;
  naslov?: string | null;
  ulica?: string | null;
  postnaStevika?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  maticnaStevilka?: string | null;
  idZaDdv?: string | null;
  zavezanecDdv?: boolean | null;
  trr?: TrrEntry[] | null;
  email?: string | null;
  telefon?: string | null;
  www?: string | null;
  eRacunPrejemnik?: boolean | null;
  eRacunOmrezje?: string | null;
  eRacunEmail?: string | null;
  eRacunNaslov?: string | null;
  eRacunSifraPu?: string | null;
  eRacunBic?: string | null;
}

function parseUpdateCompany(body: unknown): { ok: true; data: UpdateCompanyFields } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Telo zahteve mora biti objekt" };
  const b = body as Record<string, unknown>;
  const data: UpdateCompanyFields = {};
  if ("naziv" in b) {
    if (typeof b.naziv !== "string" || b.naziv.trim() === "") return { ok: false, error: "naziv mora biti neprazen niz" };
    data.naziv = b.naziv.trim();
  }
  const stringNullFields = [
    "kratekNaziv", "naslov", "ulica", "postnaStevika", "kraj",
    "drzava", "kodaDrzave", "maticnaStevilka", "idZaDdv",
    "email", "telefon", "www",
    "eRacunOmrezje", "eRacunEmail", "eRacunNaslov", "eRacunSifraPu", "eRacunBic",
  ] as const;
  for (const field of stringNullFields) {
    if (field in b) {
      if (b[field] !== null && typeof b[field] !== "string") return { ok: false, error: `${field} mora biti niz ali null` };
      (data as Record<string, unknown>)[field] = b[field] as string | null;
    }
  }
  for (const field of ["zavezanecDdv", "eRacunPrejemnik"] as const) {
    if (field in b) {
      if (b[field] !== null && typeof b[field] !== "boolean") return { ok: false, error: `${field} mora biti boolean ali null` };
      data[field] = b[field] as boolean | null;
    }
  }
  if ("trr" in b) {
    if (b.trr === null) {
      data.trr = null;
    } else if (Array.isArray(b.trr)) {
      for (const entry of b.trr) {
        if (typeof entry !== "object" || entry === null || typeof (entry as TrrEntry).iban !== "string" || typeof (entry as TrrEntry).bic !== "string")
          return { ok: false, error: "trr mora biti seznam objektov {iban, bic}" };
      }
      data.trr = b.trr as TrrEntry[];
    } else {
      return { ok: false, error: "trr mora biti seznam ali null" };
    }
  }
  return { ok: true, data };
}
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";

const router: IRouter = Router();

// GET /companies — seznam podjetij prijavljenega uporabnika (ERP + POS)
router.get(
  "/companies",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

    // ERP podjetja (accountingRoles)
    const erpRows = await db
      .select({
        id: companiesTable.id,
        podjetjeDavcna: companiesTable.podjetjeDavcna,
        naziv: companiesTable.naziv,
        kratekNaziv: companiesTable.kratekNaziv,
        naslov: companiesTable.naslov,
        postnaStevika: companiesTable.postnaStevika,
        kraj: companiesTable.kraj,
        createdAt: companiesTable.createdAt,
        role: accountingRolesTable.role,
      })
      .from(accountingRolesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, accountingRolesTable.companyId))
      .where(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId))
      .orderBy(companiesTable.naziv);

    // POS podjetja (posUporabniki) — samo tista ki niso že v ERP seznamu
    const erpIds = new Set(erpRows.map((r) => r.id));
    const posRows = await db
      .select({
        id: companiesTable.id,
        podjetjeDavcna: companiesTable.podjetjeDavcna,
        naziv: companiesTable.naziv,
        kratekNaziv: companiesTable.kratekNaziv,
        naslov: companiesTable.naslov,
        postnaStevika: companiesTable.postnaStevika,
        kraj: companiesTable.kraj,
        createdAt: companiesTable.createdAt,
        vloga: posUporabnikiTable.vloga,
      })
      .from(posUporabnikiTable)
      .innerJoin(companiesTable, eq(companiesTable.id, posUporabnikiTable.companyId))
      .where(and(
        eq(posUporabnikiTable.clerkUserId, authReq.clerkUserId),
        eq(posUporabnikiTable.aktiven, true),
      ))
      .orderBy(companiesTable.naziv);

    // Združi vse ID-je za module query
    const allIds = [...new Set([...erpRows.map((r) => r.id), ...posRows.map((r) => r.id)])];
    const moduleRows = allIds.length
      ? await db
          .select({ companyId: companyModulesTable.companyId, module: companyModulesTable.module })
          .from(companyModulesTable)
          .where(inArray(companyModulesTable.companyId, allIds))
      : [];

    const modulesMap = new Map<string, string[]>();
    for (const m of moduleRows) {
      if (!modulesMap.has(m.companyId)) modulesMap.set(m.companyId, []);
      modulesMap.get(m.companyId)!.push(m.module);
    }

    const companies = [
      ...erpRows.map((r) => ({ ...r, modules: modulesMap.get(r.id) ?? [], posOnly: false })),
      // Dodaj VSA POS podjetja — tudi tista ki so hkrati v ERP (dual-role uporabnik)
      ...posRows
        .map((r) => ({ ...r, role: `pos_${r.vloga}`, modules: modulesMap.get(r.id) ?? [], posOnly: !erpIds.has(r.id) })),
    ];

    res.json({ companies });
  },
);

// POST /companies — ustvari novo podjetje, ustvarjalec dobi vlogo owner
router.post(
  "/companies",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;

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

    const [company] = await db.transaction(async (tx) => {
      const [newCompany] = await tx
        .insert(companiesTable)
        .values(parsed.data)
        .returning();

      await tx.insert(accountingRolesTable).values({
        clerkUserId: authReq.clerkUserId,
        companyId: newCompany.id,
        role: "owner",
      });

      return [newCompany];
    });

    res.status(201).json({ ...company, role: "owner" });
  },
);

// GET /companies/:id — podrobnosti podjetja (pot :id je avtoritativna)
router.get(
  "/companies/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Preveri dostop — JOIN po companyId IZ poti, ne iz headerja
    const [row] = await db
      .select({
        id: companiesTable.id,
        podjetjeDavcna: companiesTable.podjetjeDavcna,
        naziv: companiesTable.naziv,
        kratekNaziv: companiesTable.kratekNaziv,
        naslov: companiesTable.naslov,
        ulica: companiesTable.ulica,
        postnaStevika: companiesTable.postnaStevika,
        kraj: companiesTable.kraj,
        drzava: companiesTable.drzava,
        kodaDrzave: companiesTable.kodaDrzave,
        maticnaStevilka: companiesTable.maticnaStevilka,
        idZaDdv: companiesTable.idZaDdv,
        zavezanecDdv: companiesTable.zavezanecDdv,
        trr: companiesTable.trr,
        email: companiesTable.email,
        telefon: companiesTable.telefon,
        www: companiesTable.www,
        eRacunPrejemnik: companiesTable.eRacunPrejemnik,
        eRacunOmrezje: companiesTable.eRacunOmrezje,
        eRacunEmail: companiesTable.eRacunEmail,
        eRacunNaslov: companiesTable.eRacunNaslov,
        eRacunSifraPu: companiesTable.eRacunSifraPu,
        eRacunBic: companiesTable.eRacunBic,
        createdAt: companiesTable.createdAt,
        role: accountingRolesTable.role,
      })
      .from(accountingRolesTable)
      .innerJoin(
        companiesTable,
        eq(companiesTable.id, accountingRolesTable.companyId),
      )
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!row) {
      // Razlikujemo: ali podjetje sploh obstaja ali samo nima dostopa
      const [exists] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);

      if (!exists) {
        res.status(404).json({ error: "Podjetje ni najdeno" });
      } else {
        res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
      }
      return;
    }

    res.json(row);
  },
);

// PATCH /companies/:id — posodobi podatke podjetja (samo owner)
router.patch(
  "/companies/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }
    if (callerRole.role !== "owner") { res.status(403).json({ error: "Za urejanje podatkov podjetja potrebujete vlogo lastnik" }); return; }

    const parsed = parseUpdateCompany(req.body);
    if (!parsed.ok) { res.status(400).json({ error: parsed.error }); return; }

    const [updated] = await db
      .update(companiesTable)
      .set({ ...parsed.data, updatedAt: new Date() } as Partial<typeof companiesTable.$inferInsert>)
      .where(eq(companiesTable.id, companyId))
      .returning();

    if (!updated) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

    res.json({ ...updated, role: callerRole.role });
  },
);

// POST /companies/:id/osvezi — osveži podatke podjetja iz Inetis + UJP + AJPES
router.post(
  "/companies/:id/osvezi",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);
    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }
    if (callerRole.role !== "owner") { res.status(403).json({ error: "Za osvežitev podatkov potrebujete vlogo lastnik" }); return; }

    const [company] = await db.select().from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1);
    if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

    const davcna = company.podjetjeDavcna.replace(/^SI/i, "");
    if (!/^\d{8}$/.test(davcna)) { res.status(400).json({ error: "Podjetje nima veljavne davčne številke za iskanje." }); return; }

    // Inetis — osnovni podatki
    const inetisRes = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(davcna)}`,
      { signal: AbortSignal.timeout(8000) }
    ).catch(() => null);

    if (!inetisRes?.ok) { res.status(502).json({ error: "Register Inetis ni dosegljiv." }); return; }

    const inetisData = await inetisRes.json() as {
      status: string;
      list: Array<{
        Naziv?: string; NazivKratek?: string; Naslov?: string;
        DavcnaStevilka?: string; DavcnaStevilkaKratka?: string;
        MaticnaStevilka?: string; ZavezanecZaDDV?: boolean;
        TransakcijskiRacuni?: Array<{ TRRSurovi?: string; Banka?: string; Zaprt?: boolean }>;
      }> | null;
    };

    if (inetisData.status !== "ok" || !inetisData.list?.length) {
      res.status(404).json({ error: "Podjetje ni bilo najdeno v registru Inetis." }); return;
    }

    const p = inetisData.list[0]!;
    const rawNaslov = p.Naslov ?? null;

    function razclenitNaslov(naslov: string) {
      const idx = naslov.lastIndexOf(", ");
      if (idx === -1) return { ulica: naslov.trim() || null, postnaStevilka: null, kraj: null };
      const ulica = naslov.slice(0, idx).trim();
      const rest = naslov.slice(idx + 2).trim();
      const spaceIdx = rest.indexOf(" ");
      if (spaceIdx === -1) return { ulica: ulica || null, postnaStevilka: rest || null, kraj: null };
      return { ulica: ulica || null, postnaStevilka: rest.slice(0, spaceIdx), kraj: rest.slice(spaceIdx + 1).trim() || null };
    }

    const adresni = rawNaslov ? razclenitNaslov(rawNaslov) : { ulica: null, postnaStevilka: null, kraj: null };

    const BANCNI_BIC: Record<string, string> = {
      "NLB": "LJBASI2X", "Nova KBM": "KBMASI2X", "SKB": "SKBASI2X",
      "Addiko": "HAABSI22", "OTP banka": "OTPVSI2X", "UniCredit Banka": "BACXSI22",
      "Banka Intesa Sanpaolo": "BISISI22", "Gorenjska banka": "GBKPSI2X",
    };

    function trrSuroviVIban(surovi: string) {
      const rearranged = surovi + "281800";
      const mod = BigInt(rearranged) % 97n;
      const check = String(98n - mod).padStart(2, "0");
      return `SI${check}${surovi}`;
    }

    const trrji = (p.TransakcijskiRacuni ?? [])
      .filter((t) => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
      .map((t) => {
        const iban = trrSuroviVIban(t.TRRSurovi!);
        return {
          iban: iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
            ? iban : iban,
          bic: (t.Banka && BANCNI_BIC[t.Banka]) ? BANCNI_BIC[t.Banka]! : "",
        };
      })
      .map((t) => t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601") ? { ...t, bic: "BSLJSI2X" } : t);

    const maticna = p.MaticnaStevilka ?? company.maticnaStevilka ?? null;

    // Vzporedno: UJP + AJPES
    const [ujpRes, ajpesRes] = await Promise.all([
      fetch(
        `https://storitve.ujp.gov.si/b2b/cl/isci?format=json&tip=1&davcna=${davcna}`,
        { signal: AbortSignal.timeout(8000) }
      ).then((r) => r.ok ? r.json() : null).catch(() => null),
      // AJPES poisci — poiščemo po matični
      (async () => {
        if (!maticna) return null;
        try {
          const { poisciVAjpes } = await import("./ajpes");
          return await poisciVAjpes(maticna);
        } catch { return null; }
      })(),
    ]);

    // UJP obdelava
    let eRacunPrejemnik: boolean | null = null;
    let eRacunOmrezje: string | null = null;
    let eRacunNaslov: string | null = null;
    let eRacunSifraPu: string | null = null;
    let eRacunBic: string | null = null;

    if (ujpRes && Array.isArray((ujpRes as { seznam?: unknown[] }).seznam) && (ujpRes as { seznam: unknown[] }).seznam.length > 0) {
      const u = (ujpRes as { seznam: Array<{ trrSt?: string; sifraPu?: string }> }).seznam[0]!;
      const surovi = u.trrSt ?? "";
      const ujpIban = /^\d{15}$/.test(surovi) ? trrSuroviVIban(surovi) : surovi;
      eRacunPrejemnik = true;
      eRacunOmrezje = "UJP";
      eRacunNaslov = ujpIban || null;
      eRacunSifraPu = u.sifraPu || null;
      eRacunBic = ujpIban.replace(/\s/g, "").toUpperCase().startsWith("SI5601") ? "BSLJSI2X" : null;
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
      maticnaStevilka: maticna ?? company.maticnaStevilka,
      idZaDdv: p.DavcnaStevilka ?? company.idZaDdv,
      zavezanecDdv: p.ZavezanecZaDDV ?? company.zavezanecDdv,
      trr: trrji.length > 0 ? trrji : (company.trr ?? null),
      ...(ajpesRes?.email && !company.email ? { email: ajpesRes.email } : {}),
      ...(eRacunPrejemnik !== null ? {
        eRacunPrejemnik, eRacunOmrezje, eRacunNaslov, eRacunSifraPu, eRacunBic,
      } : {}),
      updatedAt: new Date(),
    };

    const [updated] = await db.update(companiesTable).set(updateData).where(eq(companiesTable.id, companyId)).returning();
    res.json({ ...updated, role: callerRole.role });
  },
);

// GET /companies/:id/roles — seznam vlog za podjetje (samo member+)
router.get(
  "/companies/:id/roles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }

    const roles = await db
      .select({
        clerkUserId: accountingRolesTable.clerkUserId,
        role: accountingRolesTable.role,
        createdAt: accountingRolesTable.createdAt,
      })
      .from(accountingRolesTable)
      .where(eq(accountingRolesTable.companyId, companyId))
      .orderBy(accountingRolesTable.createdAt);

    res.json(roles);
  },
);

// DELETE /companies/:id/roles/:clerkUserId — odstrani vlogo (samo owner, ne more odstraniti sebe)
router.delete(
  "/companies/:id/roles/:clerkUserId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const targetUserId = Array.isArray(req.params.clerkUserId) ? req.params.clerkUserId[0] : req.params.clerkUserId;

    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, authReq.clerkUserId), eq(accountingRolesTable.companyId, companyId)))
      .limit(1);

    if (!callerRole) { res.status(403).json({ error: "Dostop ni dovoljen" }); return; }
    if (callerRole.role !== "owner") { res.status(403).json({ error: "Za odstranjevanje vlog potrebujete vlogo lastnik" }); return; }
    if (targetUserId === authReq.clerkUserId) { res.status(400).json({ error: "Ne morete odstraniti lastne vloge" }); return; }

    await db
      .delete(accountingRolesTable)
      .where(and(eq(accountingRolesTable.clerkUserId, targetUserId), eq(accountingRolesTable.companyId, companyId)));

    res.status(204).send();
  },
);

// POST /companies/:id/roles — dodeli vlogo (samo owner, pot :id je avtoritativna)
router.post(
  "/companies/:id/roles",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;

    // Preveri, da je klic owner tega podjetja (pot :id)
    const [callerRole] = await db
      .select({ role: accountingRolesTable.role })
      .from(accountingRolesTable)
      .where(
        and(
          eq(accountingRolesTable.clerkUserId, authReq.clerkUserId),
          eq(accountingRolesTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!callerRole) {
      const [exists] = await db
        .select({ id: companiesTable.id })
        .from(companiesTable)
        .where(eq(companiesTable.id, companyId))
        .limit(1);

      if (!exists) {
        res.status(404).json({ error: "Podjetje ni najdeno" });
      } else {
        res.status(403).json({ error: "Dostop do tega podjetja ni dovoljen" });
      }
      return;
    }

    if (callerRole.role !== "owner") {
      res.status(403).json({ error: "Za dodeljevanje vlog potrebujete vlogo lastnik" });
      return;
    }

    const parsed = AssignRoleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [role] = await db
      .insert(accountingRolesTable)
      .values({
        clerkUserId: parsed.data.clerkUserId,
        companyId,
        role: parsed.data.role,
      })
      .onConflictDoUpdate({
        target: [
          accountingRolesTable.clerkUserId,
          accountingRolesTable.companyId,
        ],
        set: { role: parsed.data.role, updatedAt: new Date() },
      })
      .returning();

    res.json({
      companyId: role.companyId,
      clerkUserId: role.clerkUserId,
      role: role.role,
    });
  },
);

export default router;
