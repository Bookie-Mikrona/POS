/**
 * osnovnaSredstva.ts — Register osnovnih sredstev (Faza 3a–3b, Možnost A)
 *
 * Hierarhija: GLAVA (osnovna_sredstva) + PODZAPISI (os_doknjizbe)
 *
 * Rute — amortizacijske skupine (nespremenjene):
 *   GET    /companies/:companyId/os-amortizacijske-skupine
 *   POST   /companies/:companyId/os-amortizacijske-skupine
 *   PATCH  /companies/:companyId/os-amortizacijske-skupine/:id
 *
 * Rute — osnovna sredstva (glava):
 *   GET    /companies/:companyId/osnovna-sredstva
 *     → seznam glav s seštevki iz doknjižb
 *   POST   /companies/:companyId/osnovna-sredstva
 *     → ustvari glavo + samodejno doknjižbo seq=0 (osnovni nakup)
 *   GET    /companies/:companyId/osnovna-sredstva/:id
 *     → kartica: glava + vse doknjižbe + skupni seštevki
 *   PATCH  /companies/:companyId/osnovna-sredstva/:id
 *     → uredi skupne atribute glave (naziv, skupina, konti, STM, status, opomba)
 *   DELETE /companies/:companyId/osnovna-sredstva/:id
 *     → soft delete: status → izloceno (glava + vse doknjižbe)
 *
 * Rute — doknjižbe (podzapisi):
 *   POST   /companies/:companyId/osnovna-sredstva/:id/doknjizbe
 *     → dodaj dograditev (naslednji seq, lastna vrednost/datum; skupino/konte podeduje iz glave)
 *   PATCH  /companies/:companyId/osnovna-sredstva/:id/doknjizbe/:doknjizbaId
 *     → uredi posamezno doknjižbo (vrednost, datum, status, opomba)
 *   DELETE /companies/:companyId/osnovna-sredstva/:id/doknjizbe/:doknjizbaId
 *     → soft delete doknjižbe (status → izloceno)
 *
 * OPOMBA: Ta modul NE vsebuje amortizacijskega obračuna niti knjižb v GK (3c–3f).
 */

import { Router, type Request, type Response, type IRouter } from "express";
import { eq, and, asc, or, inArray, sql, desc, ne, isNull } from "drizzle-orm";
import { z } from "zod/v4";
import {
  db,
  osAmortizacijskeSkupineTable,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osRolesTable,
  companyModulesTable,
  osAmortizacijaObracunTable,
  osAmortizacijaObracunSredstvoTable,
  companiesTable,
  accountsTable,
  costCentersTable,
  counterpartiesTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";
import { assertCostCenterInCompany, assertAccountInCompany } from "../lib/assertSameCompany";
import {
  formatObracunPeriod,
  resolveStatusSredstvo,
  buildObracunPeriodMap,
  maxObracunPeriod,
} from "./osHelpers";
import {
  calcMedletniSredstvo,
  calcMedletniSeštevki,
  emptyMedletniSeštevki,
  lastDayOfMonthIso,
  type RegisterSredstvoInput,
  type RegisterDoknjizbaInput,
  type EnrichedMedletniVrstica,
} from "./osRegisterMedletni";
import { calcKarticaVrednosti } from "./osKarticaVrednosti";
import { loadObracunaniOdpisi } from "./osStatusOdpisi";
import { calcKronoloskiPregled } from "./osKronoloskiPregled";
import { generateKarticaPdf, generateOsRegisterPdf } from "../lib/report-pdf";
import ExcelJS from "exceljs";
// Re-eksport za teste in zunanje importe (backward compat)
export { formatObracunPeriod, resolveStatusSredstvo, buildObracunPeriodMap } from "./osHelpers";

const router: IRouter = Router();

function ep(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

/** Preveri dostop do modula Osnovna sredstva prek os_roles (neodvisno od ERP). */
async function resolveOsAccess(
  clerkUserId: string,
  companyId: string,
  res: Response,
): Promise<{ role: "os_admin" | "os_user" | "os_viewer" } | null> {
  // Superadmin ima vedno polni dostop
  if (isSuperAdmin(clerkUserId)) {
    return { role: "os_admin" };
  }

  // Preveri da je modul osnovna_sredstva vklopljen za to podjetje
  const [moduleRow] = await db
    .select({ module: companyModulesTable.module })
    .from(companyModulesTable)
    .where(
      and(
        eq(companyModulesTable.companyId, companyId),
        eq(companyModulesTable.module, "osnovna_sredstva"),
      ),
    )
    .limit(1);

  if (!moduleRow) {
    res.status(403).json({ error: "Modul Osnovna sredstva ni aktiviran za to podjetje" });
    return null;
  }

  // Preveri os_roles
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
    return null;
  }

  return { role: row.role };
}

/** Branje zahteva katero koli OS vlogo. */
export function canReadOs(role: string | null): boolean {
  return role === "os_admin" || role === "os_user" || role === "os_viewer";
}

/** Pisanje zahteva os_admin ali os_user. */
export function canWriteOs(role: string | null): boolean {
  return role === "os_admin" || role === "os_user";
}

// ─── Pomožne funkcije (exportirane za testiranje) ────────────────────────────

export function sedanjaVrednostSum(
  doknjizbe: Array<{ nabavnaVrednost: string; odpisanaVrednost: string }>,
): number {
  const nabavna = doknjizbe.reduce((s, d) => s + parseFloat(d.nabavnaVrednost), 0);
  const odpisana = doknjizbe.reduce((s, d) => s + parseFloat(d.odpisanaVrednost), 0);
  return nabavna - odpisana;
}

export function skupnaNabavna(
  doknjizbe: Array<{ nabavnaVrednost: string }>,
): number {
  return doknjizbe.reduce((s, d) => s + parseFloat(d.nabavnaVrednost), 0);
}

export function resolveNextSeq(
  existing: Array<{ seq: number }>,
): number {
  if (existing.length === 0) return 0;
  return Math.max(...existing.map((d) => d.seq)) + 1;
}

export function resolveStatusDoknjizba(
  explicitStatus: string | undefined,
  datumAktivacije: string | null | undefined,
): string {
  if (explicitStatus) return explicitStatus;
  if (datumAktivacije) return "v_uporabi";
  return "v_teku";
}

export function validateNeamortizljiviPct(pct: number): string | null {
  if (isNaN(pct) || pct < 0 || pct > 100) {
    return "Neamortizljivi del mora biti med 0 in 100";
  }
  return null;
}

// formatObracunPeriod, resolveStatusSredstvo, buildObracunPeriodMap so v osHelpers.ts (re-exportirani zgoraj)

export function resolveDAvcna(
  davcna: string | undefined,
  racunovodska: string,
): string {
  return davcna ?? racunovodska;
}

// ─── Zod sheme ──────────────────────────────────────────────────────────────

const OS_STATUSI = ["v_teku", "v_uporabi", "odpisano", "izloceno"] as const;

const CreateSkupinaBody = z.object({
  koda: z.string().min(1).max(20),
  naziv: z.string().min(1).max(200),
  racunovodskaStonja: z.string().regex(/^\d{1,3}(\.\d{1,3})?$/, "Neveljavna stopnja"),
  davcnaStonja: z.string().optional(),
  aktivno: z.boolean().optional().default(true),
  opomba: z.string().optional().nullable(),
});

const UpdateSkupinaBody = z.object({
  naziv: z.string().min(1).max(200).optional(),
  racunovodskaStonja: z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).optional(),
  davcnaStonja: z.string().regex(/^\d{1,3}(\.\d{1,3})?$/).optional(),
  aktivno: z.boolean().optional(),
  opomba: z.string().optional().nullable(),
});

/** Skupna dobavitelj/račun polja — deklaracija pred vsemi Zod shemami, ki jo potrebujejo. */
const DoknjizbaRacunFieldsDef = {
  /** FK na counterparties — dobavitelj tega nakupa. */
  partnerId: z.string().uuid().optional().nullable(),
  /** Številka prejetega računa. */
  stRacuna: z.string().max(100).optional().nullable(),
  /** Datum prejetega računa (YYYY-MM-DD). */
  datumRacuna: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
};

/** Polja za novo GLAVO + obvezna seq=0 doknjižba (osnovni nakup). */
const CreateOsBody = z.object({
  // Glava
  inventarnaSt: z.string().min(1).max(50),
  naziv: z.string().min(1).max(300),
  skupinaId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  kontoPopravkaId: z.string().uuid().optional().nullable(),
  kontoStroskaId: z.string().uuid().optional().nullable(),
  status: z.enum(OS_STATUSI).optional(),
  opomba: z.string().optional().nullable(),
  // seq=0 doknjižba (osnovni nakup)
  nabavnaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/),
  odpisanaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0"),
  neamortizljiviDelPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0"),
  datumNabave: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  datumAktivacije: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  datumIzpisa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  // seq=0 nabavni dokument
  ...DoknjizbaRacunFieldsDef,
});

/** Uredi SAMO skupne atribute glave (vrednostna polja so na doknjižbah). */
const UpdateOsBody = z.object({
  inventarnaSt: z.string().min(1).max(50).optional(),
  naziv: z.string().min(1).max(300).optional(),
  skupinaId: z.string().uuid().optional().nullable(),
  costCenterId: z.string().uuid().optional().nullable(),
  accountId: z.string().uuid().optional().nullable(),
  kontoPopravkaId: z.string().uuid().optional().nullable(),
  kontoStroskaId: z.string().uuid().optional().nullable(),
  status: z.enum(OS_STATUSI).optional(),
  opomba: z.string().optional().nullable(),
  /**
   * Datum prodaje / odtujitve celotnega sredstva (YYYY-MM-DD).
   * Ko je nastavljeno, engine preneha obračunavati AM s prvim dnem tega meseca.
   * Pošlji null za brisanje (povrnitev v normalno stanje).
   */
  datumOdtujitve: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  /** Besedilni razlog izločitve (prodaja/odpis/uničenje/…). */
  razlogIzlocitve: z.string().max(500).optional().nullable(),
});

/** Nova dograditev (seq≥1). Skupino in konte podeduje iz glave. */
const CreateDoknjizbaBody = z.object({
  nazivVlaganja: z.string().max(300).optional().nullable(),
  nabavnaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/),
  odpisanaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0"),
  neamortizljiviDelPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional().default("0"),
  datumNabave: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  datumAktivacije: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  datumIzpisa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(OS_STATUSI).optional(),
  ...DoknjizbaRacunFieldsDef,
});

const UpdateDoknjizbaBody = z.object({
  nazivVlaganja: z.string().max(300).optional().nullable(),
  nabavnaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  odpisanaVrednost: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  neamortizljiviDelPct: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
  datumNabave: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  datumAktivacije: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  datumIzpisa: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(OS_STATUSI).optional(),
  ...DoknjizbaRacunFieldsDef,
});

// ─── Amortizacijske skupine ──────────────────────────────────────────────────

router.get(
  "/companies/:companyId/os-amortizacijske-skupine",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const includeInactive = req.query.includeInactive === "true";
    const conditions = [eq(osAmortizacijskeSkupineTable.companyId, companyId)];
    if (!includeInactive)
      conditions.push(eq(osAmortizacijskeSkupineTable.aktivno, true));

    const rows = await db
      .select()
      .from(osAmortizacijskeSkupineTable)
      .where(and(...conditions))
      .orderBy(asc(osAmortizacijskeSkupineTable.koda));

    res.json({ amortizacijskeSkupine: rows });
  },
);

router.post(
  "/companies/:companyId/os-amortizacijske-skupine",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za ustvarjanje amortizacijskih skupin potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const parsed = CreateSkupinaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: osAmortizacijskeSkupineTable.id })
      .from(osAmortizacijskeSkupineTable)
      .where(
        and(
          eq(osAmortizacijskeSkupineTable.companyId, companyId),
          eq(osAmortizacijskeSkupineTable.koda, parsed.data.koda),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(409).json({ error: `Amortizacijska skupina s kodo "${parsed.data.koda}" že obstaja` });
      return;
    }

    const davcna = resolveDAvcna(parsed.data.davcnaStonja, parsed.data.racunovodskaStonja);

    const [row] = await db
      .insert(osAmortizacijskeSkupineTable)
      .values({
        companyId,
        koda: parsed.data.koda,
        naziv: parsed.data.naziv,
        racunovodskaStonja: parsed.data.racunovodskaStonja,
        davcnaStonja: davcna,
        aktivno: parsed.data.aktivno ?? true,
        opomba: parsed.data.opomba ?? null,
      })
      .returning();

    res.status(201).json(row);
  },
);

router.patch(
  "/companies/:companyId/os-amortizacijske-skupine/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za urejanje amortizacijskih skupin potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const parsed = UpdateSkupinaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: osAmortizacijskeSkupineTable.id })
      .from(osAmortizacijskeSkupineTable)
      .where(
        and(
          eq(osAmortizacijskeSkupineTable.id, id),
          eq(osAmortizacijskeSkupineTable.companyId, companyId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Amortizacijska skupina ni najdena" });
      return;
    }

    const upd: Record<string, unknown> = {};
    if (parsed.data.naziv !== undefined) upd.naziv = parsed.data.naziv;
    if (parsed.data.racunovodskaStonja !== undefined) upd.racunovodskaStonja = parsed.data.racunovodskaStonja;
    if (parsed.data.davcnaStonja !== undefined) upd.davcnaStonja = parsed.data.davcnaStonja;
    if (parsed.data.aktivno !== undefined) upd.aktivno = parsed.data.aktivno;
    if ("opomba" in parsed.data) upd.opomba = parsed.data.opomba ?? null;

    if (Object.keys(upd).length === 0) {
      const [cur] = await db.select().from(osAmortizacijskeSkupineTable).where(eq(osAmortizacijskeSkupineTable.id, id)).limit(1);
      res.json(cur);
      return;
    }

    const [updated] = await db
      .update(osAmortizacijskeSkupineTable)
      .set(upd)
      .where(and(eq(osAmortizacijskeSkupineTable.id, id), eq(osAmortizacijskeSkupineTable.companyId, companyId)))
      .returning();

    res.json(updated);
  },
);

// ─── Register osnovnih sredstev — SEZNAM ────────────────────────────────────

router.get(
  "/companies/:companyId/osnovna-sredstva",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const {
      skupinaId,
      costCenterId,
      accountId,
      status,
      q,
      includeIzloceno,
    } = req.query as Record<string, string | undefined>;

    const conditions = [eq(osnovnaSredstvaTable.companyId, companyId)];

    if (skupinaId) conditions.push(eq(osnovnaSredstvaTable.skupinaId, skupinaId));
    if (costCenterId) conditions.push(eq(osnovnaSredstvaTable.costCenterId, costCenterId));
    if (accountId) conditions.push(eq(osnovnaSredstvaTable.accountId, accountId));
    // Izloceno se vedno izključi na DB ravni (razen če status="izloceno" ali includeIzloceno=true).
    // Specifični status filter (v_teku/v_uporabi/odpisano) se aplicira POST-agregacijsko na
    // enriched array, kjer je status že izračunan iz vseh doknjižb (resolveStatusSredstvo).
    // S tem filter ?status=v_uporabi pravilno najde tudi sredstva z DB "odpisano" ki so
    // dejansko "v_uporabi" (neodpisane dograditve).
    //
    // POZOR: ne uporabimo whitelist (IN 'v_teku','v_uporabi','odpisano') ker bi skrili sredstva
    // s pokvarjenim/NULL DB poljem — namesto tega izključimo samo "izloceno" eksplicitno.
    // SQL: NOT status = 'izloceno' ne vrne NULL vrstic → dodamo OR IS NULL.
    if (includeIzloceno !== "true" && status !== "izloceno") {
      conditions.push(
        or(
          ne(osnovnaSredstvaTable.status, "izloceno"),
          isNull(osnovnaSredstvaTable.status),
        )!,
      );
    }

    let glave = await db
      .select()
      .from(osnovnaSredstvaTable)
      .where(and(...conditions))
      .orderBy(asc(osnovnaSredstvaTable.inventarnaSt));

    // Iskanje po nazivu / inventarni
    if (q && q.trim()) {
      const lower = q.trim().toLowerCase();
      glave = glave.filter(
        (r) =>
          r.naziv.toLowerCase().includes(lower) ||
          r.inventarnaSt.toLowerCase().includes(lower),
      );
    }

    if (glave.length === 0) {
      res.json({ osnovnaSredstva: [] });
      return;
    }

    // Pridobi vse doknjižbe za vse glave v enem klicu
    const srIds = glave.map((g) => g.id);
    const allDoknjizbe = await db
      .select({
        sredstvoId: osDoknjizbeTable.sredstvoId,
        nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
        odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
        seq: osDoknjizbeTable.seq,
        // potrebujemo za izračun status na ravni sredstva
        datumAktivacije: osDoknjizbeTable.datumAktivacije,
      })
      .from(osDoknjizbeTable)
      .where(inArray(osDoknjizbeTable.sredstvoId, srIds));

    // Pridobi zadnji obračun na sredstvo (en klic za vsa sredstva)
    const allObracunRows = await db
      .select({
        sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
        leto: osAmortizacijaObracunTable.leto,
        doMeseca: osAmortizacijaObracunTable.doMeseca,
      })
      .from(osAmortizacijaObracunSredstvoTable)
      .innerJoin(
        osAmortizacijaObracunTable,
        eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
      )
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          inArray(osAmortizacijaObracunSredstvoTable.sredstvoId, srIds),
        ),
      );

    // Agregat: zadnji obračun na sredstvo (per-sredstvo, neodvisno od globalnega)
    const obracunPeriodMap = buildObracunPeriodMap(allObracunRows);

    // Globalni zadnji obračun podjetja (MM/YYYY)
    const [zadnjiObracunRow] = await db
      .select({ leto: osAmortizacijaObracunTable.leto, doMeseca: osAmortizacijaObracunTable.doMeseca })
      .from(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))
      .orderBy(desc(osAmortizacijaObracunTable.leto), desc(osAmortizacijaObracunTable.doMeseca))
      .limit(1);

    const zadnjiObracun = zadnjiObracunRow
      ? formatObracunPeriod(zadnjiObracunRow.leto, zadnjiObracunRow.doMeseca)
      : null;

    // Seštej po sredstvo_id; stevilo šteje SAMO dograditve (seq>0), osnova (seq=0) se ne šteje.
    // hasAktivirana = true, če ima vsaj ena doknjižba datumAktivacije (ni "v_teku") — za status izračun.
    type Totals = { nabavna: number; odpisana: number; stevilo: number; hasAktivirana: boolean };
    const totalsMap = new Map<string, Totals>();
    for (const d of allDoknjizbe) {
      const cur = totalsMap.get(d.sredstvoId) ?? { nabavna: 0, odpisana: 0, stevilo: 0, hasAktivirana: false };
      cur.nabavna += parseFloat(d.nabavnaVrednost);
      cur.odpisana += parseFloat(d.odpisanaVrednost);
      if (d.seq > 0) cur.stevilo += 1; // dograditve (seq≥1), ne osnova (seq=0)
      if (d.datumAktivacije) cur.hasAktivirana = true; // vsaj ena aktivirana
      totalsMap.set(d.sredstvoId, cur);
    }

    const odpisi = await loadObracunaniOdpisi(companyId, srIds);
    const enriched = glave.map((g) => {
      const t = totalsMap.get(g.id) ?? { nabavna: 0, odpisana: 0, stevilo: 0, hasAktivirana: false };
      // Status se izračuna iz vseh doknjižb (ne le shranjeno polje glave).
      // Pravilo: "v_uporabi" če katerakoli doknjižba ima sedanjaVrednost > 0;
      //          "odpisano" šele ko so vse polno odpisane.
      const computedStatus = resolveStatusSredstvo(g.status, {
        ...t, obracunaniOdpisi: odpisi.get(g.id) ?? 0,
      }, g.datumOdtujitve ?? undefined);
      return {
        ...g,
        status: computedStatus,
        skupnaNabavna: t.nabavna.toFixed(2),
        skupnaOdpisana: t.odpisana.toFixed(2),
        sedanjaVrednost: (t.nabavna - t.odpisana).toFixed(2),
        steviloDoknjizb: t.stevilo,
        obracunPeriod: obracunPeriodMap.get(g.id) ?? null,
      };
    });

    // Post-agregacijski filter po computed statusu (ne DB vrednosti glave).
    // Zagotavlja, da ?status=v_uporabi najde tudi sredstva, ki imajo v DB "odpisano"
    // a je dejanski computed status "v_uporabi" (neodpisane dograditve).
    const finalResults = status && OS_STATUSI.includes(status as (typeof OS_STATUSI)[number])
      ? enriched.filter((os) => os.status === status)
      : enriched;

    res.json({ osnovnaSredstva: finalResults, zadnjiObracun });
  },
);

// ─── Register osnovnih sredstev — KARTICA ───────────────────────────────────

router.get(
  "/companies/:companyId/osnovna-sredstva/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const [glava] = await db
      .select()
      .from(osnovnaSredstvaTable)
      .where(
        and(
          eq(osnovnaSredstvaTable.id, id),
          eq(osnovnaSredstvaTable.companyId, companyId),
        ),
      )
      .limit(1);

    if (!glava) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }

    const doknjizbeRaw = await db
      .select()
      .from(osDoknjizbeTable)
      .where(eq(osDoknjizbeTable.sredstvoId, id))
      .orderBy(asc(osDoknjizbeTable.seq));

    // Batch-fetch partnerjev za doknjizbe, ki imajo partnerId
    const partnerIds = [...new Set(doknjizbeRaw.map((d) => d.partnerId).filter(Boolean) as string[])];
    const partnerMap = new Map<string, { name: string; taxId: string | null }>();
    if (partnerIds.length > 0) {
      const partners = await db
        .select({ id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId })
        .from(counterpartiesTable)
        .where(inArray(counterpartiesTable.id, partnerIds));
      for (const p of partners) partnerMap.set(p.id, { name: p.name, taxId: p.taxId });
    }
    const doknjizbe = doknjizbeRaw.map((d) => ({
      ...d,
      partnerNaziv: d.partnerId ? (partnerMap.get(d.partnerId)?.name ?? null) : null,
      partnerTaxId: d.partnerId ? (partnerMap.get(d.partnerId)?.taxId ?? null) : null,
    }));

    const nabavna = doknjizbe.reduce((s, d) => s + parseFloat(d.nabavnaVrednost), 0);
    const odpisana = doknjizbe.reduce((s, d) => s + parseFloat(d.odpisanaVrednost), 0);
    // Agregirani status — isto pravilo kot register (resolveStatusSredstvo):
    // "v_uporabi" dokler ima katerakoli doknjižba sedanjaVrednost > 0.
    const hasAktivirana = doknjizbe.some((d) => !!d.datumAktivacije);

    // Amortizirljiva baza za vsako doknjižbo (pred obogatitvijo — potrebujemo za calcKarticaVrednosti)
    const doknjizbeZBazo = doknjizbe.map((d) => ({
      ...d,
      sedanjaVrednost: (parseFloat(d.nabavnaVrednost) - parseFloat(d.odpisanaVrednost)).toFixed(2),
      amortizirljivaBaza: (
        parseFloat(d.nabavnaVrednost) *
        ((100 - parseFloat(d.neamortizljiviDelPct)) / 100)
      ).toFixed(2),
    }));

    // Amortizacijska zgodovina — iz os_amortizacija_obracun_sredstvo JOIN os_amortizacija_obracun
    const amortVrstice = await db
      .select({
        leto: osAmortizacijaObracunTable.leto,
        doMeseca: osAmortizacijaObracunTable.doMeseca,
        status: osAmortizacijaObracunTable.status,
        obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
        oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
        oslabitevMetoda: osAmortizacijaObracunSredstvoTable.oslabitevMetoda,
        oslabitevNovaLetnaAmRac: osAmortizacijaObracunSredstvoTable.oslabitevNovaLetnaAmRac,
        oslabitevNovaDobeLet: osAmortizacijaObracunSredstvoTable.oslabitevNovaDobeLet,
      })
      .from(osAmortizacijaObracunSredstvoTable)
      .innerJoin(
        osAmortizacijaObracunTable,
        eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
      )
      .where(
        and(
          eq(osAmortizacijaObracunSredstvoTable.sredstvoId, id),
          eq(osAmortizacijaObracunTable.companyId, companyId),
        ),
      )
      .orderBy(asc(osAmortizacijaObracunTable.leto));

    const amortizacijskaZgodovina = amortVrstice.map((v) => ({
      leto: v.leto,
      doMeseca: v.doMeseca,
      obracunano: v.obracunano,
      oslabitev: v.oslabitev,
      oslabitevMetoda: v.oslabitevMetoda ?? 1,
      oslabitevNovaLetnaAmRac: v.oslabitevNovaLetnaAmRac ?? null,
      oslabitevNovaDobeLet: v.oslabitevNovaDobeLet ?? null,
      status: v.status,
    }));

    // Kronološki pregled gibanja vrednosti — čista funkcija
    const kronoloskiPregled = calcKronoloskiPregled(
      doknjizbe.map((d) => ({
        seq: d.seq,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        datumNabave: d.datumNabave,
        datumAktivacije: d.datumAktivacije,
        status: d.status,
        nazivVlaganja: d.nazivVlaganja,
      })),
      amortizacijskaZgodovina,
      glava.datumOdtujitve ?? undefined,
      glava.razlogIzlocitve ?? undefined,
    );

    // Skupna amortizacija iz VSEH shranjenih obračunov
    const skupnaAmortizacijaObracunana = amortVrstice.reduce(
      (s, v) => s + parseFloat(v.obracunano),
      0,
    );
    const computedStatus = resolveStatusSredstvo(glava.status, {
      nabavna, odpisana, hasAktivirana,
      obracunaniOdpisi: amortVrstice.reduce((sum, v) => sum + Number(v.obracunano) + Number(v.oslabitev), 0),
    }, glava.datumOdtujitve);

    // Vrednosti pred/po obračunu — čista funkcija
    const karticaVrednosti = calcKarticaVrednosti(
      nabavna,
      odpisana,
      skupnaAmortizacijaObracunana,
      doknjizbeZBazo.map((d) => ({
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        amortizirljivaBaza: d.amortizirljivaBaza,
        jeIzlocena: d.status === "izloceno",
      })),
    );

    // Obogati doknjizbe s sedanjaVrednostPoObracunu (iz per-doc razčlenitve)
    const enrichedDoknjizbe = doknjizbeZBazo.map((d, i) => ({
      ...d,
      sedanjaVrednostPoObracunu: karticaVrednosti.perDoknjizba[i]?.sedanjaVrednostPoObracunu ?? d.sedanjaVrednost,
    }));

    // steviloDoknjizb in obracunPeriod — enako kot seznam endpoint, za doslednost
    const steviloDoknjizb = doknjizbe.filter((d) => d.seq > 0).length;
    const obracunPeriod = maxObracunPeriod(amortVrstice);

    res.json({
      ...glava,
      status: computedStatus,   // agregirani status iz vseh doknjižb (= register)
      steviloDoknjizb,           // count(seq>0) — enako kot "#" v registru
      obracunPeriod,             // MAX(leto*100+doMeseca) — enako kot "Obračun OS" v registru
      doknjizbe: enrichedDoknjizbe,
      skupnaNabavna: nabavna.toFixed(2),
      skupnaOdpisana: odpisana.toFixed(2),
      // Obstoječe polje — ohranjeno za nazaj-združljivost
      sedanjaVrednost: karticaVrednosti.sedanjaVrednostPredObracunom,
      // Nova polja
      sedanjaVrednostPredObracunom: karticaVrednosti.sedanjaVrednostPredObracunom,
      sedanjaVrednostPoObracunu: karticaVrednosti.sedanjaVrednostPoObracunu,
      skupnaAmortizacijaObracunana: karticaVrednosti.skupnaAmortizacijaObracunana,
      amortizacijskaZgodovina,
      kronoloskiPregled,
    });
  },
);

// ─── Kartica OS — PDF izpis ──────────────────────────────────────────────────

router.get(
  "/companies/:companyId/osnovna-sredstva/:id/kartica-pdf",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    // Glava sredstva
    const [glava] = await db.select().from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, id), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!glava) { res.status(404).json({ error: "Osnovno sredstvo ni najdeno" }); return; }

    // Doknjizbe + amortizacija + podjetje + skupina + konti — vzporedno
    const [doknjizbeRawPdf, amortVrstice, companyRow, skupinaRow, kontoOsRow, kontoPopravkaRow, kontoStroskaRow, costCenterRow] =
      await Promise.all([
        db.select().from(osDoknjizbeTable).where(eq(osDoknjizbeTable.sredstvoId, id)).orderBy(asc(osDoknjizbeTable.seq)),
        db.select({
          leto: osAmortizacijaObracunTable.leto,
          doMeseca: osAmortizacijaObracunTable.doMeseca,
          obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
          oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
          oslabitevMetoda: osAmortizacijaObracunSredstvoTable.oslabitevMetoda,
          oslabitevNovaLetnaAmRac: osAmortizacijaObracunSredstvoTable.oslabitevNovaLetnaAmRac,
          oslabitevNovaDobeLet: osAmortizacijaObracunSredstvoTable.oslabitevNovaDobeLet,
          status: osAmortizacijaObracunTable.status,
        })
          .from(osAmortizacijaObracunSredstvoTable)
          .innerJoin(osAmortizacijaObracunTable, eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id))
          .where(and(eq(osAmortizacijaObracunSredstvoTable.sredstvoId, id), eq(osAmortizacijaObracunTable.companyId, companyId)))
          .orderBy(asc(osAmortizacijaObracunTable.leto)),
        db.select({ naziv: companiesTable.naziv, podjetjeDavcna: companiesTable.podjetjeDavcna })
          .from(companiesTable).where(eq(companiesTable.id, companyId)).limit(1),
        glava.skupinaId
          ? db.select({ koda: osAmortizacijskeSkupineTable.koda, naziv: osAmortizacijskeSkupineTable.naziv, stopnja: osAmortizacijskeSkupineTable.racunovodskaStonja, davcnaStonja: osAmortizacijskeSkupineTable.davcnaStonja })
            .from(osAmortizacijskeSkupineTable).where(eq(osAmortizacijskeSkupineTable.id, glava.skupinaId)).limit(1)
          : Promise.resolve([] as Array<{ koda: string; naziv: string; stopnja: string; davcnaStonja: string }>),
        glava.accountId
          ? db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.id, glava.accountId)).limit(1)
          : Promise.resolve([] as Array<{ code: string }>),
        glava.kontoPopravkaId
          ? db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.id, glava.kontoPopravkaId)).limit(1)
          : Promise.resolve([] as Array<{ code: string }>),
        glava.kontoStroskaId
          ? db.select({ code: accountsTable.code }).from(accountsTable).where(eq(accountsTable.id, glava.kontoStroskaId)).limit(1)
          : Promise.resolve([] as Array<{ code: string }>),
        glava.costCenterId
          ? db.select({ code: costCentersTable.code, name: costCentersTable.name }).from(costCentersTable).where(eq(costCentersTable.id, glava.costCenterId)).limit(1)
          : Promise.resolve([] as Array<{ code: string; name: string }>),
      ]);

    // Batch-fetch partnerjev za PDF doknjizbe
    const pdfPartnerIds = [...new Set(doknjizbeRawPdf.map((d) => d.partnerId).filter(Boolean) as string[])];
    const pdfPartnerMap = new Map<string, { name: string; taxId: string | null }>();
    if (pdfPartnerIds.length > 0) {
      const partners = await db
        .select({ id: counterpartiesTable.id, name: counterpartiesTable.name, taxId: counterpartiesTable.taxId })
        .from(counterpartiesTable)
        .where(inArray(counterpartiesTable.id, pdfPartnerIds));
      for (const p of partners) pdfPartnerMap.set(p.id, { name: p.name, taxId: p.taxId });
    }
    const doknjizbe = doknjizbeRawPdf;

    const nabavna = doknjizbe.reduce((s, d) => s + parseFloat(d.nabavnaVrednost), 0);
    const odpisana = doknjizbe.reduce((s, d) => s + parseFloat(d.odpisanaVrednost), 0);
    const skupnaAmortizacijaObracunana = amortVrstice.reduce((s, v) => s + parseFloat(v.obracunano), 0);
    const karticaVrednosti = calcKarticaVrednosti(nabavna, odpisana, skupnaAmortizacijaObracunana,
      doknjizbe.map((d) => ({
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        amortizirljivaBaza: (parseFloat(d.nabavnaVrednost) * ((100 - parseFloat(d.neamortizljiviDelPct)) / 100)).toFixed(2),
        jeIzlocena: d.status === "izloceno",
      })),
    );
    const amortizacijskaZgodovina = amortVrstice.map((v) => ({ leto: v.leto, doMeseca: v.doMeseca, obracunano: v.obracunano, oslabitev: v.oslabitev, oslabitevMetoda: v.oslabitevMetoda ?? 1, oslabitevNovaLetnaAmRac: v.oslabitevNovaLetnaAmRac ?? null, oslabitevNovaDobeLet: v.oslabitevNovaDobeLet ?? null, status: v.status }));
    const kronoloskiPregled = calcKronoloskiPregled(
      doknjizbe.map((d) => ({ seq: d.seq, nabavnaVrednost: d.nabavnaVrednost, odpisanaVrednost: d.odpisanaVrednost, datumNabave: d.datumNabave, datumAktivacije: d.datumAktivacije, status: d.status, nazivVlaganja: d.nazivVlaganja })),
      amortizacijskaZgodovina,
      glava.datumOdtujitve ?? undefined,
      glava.razlogIzlocitve ?? undefined,
    );

    const seqZero = doknjizbe.find((d) => d.seq === 0);
    const obracunPeriod = maxObracunPeriod(amortVrstice);
    const datumIzpisa = new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\s/g, "");

    try {
      const pdfBuffer = await generateKarticaPdf({
        companyName: companyRow[0]?.naziv ?? companyId,
        companyDavcna: companyRow[0]?.podjetjeDavcna ?? "",
        datumIzpisa,
        inventarnaSt: glava.inventarnaSt,
        naziv: glava.naziv,
        skupinaKoda: skupinaRow[0]?.koda ?? null,
        skupinaNaziv: skupinaRow[0]?.naziv ?? null,
        skupinaStopnja: skupinaRow[0]?.stopnja ?? null,
        skupinaDavcnaStopnja: skupinaRow[0]?.davcnaStonja ?? null,
        costCenterCode: costCenterRow[0]?.code ?? null,
        costCenterName: costCenterRow[0]?.name ?? null,
        kontoOsCode: kontoOsRow[0]?.code ?? null,
        kontoPopravkaCode: kontoPopravkaRow[0]?.code ?? null,
        kontoStroskaCode: kontoStroskaRow[0]?.code ?? null,
        datumNabave: seqZero?.datumNabave ?? null,
        datumAktivacije: seqZero?.datumAktivacije ?? null,
        datumOdtujitve: glava.datumOdtujitve ?? null,
        razlogIzlocitve: glava.razlogIzlocitve ?? null,
        status: resolveStatusSredstvo(glava.status, {
          nabavna, odpisana, hasAktivirana: doknjizbe.some((d) => !!d.datumAktivacije),
          obracunaniOdpisi: amortVrstice.reduce((sum, v) => sum + Number(v.obracunano) + Number(v.oslabitev), 0),
        }, glava.datumOdtujitve ?? undefined),
        opomba: glava.opomba,
        skupnaNabavna: nabavna.toFixed(2),
        skupnaOdpisana: odpisana.toFixed(2),
        sedanjaVrednostPredObracunom: karticaVrednosti.sedanjaVrednostPredObracunom,
        sedanjaVrednostPoObracunu: karticaVrednosti.sedanjaVrednostPoObracunu,
        obracunPeriod,
        skupnaAmortizacijaObracunana: karticaVrednosti.skupnaAmortizacijaObracunana,
        dograditve: doknjizbe.filter((d) => d.seq > 0).map((d) => ({
          seq: d.seq,
          nazivVlaganja: d.nazivVlaganja,
          nabavnaVrednost: d.nabavnaVrednost,
          datumNabave: d.datumNabave,
          datumAktivacije: d.datumAktivacije,
          partnerNaziv: d.partnerId ? (pdfPartnerMap.get(d.partnerId)?.name ?? null) : null,
          partnerTaxId: d.partnerId ? (pdfPartnerMap.get(d.partnerId)?.taxId ?? null) : null,
          stRacuna: d.stRacuna ?? null,
          datumRacuna: d.datumRacuna ?? null,
        })),
        seq0Partner: seqZero?.partnerId
          ? (() => { const p = pdfPartnerMap.get(seqZero.partnerId!); return p ? { naziv: p.name, taxId: p.taxId } : null; })()
          : null,
        seq0StRacuna: seqZero?.stRacuna ?? null,
        seq0DatumRacuna: seqZero?.datumRacuna ?? null,
        kronoloskiPregled,
      });

      const safeNaziv = glava.inventarnaSt.replace(/[^a-zA-Z0-9-_]/g, "-");
      res.set("Content-Type", "application/pdf");
      res.set("Content-Disposition", `attachment; filename="kartica-${safeNaziv}.pdf"`);
      res.send(pdfBuffer);
    } catch (err) {
      console.error("Napaka pri generiranju PDF kartice:", err);
      res.status(500).json({ error: "Napaka pri generiranju PDF" });
    }
  },
);

// ─── Register osnovnih sredstev — USTVARI GLAVO + SEQ=0 ─────────────────────

router.post(
  "/companies/:companyId/osnovna-sredstva",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za ustvarjanje osnovnih sredstev potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const parsed = CreateOsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    // Validacija neamortizljivi del
    const pct = parseFloat(d.neamortizljiviDelPct);
    const pctErr = validateNeamortizljiviPct(pct);
    if (pctErr) {
      res.status(400).json({ error: pctErr });
      return;
    }

    // Company-scope preverba referenc na skupne šifrante
    const [ccErr, accErr] = await Promise.all([
      assertCostCenterInCompany([d.costCenterId], companyId),
      assertAccountInCompany([d.accountId, d.kontoPopravkaId, d.kontoStroskaId], companyId),
    ]);
    const scopeErr = ccErr ?? accErr;
    if (scopeErr) {
      res.status(scopeErr.status).json({ error: scopeErr.error });
      return;
    }

    // Enoličnost inventarna_st znotraj podjetja (brez doknjizba v ključu)
    const [existing] = await db
      .select({ id: osnovnaSredstvaTable.id })
      .from(osnovnaSredstvaTable)
      .where(
        and(
          eq(osnovnaSredstvaTable.companyId, companyId),
          eq(osnovnaSredstvaTable.inventarnaSt, d.inventarnaSt),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(409).json({
        error: `Sredstvo z inventarno številko "${d.inventarnaSt}" že obstaja`,
      });
      return;
    }

    // Auto-status glave glede na seq=0 datum_aktivacije
    const doknjizbaStatus = resolveStatusDoknjizba(undefined, d.datumAktivacije);
    const glavaStatus = d.status ?? doknjizbaStatus;

    // Transakcija: ustvari glavo + seq=0 doknjižbo
    const [glava] = await db
      .insert(osnovnaSredstvaTable)
      .values({
        companyId,
        inventarnaSt: d.inventarnaSt,
        naziv: d.naziv,
        skupinaId: d.skupinaId ?? null,
        costCenterId: d.costCenterId ?? null,
        accountId: d.accountId ?? null,
        kontoPopravkaId: d.kontoPopravkaId ?? null,
        kontoStroskaId: d.kontoStroskaId ?? null,
        status: glavaStatus,
        opomba: d.opomba ?? null,
      })
      .returning();

    const [doknjizba] = await db
      .insert(osDoknjizbeTable)
      .values({
        sredstvoId: glava.id,
        seq: 0,
        nazivVlaganja: null,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        neamortizljiviDelPct: d.neamortizljiviDelPct,
        datumNabave: d.datumNabave,
        datumAktivacije: d.datumAktivacije ?? null,
        datumIzpisa: d.datumIzpisa ?? null,
        status: doknjizbaStatus,
        partnerId: d.partnerId ?? null,
        stRacuna: d.stRacuna ?? null,
        datumRacuna: d.datumRacuna ?? null,
      })
      .returning();

    res.status(201).json({ ...glava, doknjizbe: [doknjizba] });
  },
);

// ─── Register osnovnih sredstev — UREDI GLAVO ───────────────────────────────

router.patch(
  "/companies/:companyId/osnovna-sredstva/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za urejanje osnovnih sredstev potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const parsed = UpdateOsBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const [existing] = await db
      .select({ id: osnovnaSredstvaTable.id })
      .from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, id), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }

    const d = parsed.data;

    // Company-scope preverba referenc na skupne šifrante — samo prisotna polja
    const [ccErr, accErr] = await Promise.all([
      assertCostCenterInCompany(["costCenterId" in d ? d.costCenterId : null], companyId),
      assertAccountInCompany(
        [
          "accountId" in d ? d.accountId : null,
          "kontoPopravkaId" in d ? d.kontoPopravkaId : null,
          "kontoStroskaId" in d ? d.kontoStroskaId : null,
        ],
        companyId,
      ),
    ]);
    const scopeErr = ccErr ?? accErr;
    if (scopeErr) {
      res.status(scopeErr.status).json({ error: scopeErr.error });
      return;
    }

    const upd: Record<string, unknown> = {};

    if (d.inventarnaSt !== undefined) {
      const [dup] = await db
        .select({ id: osnovnaSredstvaTable.id })
        .from(osnovnaSredstvaTable)
        .where(and(
          eq(osnovnaSredstvaTable.companyId, companyId),
          eq(osnovnaSredstvaTable.inventarnaSt, d.inventarnaSt),
          ne(osnovnaSredstvaTable.id, id),
        ))
        .limit(1);
      if (dup) {
        res.status(409).json({ error: `Sredstvo z inventarno številko "${d.inventarnaSt}" že obstaja` });
        return;
      }
      upd.inventarnaSt = d.inventarnaSt;
    }

    if (d.naziv !== undefined) upd.naziv = d.naziv;
    if ("skupinaId" in d) upd.skupinaId = d.skupinaId ?? null;
    if ("costCenterId" in d) upd.costCenterId = d.costCenterId ?? null;
    if ("accountId" in d) upd.accountId = d.accountId ?? null;
    if ("kontoPopravkaId" in d) upd.kontoPopravkaId = d.kontoPopravkaId ?? null;
    if ("kontoStroskaId" in d) upd.kontoStroskaId = d.kontoStroskaId ?? null;
    if (d.status !== undefined) upd.status = d.status;
    if ("opomba" in d) upd.opomba = d.opomba ?? null;
    if ("datumOdtujitve" in d) upd.datumOdtujitve = d.datumOdtujitve ?? null;
    if ("razlogIzlocitve" in d) upd.razlogIzlocitve = d.razlogIzlocitve ?? null;

    if (Object.keys(upd).length === 0) {
      const [cur] = await db.select().from(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.id, id)).limit(1);
      res.json(cur);
      return;
    }

    const [updated] = await db
      .update(osnovnaSredstvaTable)
      .set(upd)
      .where(and(eq(osnovnaSredstvaTable.id, id), eq(osnovnaSredstvaTable.companyId, companyId)))
      .returning();

    res.json(updated);
  },
);

// ─── Register osnovnih sredstev — SOFT DELETE (izloči) ──────────────────────

router.delete(
  "/companies/:companyId/osnovna-sredstva/:id",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const id = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za izločitev osnovnih sredstev potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const [existing] = await db
      .select({ id: osnovnaSredstvaTable.id })
      .from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, id), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }

    const datumIzpisa = (req.body?.datumIzpisa as string | undefined) ??
      new Date().toISOString().slice(0, 10);

    // Izloči vse doknjižbe in glavo
    await db
      .update(osDoknjizbeTable)
      .set({ status: "izloceno", datumIzpisa })
      .where(eq(osDoknjizbeTable.sredstvoId, id));

    const [updated] = await db
      .update(osnovnaSredstvaTable)
      .set({ status: "izloceno", datumOdtujitve: datumIzpisa })
      .where(and(eq(osnovnaSredstvaTable.id, id), eq(osnovnaSredstvaTable.companyId, companyId)))
      .returning();

    res.json(updated);
  },
);

// ─── Doknjižbe — DODAJ DOGRADITEV ───────────────────────────────────────────

router.post(
  "/companies/:companyId/osnovna-sredstva/:id/doknjizbe",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const sredstvoId = ep(req.params.id);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za dodajanje dograditev potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const [glava] = await db
      .select({ id: osnovnaSredstvaTable.id, status: osnovnaSredstvaTable.status })
      .from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, sredstvoId), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!glava) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }
    if (glava.status === "izloceno") {
      res.status(409).json({ error: "Na izločeno sredstvo ni mogoče dodati dograditve" });
      return;
    }

    const parsed = CreateDoknjizbaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    const pct = parseFloat(d.neamortizljiviDelPct);
    const pctErr = validateNeamortizljiviPct(pct);
    if (pctErr) {
      res.status(400).json({ error: pctErr });
      return;
    }

    // Naslednji seq
    const existingDoknjizbe = await db
      .select({ seq: osDoknjizbeTable.seq })
      .from(osDoknjizbeTable)
      .where(eq(osDoknjizbeTable.sredstvoId, sredstvoId));

    const nextSeq = resolveNextSeq(existingDoknjizbe);

    const doknjizbaStatus = resolveStatusDoknjizba(d.status, d.datumAktivacije);

    const [doknjizba] = await db
      .insert(osDoknjizbeTable)
      .values({
        sredstvoId,
        seq: nextSeq,
        nazivVlaganja: d.nazivVlaganja ?? null,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        neamortizljiviDelPct: d.neamortizljiviDelPct,
        datumNabave: d.datumNabave,
        datumAktivacije: d.datumAktivacije ?? null,
        datumIzpisa: d.datumIzpisa ?? null,
        status: doknjizbaStatus,
        partnerId: d.partnerId ?? null,
        stRacuna: d.stRacuna ?? null,
        datumRacuna: d.datumRacuna ?? null,
      })
      .returning();

    // Posodobi status glave na v_uporabi, če je bila v teku in nova doknjižba aktivirana
    if (glava.status === "v_teku" && doknjizbaStatus === "v_uporabi") {
      await db
        .update(osnovnaSredstvaTable)
        .set({ status: "v_uporabi" })
        .where(eq(osnovnaSredstvaTable.id, sredstvoId));
    }

    res.status(201).json({
      ...doknjizba,
      sedanjaVrednost: (parseFloat(doknjizba.nabavnaVrednost) - parseFloat(doknjizba.odpisanaVrednost)).toFixed(2),
      amortizirljivaBaza: (
        parseFloat(doknjizba.nabavnaVrednost) *
        ((100 - parseFloat(doknjizba.neamortizljiviDelPct)) / 100)
      ).toFixed(2),
    });
  },
);

// ─── Doknjižbe — UREDI ───────────────────────────────────────────────────────

router.patch(
  "/companies/:companyId/osnovna-sredstva/:id/doknjizbe/:doknjizbaId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const sredstvoId = ep(req.params.id);
    const doknjizbaId = ep(req.params.doknjizbaId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za urejanje doknjižb potrebujete vlogo os_admin ali os_user" });
      return;
    }

    // Preveri, da glava pripada podjetju
    const [glava] = await db
      .select({ id: osnovnaSredstvaTable.id })
      .from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, sredstvoId), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!glava) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }

    const [existingD] = await db
      .select({ id: osDoknjizbeTable.id, seq: osDoknjizbeTable.seq })
      .from(osDoknjizbeTable)
      .where(and(eq(osDoknjizbeTable.id, doknjizbaId), eq(osDoknjizbeTable.sredstvoId, sredstvoId)))
      .limit(1);
    if (!existingD) {
      res.status(404).json({ error: "Doknjižba ni najdena" });
      return;
    }
    if (existingD.seq === 0) {
      res.status(400).json({ error: "Osnovni nakup uredite prek obrazca Uredi osnovno sredstvo, ne kot dograditev." });
      return;
    }

    const parsed = UpdateDoknjizbaBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const d = parsed.data;

    if (d.neamortizljiviDelPct !== undefined) {
      const pct = parseFloat(d.neamortizljiviDelPct);
      const pctErr = validateNeamortizljiviPct(pct);
      if (pctErr) {
        res.status(400).json({ error: pctErr });
        return;
      }
    }

    const upd: Record<string, unknown> = {};
    if ("nazivVlaganja" in d) upd.nazivVlaganja = d.nazivVlaganja ?? null;
    if (d.nabavnaVrednost !== undefined) upd.nabavnaVrednost = d.nabavnaVrednost;
    if (d.odpisanaVrednost !== undefined) upd.odpisanaVrednost = d.odpisanaVrednost;
    if (d.neamortizljiviDelPct !== undefined) upd.neamortizljiviDelPct = d.neamortizljiviDelPct;
    if (d.datumNabave !== undefined) upd.datumNabave = d.datumNabave;
    if ("datumAktivacije" in d) upd.datumAktivacije = d.datumAktivacije ?? null;
    if ("datumIzpisa" in d) upd.datumIzpisa = d.datumIzpisa ?? null;
    if (d.status !== undefined) upd.status = d.status;
  if ("partnerId" in d) upd.partnerId = d.partnerId ?? null;
    if ("stRacuna" in d) upd.stRacuna = d.stRacuna ?? null;
    if ("datumRacuna" in d) upd.datumRacuna = d.datumRacuna ?? null;

    if (Object.keys(upd).length === 0) {
      const [cur] = await db.select().from(osDoknjizbeTable).where(eq(osDoknjizbeTable.id, doknjizbaId)).limit(1);
      res.json(cur);
      return;
    }

    const [updated] = await db
      .update(osDoknjizbeTable)
      .set(upd)
      .where(and(eq(osDoknjizbeTable.id, doknjizbaId), eq(osDoknjizbeTable.sredstvoId, sredstvoId)))
      .returning();

    res.json({
      ...updated,
      sedanjaVrednost: (parseFloat(updated.nabavnaVrednost) - parseFloat(updated.odpisanaVrednost)).toFixed(2),
      amortizirljivaBaza: (
        parseFloat(updated.nabavnaVrednost) *
        ((100 - parseFloat(updated.neamortizljiviDelPct)) / 100)
      ).toFixed(2),
    });
  },
);

// ─── Doknjižbe — SOFT DELETE ─────────────────────────────────────────────────

router.delete(
  "/companies/:companyId/osnovna-sredstva/:id/doknjizbe/:doknjizbaId",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const sredstvoId = ep(req.params.id);
    const doknjizbaId = ep(req.params.doknjizbaId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;
    if (!canWriteOs(access.role)) {
      res.status(403).json({ error: "Za izločitev doknjižbe potrebujete vlogo os_admin ali os_user" });
      return;
    }

    const [glava] = await db
      .select({ id: osnovnaSredstvaTable.id })
      .from(osnovnaSredstvaTable)
      .where(and(eq(osnovnaSredstvaTable.id, sredstvoId), eq(osnovnaSredstvaTable.companyId, companyId)))
      .limit(1);
    if (!glava) {
      res.status(404).json({ error: "Osnovno sredstvo ni najdeno" });
      return;
    }

    const [existingD] = await db
      .select({ id: osDoknjizbeTable.id, seq: osDoknjizbeTable.seq })
      .from(osDoknjizbeTable)
      .where(and(eq(osDoknjizbeTable.id, doknjizbaId), eq(osDoknjizbeTable.sredstvoId, sredstvoId)))
      .limit(1);
    if (!existingD) {
      res.status(404).json({ error: "Doknjižba ni najdena" });
      return;
    }
    if (existingD.seq === 0) {
      res.status(409).json({ error: "Osnovne doknjižbe (seq=0) ni mogoče izločiti ločeno. Izločite celotno sredstvo." });
      return;
    }

    const datumIzpisa = (req.body?.datumIzpisa as string | undefined) ??
      new Date().toISOString().slice(0, 10);

    const [updated] = await db
      .update(osDoknjizbeTable)
      .set({ status: "izloceno", datumIzpisa })
      .where(and(eq(osDoknjizbeTable.id, doknjizbaId), eq(osDoknjizbeTable.sredstvoId, sredstvoId)))
      .returning();

    res.json(updated);
  },
);

// ─── Skupna logika registra (za JSON + PDF + XLSX) ───────────────────────────

interface RegisterQueryParams {
  skupinaId?: string;
  costCenterId?: string;
  accountId?: string;
  status?: string;
  q?: string;
  includeIzloceno?: string;
  leto?: string;
}

interface BuildRegisterResult {
  enrichedVrstice: EnrichedMedletniVrstica[];
  periodo: { leto: number; doMeseca: number; datumKonca: string; predogled: boolean };
  zadnjiObracun: string | null;
  obracunPeriod: string | null;
  razpolozljivaLeta: number[];
  seštevki: ReturnType<typeof calcMedletniSeštevki>;
  company: { name: string | null; taxId: string | null };
}

async function buildEnrichedRegisterData(
  companyId: string,
  params: RegisterQueryParams,
): Promise<BuildRegisterResult> {
  const { skupinaId, costCenterId, accountId, status, q, includeIzloceno, leto: letoParam } = params;

  // Podjetje
  const [companyRow] = await db
    .select({ naziv: companiesTable.naziv, idZaDdv: companiesTable.idZaDdv })
    .from(companiesTable)
    .where(eq(companiesTable.id, companyId))
    .limit(1);

  // Zadnji obračun
  const [zadnjiObracunRow] = await db
    .select({ leto: osAmortizacijaObracunTable.leto, doMeseca: osAmortizacijaObracunTable.doMeseca })
    .from(osAmortizacijaObracunTable)
    .where(eq(osAmortizacijaObracunTable.companyId, companyId))
    .orderBy(desc(osAmortizacijaObracunTable.leto), desc(osAmortizacijaObracunTable.doMeseca))
    .limit(1);

  let leto: number;
  if (letoParam && String(letoParam).trim()) {
    leto = parseInt(String(letoParam), 10);
    if (isNaN(leto) || leto < 1990 || leto > 2100) throw new Error("Neveljavno leto");
  } else {
    leto = zadnjiObracunRow?.leto ?? new Date().getFullYear();
  }

  const [obracunZaLeto] = await db
    .select({ id: osAmortizacijaObracunTable.id, doMeseca: osAmortizacijaObracunTable.doMeseca, status: osAmortizacijaObracunTable.status })
    .from(osAmortizacijaObracunTable)
    .where(and(eq(osAmortizacijaObracunTable.companyId, companyId), eq(osAmortizacijaObracunTable.leto, leto)))
    .limit(1);

  const doMeseca   = obracunZaLeto?.doMeseca ?? 12;
  const predogled  = !obracunZaLeto;
  const datumKonca = lastDayOfMonthIso(leto, doMeseca);
  const obracunPeriod = obracunZaLeto ? formatObracunPeriod(leto, doMeseca) : null;
  const zadnjiObracun = zadnjiObracunRow ? formatObracunPeriod(zadnjiObracunRow.leto, zadnjiObracunRow.doMeseca) : null;

  const vsiObracuniRows = await db.select({ leto: osAmortizacijaObracunTable.leto })
    .from(osAmortizacijaObracunTable)
    .where(eq(osAmortizacijaObracunTable.companyId, companyId))
    .orderBy(asc(osAmortizacijaObracunTable.leto));
  const razpolozljivaLeta = vsiObracuniRows.map((r) => r.leto);

  const conditions = [eq(osnovnaSredstvaTable.companyId, companyId)];
  if (skupinaId)   conditions.push(eq(osnovnaSredstvaTable.skupinaId,   skupinaId));
  if (costCenterId) conditions.push(eq(osnovnaSredstvaTable.costCenterId, costCenterId));
  if (accountId)   conditions.push(eq(osnovnaSredstvaTable.accountId,   accountId));
  // Status filtriramo šele po izračunu na datumKonca; današnja izločitev ni zgodovinski status.

  let glave = await db.select().from(osnovnaSredstvaTable)
    .where(and(...conditions)).orderBy(asc(osnovnaSredstvaTable.inventarnaSt));

  if (q?.trim()) {
    const lower = q.trim().toLowerCase();
    glave = glave.filter((r) =>
      r.naziv.toLowerCase().includes(lower) || r.inventarnaSt.toLowerCase().includes(lower));
  }
  glave = glave.filter((g) => {
    if (!g.datumOdtujitve) return true;
    const dy = parseInt(g.datumOdtujitve.slice(0, 4), 10);
    return isNaN(dy) || dy >= leto;
  });

  if (glave.length === 0) {
    return {
      enrichedVrstice: [],
      periodo: { leto, doMeseca, datumKonca, predogled },
      zadnjiObracun,
      obracunPeriod,
      razpolozljivaLeta,
      seštevki: emptyMedletniSeštevki(),
      company: { name: companyRow?.naziv ?? null, taxId: companyRow?.idZaDdv ?? null },
    };
  }

  const srIds = glave.map((g) => g.id);

  const allDoknjizbe = await db.select({
    id: osDoknjizbeTable.id, sredstvoId: osDoknjizbeTable.sredstvoId,
    seq: osDoknjizbeTable.seq, nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
    odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
    datumNabave: osDoknjizbeTable.datumNabave, datumAktivacije: osDoknjizbeTable.datumAktivacije,
  }).from(osDoknjizbeTable).where(inArray(osDoknjizbeTable.sredstvoId, srIds));

  const doknjizbeMap = new Map<string, RegisterDoknjizbaInput[]>();
  for (const d of allDoknjizbe) {
    const list = doknjizbeMap.get(d.sredstvoId) ?? [];
    list.push({ id: d.id, seq: d.seq, nabavnaVrednost: d.nabavnaVrednost, odpisanaVrednost: d.odpisanaVrednost, datumNabave: d.datumNabave, datumAktivacije: d.datumAktivacije });
    doknjizbeMap.set(d.sredstvoId, list);
  }

  const allObracunRows = await db
    .select({ sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId, obracunano: osAmortizacijaObracunSredstvoTable.obracunano, oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev, leto: osAmortizacijaObracunTable.leto })
    .from(osAmortizacijaObracunSredstvoTable)
    .innerJoin(osAmortizacijaObracunTable, eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id))
    .where(and(eq(osAmortizacijaObracunTable.companyId, companyId), inArray(osAmortizacijaObracunSredstvoTable.sredstvoId, srIds)));

  const obracuniByIdMap  = new Map<string, Map<number, string>>();
  const oslabitevByIdMap = new Map<string, Map<number, string>>();
  for (const row of allObracunRows) {
    const byLeto = obracuniByIdMap.get(row.sredstvoId) ?? new Map<number, string>();
    byLeto.set(row.leto, row.obracunano);
    obracuniByIdMap.set(row.sredstvoId, byLeto);
    if (parseFloat(row.oslabitev) > 0) {
      const byLetoOsl = oslabitevByIdMap.get(row.sredstvoId) ?? new Map<number, string>();
      byLetoOsl.set(row.leto, row.oslabitev);
      oslabitevByIdMap.set(row.sredstvoId, byLetoOsl);
    }
  }

  type DocTotals = { nabavna: number; odpisana: number; hasAktivirana: boolean };
  const totalsMap = new Map<string, DocTotals>();
  for (const d of allDoknjizbe) {
    const cur = totalsMap.get(d.sredstvoId) ?? { nabavna: 0, odpisana: 0, hasAktivirana: false };
    cur.nabavna  += parseFloat(d.nabavnaVrednost);
    cur.odpisana += parseFloat(d.odpisanaVrednost);
    if (d.datumAktivacije) cur.hasAktivirana = true;
    totalsMap.set(d.sredstvoId, cur);
  }

  const odpisi = await loadObracunaniOdpisi(companyId, srIds, leto);
  const vrstice = glave.map((g) => {
    const doknjizbe = doknjizbeMap.get(g.id) ?? [];
    const t = totalsMap.get(g.id) ?? { nabavna: 0, odpisana: 0, hasAktivirana: false };
    const input: RegisterSredstvoInput = {
      id: g.id, inventarnaSt: g.inventarnaSt, naziv: g.naziv, skupinaId: g.skupinaId ?? null,
      status: resolveStatusSredstvo(g.status, { ...t, obracunaniOdpisi: odpisi.get(g.id) ?? 0 }, g.datumOdtujitve, datumKonca),
      steviloDoknjizb: doknjizbe.filter((d) => d.seq > 0).length,
      doknjizbe, obracuniPoLetih: obracuniByIdMap.get(g.id) ?? new Map<number, string>(),
      oslabitevPoLetih: oslabitevByIdMap.get(g.id),
      datumOdtujitve: g.datumOdtujitve && g.datumOdtujitve <= datumKonca ? g.datumOdtujitve : null,
    };
    return calcMedletniSredstvo(input, leto);
  });

  const OS_STATUSI_LIST = ["v_teku", "v_uporabi", "odpisano", "izloceno"] as const;
  const finalVrstice = status && OS_STATUSI_LIST.includes(status as (typeof OS_STATUSI_LIST)[number])
    ? vrstice.filter((v) => v.status === status)
    : vrstice.filter((v) => includeIzloceno === "true" || v.status !== "izloceno");

  const seštevki = calcMedletniSeštevki(finalVrstice);

  // Enrichment
  const skupinaIds2 = [...new Set(glave.map((g) => g.skupinaId).filter(Boolean) as string[])];
  const allAccIds   = [...new Set([...glave.map((g) => g.accountId), ...glave.map((g) => g.kontoPopravkaId), ...glave.map((g) => g.kontoStroskaId)].filter(Boolean) as string[])];
  const ccIds2      = [...new Set(glave.map((g) => g.costCenterId).filter(Boolean) as string[])];

  const [sku2, acc2, cc2] = await Promise.all([
    skupinaIds2.length > 0
      ? db.select({ id: osAmortizacijskeSkupineTable.id, koda: osAmortizacijskeSkupineTable.koda, naziv: osAmortizacijskeSkupineTable.naziv, racunovodskaStonja: osAmortizacijskeSkupineTable.racunovodskaStonja, davcnaStonja: osAmortizacijskeSkupineTable.davcnaStonja }).from(osAmortizacijskeSkupineTable).where(inArray(osAmortizacijskeSkupineTable.id, skupinaIds2))
      : Promise.resolve([] as Array<{ id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>),
    allAccIds.length > 0
      ? db.select({ id: accountsTable.id, code: accountsTable.code }).from(accountsTable).where(inArray(accountsTable.id, allAccIds))
      : Promise.resolve([] as Array<{ id: string; code: string }>),
    ccIds2.length > 0
      ? db.select({ id: costCentersTable.id, code: costCentersTable.code }).from(costCentersTable).where(inArray(costCentersTable.id, ccIds2))
      : Promise.resolve([] as Array<{ id: string; code: string }>),
  ]);

  const skupinaMap2 = new Map(sku2.map((s) => [s.id, s]));
  const accountMap2 = new Map(acc2.map((a) => [a.id, a.code]));
  const ccMap2      = new Map(cc2.map((c) => [c.id, c.code]));

  const seq0Map2 = new Map<string, { datumNabave: string; datumAktivacije: string | null }>();
  for (const d of allDoknjizbe) {
    if (d.seq === 0) seq0Map2.set(d.sredstvoId, { datumNabave: d.datumNabave, datumAktivacije: d.datumAktivacije });
  }
  const glavaMap2 = new Map(glave.map((g) => [g.id, g]));

  const enrichedVrstice: EnrichedMedletniVrstica[] = finalVrstice.map((v) => {
    const g      = glavaMap2.get(v.id)!;
    const skupina = g.skupinaId ? (skupinaMap2.get(g.skupinaId) ?? null) : null;
    const seq0    = seq0Map2.get(v.id) ?? null;
    return {
      ...v,
      skupinaKoda:        skupina?.koda                ?? null,
      skupinaNaziv:       skupina?.naziv               ?? null,
      racunovodskaStonja: skupina?.racunovodskaStonja  ?? null,
      davcnaStonja:       skupina?.davcnaStonja        ?? null,
      datumNabave:        seq0?.datumNabave            ?? null,
      datumAktivacije:    seq0?.datumAktivacije        ?? null,
      accountCode:        g.accountId        ? (accountMap2.get(g.accountId)        ?? null) : null,
      kontoPopravkaCode:  g.kontoPopravkaId  ? (accountMap2.get(g.kontoPopravkaId)  ?? null) : null,
      kontoStroskaCode:   g.kontoStroskaId   ? (accountMap2.get(g.kontoStroskaId)   ?? null) : null,
      costCenterCode:     g.costCenterId     ? (ccMap2.get(g.costCenterId)           ?? null) : null,
    };
  });

  return {
    enrichedVrstice,
    periodo: { leto, doMeseca, datumKonca, predogled },
    zadnjiObracun,
    obracunPeriod,
    razpolozljivaLeta,
    seštevki,
    company: { name: companyRow?.naziv ?? null, taxId: companyRow?.idZaDdv ?? null },
  };
}

// ─── Medletni register OS ────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/osnovna-sredstva-register",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const {
      skupinaId,
      costCenterId,
      accountId,
      status,
      q,
      includeIzloceno,
    } = req.query as Record<string, string | undefined>;

    // Ugotovi zadnji shranjeni obračun podjetja (za privzeto leto + zadnjiObracun prikaz)
    const [zadnjiObracunRow] = await db
      .select({ leto: osAmortizacijaObracunTable.leto, doMeseca: osAmortizacijaObracunTable.doMeseca })
      .from(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))
      .orderBy(desc(osAmortizacijaObracunTable.leto), desc(osAmortizacijaObracunTable.doMeseca))
      .limit(1);

    // Določi leto
    const letoParam = req.query.leto;
    let leto: number;
    if (letoParam && String(letoParam).trim()) {
      leto = parseInt(String(letoParam), 10);
      if (isNaN(leto) || leto < 1990 || leto > 2100) {
        res.status(400).json({ error: "Neveljavno leto" });
        return;
      }
    } else {
      leto = zadnjiObracunRow?.leto ?? new Date().getFullYear();
    }

    // Obračun za izbrano leto
    const [obracunZaLeto] = await db
      .select({
        id: osAmortizacijaObracunTable.id,
        doMeseca: osAmortizacijaObracunTable.doMeseca,
        status: osAmortizacijaObracunTable.status,
      })
      .from(osAmortizacijaObracunTable)
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          eq(osAmortizacijaObracunTable.leto, leto),
        ),
      )
      .limit(1);

    const doMeseca = obracunZaLeto?.doMeseca ?? 12;
    const predogled = !obracunZaLeto;
    const datumKonca = lastDayOfMonthIso(leto, doMeseca);
    const obracunPeriod = obracunZaLeto ? formatObracunPeriod(leto, doMeseca) : null;
    const zadnjiObracun = zadnjiObracunRow
      ? formatObracunPeriod(zadnjiObracunRow.leto, zadnjiObracunRow.doMeseca)
      : null;

    // Razpoložljiva leta (za UI selector)
    const vsiObracuniRows = await db
      .select({ leto: osAmortizacijaObracunTable.leto })
      .from(osAmortizacijaObracunTable)
      .where(eq(osAmortizacijaObracunTable.companyId, companyId))
      .orderBy(asc(osAmortizacijaObracunTable.leto));
    const razpolozljivaLeta = vsiObracuniRows.map((r) => r.leto);

    // Filtri za glave (enako kot GET /osnovna-sredstva)
    const conditions = [eq(osnovnaSredstvaTable.companyId, companyId)];
    if (skupinaId) conditions.push(eq(osnovnaSredstvaTable.skupinaId, skupinaId));
    if (costCenterId) conditions.push(eq(osnovnaSredstvaTable.costCenterId, costCenterId));
    if (accountId) conditions.push(eq(osnovnaSredstvaTable.accountId, accountId));
    // Status filtriramo šele po izračunu na datumKonca, ne po današnjem stanju glave.

    let glave = await db
      .select()
      .from(osnovnaSredstvaTable)
      .where(and(...conditions))
      .orderBy(asc(osnovnaSredstvaTable.inventarnaSt));

    if (q && q.trim()) {
      const lower = q.trim().toLowerCase();
      glave = glave.filter(
        (r) =>
          r.naziv.toLowerCase().includes(lower) ||
          r.inventarnaSt.toLowerCase().includes(lower),
      );
    }

    // Filtriramo sredstva, ki so bila odtujena PRED začetkom leta:
    //   - odtujitev v tem letu → prikazano z izlocitveNV/PV stolpci (pravilno)
    //   - odtujitev v prihodnosti → prikazano normalno
    //   - odtujitev pred letom → NI v registru za to leto
    glave = glave.filter((g) => {
      if (!g.datumOdtujitve) return true;
      const dispYear = parseInt(g.datumOdtujitve.slice(0, 4), 10);
      return isNaN(dispYear) || dispYear >= leto;
    });

    if (glave.length === 0) {
      res.json({
        periodo: { leto, doMeseca, datumKonca, predogled },
        zadnjiObracun,
        obracunPeriod,
        razpolozljivaLeta,
        osnovnaSredstva: [],
        seštevki: emptyMedletniSeštevki(),
      });
      return;
    }

    const srIds = glave.map((g) => g.id);

    // Doknjižbe (nabavna, odpisana, datumi — za medletni izračun)
    const allDoknjizbe = await db
      .select({
        id: osDoknjizbeTable.id,
        sredstvoId: osDoknjizbeTable.sredstvoId,
        seq: osDoknjizbeTable.seq,
        nabavnaVrednost: osDoknjizbeTable.nabavnaVrednost,
        odpisanaVrednost: osDoknjizbeTable.odpisanaVrednost,
        datumNabave: osDoknjizbeTable.datumNabave,
        datumAktivacije: osDoknjizbeTable.datumAktivacije,
      })
      .from(osDoknjizbeTable)
      .where(inArray(osDoknjizbeTable.sredstvoId, srIds));

    // Grupiraj doknjizbe po sredstvoId
    const doknjizbeMap = new Map<string, RegisterDoknjizbaInput[]>();
    for (const d of allDoknjizbe) {
      const list = doknjizbeMap.get(d.sredstvoId) ?? [];
      list.push({
        id: d.id,
        seq: d.seq,
        nabavnaVrednost: d.nabavnaVrednost,
        odpisanaVrednost: d.odpisanaVrednost,
        datumNabave: d.datumNabave,
        datumAktivacije: d.datumAktivacije,
      });
      doknjizbeMap.set(d.sredstvoId, list);
    }

    // VSI obračuni za ta sredstva (vsa leta — za pretekle obračune v začetnem PV)
    const allObracunRows = await db
      .select({
        sredstvoId: osAmortizacijaObracunSredstvoTable.sredstvoId,
        obracunano: osAmortizacijaObracunSredstvoTable.obracunano,
        oslabitev: osAmortizacijaObracunSredstvoTable.oslabitev,
        leto: osAmortizacijaObracunTable.leto,
      })
      .from(osAmortizacijaObracunSredstvoTable)
      .innerJoin(
        osAmortizacijaObracunTable,
        eq(osAmortizacijaObracunSredstvoTable.obracunId, osAmortizacijaObracunTable.id),
      )
      .where(
        and(
          eq(osAmortizacijaObracunTable.companyId, companyId),
          inArray(osAmortizacijaObracunSredstvoTable.sredstvoId, srIds),
        ),
      );

    // Map: sredstvoId → Map<leto, obracunano>
    const obracuniByIdMap = new Map<string, Map<number, string>>();
    // Map: sredstvoId → Map<leto, oslabitev>
    const oslabitevByIdMap = new Map<string, Map<number, string>>();
    for (const row of allObracunRows) {
      const byLeto = obracuniByIdMap.get(row.sredstvoId) ?? new Map<number, string>();
      byLeto.set(row.leto, row.obracunano);
      obracuniByIdMap.set(row.sredstvoId, byLeto);

      if (parseFloat(row.oslabitev) > 0) {
        const byLetoOsl = oslabitevByIdMap.get(row.sredstvoId) ?? new Map<number, string>();
        byLetoOsl.set(row.leto, row.oslabitev);
        oslabitevByIdMap.set(row.sredstvoId, byLetoOsl);
      }
    }

    // Agregat za status (enako kot obstoječi register)
    type DocTotals = { nabavna: number; odpisana: number; hasAktivirana: boolean };
    const totalsMap = new Map<string, DocTotals>();
    for (const d of allDoknjizbe) {
      const cur = totalsMap.get(d.sredstvoId) ?? { nabavna: 0, odpisana: 0, hasAktivirana: false };
      cur.nabavna += parseFloat(d.nabavnaVrednost);
      cur.odpisana += parseFloat(d.odpisanaVrednost);
      if (d.datumAktivacije) cur.hasAktivirana = true;
      totalsMap.set(d.sredstvoId, cur);
    }

    // Izračun medletnega registra
    const odpisi = await loadObracunaniOdpisi(companyId, srIds, leto);
    const vrstice = glave.map((g) => {
      const doknjizbe = doknjizbeMap.get(g.id) ?? [];
      const obracuniPoLetih = obracuniByIdMap.get(g.id) ?? new Map<number, string>();
      const t = totalsMap.get(g.id) ?? { nabavna: 0, odpisana: 0, hasAktivirana: false };
      const computedStatus = resolveStatusSredstvo(g.status, { ...t, obracunaniOdpisi: odpisi.get(g.id) ?? 0 }, g.datumOdtujitve, datumKonca);
      const steviloDoknjizb = doknjizbe.filter((d) => d.seq > 0).length;

      const input: RegisterSredstvoInput = {
        id: g.id,
        inventarnaSt: g.inventarnaSt,
        naziv: g.naziv,
        skupinaId: g.skupinaId ?? null,
        status: computedStatus,
        steviloDoknjizb,
        doknjizbe,
        obracuniPoLetih,
        oslabitevPoLetih: oslabitevByIdMap.get(g.id),
        datumOdtujitve: g.datumOdtujitve && g.datumOdtujitve <= datumKonca ? g.datumOdtujitve : null,
      };
      return calcMedletniSredstvo(input, leto);
    });

    // Post-agregacijski filter po statusu (enako kot obstoječi register)
    const OS_STATUSI_LIST = ["v_teku", "v_uporabi", "odpisano", "izloceno"] as const;
    const finalVrstice =
      status && OS_STATUSI_LIST.includes(status as (typeof OS_STATUSI_LIST)[number])
        ? vrstice.filter((v) => v.status === status)
        : vrstice.filter((v) => includeIzloceno === "true" || v.status !== "izloceno");

    const seštevki = calcMedletniSeštevki(finalVrstice);

    // ── Enrichment: skupiny, accounts, costCenters → SRS metapodatki ──────────
    const skupinaIds = [...new Set(glave.map((g) => g.skupinaId).filter(Boolean) as string[])];
    const allAccountIds = [...new Set([
      ...glave.map((g) => g.accountId),
      ...glave.map((g) => g.kontoPopravkaId),
      ...glave.map((g) => g.kontoStroskaId),
    ].filter(Boolean) as string[])];
    const ccIds = [...new Set(glave.map((g) => g.costCenterId).filter(Boolean) as string[])];

    const [skupinyRows, accountRows, ccRows] = await Promise.all([
      skupinaIds.length > 0
        ? db.select({
            id: osAmortizacijskeSkupineTable.id,
            koda: osAmortizacijskeSkupineTable.koda,
            naziv: osAmortizacijskeSkupineTable.naziv,
            racunovodskaStonja: osAmortizacijskeSkupineTable.racunovodskaStonja,
            davcnaStonja: osAmortizacijskeSkupineTable.davcnaStonja,
          }).from(osAmortizacijskeSkupineTable).where(inArray(osAmortizacijskeSkupineTable.id, skupinaIds))
        : Promise.resolve([] as Array<{ id: string; koda: string; naziv: string; racunovodskaStonja: string; davcnaStonja: string }>),
      allAccountIds.length > 0
        ? db.select({ id: accountsTable.id, code: accountsTable.code }).from(accountsTable).where(inArray(accountsTable.id, allAccountIds))
        : Promise.resolve([] as Array<{ id: string; code: string }>),
      ccIds.length > 0
        ? db.select({ id: costCentersTable.id, code: costCentersTable.code }).from(costCentersTable).where(inArray(costCentersTable.id, ccIds))
        : Promise.resolve([] as Array<{ id: string; code: string }>),
    ]);

    const skupinaMap = new Map(skupinyRows.map((s) => [s.id, s]));
    const accountMap = new Map(accountRows.map((a) => [a.id, a.code]));
    const ccMap      = new Map(ccRows.map((c) => [c.id, c.code]));

    // seq=0 datumi iz allDoknjizbe (že naloženih)
    const seq0Map = new Map<string, { datumNabave: string; datumAktivacije: string | null }>();
    for (const d of allDoknjizbe) {
      if (d.seq === 0) seq0Map.set(d.sredstvoId, { datumNabave: d.datumNabave, datumAktivacije: d.datumAktivacije });
    }

    const glavaMap = new Map(glave.map((g) => [g.id, g]));

    const enrichedVrstice: EnrichedMedletniVrstica[] = finalVrstice.map((v) => {
      const g = glavaMap.get(v.id)!;
      const skupina = g.skupinaId ? (skupinaMap.get(g.skupinaId) ?? null) : null;
      const seq0    = seq0Map.get(v.id) ?? null;
      return {
        ...v,
        skupinaKoda:       skupina?.koda               ?? null,
        skupinaNaziv:      skupina?.naziv               ?? null,
        racunovodskaStonja: skupina?.racunovodskaStonja ?? null,
        davcnaStonja:      skupina?.davcnaStonja        ?? null,
        datumNabave:       seq0?.datumNabave            ?? null,
        datumAktivacije:   seq0?.datumAktivacije        ?? null,
        accountCode:       g.accountId        ? (accountMap.get(g.accountId)        ?? null) : null,
        kontoPopravkaCode: g.kontoPopravkaId  ? (accountMap.get(g.kontoPopravkaId)  ?? null) : null,
        kontoStroskaCode:  g.kontoStroskaId   ? (accountMap.get(g.kontoStroskaId)   ?? null) : null,
        costCenterCode:    g.costCenterId     ? (ccMap.get(g.costCenterId)           ?? null) : null,
        // Edit-dialog polja
        costCenterId:      g.costCenterId     ?? null,
        accountId:         g.accountId        ?? null,
        kontoPopravkaId:   g.kontoPopravkaId  ?? null,
        kontoStroskaId:    g.kontoStroskaId   ?? null,
        opomba:            g.opomba           ?? null,
        datumOdtujitve:    g.datumOdtujitve   ?? null,
        razlogIzlocitve:   g.razlogIzlocitve  ?? null,
      };
    });

    res.json({
      periodo: { leto, doMeseca, datumKonca, predogled },
      zadnjiObracun,
      obracunPeriod,
      razpolozljivaLeta,
      osnovnaSredstva: enrichedVrstice,
      seštevki,
    });
  },
);

// ─── OS Register PDF ──────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/os-register/pdf",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    // Pridobi enriched vrstice (enak klic kot JSON endpoint prek internega fetcha)
    // Ker ne moremo klicati samega sebe, podpremo zahtevo direktno iz DB.
    const { enrichedVrstice: ev, periodo, obracunPeriod, company } =
      await buildEnrichedRegisterData(companyId, req.query as Record<string, string>);

    const datumKoncaFmt = (() => {
      const p = periodo.datumKonca.split("-");
      return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : periodo.datumKonca;
    })();
    const seštevkiPdf = calcMedletniSeštevki(ev);

    const pdf = await generateOsRegisterPdf({
      companyName:  company.name ?? "Podjetje",
      companyDavcna: company.taxId ?? null,
      datumIzpisa:   new Date().toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" }),
      datumKonca:    datumKoncaFmt,
      obracunPeriod: obracunPeriod,
      vrstice: ev.map((v) => ({
        inventarnaSt:      v.inventarnaSt,
        naziv:             v.naziv,
        skupinaKoda:       v.skupinaKoda,
        skupinaNaziv:      v.skupinaNaziv,
        racunovodskaStonja: v.racunovodskaStonja,
        datumNabave:       v.datumNabave,
        datumAktivacije:   v.datumAktivacije,
        zacNV:    v.zacNV,   zacPV:  v.zacPV,  zacNed:  v.zacNed,
        noveNabave: v.noveNabave, amortObdobja: v.amortObdobja,
        konNV:    v.konNV,   konNed: v.konNed,
        status:   v.status,
      })),
      seštevki: {
        zacNV: seštevkiPdf.zacNV, zacPV: seštevkiPdf.zacPV, zacNed: seštevkiPdf.zacNed,
        noveNabave: seštevkiPdf.noveNabave, amortObdobja: seštevkiPdf.amortObdobja,
        konNV: seštevkiPdf.konNV, konNed: seštevkiPdf.konNed,
      },
    });

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="register-os-${periodo.leto}.pdf"`);
    res.send(pdf);
  },
);

// ─── OS Register XLSX ─────────────────────────────────────────────────────────

router.get(
  "/companies/:companyId/os-register/xlsx",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = ep(req.params.companyId);
    const access = await resolveOsAccess(authReq.clerkUserId, companyId, res);
    if (!access) return;

    const { enrichedVrstice: ev, periodo, obracunPeriod, company } =
      await buildEnrichedRegisterData(companyId, req.query as Record<string, string>);

    const wb = new ExcelJS.Workbook();
    wb.creator = "ERP — OS Register";
    wb.created = new Date();

    const ws = wb.addWorksheet("Register OS", {
      pageSetup: { paperSize: 9, orientation: "landscape", fitToPage: true, fitToWidth: 1 },
    });

    // Glava dokumenta
    const datumKoncaFmt = (() => {
      const p = periodo.datumKonca.split("-");
      return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : periodo.datumKonca;
    })();
    ws.mergeCells("A1:S1");
    ws.getCell("A1").value = `${company.name ?? "Podjetje"} — Register osnovnih sredstev na dan ${datumKoncaFmt}`;
    ws.getCell("A1").font = { bold: true, size: 12 };
    ws.mergeCells("A2:S2");
    ws.getCell("A2").value = [
      obracunPeriod ? `Obračun: ${obracunPeriod}` : "Predogled (brez shranjenega obračuna)",
      company.taxId ? `DDV: ${company.taxId}` : null,
    ].filter(Boolean).join("  ·  ");
    ws.getCell("A2").font = { italic: true, size: 9, color: { argb: "FF6B7280" } };

    // Stolpci
    const SRS_COLS = [
      { header: "Inv. št.",      key: "inventarnaSt",      width: 14 },
      { header: "Naziv",         key: "naziv",             width: 30 },
      { header: "Skupina",       key: "skupinaKoda",       width: 9  },
      { header: "Skupina naziv", key: "skupinaNaziv",      width: 22 },
      { header: "Rac. stopnja%", key: "racunovodskaStonja",width: 13 },
      { header: "Dav. stopnja%", key: "davcnaStonja",      width: 13 },
      { header: "Doba (let)",    key: "doba",              width: 10 },
      { header: "Dat. nabave",   key: "datumNabave",       width: 13 },
      { header: "Dat. aktiv.",   key: "datumAktivacije",   width: 13 },
      { header: "NV (1.1.)",     key: "zacNV",             width: 14, numFmt: "#,##0.00" },
      { header: "PV (1.1.)",     key: "zacPV",             width: 14, numFmt: "#,##0.00" },
      { header: "Ned. (1.1.)",   key: "zacNed",            width: 14, numFmt: "#,##0.00" },
      { header: "Nov. nabave",   key: "noveNabave",        width: 14, numFmt: "#,##0.00" },
      { header: "Amortizacija",  key: "amortObdobja",      width: 14, numFmt: "#,##0.00" },
      { header: "NV (konec)",    key: "konNV",             width: 14, numFmt: "#,##0.00" },
      { header: "PV (konec)",    key: "konPV",             width: 14, numFmt: "#,##0.00" },
      { header: "Ned. (konec)",  key: "konNed",            width: 14, numFmt: "#,##0.00" },
      { header: "Konto OS",      key: "accountCode",       width: 10 },
      { header: "Konto popravka",key: "kontoPopravkaCode", width: 14 },
      { header: "Konto stroška", key: "kontoStroskaCode",  width: 14 },
      { header: "STM",           key: "costCenterCode",    width: 9  },
      { header: "Status",        key: "status",            width: 11 },
    ];

    ws.columns = SRS_COLS.map((c) => ({ header: "", key: c.key, width: c.width }));

    // Glava stolpcev (vrstica 4)
    ws.getRow(4).values = SRS_COLS.map((c) => c.header);
    const hdr = ws.getRow(4);
    hdr.font = { bold: true, size: 9 };
    hdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } };
    hdr.alignment = { horizontal: "center", wrapText: true };
    hdr.height = 22;

    // Podatki (od vrstice 5)
    function calcDobaXls(stonja: string | null | undefined): string {
      if (!stonja) return "";
      const n = parseFloat(stonja);
      if (!n || n <= 0) return "";
      return (100 / n).toLocaleString("sl-SI", { minimumFractionDigits: 0, maximumFractionDigits: 1 });
    }

    function fmtDateXls(iso: string | null | undefined): string {
      if (!iso) return "";
      const p = iso.split("-");
      return p.length === 3 ? `${p[2]}.${p[1]}.${p[0]}` : iso;
    }

    const STATUS_LABELS: Record<string, string> = {
      v_teku: "V teku", v_uporabi: "V uporabi", odpisano: "Odpisano", izloceno: "Izločeno",
    };

    const numKeys = new Set(["zacNV","zacPV","zacNed","noveNabave","amortObdobja","konNV","konPV","konNed"]);
    for (const v of ev) {
      const row: Record<string, unknown> = {
        inventarnaSt:      v.inventarnaSt,
        naziv:             v.naziv,
        skupinaKoda:       v.skupinaKoda ?? "",
        skupinaNaziv:      v.skupinaNaziv ?? "",
        racunovodskaStonja: v.racunovodskaStonja ? parseFloat(v.racunovodskaStonja) : "",
        davcnaStonja:      v.davcnaStonja ? parseFloat(v.davcnaStonja) : "",
        doba:              calcDobaXls(v.racunovodskaStonja),
        datumNabave:       fmtDateXls(v.datumNabave),
        datumAktivacije:   fmtDateXls(v.datumAktivacije),
        zacNV:   parseFloat(v.zacNV),  zacPV:  parseFloat(v.zacPV),  zacNed:  parseFloat(v.zacNed),
        noveNabave: parseFloat(v.noveNabave), amortObdobja: parseFloat(v.amortObdobja),
        konNV:   parseFloat(v.konNV),  konPV:  parseFloat(v.konPV),  konNed:  parseFloat(v.konNed),
        accountCode:       v.accountCode       ?? "",
        kontoPopravkaCode: v.kontoPopravkaCode ?? "",
        kontoStroskaCode:  v.kontoStroskaCode  ?? "",
        costCenterCode:    v.costCenterCode    ?? "",
        status:            STATUS_LABELS[v.status] ?? v.status,
      };
      const dataRow = ws.addRow(row);
      // Formati za numerične stolpce
      SRS_COLS.forEach((c, colIdx) => {
        if (c.numFmt) dataRow.getCell(colIdx + 1).numFmt = c.numFmt;
      });
      dataRow.font = { size: 9 };
    }

    // Seštevki
    const se = calcMedletniSeštevki(ev);
    const totRow = ws.addRow({
      inventarnaSt: `SKUPAJ (${ev.length})`,
      zacNV: parseFloat(se.zacNV), zacPV: parseFloat(se.zacPV), zacNed: parseFloat(se.zacNed),
      noveNabave: parseFloat(se.noveNabave), amortObdobja: parseFloat(se.amortObdobja),
      konNV: parseFloat(se.konNV), konPV: parseFloat(se.konPV), konNed: parseFloat(se.konNed),
    });
    totRow.font = { bold: true, size: 9 };
    totRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE0E7FF" } };
    SRS_COLS.forEach((c, colIdx) => {
      if (c.numFmt) totRow.getCell(colIdx + 1).numFmt = c.numFmt;
    });

    // Zamrzni glavo
    ws.views = [{ state: "frozen", xSplit: 0, ySplit: 4 }];
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: SRS_COLS.length } };

    const xlsBuffer = await wb.xlsx.writeBuffer();
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="register-os-${periodo.leto}.xlsx"`);
    res.send(Buffer.from(xlsBuffer));
  },
);

export default router;
