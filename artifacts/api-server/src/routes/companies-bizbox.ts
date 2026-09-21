/**
 * Skupni dostop do e-račun registracije in bizBox poverilnic za:
 *   - ERP lastnik (owner v accounting_roles)
 *   - POS admin (vloga="admin" v pos_uporabniki)
 *   - Superadmin
 *
 * Vsi endpointi so company-scoped: companyId iz URL, vsakdo dostopa
 * samo do lastnega podjetja.
 *
 * GET  /companies/:id/eracun-nastavitve   — e-račun polja podjetja (samo ta polja)
 * PATCH /companies/:id/eracun-nastavitve  — uredi e-račun polja (ne ostalih polj podjetja)
 * GET  /companies/:id/bizbox-nastavitve   — bizBox status (brez gesla)
 * PUT  /companies/:id/bizbox-nastavitve   — shrani/posodobi bizBox poverilnice
 * DELETE /companies/:id/bizbox-nastavitve — odstrani bizBox poverilnice
 *
 * Geslo se šifrira z AES-256-GCM (BIZBOX_ENC_KEY) — NIKOLI ni vrnjeno v odgovoru.
 */
import { Router, type IRouter } from "express";
import { eq, and } from "drizzle-orm";
import {
  db,
  companiesTable,
  accountingRolesTable,
  posUporabnikiTable,
  bizboxNastavitveTable,
} from "@workspace/db";
import { requireAuth, type AuthenticatedRequest } from "../middlewares/requireAuth";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";
import { sifrirajBizboxGeslo, preveriKljucBizbox } from "../lib/kripto-bizbox";
import type { Request, Response } from "express";

const router: IRouter = Router();

// ── Skupna avtorizacijska pomoč ───────────────────────────────────────────────
/**
 * Vrne vlogo klicatelja za podjetje, ali null ob nedostopnosti.
 * Company-scope je zagotovljen: preverja se glede na companyId iz URL.
 */
export async function resolvePodjetjeSkrbnik(
  clerkUserId: string,
  companyId: string,
): Promise<"superadmin" | "erp_owner" | "pos_admin" | null> {
  // 1. Superadmin (globalen, env var)
  if (isSuperAdmin(clerkUserId)) return "superadmin";

  // 2. ERP owner za to podjetje
  const [erpRole] = await db
    .select({ role: accountingRolesTable.role })
    .from(accountingRolesTable)
    .where(and(
      eq(accountingRolesTable.clerkUserId, clerkUserId),
      eq(accountingRolesTable.companyId, companyId),
    ))
    .limit(1);
  if (erpRole?.role === "owner") return "erp_owner";

  // 3. POS admin za to podjetje
  const [posUser] = await db
    .select({ vloga: posUporabnikiTable.vloga })
    .from(posUporabnikiTable)
    .where(and(
      eq(posUporabnikiTable.clerkUserId, clerkUserId),
      eq(posUporabnikiTable.companyId, companyId),
      eq(posUporabnikiTable.aktiven, true),
    ))
    .limit(1);
  if (posUser?.vloga === "admin") return "pos_admin";

  return null;
}

// ── e-Račun registracijska polja podjetja ────────────────────────────────────

/**
 * GET /companies/:id/eracun-nastavitve
 * Vrne samo e-račun registracijska polja (ne ostalih podatkov podjetja).
 */
router.get(
  "/companies/:id/eracun-nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = req.params["id"] as string;

    const vloga = await resolvePodjetjeSkrbnik(authReq.clerkUserId, companyId);
    if (!vloga) { res.status(403).json({ error: "Dostop zavrnjen" }); return; }

    const [company] = await db
      .select({
        eRacunPrejemnik:  companiesTable.eRacunPrejemnik,
        eRacunOmrezje:    companiesTable.eRacunOmrezje,
        eRacunEmail:      companiesTable.eRacunEmail,
        eRacunNaslov:     companiesTable.eRacunNaslov,
        eRacunSifraPu:    companiesTable.eRacunSifraPu,
        eRacunBic:        companiesTable.eRacunBic,
      })
      .from(companiesTable)
      .where(eq(companiesTable.id, companyId));

    if (!company) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

    res.json(company);
  },
);

/**
 * PATCH /companies/:id/eracun-nastavitve
 * Posodobi samo e-račun registracijska polja. Ostala polja podjetja (naziv, davčna…)
 * so nedostopna prek tega endpointa — za to ostane PATCH /companies/:id (samo ERP owner).
 */
router.patch(
  "/companies/:id/eracun-nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = req.params["id"] as string;

    const vloga = await resolvePodjetjeSkrbnik(authReq.clerkUserId, companyId);
    if (!vloga) { res.status(403).json({ error: "Dostop zavrnjen" }); return; }

    const b = req.body as Record<string, unknown>;

    // Stroga whitelist — samo e-račun polja; nobeno drugo polje podjetja
    type EracunData = {
      eRacunPrejemnik?: boolean | null;
      eRacunOmrezje?:   string | null;
      eRacunEmail?:     string | null;
      eRacunNaslov?:    string | null;
      eRacunSifraPu?:   string | null;
      eRacunBic?:       string | null;
    };
    const data: EracunData = {};

    for (const field of [
      "eRacunOmrezje", "eRacunEmail", "eRacunNaslov", "eRacunSifraPu", "eRacunBic",
    ] as const) {
      if (field in b) {
        if (b[field] !== null && typeof b[field] !== "string") {
          res.status(400).json({ error: `${field} mora biti niz ali null` }); return;
        }
        data[field] = b[field] as string | null;
      }
    }
    if ("eRacunPrejemnik" in b) {
      if (b.eRacunPrejemnik !== null && typeof b.eRacunPrejemnik !== "boolean") {
        res.status(400).json({ error: "eRacunPrejemnik mora biti boolean ali null" }); return;
      }
      data.eRacunPrejemnik = b.eRacunPrejemnik as boolean | null;
    }

    const [updated] = await db
      .update(companiesTable)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(companiesTable.id, companyId))
      .returning({
        eRacunPrejemnik:  companiesTable.eRacunPrejemnik,
        eRacunOmrezje:    companiesTable.eRacunOmrezje,
        eRacunEmail:      companiesTable.eRacunEmail,
        eRacunNaslov:     companiesTable.eRacunNaslov,
        eRacunSifraPu:    companiesTable.eRacunSifraPu,
        eRacunBic:        companiesTable.eRacunBic,
      });

    if (!updated) { res.status(404).json({ error: "Podjetje ni najdeno" }); return; }

    res.json(updated);
  },
);

// ── bizBox poverilnice — podjetniška raven ────────────────────────────────────

/**
 * GET /companies/:id/bizbox-nastavitve
 * Vrne bizBox status. Geslo se NIKOLI ne vrne — samo indikator gesloNastavljeno.
 */
router.get(
  "/companies/:id/bizbox-nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = req.params["id"] as string;

    const vloga = await resolvePodjetjeSkrbnik(authReq.clerkUserId, companyId);
    if (!vloga) { res.status(403).json({ error: "Dostop zavrnjen" }); return; }

    const [row] = await db
      .select({
        bizboxUser:        bizboxNastavitveTable.bizboxUser,
        bizboxOkolje:      bizboxNastavitveTable.bizboxOkolje,
        posiljateljDavcna: bizboxNastavitveTable.posiljateljDavcna,
        updatedAt:         bizboxNastavitveTable.updatedAt,
      })
      .from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));

    if (!row) {
      res.json({
        gesloNastavljeno:  false,
        bizboxUser:        "",
        bizboxOkolje:      "test",
        posiljateljDavcna: null,
        updatedAt:         null,
      });
      return;
    }

    res.setHeader("Cache-Control", "no-store, max-age=0");
    res.json({
      gesloNastavljeno:  true,
      bizboxUser:        row.bizboxUser,
      bizboxOkolje:      row.bizboxOkolje,
      posiljateljDavcna: row.posiljateljDavcna ?? null,
      updatedAt:         row.updatedAt,
      // bizboxPassEnc se NIKOLI ne vrne
    });
  },
);

/**
 * PUT /companies/:id/bizbox-nastavitve
 * Upsert. Geslo pošlji samo ob spremembi; brez bizboxPass se obstoječe ohrani.
 */
router.put(
  "/companies/:id/bizbox-nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = req.params["id"] as string;

    const vloga = await resolvePodjetjeSkrbnik(authReq.clerkUserId, companyId);
    if (!vloga) { res.status(403).json({ error: "Dostop zavrnjen" }); return; }

    const { bizboxUser, bizboxPass, bizboxOkolje, posiljateljDavcna } = req.body as {
      bizboxUser?: string;
      bizboxPass?: string;
      bizboxOkolje?: string;
      posiljateljDavcna?: string | null;
    };

    if (!bizboxUser || typeof bizboxUser !== "string" || !bizboxUser.trim()) {
      res.status(400).json({ error: "bizboxUser je obvezen" }); return;
    }
    const okolje = bizboxOkolje === "prod" ? "prod" : "test";

    const [obstojeciRow] = await db
      .select({ bizboxPassEnc: bizboxNastavitveTable.bizboxPassEnc })
      .from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));

    let passEnc: string;
    if (bizboxPass && typeof bizboxPass === "string" && bizboxPass.length > 0) {
      if (!preveriKljucBizbox()) {
        res.status(500).json({
          error: "BIZBOX_ENC_KEY ni pravilno konfiguriran v Replit Secrets.",
        });
        return;
      }
      passEnc = sifrirajBizboxGeslo(bizboxPass);
    } else if (obstojeciRow) {
      passEnc = obstojeciRow.bizboxPassEnc;
    } else {
      res.status(400).json({ error: "Ob prvem shranjevanju je bizboxPass (geslo) obvezno" });
      return;
    }

    await db
      .insert(bizboxNastavitveTable)
      .values({
        companyId,
        bizboxUser:        bizboxUser.trim(),
        bizboxPassEnc:     passEnc,
        bizboxOkolje:      okolje,
        posiljateljDavcna: posiljateljDavcna?.trim() || null,
        updatedAt:         new Date(),
      })
      .onConflictDoUpdate({
        target: bizboxNastavitveTable.companyId,
        set: {
          bizboxUser:        bizboxUser.trim(),
          bizboxPassEnc:     passEnc,
          bizboxOkolje:      okolje,
          posiljateljDavcna: posiljateljDavcna?.trim() || null,
          updatedAt:         new Date(),
        },
      });

    res.json({ uspeh: true, gesloNastavljeno: true });
  },
);

/**
 * DELETE /companies/:id/bizbox-nastavitve
 * Odstrani per-podjetje poverilnice (oddaja se vrne na env fallback).
 */
router.delete(
  "/companies/:id/bizbox-nastavitve",
  requireAuth,
  async (req: Request, res: Response): Promise<void> => {
    const authReq = req as AuthenticatedRequest;
    const companyId = req.params["id"] as string;

    const vloga = await resolvePodjetjeSkrbnik(authReq.clerkUserId, companyId);
    if (!vloga) { res.status(403).json({ error: "Dostop zavrnjen" }); return; }

    await db
      .delete(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));

    res.json({ uspeh: true, izbrisan: true });
  },
);

export default router;
