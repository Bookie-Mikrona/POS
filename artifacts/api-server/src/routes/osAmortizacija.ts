/**
 * osAmortizacija.ts — API ruta za amortizacijski obračun OS (Faza 3c, 1. del)
 *
 * GET /os/:companyId/amortizacija?leto=2024
 *   → izračuna amortizacijo za dano leto, NE zapisuje v bazo
 *
 * Dostop: os_roles branje (os_admin | os_user | os_viewer)
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, lt, desc } from "drizzle-orm";
import {
  db,
  osAmortizacijskeSkupineTable,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osRolesTable,
  companyModulesTable,
  accountsTable,
  costCentersTable,
  osAmortizacijaObracunTable,
  osAmortizacijaObracunSredstvoTable,
  osAmortizacijaNastavitveTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";
import {
  calcAmortizacijaObracun,
  computeVhodniPodpis,
  type SredstvoInput,
  type DoknjizbaInput,
  type PraviloZacetkaAmortizacije,
} from "./osAmortizacijaEngine";

const router: IRouter = Router();

// ─── Pomožna: preveri OS dostop (branje) ────────────────────────────────────

async function resolveOsReadAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<boolean> {
  if (isSuperAdmin(clerkUserId)) return true;

  const [mod] = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(
      and(
        eq(companyModulesTable.companyId, companyId),
        eq(companyModulesTable.module, "osnovna_sredstva"),
      ),
    )
    .limit(1);

  if (!mod) {
    res.status(403).json({ error: "Modul Osnovna sredstva ni aktiviran za to podjetje" });
    return false;
  }

  const [row] = await db
    .select({ role: osRolesTable.role })
    .from(osRolesTable)
    .where(
      and(
        eq(osRolesTable.clerkUserId, clerkUserId),
        eq(osRolesTable.companyId, companyId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(403).json({ error: "Dostop do modula Osnovna sredstva ni dodeljen" });
    return false;
  }

  return true;
}

// ─── GET /os/:companyId/amortizacija ────────────────────────────────────────

router.get(
  "/os/:companyId/amortizacija",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const { companyId } = req.params as { companyId: string };
    const clerkUserId = (req as AuthenticatedRequest).clerkUserId;

    if (!(await resolveOsReadAccess(clerkUserId, companyId, res))) return;

    // Leto
    const letoParam = req.query.leto;
    const leto = letoParam ? parseInt(String(letoParam), 10) : new Date().getFullYear();
    if (isNaN(leto) || leto < 1990 || leto > 2100) {
      res.status(400).json({ error: "Neveljavno leto" });
      return;
    }

    const { inArray: inArr } = await import("drizzle-orm");

    // ─── Naloži vse podatke iz baze (vzporedno) ──────────────────────────

    // 1) Skupaj vse amortizacijske skupine za to podjetje (lookup map)
    const skupineRows = await db
      .select({
        id: osAmortizacijskeSkupineTable.id,
        koda: osAmortizacijskeSkupineTable.koda,
        naziv: osAmortizacijskeSkupineTable.naziv,
        racunovodskaStonja: osAmortizacijskeSkupineTable.racunovodskaStonja,
        davcnaStonja: osAmortizacijskeSkupineTable.davcnaStonja,
      })
      .from(osAmortizacijskeSkupineTable)
      .where(eq(osAmortizacijskeSkupineTable.companyId, companyId));

    const skupineMap = new Map(skupineRows.map((s) => [s.id, s]));

    // 2) Vse glave
    const glaveRows = await db
      .select({
        id: osnovnaSredstvaTable.id,
        inventarnaSt: osnovnaSredstvaTable.inventarnaSt,
        naziv: osnovnaSredstvaTable.naziv,
        skupinaId: osnovnaSredstvaTable.skupinaId,
        costCenterId: osnovnaSredstvaTable.costCenterId,
        accountId: osnovnaSredstvaTable.accountId,
        status: osnovnaSredstvaTable.status,
        datumOdtujitve: osnovnaSredstvaTable.datumOdtujitve,
      })
      .from(osnovnaSredstvaTable)
      .where(eq(osnovnaSredstvaTable.companyId, companyId))
      .then((rows) => rows.filter((g) => {
        if (!g.datumOdtujitve) return true;
        const dispYear = parseInt(g.datumOdtujitve.slice(0, 4), 10);
        return isNaN(dispYear) || dispYear >= leto;
      }));

    // 3) Vse doknjižbe
    const sredstvoIds = glaveRows.map((g) => g.id);
    let doknjizbeRows: Array<{
      id: string;
      sredstvoId: string;
      seq: number;
      nabavnaVrednost: string;
      odpisanaVrednost: string;
      neamortizljiviDelPct: string;
      datumAktivacije: string | null;
      datumIzpisa: string | null;
      status: string;
    }> = [];

    if (sredstvoIds.length > 0) {
      doknjizbeRows = await db
        .select({
          id: osDoknjizbeTable.id,
          sredstvoId: osDoknjizbeTable.sredstvoId,
          seq: osDoknjizbeTable.seq,
          nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
          odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
          neamortizljiviDelPct: osDoknjizbeTable.neamortizljiviDelPct,
          datumAktivacije: osDoknjizbeTable.datumAktivacije,
          datumIzpisa: osDoknjizbeTable.datumIzpisa,
          status: osDoknjizbeTable.status,
        })
        .from(osDoknjizbeTable)
        .where(inArr(osDoknjizbeTable.sredstvoId, sredstvoIds));
    }

    // Grupiraj doknjizbe po sredstvoId
    const doknjizbeByGlava = new Map<string, DoknjizbaInput[]>();
    for (const d of doknjizbeRows) {
      const list = doknjizbeByGlava.get(d.sredstvoId) ?? [];
      list.push({
        id: d.id,
        seq: d.seq,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        neamortizljiviDelPct: d.neamortizljiviDelPct,
        datumAktivacije: d.datumAktivacije,
        datumIzpisa: d.datumIzpisa,
        status: d.status,
      });
      doknjizbeByGlava.set(d.sredstvoId, list);
    }

    // 4) Konti in STM (lookup maps)
    const accountIds = [
      ...new Set(glaveRows.map((g) => g.accountId).filter(Boolean) as string[]),
    ];
    const ccIds = [
      ...new Set(glaveRows.map((g) => g.costCenterId).filter(Boolean) as string[]),
    ];

    const accountsMap = new Map<string, { code: string; name: string }>();
    if (accountIds.length > 0) {
      const accRows = await db
        .select({ id: accountsTable.id, code: accountsTable.code, name: accountsTable.name })
        .from(accountsTable)
        .where(inArr(accountsTable.id, accountIds));
      for (const a of accRows) accountsMap.set(a.id, { code: a.code, name: a.name });
    }

    const ccMap = new Map<string, { code: string; name: string }>();
    if (ccIds.length > 0) {
      const ccRows = await db
        .select({ id: costCentersTable.id, code: costCentersTable.code, name: costCentersTable.name })
        .from(costCentersTable)
        .where(inArr(costCentersTable.id, ccIds));
      for (const c of ccRows) ccMap.set(c.id, { code: c.code, name: c.name });
    }

    // 5) Shranjeni obračun + nastavitve (vzporedno)
    const [[savedObracun], [nastavitveRow]] = await Promise.all([
      db
        .select({
          id: osAmortizacijaObracunTable.id,
          doMeseca: osAmortizacijaObracunTable.doMeseca,
          praviloZacetkaAmortizacije: osAmortizacijaObracunTable.praviloZacetkaAmortizacije,
          vhodniPodpis: osAmortizacijaObracunTable.vhodniPodpis,
        })
        .from(osAmortizacijaObracunTable)
        .where(
          and(
            eq(osAmortizacijaObracunTable.companyId, companyId),
            eq(osAmortizacijaObracunTable.leto, leto),
          ),
        )
        .limit(1),
      db
        .select({ praviloZacetkaAmortizacije: osAmortizacijaNastavitveTable.praviloZacetkaAmortizacije })
        .from(osAmortizacijaNastavitveTable)
        .where(eq(osAmortizacijaNastavitveTable.companyId, companyId))
        .limit(1),
    ]);

    const doMeseca: number | undefined = savedObracun?.doMeseca ?? undefined;
    const pravilo: PraviloZacetkaAmortizacije =
      (nastavitveRow?.praviloZacetkaAmortizacije as PraviloZacetkaAmortizacije) ?? "naslednji_dan";

    // 6) Oslabitev preteklega leta (N-1) za izračun osnove tega leta
    //    — naloži samo ko obstaja shranjeni obračun za (leto-1)
    const oslabitevPrevLetoMap = new Map<string, string>();
    const oslabitevPrevLetoMetodaMap = new Map<string, number>();
    const oslabitevNovaLetnaAmMap = new Map<string, string>();
    if (sredstvoIds.length > 0) {
      const [prevObracunRow] = await db
        .select({ id: osAmortizacijaObracunTable.id })
        .from(osAmortizacijaObracunTable)
        .where(
          and(
            eq(osAmortizacijaObracunTable.companyId, companyId),
            eq(osAmortizacijaObracunTable.leto, leto - 1),
          ),
        )
        .limit(1);

      if (prevObracunRow) {
        const prevVrstice = await db
          .select({
            sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
            oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
            oslabitevMetoda: osAmortizacijaObracunSredstvoTable.oslabitevMetoda,
          })
          .from(osAmortizacijaObracunSredstvoTable)
          .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, prevObracunRow.id));
        for (const v of prevVrstice) {
          if (parseFloat(v.oslabitev) > 0) {
            oslabitevPrevLetoMap.set(v.sredstvoId, v.oslabitev);
            oslabitevPrevLetoMetodaMap.set(v.sredstvoId, v.oslabitevMetoda ?? 1);
          }
        }
      }

      // Nova letna AM: iz NAJNOVEJŠEGA leta z oslabitev_nova_letna_am_rac > 0 (katerokoli leto < leto)
      const novaLetnaRows = await db
        .select({
          sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
          oslabitevNovaLetnaAmRac: osAmortizacijaObracunSredstvoTable.oslabitevNovaLetnaAmRac,
        })
        .from(osAmortizacijaObracunSredstvoTable)
        .innerJoin(
          osAmortizacijaObracunTable,
          eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
        )
        .where(
          and(
            eq(osAmortizacijaObracunTable.companyId, companyId),
            lt(osAmortizacijaObracunTable.leto, leto),
          ),
        )
        .orderBy(desc(osAmortizacijaObracunTable.leto));
      // Najnovejše po sredstvo (vrstice so že sortirane DESC po letu)
      for (const row of novaLetnaRows) {
        if (!oslabitevNovaLetnaAmMap.has(row.sredstvoId) && row.oslabitevNovaLetnaAmRac) {
          const val = parseFloat(row.oslabitevNovaLetnaAmRac);
          if (val > 0) oslabitevNovaLetnaAmMap.set(row.sredstvoId, row.oslabitevNovaLetnaAmRac);
        }
      }
    }

    // ─── Sestavi SredstvoInput[] ──────────────────────────────────────────

    const sredstvaInput: SredstvoInput[] = glaveRows.map((g) => {
      const skupina = g.skupinaId ? skupineMap.get(g.skupinaId) : undefined;
      const acc = g.accountId ? accountsMap.get(g.accountId) : undefined;
      const cc = g.costCenterId ? ccMap.get(g.costCenterId) : undefined;
      const doknjizbe = (doknjizbeByGlava.get(g.id) ?? []).sort((a, b) => a.seq - b.seq);

      return {
        id: g.id,
        inventarnaSt: g.inventarnaSt,
        naziv: g.naziv,
        skupinaId: g.skupinaId ?? null,
        skupinaNaziv: skupina?.naziv ?? null,
        skupinaKoda: skupina?.koda ?? null,
        racunovodskaStonja: skupina?.racunovodskaStonja ?? null,
        davcnaStonja: skupina?.davcnaStonja ?? null,
        accountId: g.accountId ?? null,
        accountCode: acc?.code ?? null,
        accountName: acc?.name ?? null,
        costCenterId: g.costCenterId ?? null,
        costCenterCode: cc?.code ?? null,
        costCenterName: cc?.name ?? null,
        status: g.status,
        doknjizbe,
        datumOdtujitve: g.datumOdtujitve ?? null,
        oslabitevPrevLeto: oslabitevPrevLetoMap.get(g.id) ?? "0.00",
        oslabitevPrevLetoMetoda: oslabitevPrevLetoMetodaMap.get(g.id) ?? 1,
        oslabitevNovaLetnaAmRac: oslabitevNovaLetnaAmMap.get(g.id),
      };
    });

    // ─── Izračun (čista funkcija, brez DB) ───────────────────────────────
    const result = calcAmortizacijaObracun(sredstvaInput, leto, doMeseca, pravilo);

    if (!savedObracun) {
      // Ni shranjenega obračuna → predogled (celoletni živi izračun, brez zastarelosti)
      res.json({ ...result, doMeseca: null, predogled: true, zastarel: false, zastarelRazlog: null });
      return;
    }

    // ─── Shranjeni zneski po sredstvih (enaki kot izpis PDF/CSV) ──────────────
    const savedVrstice = await db
      .select({
        sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
        obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
        oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
        oslabitevMetoda: osAmortizacijaObracunSredstvoTable.oslabitevMetoda,
        oslabitevNovaLetnaAmRac: osAmortizacijaObracunSredstvoTable.oslabitevNovaLetnaAmRac,
      })
      .from(osAmortizacijaObracunSredstvoTable)
      .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, savedObracun.id));

    const storedMap = new Map(savedVrstice.map((v) => [v.sredstvoId, v.obracunano]));
    const storedOslabitevMap = new Map(savedVrstice.map((v) => [v.sredstvoId, v.oslabitev]));
    const storedMetodaMap = new Map(savedVrstice.map((v) => [v.sredstvoId, v.oslabitevMetoda ?? 1]));
    const storedNovaLetnaAmMap = new Map(savedVrstice.map((v) => [v.sredstvoId, v.oslabitevNovaLetnaAmRac ?? null]));

    // ─── Zastarelost: primerjaj shranjeno pravilo + podpis z aktualnim ────────
    const zastarelRazlogi: string[] = [];

    if (savedObracun.praviloZacetkaAmortizacije !== null) {
      if (savedObracun.praviloZacetkaAmortizacije !== pravilo) {
        zastarelRazlogi.push(
          `Pravilo začetka amortizacije se je spremenilo iz "${savedObracun.praviloZacetkaAmortizacije}" v "${pravilo}"`,
        );
      }
      if (savedObracun.vhodniPodpis !== null) {
        const trenutniPodpis = computeVhodniPodpis(pravilo, doknjizbeRows);
        if (savedObracun.vhodniPodpis !== trenutniPodpis) {
          zastarelRazlogi.push(
            "Podatki sredstev ali doknjižb so bili posodobljeni po zadnjem obračunu",
          );
        }
      }
    }

    const zastarel = zastarelRazlogi.length > 0;
    const zastarelRazlog = zastarel ? zastarelRazlogi.join("; ") : null;

    // ─── Prepiši skupnaObracunanaRacunovodska s shranjenimi vrednostmi ─────────
    const sredstvaStoreno = result.sredstva.map((s) => ({
      ...s,
      skupnaObracunanaRacunovodska: storedMap.get(s.id) ?? "0.00",
      /**
       * savedOslabitev = oslabitev vnesena na ZAKLJUCEN obracun TEGA leta.
       * Vpliva na osnovo amortizacije naslednjega leta.
       * "0.00" = ni oslabitve za to leto.
       */
      savedOslabitev: storedOslabitevMap.get(s.id) ?? "0.00",
      savedMetodaOslabitve: storedMetodaMap.get(s.id) ?? 1,
      savedNovaLetnaAmRac: storedNovaLetnaAmMap.get(s.id) ?? null,
    }));

    const skupajRacunovodskaStoreno = sredstvaStoreno
      .reduce((sum, s) => sum + parseFloat(s.skupnaObracunanaRacunovodska || "0"), 0)
      .toFixed(2);

    res.json({
      ...result,
      sredstva: sredstvaStoreno,
      skupajRacunovodska: skupajRacunovodskaStoreno,
      doMeseca: doMeseca ?? null,
      predogled: false,
      zastarel,
      zastarelRazlog,
    });
  },
);

export default router;
