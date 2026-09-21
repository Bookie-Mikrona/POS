/**
 * POS Gostinstvo — middleware za Clerk auth + enota/podjetje izolacija.
 *
 * requireEnota  — za rute ki zahtevajo aktivno enoto (X-Enota-Id header)
 * requirePosCompany — za rute ki zahtevajo samo company-level dostop (npr. upravljanje enot)
 */

import type { Request, Response, NextFunction } from "express";
import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import {
  enoteTable,
  posEventStaffGrantsTable,
  posUporabnikiTable,
  companiesTable,
  accountingRolesTable,
  type UnitCapability,
} from "@workspace/db";
import { and, eq, inArray, gte, lte, sql } from "drizzle-orm";
import { createHmac, timingSafeEqual } from "node:crypto";
import { getPosActorSessionSecret } from "../lib/posActorSessionSecret";

/** Podjetje je DDV zavezanec, ko ima id_za_ddv ki se začne s "SI" (case-insensitive). */
function jeZavezanecDdv(idZaDdv: string | null | undefined): boolean {
  return typeof idZaDdv === "string" && idZaDdv.toUpperCase().startsWith("SI");
}

const SUPER_ADMIN_IDS = (process.env.SUPER_ADMIN_IDS ?? "")
  .split(",").map((s) => s.trim()).filter(Boolean);

export interface PosRequest extends Request {
  enotaId: number;
  clerkUserId: string;
  companyId: string;
  vloga: string; // "admin" | "admin_enote" | "uporabnik"
  jeDdvZavezanec: boolean;
  idZaDdv: string | null;
  posActorNatakarId?: number;
  posActorShiftId?: number;
  posActorSessionError?: { error: string; code: string };
  deviceSyncDeviceId?: string;
}

type CapabilityPathRule = {
  capability: UnitCapability;
  matches: (path: string) => boolean;
};

const hasPrefix = (path: string, prefix: string): boolean =>
  path === prefix || path.startsWith(`${prefix}/`);

const prefixes = (capability: UnitCapability, ...values: string[]): CapabilityPathRule => ({
  capability,
  matches: path => values.some(prefix => hasPrefix(path, prefix)),
});

/**
 * Pravila so urejena od najbolj specifičnih proti splošnim. Tako lahko skupni
 * routerji (/mize, /narocila, /statistike) varujejo posamezne podmodule.
 */
const CAPABILITY_PATHS: CapabilityPathRule[] = [
  {
    capability: "delivery",
    matches: path => /^\/narocila\/[^/]+\/dostava(?:-|\/|$)/.test(path),
  },
  {
    capability: "reservations",
    matches: path => /^\/mize\/[^/]+\/rezervacij(?:a|e)(?:\/|$)/.test(path),
  },
  {
    capability: "kitchen",
    matches: path => /^\/narocila\/[^/]+\/postavke\/[^/]+\/pripravljeno$/.test(path),
  },
  prefixes("hours", "/izmene/obracun-ur"),
  prefixes("realization", "/statistike/realizacija"),
  prefixes("checkout", "/x-porocilo", "/z-porocilo"),
  prefixes("operational_reports", "/operativna-porocila"),
  prefixes("menu", "/kategorije", "/artikli", "/dnevni-meni", "/modifikatorske-skupine", "/modifikatorji", "/multicourse-menus"),
  prefixes("tables", "/mize", "/prostori", "/qr-admin", "/qr-waiter-requests"),
  prefixes("reservations", "/rezervacije"),
  prefixes("delivery", "/dostava", "/naselja"),
  prefixes("checkout", "/narocila", "/blagajne", "/terminal", "/quick-switch", "/ai/glasovni-ukaz", "/ai/svetovalec"),
  prefixes("checkout", "/ai/agent", "/ai/normativ-primerjava"),
  prefixes("receipts", "/racuni", "/darilni-boni", "/print", "/kupec"),
  prefixes("receipts", "/offline-fiscal"),
  prefixes("shifts", "/izmene", "/odsotnosti", "/natakari"),
  prefixes("settings", "/nastavitve", "/poslovni-prostori", "/naprave", "/glasovni-sinonimi", "/partnerji", "/furs", "/bizbox-nastavitve", "/certifikat"),
  prefixes("bar", "/happy-hour"),
  prefixes("statistics", "/statistike"),
  prefixes("inventory", "/zaloge", "/inventure", "/prejemnice", "/izdajnice", "/zacetne-zaloge", "/uvoz", "/embalaza"),
  prefixes("prepared_food", "/prepared-food"),
  prefixes("plate_waste", "/plate-waste"),
  prefixes("kitchen", "/kds"),
  prefixes("journals", "/temeljnice"),
  prefixes("cash_movements", "/blagajniski-premiki"),
  prefixes("phone_orders", "/narocniki", "/cti"),
  prefixes("events", "/pos-events"),
  prefixes("simulation", "/sim"),
  prefixes("checkout", "/events"),
];

export function resolveUnitCapability(path: string): UnitCapability | null {
  return CAPABILITY_PATHS.find(rule => rule.matches(path))?.capability ?? null;
}

async function enforceUnitCapability(
  req: Request,
  res: Response,
  next: NextFunction,
  capability: UnitCapability,
): Promise<void> {
  const context = req as PosRequest;
  if (context.vloga === "superadmin") { next(); return; }
  const [unit] = await db
    .select({ capabilities: enoteTable.capabilities })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, context.enotaId), eq(enoteTable.companyId, context.companyId)))
    .limit(1);
  if (!unit?.capabilities.includes(capability)) {
    res.status(403).json({
      napaka: "Ta funkcija za aktivno poslovno enoto ni omogočena.",
      koda: "FUNKCIJA_ENOTE_ONEMOGOCENA",
      funkcija: capability,
    });
    return;
  }
  next();
}

/** Za routerje pred globalno politiko, kjer je zmožnost določena ob montaži. */
export function requireSpecificUnitCapability(capability: UnitCapability) {
  return (req: Request, res: Response, next: NextFunction): Promise<void> =>
    enforceUnitCapability(req, res, next, capability);
}

/** Enaka zaščita kot v POS navigaciji za vse poslovne module; neznane poti se zavrnejo. */
export async function requireUnitCapability(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const context = req as PosRequest;
  if (context.vloga === "superadmin") { next(); return; }
  const capability = resolveUnitCapability(req.path);
  if (!capability) {
    res.status(403).json({
      napaka: "POS pot nima določene dovoljene funkcije poslovne enote.",
      koda: "POT_ENOTE_NEPRESLIKANA",
    });
    return;
  }
  await enforceUnitCapability(req, res, next, capability);
}

/** Dodatna avtorizacija za občutljive nastavitve podjetja. */
export function requirePosAdminRole(req: Request, res: Response, next: NextFunction): void {
  const role = (req as PosRequest).vloga;
  if (role === "admin" || role === "superadmin") {
    next();
    return;
  }
  res.status(403).json({
    napaka: "Ta nastavitev zahteva vlogo administratorja podjetja.",
    koda: "POS_ADMIN_OBVEZEN",
  });
}

/** Resolves a short lived, signed actor selection without replacing Clerk identity. */
export async function posActorContext(req: Request, res: Response, next: NextFunction): Promise<void> {
  if (req.method === "POST" && req.path === "/quick-switch/switch") {
    next();
    return;
  }
  const token = req.headers["x-pos-actor-session"];
  if (typeof token !== "string") { next(); return; }
  const secret = getPosActorSessionSecret();
  if (!secret) { res.status(503).json({ error: "POS actor session ni konfiguriran." }); return; }
  const [encoded, signature] = token.split(".");
  const context = req as PosRequest;
  const rejectActorOnly = (error: string, code: string) => {
    context.posActorSessionError = { error, code };
    next();
  };
  if (!encoded || !signature) {
    rejectActorOnly("POS actor seja je potekla ali ni veljavna.", "POS_ACTOR_SESSION_INVALID");
    return;
  }
  const expected = createHmac("sha256", secret).update(encoded).digest("base64url");
  try {
    if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as { n: number; s: number; e: number; c: string; u: number };
    if (!Number.isInteger(payload.n) || !Number.isInteger(payload.s) || payload.s < 1 || payload.e < Date.now() || payload.c !== context.companyId || payload.u !== context.enotaId) throw new Error();
    const activeShift = await db.execute(sql`
      SELECT 1
      FROM izmene
      WHERE id = ${payload.s}
        AND natakari_id = ${payload.n}
        AND enota_id = ${payload.u}
        AND konec IS NULL
      LIMIT 1
    `);
    if (activeShift.rows.length === 0) {
      rejectActorOnly(
        "Izmena izbranega natakarja je zaprta. Za nadaljevanje odprite izmeno.",
        "POS_ACTOR_SHIFT_CLOSED",
      );
      return;
    }
    context.posActorNatakarId = payload.n;
    context.posActorShiftId = payload.s;
    next();
  } catch {
    rejectActorOnly("POS actor seja je potekla ali ni veljavna.", "POS_ACTOR_SESSION_INVALID");
  }
}

/** Requires an actor identity that was cryptographically verified by posActorContext. */
export function requireVerifiedPosActor(req: Request, res: Response, next: NextFunction): void {
  if (Number.isInteger((req as PosRequest).posActorNatakarId)) {
    next();
    return;
  }
  const actorError = (req as PosRequest).posActorSessionError;
  res.status(401).json({
    error: actorError?.error ?? "Za to dejanje izberite natakarja in vnesite PIN.",
    code: actorError?.code ?? "POS_ACTOR_SESSION_REQUIRED",
  });
}

type PosUserContext = {
  id: number;
  companyId: string;
  vloga: string;
  dodeljenaEnotaId: number | null;
};

type PosUserResolution =
  | { user: PosUserContext; ambiguous: false }
  | { user: null; ambiguous: false }
  | { user: null; ambiguous: true };

function requestedCompanyId(req: Request): string | null {
  const value = req.headers["x-company-id"];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

/**
 * Razreši POS vlogo brez ugibanja med podjetji.
 *
 * Uporabnik z enim aktivnim POS zapisom se razreši samodejno. Kadar ima več
 * podjetij, mora poslati X-Company-Id; izbrana družba se nato preveri proti
 * njegovim aktivnim POS vlogam.
 */
async function resolvePosUser(
  clerkUserId: string,
  selectedCompanyId: string | null,
): Promise<PosUserResolution> {
  const candidates = await db
    .select({
      id: posUporabnikiTable.id,
      companyId: posUporabnikiTable.companyId,
      vloga: posUporabnikiTable.vloga,
      dodeljenaEnotaId: posUporabnikiTable.enotaId,
    })
    .from(posUporabnikiTable)
    .where(and(
      eq(posUporabnikiTable.clerkUserId, clerkUserId),
      eq(posUporabnikiTable.aktiven, true),
    ))
    .orderBy(posUporabnikiTable.id);

  const matching = selectedCompanyId
    ? candidates.filter((candidate) => candidate.companyId === selectedCompanyId)
    : candidates;

  if (!selectedCompanyId && matching.length > 1) {
    return { user: null, ambiguous: true };
  }

  return { user: matching[0] ?? null, ambiguous: false };
}

/**
 * Avtorizacija za bralni obračun ur.
 *
 * POS administratorji uporabljajo enak kontekst kot ostale POS rute.
 * ERP računovodja/lastnik pa nima POS uporabniškega zapisa, zato ga
 * razrešimo prek X-Company-Id in accounting_roles. Ta middleware je
 * namenjen samo GET /izmene/obracun-ur in ne odpira drugih POS rut.
 */
export async function requireObracunUrAccess(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ napaka: "Prijava je obvezna" });
    return;
  }

  const enotaIdRaw = req.headers["x-enota-id"] ?? req.query["enota_id"];
  const requestedEnotaId = enotaIdRaw ? parseInt(String(enotaIdRaw), 10) : NaN;
  const selectedCompanyId = requestedCompanyId(req);

  // ERP pot je vedno izrecno vezana na izbrano družbo. Preverimo jo pred
  // POS članstvom, saj je isti uporabnik lahko POS uporabnik v družbi A in
  // računovodja/lastnik v družbi B.
  if (selectedCompanyId) {
    const [erpAccess] = await db
      .select({
        companyId: accountingRolesTable.companyId,
        role: accountingRolesTable.role,
        idZaDdv: companiesTable.idZaDdv,
      })
      .from(accountingRolesTable)
      .innerJoin(companiesTable, eq(companiesTable.id, accountingRolesTable.companyId))
      .where(and(
        eq(accountingRolesTable.clerkUserId, userId),
        eq(accountingRolesTable.companyId, selectedCompanyId),
        inArray(accountingRolesTable.role, ["owner", "accountant"]),
      ))
      .limit(1);

    if (erpAccess) {
      const context = req as PosRequest;
      context.clerkUserId = userId;
      context.companyId = erpAccess.companyId;
      context.vloga = `erp_${erpAccess.role}`;
      context.idZaDdv = erpAccess.idZaDdv ?? null;
      context.jeDdvZavezanec = jeZavezanecDdv(erpAccess.idZaDdv);
      (req as any).companyId = erpAccess.companyId;
      next();
      return;
    }
  }

  // POS superadmin lahko uporablja POS kontekst, kadar je enota podana.
  if (SUPER_ADMIN_IDS.includes(userId) && Number.isInteger(requestedEnotaId) && requestedEnotaId > 0) {
    const [enota] = await db
      .select({ id: enoteTable.id, companyId: enoteTable.companyId, idZaDdv: companiesTable.idZaDdv })
      .from(enoteTable)
      .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
      .where(eq(enoteTable.id, requestedEnotaId))
      .limit(1);
    if (!enota) {
      res.status(403).json({ napaka: "Poslovna enota ne obstaja", koda: "ENOTA_NEDOSTOPNA" });
      return;
    }
    const context = req as PosRequest;
    context.enotaId = requestedEnotaId;
    context.clerkUserId = userId;
    context.companyId = enota.companyId;
    context.vloga = "superadmin";
    context.idZaDdv = enota.idZaDdv ?? null;
    context.jeDdvZavezanec = jeZavezanecDdv(enota.idZaDdv);
    (req as any).companyId = enota.companyId;
    next();
    return;
  }

  const posResolution = await resolvePosUser(userId, selectedCompanyId);
  if (posResolution.ambiguous) {
    res.status(400).json({
      napaka: "Izberite podjetje z glavo X-Company-Id",
      koda: "PODJETJE_NEJASNO",
    });
    return;
  }
  const posUser = posResolution.user;

  if (posUser) {
    let resolvedEnotaId = Number.isInteger(requestedEnotaId) && requestedEnotaId > 0
      ? requestedEnotaId
      : null;

    if (!resolvedEnotaId) {
      if (posUser.vloga === "admin") {
        const [prvaEnota] = await db
          .select({ id: enoteTable.id })
          .from(enoteTable)
          .where(and(eq(enoteTable.companyId, posUser.companyId), eq(enoteTable.aktiven, true)))
          .orderBy(enoteTable.id)
          .limit(1);
        if (!prvaEnota) {
          res.status(400).json({ napaka: "Podjetje nima aktivnih enot" });
          return;
        }
        resolvedEnotaId = prvaEnota.id;
      } else if (posUser.dodeljenaEnotaId) {
        resolvedEnotaId = posUser.dodeljenaEnotaId;
      } else {
        res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
        return;
      }
    }

    if (posUser.vloga === "admin_enote" && posUser.dodeljenaEnotaId !== resolvedEnotaId) {
      res.status(403).json({ napaka: "Admin enote sme dostopati samo do svoje dodeljene enote", koda: "ENOTA_NEDOSTOPNA" });
      return;
    }

    const [enota] = await db
      .select({ id: enoteTable.id, companyId: enoteTable.companyId, idZaDdv: companiesTable.idZaDdv })
      .from(enoteTable)
      .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
      .where(and(eq(enoteTable.id, resolvedEnotaId), eq(enoteTable.companyId, posUser.companyId)))
      .limit(1);
    if (!enota) {
      res.status(403).json({ napaka: "Poslovna enota ne obstaja ali nimate dostopa do nje", koda: "ENOTA_NEDOSTOPNA" });
      return;
    }

    const context = req as PosRequest;
    context.enotaId = resolvedEnotaId;
    context.clerkUserId = userId;
    context.companyId = enota.companyId;
    context.vloga = posUser.vloga;
    context.idZaDdv = enota.idZaDdv ?? null;
    context.jeDdvZavezanec = jeZavezanecDdv(enota.idZaDdv);
    (req as any).companyId = enota.companyId;
    next();
    return;
  }

  if (!selectedCompanyId) {
    res.status(400).json({ error: "Manjka glava X-Company-Id" });
    return;
  }
  res.status(403).json({ error: "Za obračun ur potrebujete vlogo računovodja ali lastnik." });
}

/**
 * requireEnota — Clerk JWT preverjanje + enota validacija.
 * Nastavi req.enotaId, req.clerkUserId in req.companyId.
 */
export async function requireEnota(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Preveri Clerk JWT prek globalnega clerkMiddleware (nastavljenega v app.ts)
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ napaka: "Prijava je obvezna" });
    return;
  }

  // 2. Pridobi enota_id — iz headerja (fetch klici) ali query parametra (window.open popup)
  const enotaIdRaw = req.headers["x-enota-id"] ?? req.query["enota_id"];
  const enotaId = enotaIdRaw ? parseInt(String(enotaIdRaw), 10) : NaN;

  // Superadmin bypass — superadmin sme dostopati do katerekoli enote
  if (SUPER_ADMIN_IDS.includes(userId)) {
    if (!enotaId || isNaN(enotaId)) {
      res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
      return;
    }
    const [enota] = await db
      .select({
        id: enoteTable.id,
        companyId: enoteTable.companyId,
        aktiven: enoteTable.aktiven,
        idZaDdv: companiesTable.idZaDdv,
      })
      .from(enoteTable)
      .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
      .where(eq(enoteTable.id, enotaId))
      .limit(1);
    if (!enota || !enota.aktiven) {
      res.status(403).json({ napaka: "Poslovna enota ne obstaja", koda: "ENOTA_NEDOSTOPNA" });
      return;
    }
    (req as PosRequest).enotaId = enotaId;
    (req as PosRequest).clerkUserId = userId;
    (req as PosRequest).companyId = enota.companyId;
    (req as PosRequest).vloga = "superadmin";
    (req as PosRequest).idZaDdv = enota.idZaDdv ?? null;
    (req as PosRequest).jeDdvZavezanec = jeZavezanecDdv(enota.idZaDdv);
    (req as any).companyId = enota.companyId;
    next();
    return;
  }

  // 3. POS uporabnik se brez izrecne družbe razreši samo, kadar ima natanko
  // eno aktivno članstvo; več podjetij zahteva X-Company-Id.
  const selectedCompanyId = requestedCompanyId(req);
  const posResolution = await resolvePosUser(userId, selectedCompanyId);
  if (posResolution.ambiguous) {
    res.status(400).json({
      napaka: "Izberite podjetje z glavo X-Company-Id",
      koda: "PODJETJE_NEJASNO",
    });
    return;
  }
  const posUser = posResolution.user;

  if (!posUser) {
    res.status(403).json({ napaka: "Nimate dostopa do POS sistema" });
    return;
  }

  // Določi dejanski enotaId — iz headerja ali fallback kadar ga ni
  let resolvedEnotaId = (!enotaId || isNaN(enotaId)) ? null : enotaId;

  if (!resolvedEnotaId) {
    if (posUser.vloga === "admin") {
      // Admin podjetja brez X-Enota-Id: avtomatsko izberi prvo aktivno enoto podjetja
      const [prvaEnota] = await db
        .select({ id: enoteTable.id })
        .from(enoteTable)
        .where(and(eq(enoteTable.companyId, posUser.companyId), eq(enoteTable.aktiven, true)))
        .orderBy(enoteTable.id)
        .limit(1);
      if (!prvaEnota) {
        res.status(400).json({ napaka: "Podjetje nima aktivnih enot" });
        return;
      }
      resolvedEnotaId = prvaEnota.id;
    } else if (posUser.dodeljenaEnotaId) {
      // admin_enote / uporabnik: uporabi dodeljeno enoto kot fallback
      resolvedEnotaId = posUser.dodeljenaEnotaId;
    } else {
      res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
      return;
    }
  }

  // Enota je obvezna za operativni POS vlogi. Obe smeta uporabljati le svojo
  // dodeljeno enoto; admin podjetja ostane omejen na poljubno enoto podjetja.
  if (posUser.vloga === "admin_enote" || posUser.vloga === "uporabnik") {
    if (!posUser.dodeljenaEnotaId || posUser.dodeljenaEnotaId !== resolvedEnotaId) {
      const now = new Date();
      const [grant] = await db.select({ id: posEventStaffGrantsTable.id }).from(posEventStaffGrantsTable)
        .where(and(
          eq(posEventStaffGrantsTable.posUserId, posUser.id),
          eq(posEventStaffGrantsTable.unitId, resolvedEnotaId),
          eq(posEventStaffGrantsTable.revoked, false),
          lte(posEventStaffGrantsTable.validFrom, now),
          gte(posEventStaffGrantsTable.validTo, now),
        )).limit(1);
      if (!grant) {
        res.status(403).json({
          napaka: "Uporabnik sme dostopati samo do svoje dodeljene ali začasno odobrene enote",
          koda: "ENOTA_NEDOSTOPNA",
        });
        return;
      }
    }
  }

  if (!resolvedEnotaId) {
    res.status(400).json({ napaka: "Manjka X-Enota-Id glava" });
    return;
  }

  // 4. Preveri da je enota aktivna IN pripada uporabnikovemu podjetju; pridobi DDV status
  const [enota] = await db
    .select({
      id: enoteTable.id,
      companyId: enoteTable.companyId,
      aktiven: enoteTable.aktiven,
      idZaDdv: companiesTable.idZaDdv,
    })
    .from(enoteTable)
    .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
    .where(and(eq(enoteTable.id, resolvedEnotaId), eq(enoteTable.companyId, posUser.companyId)))
    .limit(1);

  if (!enota || !enota.aktiven) {
    res.status(403).json({ napaka: "Poslovna enota ne obstaja ali nimate dostopa do nje", koda: "ENOTA_NEDOSTOPNA" });
    return;
  }

  // 5. Nastavi na zahtevku
  (req as PosRequest).enotaId = resolvedEnotaId;
  (req as PosRequest).clerkUserId = userId;
  (req as PosRequest).companyId = enota.companyId;
  (req as PosRequest).vloga = posUser.vloga;
  (req as PosRequest).idZaDdv = enota.idZaDdv ?? null;
  (req as PosRequest).jeDdvZavezanec = jeZavezanecDdv(enota.idZaDdv);
  (req as any).companyId = enota.companyId;

  next();
}

/**
 * requirePosCompany — Clerk JWT preverjanje + company izolacija prek POS user zapisa.
 * Uporablja se za rute ki ne zahtevajo X-Enota-Id (npr. upravljanje enot).
 * Nastavi req.companyId in req.clerkUserId.
 * Zahteva vlogo admin ali admin_enote.
 */
export async function requirePosCompany(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  // 1. Preveri Clerk JWT
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ napaka: "Prijava je obvezna" });
    return;
  }

  // Superadmin bypass
  if (SUPER_ADMIN_IDS.includes(userId)) {
    (req as PosRequest).clerkUserId = userId;
    (req as PosRequest).companyId = "";
    (req as PosRequest).vloga = "superadmin";
    (req as any).companyId = "";
    next();
    return;
  }

  // 2. Upravljanje enot je company-scope pot: pri več podjetjih mora biti
  // družba izbrana eksplicitno, zato deaktivirana enota ne more zakleniti
  // njene kasnejše reaktivacije.
  const posResolution = await resolvePosUser(userId, requestedCompanyId(req));
  if (posResolution.ambiguous) {
    res.status(400).json({
      napaka: "Izberite podjetje z glavo X-Company-Id",
      koda: "PODJETJE_NEJASNO",
    });
    return;
  }
  const user = posResolution.user;

  if (!user) {
    res.status(403).json({ napaka: "Nimate dostopa do POS sistema" });
    return;
  }

  if (user.vloga !== "admin" && user.vloga !== "admin_enote") {
    res.status(403).json({ napaka: "Upravljanje enot zahteva vlogo admin ali admin_enote" });
    return;
  }

  // 3. Nastavi na zahtevku
  (req as PosRequest).clerkUserId = userId;
  (req as PosRequest).companyId = user.companyId;
  (req as PosRequest).vloga = user.vloga;
  (req as any).companyId = user.companyId;

  next();
}

/** Alias za združljivost s kopiranimi rutami — zamenjuje session requireAuth */
export const posAuth = requireEnota;
