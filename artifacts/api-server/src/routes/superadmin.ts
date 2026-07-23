/**
 * Super-admin rute — upravljanje podjetij in POS uporabnikov na platformnem nivoju.
 * Dostop samo za SUPER_ADMIN_IDS (Clerk user IDs iz env var).
 */
import { Router, type IRouter, type Request, type Response } from "express";
import { eq, inArray } from "drizzle-orm";
import { db, companiesTable, posUporabnikiTable } from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { requireSuperAdmin } from "../middlewares/requireSuperAdmin";

const router: IRouter = Router();

// ── Skupne pomožne funkcije (enako kot v kupec.ts) ─────────────────────────

type TrrPostavka = { iban: string; bic: string };

const BANCNI_BIC: Record<string, string> = {
  "NLB": "LJBASI2X",
  "Nova KBM": "KBMASI2X",
  "SKB": "SKBASI2X",
  "Addiko": "HAABSI22",
  "OTP banka": "OTPVSI2X",
  "UniCredit Banka": "BACXSI22",
  "Banka Intesa Sanpaolo": "BISISI22",
  "BKS banka": "BFKKSI22",
  "Gorenjska banka": "GBKPSI2X",
  "Delavska hranilnica": "DELAVSI2X",
  "Primorska hranilnica": "PHBPSI22",
};

function trrSuroviVIban(trrSurovi: string): string {
  const rearranged = trrSurovi + "281800";
  const mod = BigInt(rearranged) % 97n;
  const check = String(98n - mod).padStart(2, "0");
  return `SI${check}${trrSurovi}`;
}

function razclenitNaslov(naslov: string): { ulica: string | null; postnaStevilka: string | null; kraj: string | null } {
  const idx = naslov.lastIndexOf(", ");
  if (idx === -1) return { ulica: naslov.trim() || null, postnaStevilka: null, kraj: null };
  const ulica = naslov.slice(0, idx).trim();
  const rest = naslov.slice(idx + 2).trim();
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) return { ulica: ulica || null, postnaStevilka: rest || null, kraj: null };
  return { ulica: ulica || null, postnaStevilka: rest.slice(0, spaceIdx), kraj: rest.slice(spaceIdx + 1).trim() || null };
}

interface InetisRezultat {
  naziv: string;
  kratekNaziv: string | null;
  naslov: string | null;
  ulica: string | null;
  postnaStevilka: string | null;
  kraj: string | null;
  maticnaStevilka: string | null;
  trr: TrrPostavka[];
}

async function poisciNaInetis(davcna: string): Promise<InetisRezultat | null> {
  try {
    const cleaned = davcna.replace(/^SI/i, "");
    const r = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(cleaned)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const data = await r.json() as {
      status: string;
      list: Array<{
        Naziv?: string;
        NazivKratek?: string;
        Naslov?: string;
        MaticnaStevilka?: string;
        TransakcijskiRacuni?: Array<{ TRRSurovi?: string; Banka?: string; Zaprt?: boolean }>;
      }> | null;
    };
    if (data.status !== "ok" || !data.list?.length) return null;
    const p = data.list[0]!;
    const rawNaslov = p.Naslov ?? null;
    const adresni = rawNaslov ? razclenitNaslov(rawNaslov) : { ulica: null, postnaStevilka: null, kraj: null };
    const trrji: TrrPostavka[] = (p.TransakcijskiRacuni ?? [])
      .filter(t => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
      .map(t => ({
        iban: trrSuroviVIban(t.TRRSurovi!),
        bic: (t.Banka && BANCNI_BIC[t.Banka]) ? BANCNI_BIC[t.Banka]! : "",
      }));
    return {
      naziv: p.Naziv ?? p.NazivKratek ?? "",
      kratekNaziv: p.NazivKratek ?? null,
      naslov: rawNaslov,
      ulica: adresni.ulica,
      postnaStevilka: adresni.postnaStevilka,
      kraj: adresni.kraj,
      maticnaStevilka: p.MaticnaStevilka ?? null,
      trr: trrji,
    };
  } catch {
    return null;
  }
}

// ── Middleware stack ────────────────────────────────────────────────────────

const superAdminStack = [requireAuth, requireSuperAdmin] as const;

// ── GET /superadmin/podjetja ────────────────────────────────────────────────
// Vrne vsa podjetja z njihovimi POS uporabniki.

router.get("/superadmin/podjetja", ...superAdminStack, async (_req: Request, res: Response): Promise<void> => {
  const companies = await db
    .select({
      id: companiesTable.id,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
      naziv: companiesTable.naziv,
      kratekNaziv: companiesTable.kratekNaziv,
      naslov: companiesTable.naslov,
      postnaStevika: companiesTable.postnaStevika,
      kraj: companiesTable.kraj,
      maticnaStevilka: companiesTable.maticnaStevilka,
      trr: companiesTable.trr,
    })
    .from(companiesTable)
    .orderBy(companiesTable.naziv);

  if (companies.length === 0) { res.json([]); return; }

  const companyIds = companies.map(c => c.id);
  const users = await db
    .select({
      id: posUporabnikiTable.id,
      companyId: posUporabnikiTable.companyId,
      clerkUserId: posUporabnikiTable.clerkUserId,
      vloga: posUporabnikiTable.vloga,
      ime: posUporabnikiTable.ime,
      priimek: posUporabnikiTable.priimek,
      aktiven: posUporabnikiTable.aktiven,
    })
    .from(posUporabnikiTable)
    .where(inArray(posUporabnikiTable.companyId, companyIds));

  const usersByCompany: Record<string, typeof users> = {};
  for (const u of users) {
    if (!usersByCompany[u.companyId]) usersByCompany[u.companyId] = [];
    usersByCompany[u.companyId]!.push(u);
  }

  const naslov = (c: typeof companies[number]) =>
    [c.naslov, c.postnaStevika && c.kraj ? `${c.postnaStevika} ${c.kraj}` : c.kraj].filter(Boolean).join(", ") || null;

  res.json(companies.map(c => ({
    id: c.id,
    davcnaStevilka: c.podjetjeDavcna,
    naziv: c.naziv,
    kratekNaziv: c.kratekNaziv,
    naslov: naslov(c),
    maticnaStevilka: c.maticnaStevilka,
    trr: c.trr ?? [],
    steviloUporabnikov: (usersByCompany[c.id] ?? []).length,
    uporabniki: (usersByCompany[c.id] ?? []).map(u => ({
      id: u.id,
      clerkUserId: u.clerkUserId,
      username: `${u.ime} ${u.priimek}`.trim() || u.clerkUserId,
      ime: `${u.ime} ${u.priimek}`.trim() || null,
      vloga: u.vloga,
      aktiven: u.aktiven,
    })),
  })));
});

// ── GET /superadmin/ddv-lookup?davcna= ─────────────────────────────────────
// Poišče podjetje na Inetisu — vrne naziv, naslov, matično in TRR.

router.get("/superadmin/ddv-lookup", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const davcna = typeof req.query.davcna === "string" ? req.query.davcna.replace(/^SI/i, "").trim() : "";
  if (!/^\d{8}$/.test(davcna)) {
    res.status(400).json({ error: "Davčna številka mora imeti točno 8 številk." });
    return;
  }
  const inetis = await poisciNaInetis(davcna);
  if (!inetis) {
    res.status(404).json({ error: "Podjetje s to davčno številko ni bilo najdeno v registru." });
    return;
  }
  const naslovCel = [inetis.ulica, inetis.postnaStevilka && inetis.kraj ? `${inetis.postnaStevilka} ${inetis.kraj}` : inetis.kraj].filter(Boolean).join(", ");
  res.json({
    naziv: inetis.naziv,
    kratekNaziv: inetis.kratekNaziv,
    naslov: naslovCel || inetis.naslov || "",
    ulica: inetis.ulica,
    postnaStevika: inetis.postnaStevilka,
    kraj: inetis.kraj,
    maticnaStevilka: inetis.maticnaStevilka,
    trr: inetis.trr,
  });
});

// ── POST /superadmin/podjetja ───────────────────────────────────────────────
// Ustvari novo podjetje. Admin uporabnik se doda ročno z /uporabniki.

router.post("/superadmin/podjetja", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const { davcna, naziv, kratekNaziv, naslov, postnaStevika, kraj, maticnaStevilka, trr } = req.body as {
    davcna?: string; naziv?: string; kratekNaziv?: string; naslov?: string;
    postnaStevika?: string; kraj?: string; maticnaStevilka?: string;
    trr?: TrrPostavka[];
  };
  const cleanDavcna = (davcna ?? "").replace(/^SI/i, "").trim();
  if (!/^\d{8}$/.test(cleanDavcna)) {
    res.status(400).json({ error: "Davčna številka mora imeti točno 8 številk." });
    return;
  }
  if (!naziv?.trim()) {
    res.status(400).json({ error: "Naziv podjetja je obvezen." });
    return;
  }
  // Preverimo, ali podjetje že obstaja
  const [existing] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, cleanDavcna)).limit(1);
  if (existing) {
    res.status(409).json({ error: "Podjetje s to davčno številko že obstaja." });
    return;
  }
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: cleanDavcna,
    naziv: naziv.trim(),
    kratekNaziv: kratekNaziv?.trim() || null,
    naslov: naslov?.trim() || null,
    postnaStevika: postnaStevika?.trim() || null,
    kraj: kraj?.trim() || null,
    maticnaStevilka: maticnaStevilka?.trim() || null,
    trr: trr?.length ? trr : null,
  }).returning();
  res.status(201).json(company);
});

// ── POST /superadmin/podjetja/osvezi-inetis ────────────────────────────────
// Osveži matično in TRR za vsa podjetja iz Inetis registra.

router.post("/superadmin/podjetja/osvezi-inetis", ...superAdminStack, async (_req: Request, res: Response): Promise<void> => {
  const companies = await db
    .select({ id: companiesTable.id, podjetjeDavcna: companiesTable.podjetjeDavcna })
    .from(companiesTable);

  let osvezenih = 0;
  for (const c of companies) {
    const inetis = await poisciNaInetis(c.podjetjeDavcna);
    if (!inetis) continue;
    const adresni = inetis.ulica
      ? { naslov: inetis.ulica, postnaStevika: inetis.postnaStevilka, kraj: inetis.kraj }
      : null;
    await db.update(companiesTable)
      .set({
        naziv: inetis.naziv || undefined,
        kratekNaziv: inetis.kratekNaziv ?? undefined,
        ...(adresni ? {
          naslov: adresni.naslov,
          postnaStevika: adresni.postnaStevika,
          kraj: adresni.kraj,
        } : {}),
        maticnaStevilka: inetis.maticnaStevilka ?? undefined,
        trr: inetis.trr.length > 0 ? inetis.trr : undefined,
        updatedAt: new Date(),
      })
      .where(eq(companiesTable.id, c.id));
    osvezenih++;
  }
  res.json({ osvezenih });
});

// ── POST /superadmin/podjetja/:davcna/uporabniki ───────────────────────────
// Dodeli POS vlogo Clerk uporabniku.

router.post("/superadmin/podjetja/:davcna/uporabniki", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const davcna = (String(req.params.davcna ?? "")).replace(/^SI/i, "").trim();
  const { clerkUserId, ime, vloga } = req.body as { clerkUserId?: string; ime?: string; vloga?: string };

  if (!clerkUserId?.trim()) { res.status(400).json({ error: "Clerk user ID je obvezen." }); return; }
  if (!["admin", "admin_enote", "uporabnik"].includes(vloga ?? "")) {
    res.status(400).json({ error: "Neveljavna vloga." }); return;
  }

  const [company] = await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.podjetjeDavcna, davcna)).limit(1);
  if (!company) { res.status(404).json({ error: "Podjetje ni bilo najdeno." }); return; }

  const imeKosi = (ime ?? "").trim().split(/\s+/);
  const [row] = await db.insert(posUporabnikiTable).values({
    clerkUserId: clerkUserId.trim(),
    companyId: company.id,
    vloga: vloga!,
    ime: imeKosi[0] ?? "",
    priimek: imeKosi.slice(1).join(" "),
    aktiven: true,
  }).onConflictDoUpdate({
    target: [posUporabnikiTable.clerkUserId, posUporabnikiTable.companyId],
    set: { vloga: vloga!, ime: imeKosi[0] ?? "", priimek: imeKosi.slice(1).join(" "), aktiven: true },
  }).returning();
  res.status(201).json(row);
});

// ── PATCH /superadmin/podjetja/:davcna/uporabniki/:id ─────────────────────
// Posodobi POS uporabnika.

router.patch("/superadmin/podjetja/:davcna/uporabniki/:id", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID." }); return; }
  const { ime, vloga, aktiven } = req.body as { ime?: string; vloga?: string; aktiven?: boolean };
  const set: Record<string, unknown> = {};
  if (ime !== undefined) {
    const imeKosi = ime.trim().split(/\s+/);
    set.ime = imeKosi[0] ?? "";
    set.priimek = imeKosi.slice(1).join(" ");
  }
  if (vloga !== undefined) set.vloga = vloga;
  if (aktiven !== undefined) set.aktiven = aktiven;
  if (Object.keys(set).length === 0) { res.status(400).json({ error: "Ni polj za posodobitev." }); return; }
  const [row] = await db.update(posUporabnikiTable).set(set).where(eq(posUporabnikiTable.id, id)).returning();
  if (!row) { res.status(404).json({ error: "Uporabnik ni bil najden." }); return; }
  res.json(row);
});

// ── DELETE /superadmin/podjetja/:davcna/uporabniki/:id ────────────────────

router.delete("/superadmin/podjetja/:davcna/uporabniki/:id", ...superAdminStack, async (req: Request, res: Response): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID." }); return; }
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.id, id));
  res.status(204).send();
});

export default router;
