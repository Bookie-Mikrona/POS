/**
 * POST (upsert) /bizbox-nastavitve — shrani per-podjetje bizBox poverilnice (admin)
 * GET          /bizbox-nastavitve — vrni nastavitve BEZ gesla (samo gesloNastavljeno: bool)
 *
 * Geslo se šifrira z AES-256-GCM (BIZBOX_ENC_KEY) in shrani v bizbox_nastavitve.
 * NIKOLI se ne vrne v odgovoru — le indikator `gesloNastavljeno: true/false`.
 *
 * Dostop: requireEnota (admin enote) — companyId se vzame iz middleware konteksta.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, bizboxNastavitveTable } from "@workspace/db";
import { sifrirajBizboxGeslo, preveriKljucBizbox } from "../../lib/kripto-bizbox";

const router: IRouter = Router();

// ── Pomožna: preveri, da je klicatelj admin ali superadmin ────────────────────
// bizBox poverilnice so skupne za celotno podjetje — pisalni dostop
// mora biti omejen na polnega administratorja podjetja.
// "admin_enote" in "uporabnik" ne smeta menjati ali brisati poverilnic.
function zahtevajAdmin(req: any, res: any): boolean {
  const vloga: string = req.vloga ?? "";
  if (vloga === "admin" || vloga === "superadmin") return true;
  res.status(403).json({
    error: "Dostop zavrnjen — upravljanje bizBox poverilnic zahteva vlogo admin ali superadmin.",
  });
  return false;
}

// Bralni dostop: admin, admin_enote in superadmin smejo brati status
function zahtevajVsajAdminEnote(req: any, res: any): boolean {
  const vloga: string = req.vloga ?? "";
  if (vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin") return true;
  res.status(403).json({
    error: "Dostop zavrnjen — ogled bizBox nastavitev zahteva vlogo admin, admin_enote ali superadmin.",
  });
  return false;
}

// ── GET /bizbox-nastavitve ────────────────────────────────────────────────────
// Vrne nastavitve podjetja. Geslo NIKOLI ni v odgovoru.
// Zahteva requireEnota (apliciran na router-nivoju v pos/index.ts) + admin/admin_enote.
router.get("/bizbox-nastavitve", async (req, res): Promise<void> => {
  if (!zahtevajVsajAdminEnote(req, res)) return;
  const companyId = (req as any).companyId as string;
  if (!companyId) { res.status(400).json({ error: "companyId ni na voljo" }); return; }

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
    // Brez konfiguracije — vrni prazno + indikator
    res.json({
      gesloNastavljeno: false,
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
});

// ── PUT /bizbox-nastavitve ────────────────────────────────────────────────────
// Upsert nastavitve. Geslo se pošlje samo ob spremembi (bizboxPass je opcijsko).
// Ob PUT brez bizboxPass se obstoječe šifrirano geslo ohrani.
// Samo admin ali superadmin smeta pisati.
router.put("/bizbox-nastavitve", async (req, res): Promise<void> => {
  if (!zahtevajAdmin(req, res)) return;
  const companyId = (req as any).companyId as string;
  if (!companyId) { res.status(400).json({ error: "companyId ni na voljo" }); return; }

  const { bizboxUser, bizboxPass, bizboxOkolje, posiljateljDavcna } = req.body as {
    bizboxUser?: string;
    bizboxPass?: string;
    bizboxOkolje?: string;
    posiljateljDavcna?: string | null;
  };

  // Validacija
  if (!bizboxUser || typeof bizboxUser !== "string" || !bizboxUser.trim()) {
    res.status(400).json({ error: "bizboxUser je obvezen" }); return;
  }
  const okolje = bizboxOkolje === "prod" ? "prod" : "test";

  // Preverimo, ali obstaja že vnosek (za UPSERT brez gesla)
  const [obstojeciRow] = await db
    .select({ bizboxPassEnc: bizboxNastavitveTable.bizboxPassEnc })
    .from(bizboxNastavitveTable)
    .where(eq(bizboxNastavitveTable.companyId, companyId));

  // Šifriramo geslo (novo ali obstoječe)
  let passEnc: string;
  if (bizboxPass && typeof bizboxPass === "string" && bizboxPass.length > 0) {
    // Preverimo, ali BIZBOX_ENC_KEY dela
    if (!preveriKljucBizbox()) {
      res.status(500).json({
        error: "BIZBOX_ENC_KEY ni pravilno konfiguriran v Replit Secrets. " +
               "Ključ mora biti prisoten in dolg vsaj 32 znakov.",
      });
      return;
    }
    passEnc = sifrirajBizboxGeslo(bizboxPass);
  } else if (obstojeciRow) {
    // Ohrani obstoječe šifrirano geslo
    passEnc = obstojeciRow.bizboxPassEnc;
  } else {
    res.status(400).json({
      error: "Ob prvem shranjevanju je bizboxPass (geslo) obvezno",
    });
    return;
  }

  // Upsert
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
});

// ── DELETE /bizbox-nastavitve ────────────────────────────────────────────────
// Pobriše per-podjetje nastavitve (fallback se vrne na env).
// Samo admin ali superadmin smeta brisati.
router.delete("/bizbox-nastavitve", async (req, res): Promise<void> => {
  if (!zahtevajAdmin(req, res)) return;
  const companyId = (req as any).companyId as string;
  if (!companyId) { res.status(400).json({ error: "companyId ni na voljo" }); return; }

  await db.delete(bizboxNastavitveTable)
    .where(eq(bizboxNastavitveTable.companyId, companyId));

  res.json({ uspeh: true, izbrisan: true });
});

export default router;
