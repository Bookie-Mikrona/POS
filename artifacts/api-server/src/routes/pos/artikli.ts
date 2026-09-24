import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import { and, asc, count, desc, eq, inArray, ne, sql, sum } from "drizzle-orm";
import { artModSkupineTable, articleImageVersionsTable, artikliTable, companiesTable, db, enoteTable, kategorijeTable, modNormativiTable, modSkupineTable, modifikatorjiTable, multicourseMenusTable, nastavitveTable, normativiTable, pizzaDoughSettingsTable, posNormativeChangeAuditTable, postavkeTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import ExcelJS from "exceljs";
import multer from "multer";
import { resolveArticleType } from "../../lib/articleType";
import { CreateArtikelBody, GenerateArtikelImageBody, PreviewArtikelAlergeniNormativBody, UpdateArtikelBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../../lib/objectStorage";
import { izracunajVelikostiPic } from "../../lib/pica-velikosti";
import { readAll } from "./nastavitve";
import { generateImage, ImageGenerationError } from "@workspace/integrations-gemini-ai/image";
import {
  ArticleImageReferenceError,
  extractArticleImageReferenceUrls,
  loadArticleImageReferences,
} from "../../lib/article-image-references";
import {
  ArticleImageNormalizationError,
  normalizeArticleImage,
} from "../../lib/article-image-normalization";
import { isAllowedOneToOneSelfNorm, requiresClassicNormativ } from "../../lib/normativ-validation";
import { lockPosBusinessDay } from "../../lib/pos-z-helpers";
import { isMenuEligibleTaxCategory, normalizeAddedSugarForTaxCategory, type TaxCategory } from "../../lib/ddv-resolver";
import PDFDocument from "pdfkit";
import { normalizirajAlergenProfil } from "../../lib/alergeni";
import { razresiAlergeneArtikla, razresiAlergeneVhodnihArtiklov, razveljaviAlergeneNadrejenih } from "../../lib/alergeni-resolver";
import { generateMenuPriceListPdf } from "../../lib/menu-price-list-pdf";
import Decimal from "decimal.js";
import { verifyNormativeProposal } from "../../lib/normative-comparison";
import { z } from "zod";
import { anthropic } from "@workspace/integrations-anthropic-ai";
import { toUneceUnitCode } from "../../lib/received-invoice-eslog";
import {
  getInitialRecipeResearch,
  InitialNormativeError,
  isDetectablyPreparedIngredient,
  normalizeIngredientName,
  signInitialNormativeProposal,
  singleIngredientDrinkFromName,
  verifyInitialNormativeProposal,
  type InitialNormativeUnit,
} from "../../lib/initial-smart-normative";

const router: IRouter = Router();
class NormativeStaleError extends Error {}
type NormativeGraphLockTestContext = {
  artikelId: number;
  operation: "article-update" | "normativ-update";
};
let normativRevisionLockTestHook:
  ((context: NormativeGraphLockTestContext) => Promise<void>) | undefined;
const NORMATIVE_GRAPH_LOCK_NAMESPACE = 1_315_924_557;

export function setNormativRevisionLockTestHook(
  hook?: (context: NormativeGraphLockTestContext) => Promise<void>,
): void {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("Normativ revision lock hook je dovoljen samo v testih.");
  }
  normativRevisionLockTestHook = hook;
}

class NormativeRequestError extends Error {
  constructor(
    public readonly status: number,
    public readonly responseBody: Record<string, unknown>,
  ) {
    super(String(responseBody.error ?? "Neveljaven normativ."));
  }
}

async function lockNormativeGraph(tx: any, enotaId: number): Promise<void> {
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(
      ${NORMATIVE_GRAPH_LOCK_NAMESPACE}::integer,
      ${enotaId}::integer
    )
  `);
}

const ApplyNormativeProposalsBody = z.object({
  selections: z.array(z.object({ proposalToken: z.string().min(1).max(8_000), confirmed: z.literal(true) }).strict()).min(1).max(50),
}).strict();

const SELECT_FIELDS = {
  id: artikliTable.id,
  ime: artikliTable.ime,
  opis: artikliTable.opis,
  cena: artikliTable.cena,
  cenaMala: artikliTable.cenaMala,
  cenaDruzinska: artikliTable.cenaDruzinska,
  davek: artikliTable.davek,
  aktiven: artikliTable.aktiven,
  kategorijaId: artikliTable.kategorijaId,
  kategorijaIme: kategorijeTable.ime,
  barva: artikliTable.barva,
  opisSlike: artikliTable.opisSlike,
  slikaUrl: artikliTable.slikaUrl,
  vrstniRed: artikliTable.vrstniRed,
  nabavniArtikel: artikliTable.nabavniArtikel,
  prodajniArtikel: artikliTable.prodajniArtikel,
  jeSkupinskiNabavniArtikel: artikliTable.jeSkupinskiNabavniArtikel,
  povratnaEmbalaza: artikliTable.povratnaEmbalaza,
  vrstaEmbalaze: artikliTable.vrstaEmbalaze,
  depozitnaVrednost: artikliTable.depozitnaVrednost,
  imeZaNabavo: artikliTable.imeZaNabavo,
  enotaMere: artikliTable.enotaMere,
  normativRevision: artikliTable.normativRevision,
  jePica: artikliTable.jePica,
  jeDodatekZaPico: artikliTable.jeDodatekZaPico,
  privzetiDodatki: artikliTable.privzetiDodatki,
  jeModifikator: artikliTable.jeModifikator,
  privzetiModifikatorji: artikliTable.privzetiModifikatorji,
  toGoArtikli: artikliTable.toGoArtikli,
  toGo: artikliTable.toGo,
  casPripraveMin: artikliTable.casPripraveMin,
  mealType: artikliTable.mealType,
  vrstaArtikla: artikliTable.vrstaArtikla,
  happyHourCena: artikliTable.happyHourCena,
  happyHourCenaMala: artikliTable.happyHourCenaMala,
  happyHourCenaDruzinska: artikliTable.happyHourCenaDruzinska,
  skupina: artikliTable.skupina,
  taxCategory: artikliTable.taxCategory,
  jeDelMenija: artikliTable.jeDelMenija,
  addedSugar: artikliTable.addedSugar,
  knCode: artikliTable.knCode,
  alergeni: artikliTable.alergeni,
  alergeniSledi: artikliTable.alergeniSledi,
  alergeniStatus: artikliTable.alergeniStatus,
  alergeniVir: artikliTable.alergeniVir,
  alergeniOpombaVira: artikliTable.alergeniOpombaVira,
  alergeniDocumentId: artikliTable.alergeniDocumentId,
  alergeniVerifiedBy: artikliTable.alergeniVerifiedBy,
  alergeniVerifiedAt: artikliTable.alergeniVerifiedAt,
  alergeniRevision: artikliTable.alergeniRevision,
  alergeniHash: artikliTable.alergeniHash,
  hasNormativ: sql<boolean>`EXISTS (SELECT 1 FROM normativi WHERE artikel_id = ${artikliTable.id})`,
  isMulticourseMenu: sql<boolean>`EXISTS (
    SELECT 1 FROM multicourse_menus
    WHERE menu_artikel_id = ${artikliTable.id}
      AND enota_id = ${artikliTable.enotaId}
  )`,
  vNormativih: sql<boolean>`EXISTS (SELECT 1 FROM normativi WHERE vhodni_artikel_id = ${artikliTable.id})
                         OR EXISTS (SELECT 1 FROM modifikator_normativi WHERE vhodni_artikel_id = ${artikliTable.id})`};

function mapRow(r: Record<string, unknown>) {
  return {
    id: r.id as number,
    ime: r.ime as string,
    opis: (r.opis as string | null) ?? null,
    cena: Number(r.cena),
    cenaMala: r.cenaMala == null ? null : Number(r.cenaMala),
    cenaDruzinska: r.cenaDruzinska == null ? null : Number(r.cenaDruzinska),
    davek: Number(r.davek),
    aktiven: r.aktiven as boolean,
    kategorijaId: (r.kategorijaId as number | null) ?? null,
    kategorijaIme: (r.kategorijaIme as string | null) ?? null,
    barva: (r.barva as string | null) ?? null,
    opisSlike: (r.opisSlike as string | null) ?? null,
    slikaUrl: (r.slikaUrl as string | null) ?? null,
    vrstniRed: r.vrstniRed as number,
    nabavniArtikel: r.nabavniArtikel as boolean,
    prodajniArtikel: r.prodajniArtikel as boolean,
    jeSkupinskiNabavniArtikel: Boolean(r.jeSkupinskiNabavniArtikel),
    povratnaEmbalaza: Boolean(r.povratnaEmbalaza),
    vrstaEmbalaze: (r.vrstaEmbalaze as string | null) ?? null,
    depozitnaVrednost: r.depozitnaVrednost == null ? null : Number(r.depozitnaVrednost),
    imeZaNabavo: (r.imeZaNabavo as string | null) ?? null,
    enotaMere: (r.enotaMere as string | null) ?? null,
    normativRevision: Number(r.normativRevision ?? 1),
    jePica: r.jePica as boolean,
    jeDodatekZaPico: r.jeDodatekZaPico as boolean,
    privzetiDodatki: (r.privzetiDodatki as number[] | null) ?? [],
    jeModifikator: r.jeModifikator as boolean,
    privzetiModifikatorji: (r.privzetiModifikatorji as number[] | null) ?? [],
    toGoArtikli: (r.toGoArtikli as number[] | null) ?? [],
    toGo: Boolean(r.toGo),
    casPripraveMin: Number(r.casPripraveMin ?? 0),
    mealType: (r.mealType as "ala_carte" | "prepared" | "composite" | null) ?? "ala_carte",
    vrstaArtikla: resolveArticleType(r.vrstaArtikla as string | null, {
      nabavniArtikel: r.nabavniArtikel as boolean,
      prodajniArtikel: r.prodajniArtikel as boolean,
    }),
    happyHourCena: r.happyHourCena != null ? Number(r.happyHourCena) : null,
    happyHourCenaMala: r.happyHourCenaMala != null ? Number(r.happyHourCenaMala) : null,
    happyHourCenaDruzinska: r.happyHourCenaDruzinska != null ? Number(r.happyHourCenaDruzinska) : null,
    skupina: (r.skupina as string | null) ?? null,
    taxCategory: (r.taxCategory as string | null) ?? "food",
    jeDelMenija: Boolean(r.jeDelMenija),
    addedSugar: Boolean(r.addedSugar),
    knCode: (r.knCode as string | null) ?? null,
    alergeni: (r.alergeni as string[] | null) ?? [],
    alergeniSledi: (r.alergeniSledi as string[] | null) ?? [],
    alergeniStatus: r.alergeniStatus as string,
    alergeniVir: (r.alergeniVir as string | null) ?? null,
    alergeniOpombaVira: (r.alergeniOpombaVira as string | null) ?? null,
    alergeniDocumentId: (r.alergeniDocumentId as string | null) ?? null,
    alergeniVerifiedBy: (r.alergeniVerifiedBy as string | null) ?? null,
    alergeniVerifiedAt: (r.alergeniVerifiedAt as Date | null)?.toISOString() ?? null,
    alergeniRevision: Number(r.alergeniRevision ?? 0),
    alergeniHash: (r.alergeniHash as string | null) ?? null,
    hasNormativ: Boolean(r.hasNormativ),
    isMulticourseMenu: Boolean(r.isMulticourseMenu),
    vNormativih: Boolean(r.vNormativih),
    modSkupine: [] as Array<{
      id: number; ime: string; obvezna: boolean; minIzbir: number; maxIzbir: number; vrstniRed: number;
      modifikatorji: Array<{ id: number; skupinaId: number; ime: string; cenaDodatek: number; aktiven: boolean; vrstniRed: number }>;
    }>};
}

type PizzaCenaInput = Record<string, unknown>;
type PizzaCeneArtikla = {
  jePica: boolean;
  cena: string | number;
  cenaMala: string | number | null;
  cenaDruzinska: string | number | null;
  happyHourCena: string | number | null;
  happyHourCenaMala: string | number | null;
  happyHourCenaDruzinska: string | number | null;
};

function jeVeljavnaCena(vrednost: unknown): boolean {
  if (vrednost === null || vrednost === undefined || vrednost === "" || (typeof vrednost !== "number" && typeof vrednost !== "string")) return false;
  if (typeof vrednost === "string" && vrednost.trim() === "") return false;
  const cena = Number(vrednost);
  return Number.isFinite(cena) && cena >= 0;
}

/**
 * Dodatni ceni sta obvezni samo za dejansko aktivni velikosti. Pri urejanju
 * združimo poslano delno telo z obstoječim artiklom, zato pravila ne more
 * obiti niti neposreden API klic.
 */
async function preveriCenePic(
  podatki: PizzaCenaInput,
  enotaId: number,
  obstojeci?: PizzaCeneArtikla,
): Promise<string | null> {
  const jePica = podatki.jePica === undefined ? obstojeci?.jePica ?? false : podatki.jePica === true;
  for (const [polje, naziv] of [
    ["cena", "osnovne"],
    ["cenaMala", "male"],
    ["cenaDruzinska", "družinske"],
    ["happyHourCena", "Happy Hour normalne"],
    ["happyHourCenaMala", "Happy Hour male"],
    ["happyHourCenaDruzinska", "Happy Hour družinske"],
  ] as const) {
    if (podatki[polje] !== undefined && podatki[polje] !== null && !jeVeljavnaCena(podatki[polje])) {
      return `Cena ${naziv} pice mora biti število 0 ali več.`;
    }
  }
  if (!jePica) return null;

  const aktivneVelikosti = izracunajVelikostiPic(await readAll("", enotaId));
  for (const velikost of aktivneVelikosti) {
    if (velikost.id === "normalna") continue;
    const polje = velikost.id === "mala" ? "cenaMala" : "cenaDruzinska";
    const cena = podatki[polje] === undefined ? obstojeci?.[polje] : podatki[polje];
    if (!jeVeljavnaCena(cena)) {
      return `Za aktivno ${velikost.naziv.toLowerCase()} pico je treba vnesti ceno.`;
    }
  }
  // Happy Hour cena je neodvisna od drugih velikosti: pravilo lahko velja
  // samo za malo, normalno ali družinsko pico. Posamezne neprazne vrednosti
  // smo že preverili zgoraj, prazne pa pomenijo brez popusta za to velikost.
  return null;
}

async function fetchModSkupineForArtikli(artikelIds: number[]) {
  if (artikelIds.length === 0) return new Map<number, ReturnType<typeof mapRow>["modSkupine"]>();

  const rows = await db
    .select({
      artikelId: artModSkupineTable.artikelId,
      skupinaVrstniRed: artModSkupineTable.vrstniRed,
      skupinaId: modSkupineTable.id,
      skupinaIme: modSkupineTable.ime,
      skupinaObvezna: modSkupineTable.obvezna,
      skupinaMinIzbir: modSkupineTable.minIzbir,
      skupinaMaxIzbir: modSkupineTable.maxIzbir,
      skupinaVrstniRedNat: modSkupineTable.vrstniRed,
      modId: modifikatorjiTable.id,
      modIme: modifikatorjiTable.ime,
      modCenaDodatek: modifikatorjiTable.cenaDodatek,
      modAktiven: modifikatorjiTable.aktiven,
      modVrstniRed: modifikatorjiTable.vrstniRed})
    .from(artModSkupineTable)
    .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
    .leftJoin(modifikatorjiTable, eq(modifikatorjiTable.skupinaId, modSkupineTable.id))
    .where(inArray(artModSkupineTable.artikelId, artikelIds))
    .orderBy(asc(artModSkupineTable.vrstniRed), asc(modSkupineTable.id), asc(modifikatorjiTable.vrstniRed), asc(modifikatorjiTable.id));

  const map = new Map<number, Map<number, ReturnType<typeof mapRow>["modSkupine"][number]>>();
  for (const r of rows) {
    const aId = r.artikelId as number;
    if (!map.has(aId)) map.set(aId, new Map());
    const skupineMap = map.get(aId)!;
    if (!skupineMap.has(r.skupinaId as number)) {
      skupineMap.set(r.skupinaId as number, {
        id: r.skupinaId as number,
        ime: r.skupinaIme as string,
        obvezna: r.skupinaObvezna as boolean,
        minIzbir: r.skupinaMinIzbir as number,
        maxIzbir: r.skupinaMaxIzbir as number,
        vrstniRed: r.skupinaVrstniRed as number,
        modifikatorji: []});
    }
    if (r.modId != null) {
      skupineMap.get(r.skupinaId as number)!.modifikatorji.push({
        id: r.modId as number,
        skupinaId: r.skupinaId as number,
        ime: r.modIme as string,
        cenaDodatek: Number(r.modCenaDodatek),
        aktiven: r.modAktiven as boolean,
        vrstniRed: r.modVrstniRed as number});
    }
  }

  const result = new Map<number, ReturnType<typeof mapRow>["modSkupine"]>();
  for (const [aId, skupineMap] of map.entries()) {
    result.set(aId, Array.from(skupineMap.values()));
  }
  return result;
}

router.get("/artikli/priljubljeni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const rows = await db
    .select({
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      steviloNarocil: count(postavkeTable.id),
      skupajZnesek: sum(postavkeTable.skupaj)})
    .from(postavkeTable)
    .innerJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.enotaId, tenotaId)))
    .groupBy(postavkeTable.artikelId, postavkeTable.ime)
    .orderBy(desc(count(postavkeTable.id)))
    .limit(10);

  const mapped = rows.map((r) => ({
    artikelId: r.artikelId,
    ime: r.ime,
    steviloNarocil: Number(r.steviloNarocil),
    skupajZnesek: Number(r.skupajZnesek ?? 0)}));

  res.json((mapped));
});

router.get("/artikli", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  const conditions = [sql`true`, eq(artikliTable.enotaId, tenotaId)];
  if (query.data.kategorijaId != null) conditions.push(eq(artikliTable.kategorijaId, Number(query.data.kategorijaId)));

  const rows = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(...conditions))
    .orderBy(asc(artikliTable.vrstniRed), asc(artikliTable.ime));

  const mapped = rows.map(mapRow);
  const modMap = await fetchModSkupineForArtikli(mapped.map((a) => a.id));
  const enriched = mapped.map((a) => ({ ...a, modSkupine: modMap.get(a.id) ?? [] }));
  res.json((enriched));
});

router.get("/artikli/:id/pizza-dough-norms", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) {
    res.status(400).json({ error: "Neveljaven ID artikla." });
    return;
  }

  const [pizza] = await db.select({ id: artikliTable.id, jePica: artikliTable.jePica })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), eq(artikliTable.enotaId, tenotaId)));
  if (!pizza) {
    res.status(404).json({ error: "Artikel ni najden." });
    return;
  }
  if (!pizza.jePica) {
    res.json([]);
    return;
  }

  const [settings] = await db.select({
    normalDoughArticleId: pizzaDoughSettingsTable.normalDoughArticleId,
    smallDoughArticleId: pizzaDoughSettingsTable.smallDoughArticleId,
  }).from(pizzaDoughSettingsTable)
    .where(eq(pizzaDoughSettingsTable.enotaId, tenotaId));
  if (!settings) {
    res.json([]);
    return;
  }

  const doughIds = [settings.normalDoughArticleId, settings.smallDoughArticleId];
  const doughArticles = await db.select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), inArray(artikliTable.id, doughIds)));
  if (doughArticles.length !== new Set(doughIds).size) {
    res.status(500).json({ error: "Nastavitev testa za pico vsebuje artikel iz druge enote ali neobstoječ artikel." });
    return;
  }
  const articlesById = new Map(doughArticles.map((article) => [article.id, article]));
  res.json([
    { size: "normalna", ingredient: { id: settings.normalDoughArticleId, name: articlesById.get(settings.normalDoughArticleId)!.ime }, quantity: 1 },
    { size: "mala", ingredient: { id: settings.smallDoughArticleId, name: articlesById.get(settings.smallDoughArticleId)!.ime }, quantity: 1 },
  ]);
});

router.post("/artikli", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = CreateArtikelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const napakaCenePic = await preveriCenePic(parsed.data as PizzaCenaInput, tenotaId);
  if (napakaCenePic) { res.status(400).json({ error: napakaCenePic }); return; }

  if (parsed.data.kategorijaId != null) {
    const [kat] = await db.select({ id: kategorijeTable.id })
      .from(kategorijeTable)
      .where(and(eq(kategorijeTable.id, parsed.data.kategorijaId), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
    if (!kat) { res.status(403).json({ error: "Kategorija ne pripada temu podjetju" }); return; }
  }

  const nabavniArtikel = parsed.data.nabavniArtikel ?? false;
  const prodajniArtikel = parsed.data.prodajniArtikel ?? true;
  const jeSkupinskiNabavniArtikel = parsed.data.jeSkupinskiNabavniArtikel ?? false;
  if (jeSkupinskiNabavniArtikel && (
    !nabavniArtikel || prodajniArtikel || !toUneceUnitCode(parsed.data.enotaMere)
  )) {
    res.status(400).json({
      error: "Generični nabavni artikel mora biti samo nabavni in imeti podprto UN/ECE enoto mere.",
    });
    return;
  }
  const vrstaArtikla = resolveArticleType(
    (parsed.data as { vrstaArtikla?: string }).vrstaArtikla,
    { nabavniArtikel, prodajniArtikel },
  );
  const taxCategory = (parsed.data as { taxCategory?: string }).taxCategory ?? "food";
  const jeDelMenija = (parsed.data as { jeDelMenija?: boolean }).jeDelMenija ?? false;
  const requestedAddedSugar = (parsed.data as { addedSugar?: boolean }).addedSugar ?? false;
  const addedSugar = normalizeAddedSugarForTaxCategory(taxCategory, requestedAddedSugar);
  if (taxCategory === "food_drink" && requestedAddedSugar) {
    req.log.warn(
      { taxCategory, requestedAddedSugar },
      "addedSugar je bil pri kategoriji food_drink normaliziran na false",
    );
  }
  if (jeDelMenija && (!prodajniArtikel || !isMenuEligibleTaxCategory(taxCategory))) {
    res.status(400).json({ error: "Kot del menija je mogoče označiti le prodajno toplo ali hladno pijačo." });
    return;
  }

  let row: typeof artikliTable.$inferSelect;
  try {
    row = await db.transaction(async (tx) => {
      await lockPosBusinessDay(tx, tenotaId);
      if (parsed.data.normativItems) {
        await lockNormativeGraph(tx, tenotaId);
      }
      let allergenData: Partial<typeof artikliTable.$inferInsert> = {};
      if ("alergeniStatus" in req.body || "alergeni" in req.body || "alergeniSledi" in req.body) {
        try {
          const profile = normalizirajAlergenProfil(req.body);
          allergenData = { ...profile, alergeniRevision: 1 };
        } catch (error) {
          throw new Error(`ALLERGEN_INVALID:${(error as Error).message}`);
        }
      }
      const mealType = parsed.data.mealType ?? "ala_carte";
      const [inserted] = await tx.insert(artikliTable).values({
        enotaId: tenotaId,
        ime: parsed.data.ime,
        opis: parsed.data.opis ?? null,
        cena: String(parsed.data.cena ?? 0),
        cenaMala: parsed.data.cenaMala == null ? null : String(parsed.data.cenaMala),
        cenaDruzinska: parsed.data.cenaDruzinska == null ? null : String(parsed.data.cenaDruzinska),
        happyHourCena: parsed.data.happyHourCena == null ? null : String(parsed.data.happyHourCena),
        happyHourCenaMala: parsed.data.happyHourCenaMala == null ? null : String(parsed.data.happyHourCenaMala),
        happyHourCenaDruzinska: parsed.data.happyHourCenaDruzinska == null ? null : String(parsed.data.happyHourCenaDruzinska),
        davek: String(parsed.data.davek ?? 0),
        aktiven: parsed.data.aktiven ?? true,
        kategorijaId: parsed.data.kategorijaId ?? null,
        barva: parsed.data.barva ?? null,
        opisSlike: parsed.data.opisSlike?.trim() || null,
        vrstniRed: parsed.data.vrstniRed ?? 0,
        nabavniArtikel,
        prodajniArtikel,
        jeSkupinskiNabavniArtikel,
        povratnaEmbalaza: (parsed.data as any).povratnaEmbalaza ?? false,
        vrstaEmbalaze: (parsed.data as any).vrstaEmbalaze ?? null,
        depozitnaVrednost: (parsed.data as any).depozitnaVrednost == null ? null : String((parsed.data as any).depozitnaVrednost),
        imeZaNabavo: parsed.data.imeZaNabavo ?? null,
        enotaMere: parsed.data.enotaMere ?? null,
        jePica: parsed.data.jePica ?? false,
        jeDodatekZaPico: parsed.data.jeDodatekZaPico ?? false,
        privzetiDodatki: parsed.data.privzetiDodatki ?? [],
        jeModifikator: parsed.data.jeModifikator ?? false,
        privzetiModifikatorji: parsed.data.privzetiModifikatorji ?? [],
        toGoArtikli: parsed.data.toGoArtikli ?? [],
        toGo: parsed.data.toGo ?? false,
        casPripraveMin: Math.max(0, Number((parsed.data as { casPripraveMin?: number }).casPripraveMin ?? 0)),
        mealType,
        vrstaArtikla,
        skupina: (parsed.data as { skupina?: string | null }).skupina ?? null,
        taxCategory,
        jeDelMenija,
        addedSugar,
        knCode: (parsed.data as { knCode?: string | null }).knCode ?? null,
        ...allergenData,
      }).returning();

      if (parsed.data.normativItems) {
        const prepared = await prepareNormativUpdate(
          inserted.id,
          tenotaId,
          {
            expectedRevision: 1,
            items: parsed.data.normativItems.map(item => ({
              ...item,
              vhodniArtikelId: item.vhodniArtikelId === -1 ? inserted.id : item.vhodniArtikelId,
            })),
          },
          { mealType, nabavniArtikel, prodajniArtikel },
          tx,
        );
        await applyPreparedNormativUpdate(tx, inserted.id, tenotaId, prepared);
      }
      return inserted;
    });
  } catch (error) {
    if (String((error as Error).message).startsWith("ALLERGEN_INVALID:")) {
      req.log.warn({ err: error }, "Invalid article allergen profile");
      res.status(400).json({ error: "Alergenski profil ni veljaven." });
      return;
    }
    if (error instanceof NormativeRequestError) {
      res.status(error.status).json(error.responseBody);
      return;
    }
    throw error;
  }

  const [withKat] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(eq(artikliTable.id, row.id));

  res.status(201).json((mapRow(withKat!)));
});

router.patch("/artikli/reorder", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  await Promise.all(
    parsed.data.map(({ id, vrstniRed }: { id: number; vrstniRed: number }) =>
      db.update(artikliTable).set({ vrstniRed })
        .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)))
    )
  );

  res.sendStatus(204);
});

const articleImageStorage = new ObjectStorageService();
const ARTICLE_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_ARTICLE_IMAGE_BYTES = 8 * 1024 * 1024;
const ARTICLE_IMAGE_GENERATION_TIMEOUT_MS = 60_000;
const ARTICLE_IMAGE_SOURCE_ASPECT_RATIO = "21:9";
const ARTICLE_IMAGE_SOURCE_SIZE = "2K";
const articleImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARTICLE_IMAGE_BYTES, files: 1 },
});
const articleImageBulkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ARTICLE_IMAGE_BYTES, files: 50 },
});

function uploadArticleImage(req: Request, res: Response, next: NextFunction): void {
  articleImageUpload.single("file")(req, res, (error: unknown) => {
    if (error instanceof multer.MulterError) {
      res.status(400).json({
        error: error.code === "LIMIT_FILE_SIZE"
          ? "Slika je prevelika. Največja dovoljena velikost je 8 MB."
          : "Nalaganje slike ni uspelo.",
      });
      return;
    }
    if (error) {
      res.status(400).json({ error: "Nalaganje slike ni uspelo." });
      return;
    }
    next();
  });
}

function uploadArticleImages(req: Request, res: Response, next: NextFunction): void {
  articleImageBulkUpload.array("files", 50)(req, res, (error: unknown) => {
    if (error) { res.status(400).json({ error: "Paket slik ni veljaven (največ 50 slik po 8 MB)." }); return; }
    next();
  });
}

function detectArticleImageMimeType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    bytes.length >= 8
    && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "image/png";
  }
  if (
    bytes.length >= 12
    && bytes.subarray(0, 4).toString("ascii") === "RIFF"
    && bytes.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

function buildArticleImagePrompt(description: string, referenceCount: number): string {
  const descriptionWithoutUrls = description.replace(/https?:\/\/[^\s<>"'`]+/gi, "").replace(/\s+/g, " ").trim();
  return [
    "Create one appetizing, realistic professional food-and-drink menu photograph.",
    `Subject: ${descriptionWithoutUrls || "the product shown in the attached references"}.`,
    "Create a native 21:9 panoramic composition for a final 2.5:1 menu image. Keep the complete served product centered and fully visible inside the central safe area, with at least 10% clear space above and below it; do not cut off any part of the food and do not make a square composition.",
    "Show only the served product. Do not include people, hands, text, packaging labels, logos, watermarks or price tags.",
    ...(referenceCount > 0
      ? [`Use the ${referenceCount} attached reference image${referenceCount === 1 ? "" : "s"} as visual inspiration for the product's shape, colors, proportions and presentation. Do not copy any logo, text, trademark or watermark from the references.`]
      : []),
  ].join(" ");
}

function articleImageKey(slikaUrl: string): string | null {
  const prefix = "/api/storage/public-objects/";
  return slikaUrl.startsWith(prefix) ? slikaUrl.slice(prefix.length) : null;
}

async function setCurrentArticleImage(
  artikelId: number,
  enotaId: number,
  imageKey: string,
  source: "upload" | "generate" | "edit" | "restore" | "bulk",
  options: { prompt?: string | null; altText?: string | null } = {},
): Promise<void> {
  const slikaUrl = `/api/storage/public-objects/${imageKey}`;
  await db.transaction(async (tx) => {
    await tx.update(articleImageVersionsTable)
      .set({ isCurrent: false })
      .where(and(eq(articleImageVersionsTable.artikelId, artikelId), eq(articleImageVersionsTable.isCurrent, true)));
    await tx.insert(articleImageVersionsTable).values({
      artikelId, storageKey: imageKey, slikaUrl, source, isCurrent: true,
      prompt: options.prompt ?? null, altText: options.altText ?? null,
    });
    await tx.update(artikliTable)
      .set({ slikaUrl, ...(options.prompt !== undefined ? { opisSlike: options.prompt } : {}) })
      .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  });
}

async function articleImageResponse(artikelId: number, enotaId: number, res: Response): Promise<void> {
  const [row] = await db.select(SELECT_FIELDS).from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), eq(kategorijeTable.enotaId, enotaId)))
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!row) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  res.json(mapRow(row));
}

router.post("/artikli/:id/generiraj-sliko", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const artikelId = Number(req.params.id);
  if (!Number.isInteger(artikelId) || artikelId < 1) {
    res.status(400).json({ error: "Neveljaven artikel" });
    return;
  }

  const parsed = GenerateArtikelImageBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Opis slike mora vsebovati največ 500 znakov." });
    return;
  }
  const opisSlike = parsed.data.opisSlike.trim();
  if (!opisSlike) {
    res.status(400).json({ error: "Vnesite opis slike." });
    return;
  }

  const [artikel] = await db
    .select({
      id: artikliTable.id,
      prodajniArtikel: artikliTable.prodajniArtikel,
    })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, tenotaId)))
    .limit(1);
  if (!artikel) {
    res.status(404).json({ error: "Artikel ni najden" });
    return;
  }
  if (!artikel.prodajniArtikel) {
    res.status(400).json({ error: "Sliko lahko ustvarite samo za prodajni artikel." });
    return;
  }

  try {
    const referenceUrls = extractArticleImageReferenceUrls(opisSlike);
    const referenceImages = await loadArticleImageReferences(referenceUrls);
    const generated = await generateImage(
      buildArticleImagePrompt(opisSlike, referenceImages.length),
      {
        abortSignal: AbortSignal.timeout(ARTICLE_IMAGE_GENERATION_TIMEOUT_MS),
        referenceImages,
        imageConfig: {
          aspectRatio: ARTICLE_IMAGE_SOURCE_ASPECT_RATIO,
          imageSize: ARTICLE_IMAGE_SOURCE_SIZE,
        },
      },
    );
    if (!ARTICLE_IMAGE_MIME_TYPES.has(generated.mimeType.toLowerCase())) {
      req.log.warn({ mimeType: generated.mimeType }, "Unsupported generated article image MIME type");
      res.status(502).json({ error: "Storitev je vrnila nepodprto vrsto slike." });
      return;
    }

    const base64 = generated.b64Json.replace(/\s/g, "");
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
      res.status(502).json({ error: "Storitev je vrnila neveljavne slikovne podatke." });
      return;
    }
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > MAX_ARTICLE_IMAGE_BYTES) {
      req.log.warn({ bytes: bytes.length }, "Generated article image had invalid size");
      res.status(502).json({ error: "Ustvarjena slika je neveljavna ali prevelika." });
      return;
    }

    const normalizedImage = await normalizeArticleImage(bytes, { fit: "contain" });
    const imageKey = `article-images/enota-${tenotaId}/artikel-${artikelId}-${crypto.randomUUID()}.webp`;
    await articleImageStorage.savePublicObject(imageKey, normalizedImage, "image/webp");
    await setCurrentArticleImage(artikelId, tenotaId, imageKey, "generate", { prompt: opisSlike });
    await articleImageResponse(artikelId, tenotaId, res);
  } catch (error) {
    req.log.error({ err: error, artikelId }, "Article image generation failed");
    if ((error as { name?: string }).name === "AbortError") {
      res.status(504).json({ error: "Ustvarjanje slike je trajalo predolgo. Poskusite znova." });
      return;
    }
    if (error instanceof ImageGenerationError) {
      res.status(502).json({ error: error.message });
      return;
    }
    if (error instanceof ArticleImageReferenceError) {
      res.status(400).json({ error: error.message });
      return;
    }
    const upstreamStatus = Number((error as { status?: number }).status);
    if (upstreamStatus === 429 || upstreamStatus >= 500) {
      res.status(503).json({ error: "Storitev za ustvarjanje slik je trenutno zasedena. Poskusite malo pozneje." });
      return;
    }
    res.status(502).json({ error: "Slike ni bilo mogoče ustvariti. Poskusite znova." });
  }
});

router.post("/artikli/:id/nalozi-sliko", requireEnota, uploadArticleImage, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const artikelId = Number(req.params.id);
  if (!Number.isInteger(artikelId) || artikelId < 1) {
    res.status(400).json({ error: "Neveljaven artikel" });
    return;
  }

  const file = req.file;
  if (!file) {
    res.status(400).json({ error: "Izberite sliko za nalaganje." });
    return;
  }
  const actualMimeType = detectArticleImageMimeType(file.buffer);
    if (!actualMimeType || actualMimeType !== file.mimetype || !ARTICLE_IMAGE_MIME_TYPES.has(actualMimeType)) {
    res.status(400).json({ error: "Podprte so samo veljavne slike JPEG, PNG ali WebP." });
    return;
  }

  const [artikel] = await db
    .select({
      id: artikliTable.id,
      prodajniArtikel: artikliTable.prodajniArtikel,
    })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, tenotaId)))
    .limit(1);
  if (!artikel) {
    res.status(404).json({ error: "Artikel ni najden" });
    return;
  }
  if (!artikel.prodajniArtikel) {
    res.status(400).json({ error: "Sliko lahko naložite samo za prodajni artikel." });
    return;
  }

  try {
    const normalizedImage = await normalizeArticleImage(file.buffer);
    const imageKey = `article-images/enota-${tenotaId}/artikel-${artikelId}-${crypto.randomUUID()}.webp`;
    await articleImageStorage.savePublicObject(imageKey, normalizedImage, "image/webp");
    await setCurrentArticleImage(artikelId, tenotaId, imageKey, "upload");
    await articleImageResponse(artikelId, tenotaId, res);
  } catch (error) {
    req.log.error({ err: error, artikelId }, "Article image upload failed");
    if (error instanceof ArticleImageNormalizationError) {
      res.status(400).json({ error: error.message });
      return;
    }
    res.status(502).json({ error: "Slike ni bilo mogoče shraniti. Poskusite znova." });
  }
});

router.get("/artikli/:id/slike", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id);
  const enotaId = (req as any).enotaId ?? 1;
  if (!Number.isInteger(artikelId)) { res.status(400).json({ error: "Neveljaven artikel" }); return; }
  const [artikel] = await db.select({ id: artikliTable.id }).from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  const versions = await db.select().from(articleImageVersionsTable)
    .where(eq(articleImageVersionsTable.artikelId, artikelId))
    .orderBy(desc(articleImageVersionsTable.createdAt), desc(articleImageVersionsTable.id));
  res.json(versions.map((version) => ({ ...version, createdAt: version.createdAt.toISOString() })));
});

router.post("/artikli/:id/uredi-sliko", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id);
  const enotaId = (req as any).enotaId ?? 1;
  const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
  if (!Number.isInteger(artikelId) || !prompt || prompt.length > 500) {
    res.status(400).json({ error: "Navodilo za urejanje je obvezno in lahko vsebuje največ 500 znakov." }); return;
  }
  const [artikel] = await db.select({ slikaUrl: artikliTable.slikaUrl, prodajniArtikel: artikliTable.prodajniArtikel })
    .from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  const imageKey = artikel?.slikaUrl ? articleImageKey(artikel.slikaUrl) : null;
  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  if (!artikel.prodajniArtikel || !imageKey) { res.status(400).json({ error: "Za urejanje najprej dodajte sliko prodajnemu artiklu." }); return; }
  try {
    const file = await articleImageStorage.searchPublicObject(imageKey);
    if (!file) { res.status(409).json({ error: "Trenutna slika v shrambi ne obstaja. Naložite novo sliko." }); return; }
    const [originalBytes] = await file.download();
    const generated = await generateImage(
      `${buildArticleImagePrompt(prompt, 1)} Edit the attached image according to this instruction while preserving the dish identity: ${prompt}`,
      { abortSignal: AbortSignal.timeout(ARTICLE_IMAGE_GENERATION_TIMEOUT_MS), referenceImages: [{ mimeType: "image/webp", b64Json: originalBytes.toString("base64") }], imageConfig: { aspectRatio: ARTICLE_IMAGE_SOURCE_ASPECT_RATIO, imageSize: ARTICLE_IMAGE_SOURCE_SIZE } },
    );
    const bytes = Buffer.from(generated.b64Json.replace(/\s/g, ""), "base64");
    if (!ARTICLE_IMAGE_MIME_TYPES.has(generated.mimeType.toLowerCase()) || !bytes.length || bytes.length > MAX_ARTICLE_IMAGE_BYTES) {
      res.status(502).json({ error: "Storitev je vrnila neveljavno urejeno sliko." }); return;
    }
    const key = `article-images/enota-${enotaId}/artikel-${artikelId}-${crypto.randomUUID()}.webp`;
    await articleImageStorage.savePublicObject(key, await normalizeArticleImage(bytes, { fit: "contain" }), "image/webp");
    await setCurrentArticleImage(artikelId, enotaId, key, "edit", { prompt });
    await articleImageResponse(artikelId, enotaId, res);
  } catch (error) {
    req.log.error({ err: error, artikelId }, "Article image edit failed");
    res.status(error instanceof ArticleImageNormalizationError ? 400 : 502).json({ error: error instanceof ImageGenerationError ? error.message : "Slike ni bilo mogoče urediti. Poskusite znova." });
  }
});

router.post("/artikli/:id/slike/:versionId/obnovi", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id), versionId = Number(req.params.versionId), enotaId = (req as any).enotaId ?? 1;
  const [version] = await db.select({ storageKey: articleImageVersionsTable.storageKey, altText: articleImageVersionsTable.altText })
    .from(articleImageVersionsTable).innerJoin(artikliTable, eq(articleImageVersionsTable.artikelId, artikliTable.id))
    .where(and(eq(articleImageVersionsTable.id, versionId), eq(articleImageVersionsTable.artikelId, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!version) { res.status(404).json({ error: "Različica slike ni najdena." }); return; }
  await setCurrentArticleImage(artikelId, enotaId, version.storageKey, "restore", { altText: version.altText });
  await articleImageResponse(artikelId, enotaId, res);
});

router.patch("/artikli/:id/slike/alt", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id), enotaId = (req as any).enotaId ?? 1;
  const altText = typeof req.body?.altText === "string" ? req.body.altText.trim() : "";
  if (!Number.isInteger(artikelId) || altText.length > 250) { res.status(400).json({ error: "Nadomestno besedilo lahko vsebuje največ 250 znakov." }); return; }
  const [article] = await db.select({ id: artikliTable.id }).from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!article) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  const result = await db.update(articleImageVersionsTable).set({ altText: altText || null })
    .where(and(eq(articleImageVersionsTable.artikelId, artikelId), eq(articleImageVersionsTable.isCurrent, true))).returning();
  if (!result.length) { res.status(404).json({ error: "Aktivna slika ni najdena." }); return; }
  res.json(result[0]);
});

router.delete("/artikli/:id/slike/trenutna", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id), enotaId = (req as any).enotaId ?? 1;
  if (req.body?.confirm !== true) { res.status(400).json({ error: "Za odstranitev slike je potrebna izrecna potrditev." }); return; }
  const [article] = await db.select({ id: artikliTable.id }).from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!article) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  await db.transaction(async (tx) => {
    await tx.update(articleImageVersionsTable).set({ isCurrent: false })
      .where(and(eq(articleImageVersionsTable.artikelId, artikelId), eq(articleImageVersionsTable.isCurrent, true)));
    await tx.update(artikliTable).set({ slikaUrl: null })
      .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  }).catch((error) => {
    throw error;
  });
  if (!res.headersSent) res.sendStatus(204);
});

router.get("/artikli/slike/pregled", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const articles = await db.select({ id: artikliTable.id, ime: artikliTable.ime, slikaUrl: artikliTable.slikaUrl })
    .from(artikliTable).where(and(eq(artikliTable.enotaId, enotaId), eq(artikliTable.prodajniArtikel, true)));
  const missing = articles.filter((article) => !article.slikaUrl);
  const broken: Array<{ id: number; ime: string }> = [];
  // Verification is intentionally read-only: no lifecycle task can delete an object referenced by a version.
  for (const article of articles.filter((item) => item.slikaUrl)) {
    const key = articleImageKey(article.slikaUrl!);
    if (!key || !await articleImageStorage.searchPublicObject(key)) broken.push({ id: article.id, ime: article.ime });
  }
  res.json({ total: articles.length, missing, broken });
});

router.post("/artikli/slike/bulk", requireEnota, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  const ids: number[] = Array.isArray(req.body?.artikelIds) ? req.body.artikelIds.map(Number).filter(Number.isInteger) : [];
  if (!ids.length || ids.length > 100) { res.status(400).json({ error: "Izberite od 1 do 100 artiklov." }); return; }
  if (req.body?.action === "remove") {
    if (req.body?.confirm !== true) { res.status(400).json({ error: "Za paketno odstranitev je potrebna izrecna potrditev." }); return; }
    const saved = await db.transaction(async (tx) => {
      await tx.update(articleImageVersionsTable).set({ isCurrent: false }).where(and(inArray(articleImageVersionsTable.artikelId, ids), eq(articleImageVersionsTable.isCurrent, true)));
      await tx.update(artikliTable).set({ slikaUrl: null }).where(and(inArray(artikliTable.id, ids), eq(artikliTable.enotaId, enotaId)));
    });
    res.json({ updated: ids.length, action: "remove" }); return;
  }
  const sourceId = Number(req.body?.sourceArtikelId);
  const [source] = await db.select({ storageKey: articleImageVersionsTable.storageKey, altText: articleImageVersionsTable.altText })
    .from(articleImageVersionsTable).innerJoin(artikliTable, eq(articleImageVersionsTable.artikelId, artikliTable.id))
    .where(and(eq(articleImageVersionsTable.artikelId, sourceId), eq(articleImageVersionsTable.isCurrent, true), eq(artikliTable.enotaId, enotaId)));
  if (!source) { res.status(400).json({ error: "Izvorna trenutna slika ni najdena." }); return; }
  for (const artikelId of ids.filter((id) => id !== sourceId)) await setCurrentArticleImage(artikelId, enotaId, source.storageKey, "bulk", { altText: source.altText });
  res.json({ updated: ids.filter((id) => id !== sourceId).length, action: "replace" });
});

router.post("/artikli/slike/bulk-upload", requireEnota, uploadArticleImages, async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId ?? 1;
  let mapping: Record<string, number>;
  try { mapping = JSON.parse(String(req.body?.mapping ?? "{}")); } catch { res.status(400).json({ error: "Preslikava datotek ni veljaven JSON." }); return; }
  const files = (req.files ?? []) as Express.Multer.File[];
  const updated: number[] = [], errors: Array<{ file: string; error: string }> = [];
  for (const file of files) {
    const artikelId = Number(mapping[file.originalname]);
    if (!Number.isInteger(artikelId) || !detectArticleImageMimeType(file.buffer)) { errors.push({ file: file.originalname, error: "Datoteka nima veljavne preslikave ali slike." }); continue; }
    const [article] = await db.select({ id: artikliTable.id }).from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
    if (!article) { errors.push({ file: file.originalname, error: "Artikel ni najden." }); continue; }
    try {
      const key = `article-images/enota-${enotaId}/artikel-${artikelId}-${crypto.randomUUID()}.webp`;
      await articleImageStorage.savePublicObject(key, await normalizeArticleImage(file.buffer), "image/webp");
      await setCurrentArticleImage(artikelId, enotaId, key, "upload"); updated.push(artikelId);
    } catch { errors.push({ file: file.originalname, error: "Slike ni mogoče shraniti." }); }
  }
  res.json({ updated, errors });
});

router.post("/artikli/uskladi-ddv", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  // Preberi globalne DDV stopnje
  const globalRows = await db
    .select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, 0)));
  const ddvMap: Record<string, string> = {};
  for (const r of globalRows) ddvMap[r.kljuc] = r.vrednost;
  const splosnaSt = Number(ddvMap["ddvSplosnaSt"] ?? "22");
  const nizjaSt   = Number(ddvMap["ddvNizjaSt"]   ?? "9.5");
  const znizanaSt = Number(ddvMap["ddvZnizanaSt"] ?? "5");
  const slots = [splosnaSt, nizjaSt, znizanaSt];

  // Preberi vse artikle podjetja
  const artiki = await db
    .select({ id: artikliTable.id, davek: artikliTable.davek })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId)));

  // Razporedi artikle po ciljni stopnji (davek=0 preskočimo)
  const skupineUpdate = new Map<number, number[]>();
  for (const art of artiki) {
    const trenutna = Number(art.davek);
    if (trenutna === 0) continue;
    let najbljizja = slots[0]!;
    let minDiff = Math.abs(trenutna - najbljizja);
    for (const s of slots) {
      const diff = Math.abs(trenutna - s);
      if (diff < minDiff) { minDiff = diff; najbljizja = s; }
    }
    if (najbljizja === trenutna) continue;
    const ids = skupineUpdate.get(najbljizja) ?? [];
    ids.push(art.id);
    skupineUpdate.set(najbljizja, ids);
  }

  let posodobljeno = 0;
  for (const [novaStopnja, ids] of skupineUpdate.entries()) {
    await db
      .update(artikliTable)
      .set({ davek: String(novaStopnja) })
      .where(and(eq(artikliTable.enotaId, tenotaId),
        inArray(artikliTable.id, ids)
      ));
    posodobljeno += ids.length;
  }

  res.json({ posodobljeno, splosnaSt, nizjaSt, znizanaSt });
});

// ── GET /artikli/izvozi-excel — izvoz vseh artiklov in normativov v .xlsx ──────
router.get("/artikli/izvozi-excel", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const ENOTE_MERE = ["kom", "kos", "par", "set", "porcija", "kg", "dag", "g", "l", "dl", "ml", "m", "m²", "m³"];
  const MAX_VRSTIC = 500; // skupaj vrstic s podatki + praznih

  const [artikli, normativi, kategorije] = await Promise.all([
    db.select({
      ime: artikliTable.ime,
      opis: artikliTable.opis,
      cena: artikliTable.cena,
      davek: artikliTable.davek,
      vrstaArtikla: artikliTable.vrstaArtikla,
      kategorijaIme: kategorijeTable.ime,
      barva: artikliTable.barva,
      aktiven: artikliTable.aktiven,
      nabavniArtikel: artikliTable.nabavniArtikel,
      prodajniArtikel: artikliTable.prodajniArtikel,
      imeZaNabavo: artikliTable.imeZaNabavo,
      enotaMere: artikliTable.enotaMere,
      toGo: artikliTable.toGo,
    })
      .from(artikliTable)
      .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), eq(kategorijeTable.enotaId, tenotaId)))
      .where(eq(artikliTable.enotaId, tenotaId))
      .orderBy(asc(kategorijeTable.ime), asc(artikliTable.vrstniRed), asc(artikliTable.ime)),
    db.execute(sql`
      SELECT
        a.ime        AS "artikelIme",
        v.ime        AS "sestavinaIme",
        n.kolicina   AS "kolicina",
        v.enota_mere AS "enotaMere"
      FROM normativi n
      JOIN artikli a ON n.artikel_id = a.id AND a.enota_id = ${tenotaId}
      JOIN artikli v ON n.vhodni_artikel_id = v.id AND v.enota_id = ${tenotaId}
      ORDER BY a.ime, n.vrstni_red
    `),
    db.select({ ime: kategorijeTable.ime })
      .from(kategorijeTable)
      .where(eq(kategorijeTable.enotaId, tenotaId))
      .orderBy(asc(kategorijeTable.ime)),
  ]);

  const wb = new ExcelJS.Workbook();
  wb.creator = "POS Gostinstvo";

  // ── Skrit list: Šifranti (kategorije + enote mere) ────────────────────────
  const katImena = kategorije.map(k => k.ime);
  const wsSif = wb.addWorksheet("Sifranti", { state: "veryHidden" });
  wsSif.columns = [{ width: 30 }, { width: 15 }];
  const maxSifVrstic = Math.max(katImena.length, ENOTE_MERE.length);
  for (let i = 0; i < maxSifVrstic; i++) {
    wsSif.addRow([katImena[i] ?? "", ENOTE_MERE[i] ?? ""]);
  }

  // ── List 1: Artikli ────────────────────────────────────────────────────────
  // Stolpci: A=ime B=cena C=ddv D=vrstaArtikla E=kategorija F=opis G=barva H=aktiven I=nabavniArtikel J=prodajniArtikel K=imeZaNabavo L=enotaMere M=toGo
  const wsArt = wb.addWorksheet("Artikli");
  wsArt.columns = [
    { header: "ime",             key: "ime",             width: 28 },
    { header: "cena",            key: "cena",            width: 10 },
    { header: "ddv",             key: "ddv",             width: 7  },
    { header: "vrstaArtikla",    key: "vrstaArtikla",    width: 13 },
    { header: "kategorija",      key: "kategorija",      width: 20 },
    { header: "opis",            key: "opis",            width: 32 },
    { header: "barva",           key: "barva",           width: 10 },
    { header: "aktiven",         key: "aktiven",         width: 9  },
    { header: "nabavniArtikel",  key: "nabavniArtikel",  width: 15 },
    { header: "prodajniArtikel", key: "prodajniArtikel", width: 15 },
    { header: "imeZaNabavo",     key: "imeZaNabavo",     width: 22 },
    { header: "enotaMere",       key: "enotaMere",       width: 13 },
    { header: "toGo",            key: "toGo",            width: 9  },
    { header: "skupina",         key: "skupina",         width: 20 },
  ];

  // Glava — krepko + ozadje
  const headerRow = wsArt.getRow(1);
  headerRow.font = { bold: true };
  headerRow.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  headerRow.alignment = { vertical: "middle" };
  wsArt.views = [{ state: "frozen", ySplit: 1 }]; // zamrznjena glava

  // Obstoječi artikli
  for (const a of artikli) {
    wsArt.addRow({
      ime:             a.ime,
      cena:            Number(a.cena),
      ddv:             Number(a.davek),
      vrstaArtikla:    resolveArticleType(a.vrstaArtikla, {
        nabavniArtikel: a.nabavniArtikel,
        prodajniArtikel: a.prodajniArtikel,
      }),
      kategorija:      a.kategorijaIme ?? "",
      opis:            a.opis ?? "",
      barva:           a.barva ?? "",
      aktiven:         a.aktiven ? "DA" : "NE",
      nabavniArtikel:  a.nabavniArtikel ? "DA" : "NE",
      prodajniArtikel: a.prodajniArtikel ? "DA" : "NE",
      imeZaNabavo:     a.imeZaNabavo ?? "",
      enotaMere:       a.enotaMere ?? "",
      toGo:            a.toGo ? "DA" : "NE",
      skupina:         (a as typeof a & { skupina?: string | null }).skupina ?? "",
    });
  }

  // Prazne vrstice s privzetimi vrednostmi in formulami
  // Stolpci: H=aktiven I=nabavniArtikel J=prodajniArtikel K=imeZaNabavo M=toGo
  const prvaVrsticaZaVnos = artikli.length + 2; // +1 za glavo, +1 za 1-based
  for (let r = prvaVrsticaZaVnos; r <= MAX_VRSTIC + 1; r++) {
    const row = wsArt.getRow(r);
    row.getCell("D").value = "storitev"; // vrstaArtikla (prodajniArtikel=DA)
    row.getCell("H").value = "DA";       // aktiven
    row.getCell("J").value = "DA";       // prodajniArtikel
    row.getCell("M").value = "NE";       // toGo
    // imeZaNabavo: avtomatično iz imena ko je nabavniArtikel=DA
    row.getCell("K").value = { formula: `IF(I${r}="DA",A${r},"")` };
  }

  // Validacija podatkov (dropdowni) — za vse vrstice s podatki
  const r1 = 2;
  const r2 = MAX_VRSTIC + 1;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wsArtDv = (wsArt as any).dataValidations;

  // Vrsta artikla (D)
  wsArtDv.add(`D${r1}:D${r2}`, {
    type: "list",
    allowBlank: false,
    formulae: ['"blago,material,storitev"'],
    showErrorMessage: true,
    errorStyle: "stop",
    error: 'Veljavne vrednosti: blago, material, storitev',
  });

  // Kategorija (E)
  if (katImena.length > 0) {
    wsArtDv.add(`E${r1}:E${r2}`, {
      type: "list",
      allowBlank: true,
      formulae: [`Sifranti!$A$1:$A$${katImena.length}`],
      showErrorMessage: false,
    });
  }

  // DA/NE polja: H=aktiven, I=nabavniArtikel, J=prodajniArtikel, M=toGo
  for (const col of ["H", "I", "J", "M"]) {
    wsArtDv.add(`${col}${r1}:${col}${r2}`, {
      type: "list",
      allowBlank: false,
      formulae: ['"DA,NE"'],
      showErrorMessage: true,
      errorStyle: "stop",
      error: 'Vnesite "DA" ali "NE"',
    });
  }

  // Enota mere (L)
  wsArtDv.add(`L${r1}:L${r2}`, {
    type: "list",
    allowBlank: true,
    formulae: [`Sifranti!$B$1:$B$${ENOTE_MERE.length}`],
    showErrorMessage: false,
  });

  // ── List 2: Normativi ──────────────────────────────────────────────────────
  const normRows = normativi.rows as { artikelIme: string; sestavinaIme: string; kolicina: string; enotaMere: string | null }[];
  const wsNorm = wb.addWorksheet("Normativi");
  wsNorm.columns = [
    { header: "artikelIme",   key: "artikelIme",   width: 28 },
    { header: "sestavinaIme", key: "sestavinaIme", width: 28 },
    { header: "kolicina",     key: "kolicina",     width: 12 },
    { header: "enotaMere",    key: "enotaMere",    width: 13 },
  ];
  const normHeader = wsNorm.getRow(1);
  normHeader.font = { bold: true };
  normHeader.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD9E1F2" } };
  wsNorm.views = [{ state: "frozen", ySplit: 1 }];
  for (const n of normRows) {
    wsNorm.addRow({ artikelIme: n.artikelIme, sestavinaIme: n.sestavinaIme, kolicina: Number(n.kolicina), enotaMere: n.enotaMere ?? "" });
  }

  const buf = await wb.xlsx.writeBuffer() as unknown as Buffer;
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", 'attachment; filename="artikli.xlsx"');
  res.send(buf);
});

// ── GET /artikli/izvozi-cenik.pdf — cenik aktivnih prodajnih artiklov z alergeni
router.get("/artikli/izvozi-cenik.pdf", async (req: Request, res: Response): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const [companyRows, rows] = await Promise.all([
    db.select({
      enotaIme: enoteTable.ime,
      enotaOpis: enoteTable.opis,
      naziv: companiesTable.naziv,
      kratekNaziv: companiesTable.kratekNaziv,
      naslov: companiesTable.naslov,
      ulica: companiesTable.ulica,
      postnaStevilka: companiesTable.postnaStevika,
      kraj: companiesTable.kraj,
      drzava: companiesTable.drzava,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
      idZaDdv: companiesTable.idZaDdv,
      zavezanecDdv: companiesTable.zavezanecDdv,
      maticnaStevilka: companiesTable.maticnaStevilka,
      trr: companiesTable.trr,
      email: companiesTable.email,
      telefon: companiesTable.telefon,
      www: companiesTable.www,
    })
      .from(enoteTable)
      .innerJoin(companiesTable, eq(companiesTable.id, enoteTable.companyId))
      .where(eq(enoteTable.id, tenotaId))
      .limit(1),
    db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      opis: artikliTable.opis,
      cena: artikliTable.cena,
      cenaMala: artikliTable.cenaMala,
      cenaDruzinska: artikliTable.cenaDruzinska,
      jePica: artikliTable.jePica,
      kategorijaIme: kategorijeTable.ime,
      kategorijaVrstniRed: kategorijeTable.vrstniRed,
      vrstniRed: artikliTable.vrstniRed,
    })
      .from(artikliTable)
      .leftJoin(kategorijeTable, and(
        eq(kategorijeTable.id, artikliTable.kategorijaId),
        eq(kategorijeTable.enotaId, tenotaId),
      ))
      .where(and(
        eq(artikliTable.enotaId, tenotaId),
        eq(artikliTable.aktiven, true),
        eq(artikliTable.prodajniArtikel, true),
      ))
      .orderBy(
        asc(kategorijeTable.vrstniRed),
        asc(artikliTable.vrstniRed),
        asc(artikliTable.ime),
      ),
  ]);
  const company = companyRows[0];
  if (!company) {
    res.status(404).json({ error: "Podjetje oziroma poslovna enota ni najdena." });
    return;
  }

  const allergenSummaries = await Promise.all(
    rows.map((row) => razresiAlergeneArtikla(row.id, tenotaId)),
  );
  const cena = (value: string | number | null) => value == null ? null : `${Number(value).toFixed(2)} €`;
  const pdf = await generateMenuPriceListPdf({
    company: {
      naziv: company.naziv,
      kratekNaziv: company.kratekNaziv,
      naslov: company.naslov,
      ulica: company.ulica,
      postnaStevilka: company.postnaStevilka,
      kraj: company.kraj,
      drzava: company.drzava,
      podjetjeDavcna: company.podjetjeDavcna,
      idZaDdv: company.idZaDdv,
      zavezanecDdv: company.zavezanecDdv,
      maticnaStevilka: company.maticnaStevilka,
      trr: company.trr,
      email: company.email,
      telefon: company.telefon,
      www: company.www,
    },
    unit: {
      ime: company.enotaIme,
      opis: company.enotaOpis,
    },
    items: rows.map((row, index) => {
      const summary = allergenSummaries[index];
      return {
        category: row.kategorijaIme ?? "Ostalo",
        name: row.ime,
        description: row.opis,
        prices: row.jePica
          ? [
              `Normalna  ${cena(row.cena) ?? "—"}`,
              ...(cena(row.cenaMala) ? [`Mala  ${cena(row.cenaMala)}`] : []),
              ...(cena(row.cenaDruzinska) ? [`Družinska  ${cena(row.cenaDruzinska)}`] : []),
            ]
          : [cena(row.cena) ?? "—"],
        allergens: summary?.alergeni.map((allergen) => allergen.naziv) ?? [],
        traces: summary?.alergeniSledi.map((allergen) => allergen.naziv) ?? [],
        verified: summary?.potrjen ?? false,
      };
    }),
  });
  res.type("application/pdf").attachment("cenik-z-alergeni.pdf").send(pdf);
});

router.get("/artikli/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const mapped = mapRow(row);
  const modMap = await fetchModSkupineForArtikli([mapped.id]);
  mapped.modSkupine = modMap.get(mapped.id) ?? [];
  res.json((mapped));
});

router.put("/artikli/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = UpdateArtikelBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const [obstojeci] = await db.select({
    jePica: artikliTable.jePica,
    cena: artikliTable.cena,
    cenaMala: artikliTable.cenaMala,
    cenaDruzinska: artikliTable.cenaDruzinska,
    happyHourCena: artikliTable.happyHourCena,
    happyHourCenaMala: artikliTable.happyHourCenaMala,
    happyHourCenaDruzinska: artikliTable.happyHourCenaDruzinska,
    taxCategory: artikliTable.taxCategory,
    jeDelMenija: artikliTable.jeDelMenija,
    addedSugar: artikliTable.addedSugar,
    alergeniRevision: artikliTable.alergeniRevision,
    mealType: artikliTable.mealType,
    nabavniArtikel: artikliTable.nabavniArtikel,
    prodajniArtikel: artikliTable.prodajniArtikel,
    jeSkupinskiNabavniArtikel: artikliTable.jeSkupinskiNabavniArtikel,
    enotaMere: artikliTable.enotaMere,
    normativRevision: artikliTable.normativRevision,
  }).from(artikliTable).where(and(
    eq(artikliTable.id, params.data.id),
    eq(artikliTable.enotaId, tenotaId),
  ));
  if (!obstojeci) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  const naslednjiGeneric = parsed.data.jeSkupinskiNabavniArtikel
    ?? obstojeci.jeSkupinskiNabavniArtikel;
  const naslednjiNabavni = parsed.data.nabavniArtikel ?? obstojeci.nabavniArtikel;
  const naslednjiProdajni = parsed.data.prodajniArtikel ?? obstojeci.prodajniArtikel;
  const naslednjaEnota = "enotaMere" in parsed.data ? parsed.data.enotaMere : obstojeci.enotaMere;
  if (naslednjiGeneric && (
    !naslednjiNabavni || naslednjiProdajni || !toUneceUnitCode(naslednjaEnota)
  )) {
    res.status(400).json({
      error: "Generični nabavni artikel mora biti samo nabavni in imeti podprto UN/ECE enoto mere.",
    });
    return;
  }
  const naslednjaTaxCategory =
    (parsed.data as { taxCategory?: string }).taxCategory ?? obstojeci.taxCategory ?? "food";
  const naslednjiJeDelMenija =
    (parsed.data as { jeDelMenija?: boolean }).jeDelMenija ?? obstojeci.jeDelMenija;
  const naslednjiProdajniArtikel = parsed.data.prodajniArtikel ?? obstojeci.prodajniArtikel;
  const zahtevaniAddedSugar =
    (parsed.data as { addedSugar?: boolean }).addedSugar ?? obstojeci.addedSugar;
  const naslednjiAddedSugar = normalizeAddedSugarForTaxCategory(naslednjaTaxCategory, zahtevaniAddedSugar);
  if (naslednjaTaxCategory === "food_drink" && zahtevaniAddedSugar) {
    req.log.warn(
      { artikelId: params.data.id, taxCategory: naslednjaTaxCategory, requestedAddedSugar: zahtevaniAddedSugar },
      "addedSugar je bil pri kategoriji food_drink normaliziran na false",
    );
  }
  if (
    naslednjiJeDelMenija
    && (!naslednjiProdajniArtikel || !isMenuEligibleTaxCategory(naslednjaTaxCategory))
  ) {
    res.status(400).json({ error: "Kot del menija je mogoče označiti le prodajno toplo ali hladno pijačo." });
    return;
  }
  const napakaCenePic = await preveriCenePic(parsed.data as PizzaCenaInput, tenotaId, obstojeci);
  if (napakaCenePic) { res.status(400).json({ error: napakaCenePic }); return; }

  const updateData: Partial<typeof artikliTable.$inferInsert> = {};
  if (parsed.data.ime !== undefined) updateData.ime = parsed.data.ime;
  if (parsed.data.opis !== undefined) updateData.opis = parsed.data.opis;
  if (parsed.data.cena !== undefined) updateData.cena = String(parsed.data.cena);
  if ("cenaMala" in parsed.data) {
    const cenaMala = (parsed.data as { cenaMala?: number | null }).cenaMala;
    updateData.cenaMala = cenaMala == null ? null : String(cenaMala);
  }
  if ("cenaDruzinska" in parsed.data) {
    const cenaDruzinska = (parsed.data as { cenaDruzinska?: number | null }).cenaDruzinska;
    updateData.cenaDruzinska = cenaDruzinska == null ? null : String(cenaDruzinska);
  }
  if (parsed.data.davek !== undefined) updateData.davek = String(parsed.data.davek);
  if (parsed.data.aktiven !== undefined) updateData.aktiven = parsed.data.aktiven;
  if ("kategorijaId" in parsed.data) updateData.kategorijaId = parsed.data.kategorijaId ?? null;
  if ("barva" in parsed.data) updateData.barva = parsed.data.barva ?? null;
  if ("opisSlike" in parsed.data) {
    updateData.opisSlike = (parsed.data as { opisSlike?: string | null }).opisSlike?.trim() || null;
  }
  if (parsed.data.vrstniRed !== undefined) updateData.vrstniRed = parsed.data.vrstniRed;
  if (parsed.data.nabavniArtikel !== undefined) updateData.nabavniArtikel = parsed.data.nabavniArtikel;
  if (parsed.data.prodajniArtikel !== undefined) updateData.prodajniArtikel = parsed.data.prodajniArtikel;
  if (parsed.data.jeSkupinskiNabavniArtikel !== undefined) {
    updateData.jeSkupinskiNabavniArtikel = parsed.data.jeSkupinskiNabavniArtikel;
  }
  if ("imeZaNabavo" in parsed.data) updateData.imeZaNabavo = parsed.data.imeZaNabavo ?? null;
  if ("enotaMere" in parsed.data) updateData.enotaMere = parsed.data.enotaMere ?? null;
  if (parsed.data.jePica !== undefined) updateData.jePica = parsed.data.jePica;
  if ((parsed.data as { jeDodatekZaPico?: boolean }).jeDodatekZaPico !== undefined) updateData.jeDodatekZaPico = (parsed.data as { jeDodatekZaPico?: boolean }).jeDodatekZaPico;
  if ((parsed.data as { privzetiDodatki?: number[] }).privzetiDodatki !== undefined) updateData.privzetiDodatki = (parsed.data as { privzetiDodatki?: number[] }).privzetiDodatki ?? [];
  if ((parsed.data as { jeModifikator?: boolean }).jeModifikator !== undefined) updateData.jeModifikator = (parsed.data as { jeModifikator?: boolean }).jeModifikator;
  if ((parsed.data as { privzetiModifikatorji?: number[] }).privzetiModifikatorji !== undefined) updateData.privzetiModifikatorji = (parsed.data as { privzetiModifikatorji?: number[] }).privzetiModifikatorji ?? [];
  if ((parsed.data as { toGoArtikli?: number[] }).toGoArtikli !== undefined) updateData.toGoArtikli = (parsed.data as { toGoArtikli?: number[] }).toGoArtikli ?? [];
  if ((parsed.data as { toGo?: boolean }).toGo !== undefined) updateData.toGo = (parsed.data as { toGo?: boolean }).toGo;
  const casPripraveMin = (parsed.data as unknown as { casPripraveMin?: number }).casPripraveMin;
  if (casPripraveMin !== undefined) {
    updateData.casPripraveMin = Math.max(0, Number(casPripraveMin));
  }
  const mealType = (parsed.data as { mealType?: "ala_carte" | "prepared" | "composite" }).mealType;
  if (mealType !== undefined) updateData.mealType = mealType;
  if ((parsed.data as { vrstaArtikla?: string }).vrstaArtikla !== undefined) updateData.vrstaArtikla = (parsed.data as { vrstaArtikla?: string }).vrstaArtikla;
  if ("povratnaEmbalaza" in parsed.data) updateData.povratnaEmbalaza = Boolean((parsed.data as any).povratnaEmbalaza);
  if ("vrstaEmbalaze" in parsed.data) updateData.vrstaEmbalaze = (parsed.data as any).vrstaEmbalaze ?? null;
  if ("depozitnaVrednost" in parsed.data) updateData.depozitnaVrednost = (parsed.data as any).depozitnaVrednost == null ? null : String((parsed.data as any).depozitnaVrednost);
  if ("happyHourCena" in parsed.data) updateData.happyHourCena = (parsed.data as { happyHourCena?: number | null }).happyHourCena != null ? String((parsed.data as { happyHourCena: number }).happyHourCena) : null;
  if ("happyHourCenaMala" in parsed.data) updateData.happyHourCenaMala = (parsed.data as { happyHourCenaMala?: number | null }).happyHourCenaMala != null ? String((parsed.data as { happyHourCenaMala: number }).happyHourCenaMala) : null;
  if ("happyHourCenaDruzinska" in parsed.data) updateData.happyHourCenaDruzinska = (parsed.data as { happyHourCenaDruzinska?: number | null }).happyHourCenaDruzinska != null ? String((parsed.data as { happyHourCenaDruzinska: number }).happyHourCenaDruzinska) : null;
  if ("skupina" in parsed.data) updateData.skupina = (parsed.data as { skupina?: string | null }).skupina ?? null;
  if ("taxCategory" in parsed.data) updateData.taxCategory = (parsed.data as { taxCategory?: string }).taxCategory ?? "food";
  if ("jeDelMenija" in parsed.data) updateData.jeDelMenija = Boolean((parsed.data as { jeDelMenija?: boolean }).jeDelMenija);
  if (naslednjaTaxCategory === "food_drink" || "addedSugar" in parsed.data) {
    updateData.addedSugar = naslednjiAddedSugar;
  }
  if ("knCode" in parsed.data) updateData.knCode = (parsed.data as { knCode?: string | null }).knCode ?? null;
  const hasAlergenProfil = ["alergeni", "alergeniSledi", "alergeniStatus", "alergeniVir", "alergeniOpombaVira", "alergeniDocumentId", "alergeniVerifiedBy", "alergeniVerifiedAt"]
    .some((key) => Object.prototype.hasOwnProperty.call(req.body, key));
  if (hasAlergenProfil) {
    try {
      const profile = normalizirajAlergenProfil(req.body);
      Object.assign(updateData, profile, { alergeniRevision: (obstojeci.alergeniRevision ?? 0) + 1 });
    } catch (error) {
      req.log.warn({ err: error, artikelId: params.data.id }, "Invalid article allergen profile");
      res.status(400).json({ error: (error as Error).message });
      return;
    }
  }

  if ("kategorijaId" in parsed.data && parsed.data.kategorijaId != null) {
    const [kat] = await db.select({ id: kategorijeTable.id })
      .from(kategorijeTable)
      .where(and(eq(kategorijeTable.id, parsed.data.kategorijaId), sql`true`, eq(kategorijeTable.enotaId, tenotaId)));
    if (!kat) { res.status(403).json({ error: "Kategorija ne pripada temu podjetju" }); return; }
  }

  const graphCanChange = Boolean(parsed.data.normativUpdate) || mealType !== undefined;
  let saved: boolean;
  try {
    saved = await db.transaction(async (tx) => {
      let currentOwner = obstojeci;
      await normativRevisionLockTestHook?.({
        artikelId: params.data.id,
        operation: "article-update",
      });
      await lockPosBusinessDay(tx, tenotaId);
      if (graphCanChange) {
        await lockNormativeGraph(tx, tenotaId);
        const [lockedOwner] = await tx.select({
          jePica: artikliTable.jePica,
          cena: artikliTable.cena,
          cenaMala: artikliTable.cenaMala,
          cenaDruzinska: artikliTable.cenaDruzinska,
          happyHourCena: artikliTable.happyHourCena,
          happyHourCenaMala: artikliTable.happyHourCenaMala,
          happyHourCenaDruzinska: artikliTable.happyHourCenaDruzinska,
          taxCategory: artikliTable.taxCategory,
          jeDelMenija: artikliTable.jeDelMenija,
          prodajniArtikel: artikliTable.prodajniArtikel,
          addedSugar: artikliTable.addedSugar,
          alergeniRevision: artikliTable.alergeniRevision,
          mealType: artikliTable.mealType,
          nabavniArtikel: artikliTable.nabavniArtikel,
          jeSkupinskiNabavniArtikel: artikliTable.jeSkupinskiNabavniArtikel,
          enotaMere: artikliTable.enotaMere,
          normativRevision: artikliTable.normativRevision,
        }).from(artikliTable)
          .where(and(
            eq(artikliTable.id, params.data.id),
            eq(artikliTable.enotaId, tenotaId),
          ))
          .for("update");
        if (!lockedOwner) {
          throw new NormativeRequestError(404, { error: "Artikel ni najden" });
        }
        currentOwner = lockedOwner;
      }
      if (mealType !== undefined && mealType !== currentOwner.mealType) {
        await validateIngredientTypeChange(tx, params.data.id, tenotaId, mealType);
      }
      if (parsed.data.normativUpdate) {
        const preparedNormativ = await prepareNormativUpdate(
          params.data.id,
          tenotaId,
          parsed.data.normativUpdate,
          {
            mealType: parsed.data.mealType ?? currentOwner.mealType,
            nabavniArtikel: parsed.data.nabavniArtikel ?? currentOwner.nabavniArtikel,
            prodajniArtikel: parsed.data.prodajniArtikel ?? currentOwner.prodajniArtikel,
          },
          tx,
        );
        await applyPreparedNormativUpdate(tx, params.data.id, tenotaId, preparedNormativ);
      }
      await tx.update(artikliTable).set(updateData)
        .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
      if (hasAlergenProfil) await razveljaviAlergeneNadrejenih(params.data.id, tx as any, false);
    }).then(() => true);
  } catch (error) {
    if (error instanceof NormativeStaleError) {
      saved = false;
    } else if (error instanceof NormativeRequestError) {
      res.status(error.status).json(error.responseBody);
      return;
    } else {
      throw error;
    }
  }
  if (!saved) {
    res.status(409).json({
      code: "NORMATIVE_STALE",
      error: "Normativ se je medtem spremenil. Artikel in normativ nista bila shranjena.",
    });
    return;
  }

  const [row] = await db
    .select(SELECT_FIELDS)
    .from(artikliTable)
    .leftJoin(kategorijeTable, and(eq(artikliTable.kategorijaId, kategorijeTable.id), sql`true`, eq(kategorijeTable.enotaId, tenotaId)))
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  res.json((mapRow(row)));
});

router.delete("/artikli/:id", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [owner] = await db.select({
    id: artikliTable.id,
    mealType: artikliTable.mealType,
    nabavniArtikel: artikliTable.nabavniArtikel,
    prodajniArtikel: artikliTable.prodajniArtikel,
  })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const vpNormativi = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(normativiTable)
    .innerJoin(artikliTable, eq(normativiTable.artikelId, artikliTable.id))
    .where(and(eq(normativiTable.vhodniArtikelId, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  const samoLastniNormativ =
    owner.nabavniArtikel &&
    owner.prodajniArtikel &&
    vpNormativi.length > 0 &&
    vpNormativi.every(row => row.id === owner.id);

  if (vpNormativi.length > 0 && !samoLastniNormativ) {
    const potrdi = req.query["potrdi"] === "1";
    if (!potrdi) {
      res.status(409).json({ error: "Artikel se uporablja v normativih", vpNormativi });
      return;
    }
    // Potrjeno kaskadno brisanje: odstrani vse normativne vrstice, kjer je ta artikel sestavina
    const parents = [...new Set(vpNormativi.map(row => row.id))].sort((a, b) => a - b);
    await db.transaction(async (tx) => {
      // Lock affected owners in a stable order before changing their complete normative.
      await tx.execute(sql`SELECT id FROM artikli WHERE id IN (${sql.join(parents.map(parent => sql`${parent}`), sql`, `)}) FOR UPDATE`);
      await tx.delete(normativiTable).where(eq(normativiTable.vhodniArtikelId, params.data.id));
      await tx.update(artikliTable).set({ normativRevision: sql`${artikliTable.normativRevision} + 1` })
        .where(inArray(artikliTable.id, parents));
    });
  }

  // Preverimo ali je artikel vezan na kakšne postavke (naročila ali računi)
  const vpPostavke = await db
    .select({ id: postavkeTable.id })
    .from(postavkeTable)
    .where(eq(postavkeTable.artikelId, params.data.id))
    .limit(1);

  if (vpPostavke.length > 0) {
    // Artikel ima zgodovino — ne moremo ga izbrisati, deaktiviramo ga
    await db.update(artikliTable)
      .set({ aktiven: false })
      .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
    res.json({ deaktiviran: true });
    return;
  }

  await db.transaction(async (tx) => {
    if (samoLastniNormativ) {
      await tx.delete(normativiTable).where(and(
        eq(normativiTable.artikelId, params.data.id),
        eq(normativiTable.vhodniArtikelId, params.data.id),
      ));
    }
    await tx.delete(artikliTable)
      .where(and(eq(artikliTable.id, params.data.id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  });
  res.sendStatus(204);
});

type NormativRow = {
  id: number;
  artikelId: number;
  vhodniArtikelId: number;
  vhodniArtikelIme: string;
  enotaMere: string | null;
  kolicina: string;
  vrstniRed: number;
};

router.get("/artikli/:id/v-normativi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [owner] = await db.select({ id: artikliTable.id, mealType: artikliTable.mealType })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const rows = await db
    .select({ id: artikliTable.id, ime: artikliTable.ime })
    .from(normativiTable)
    .innerJoin(artikliTable, eq(normativiTable.artikelId, artikliTable.id))
    .where(and(eq(normativiTable.vhodniArtikelId, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));

  res.json(rows);
});

router.get("/artikli/:id/normativi", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [owner] = await db.select({
    id: artikliTable.id,
    mealType: artikliTable.mealType,
    normativRevision: artikliTable.normativRevision,
  })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, id), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden" }); return; }

  const rows = await db.execute(sql<NormativRow>`
    SELECT
      n.id,
      n.artikel_id   AS "artikelId",
      n.vhodni_artikel_id AS "vhodniArtikelId",
      COALESCE(a.ime, '')  AS "vhodniArtikelIme",
      a.enota_mere         AS "enotaMere",
      n.kolicina,
      n.vrstni_red   AS "vrstniRed"
    FROM normativi n
    LEFT JOIN artikli a ON n.vhodni_artikel_id = a.id AND a.enota_id = ${tenotaId}
    WHERE n.artikel_id = ${id}
    ORDER BY n.vrstni_red
  `);

  res.json({
    normativRevision: owner.normativRevision,
    normativi: rows.rows.map((r) => ({
      id: r.id,
      artikelId: r.artikelId,
      vhodniArtikelId: r.vhodniArtikelId,
      vhodniArtikelIme: r.vhodniArtikelIme ?? "",
      enotaMere: r.enotaMere ?? null,
      kolicina: Number(r.kolicina),
      vrstniRed: r.vrstniRed})),
  });
});

router.get("/artikli/:id/alergeni-normativ", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Neveljaven ID artikla." }); return; }
  const rezultat = await razresiAlergeneArtikla(id, tenotaId);
  if (!rezultat) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  res.json(rezultat);
});

router.post("/artikli/alergeni-normativ/preview", async (req, res): Promise<void> => {
  const parsed = PreviewArtikelAlergeniNormativBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }
  const tenotaId = (req as any).enotaId ?? 1;
  const rezultat = await razresiAlergeneVhodnihArtiklov(parsed.data.vhodniArtikelIds, tenotaId);
  res.json(rezultat);
});

router.get("/artikli/:id/alergeni-normativ.pdf", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Neveljaven ID artikla." }); return; }
  const [artikel] = await db.select({ ime: artikliTable.ime, hash: artikliTable.alergeniHash, revision: artikliTable.alergeniRevision, verifiedBy: artikliTable.alergeniVerifiedBy, verifiedAt: artikliTable.alergeniVerifiedAt })
    .from(artikliTable).where(and(eq(artikliTable.id, id), eq(artikliTable.enotaId, tenotaId)));
  const izracun = await razresiAlergeneArtikla(id, tenotaId);
  if (!artikel || !izracun) { res.status(404).json({ error: "Artikel ni najden." }); return; }
  const sestavine = await db.select({ ime: artikliTable.ime, kolicina: normativiTable.kolicina })
    .from(normativiTable).innerJoin(artikliTable, eq(artikliTable.id, normativiTable.vhodniArtikelId))
    .where(eq(normativiTable.artikelId, id));
  const pdf = new PDFDocument({ margin: 42 });
  const chunks: Buffer[] = [];
  pdf.on("data", (chunk: Buffer) => chunks.push(chunk));
  pdf.on("end", () => {
    res.type("application/pdf").attachment(`normativ-alergeni-${id}.pdf`).send(Buffer.concat(chunks));
  });
  pdf.fontSize(18).text("Alergenski normativ");
  pdf.moveDown().fontSize(11).text(`Enota: ${tenotaId}`).text(`Artikel: ${artikel.ime}`);
  pdf.text(`Status: ${izracun.potrjen ? "potrjeno" : "nepreverjeno"}`);
  pdf.text(`Verzija: ${artikel.revision}; hash: ${artikel.hash ?? "ni izračunan"}`);
  pdf.text(`Čas izvoza: ${new Date().toISOString()}`);
  pdf.text(`Potrdil: ${artikel.verifiedBy ?? "ni potrjeno"} ${artikel.verifiedAt ? `(${artikel.verifiedAt.toISOString()})` : ""}`);
  pdf.moveDown().text("Sestavine / količine:");
  sestavine.forEach((s) => pdf.text(`• ${s.ime}: ${s.kolicina}`));
  pdf.moveDown().text(`Vsebuje: ${izracun.alergeni.map((a) => `${a.koda} – ${a.naziv}`).join(", ") || "ni potrjenih podatkov"}`);
  pdf.text(`Lahko vsebuje sledi: ${izracun.alergeniSledi.map((a) => `${a.koda} – ${a.naziv}`).join(", ") || "brez navedenih sledi"}`);
  pdf.moveDown().text("Izvori:");
  izracun.izvori.forEach((source) => pdf.text(`• ${source.artikel}: ${source.vir ?? "vir ni naveden"}${source.documentId ? `; dokument ${source.documentId}` : ""}`));
  if (izracun.opozorila.length) { pdf.moveDown().text(`Opozorila: ${izracun.opozorila.join(" ")}`); }
  pdf.end();
});

type NormativInput = { vhodniArtikelId: number; kolicina: number };
type UpdateNormativBody = { items: NormativInput[]; expectedRevision: number };
type NormativeChangeHistoryRow = {
  id: number;
  changedAt: Date | string;
  actorClerkUserId: string;
  actorNatakarId: number | null;
  actorName: string | null;
  ingredientId: number;
  ingredientName: string | null;
  oldQuantity: string;
  newQuantity: string;
  unit: string;
  sourceUrl: string;
  sourceTitle: string;
  comparisonGeneratedAt: Date | string;
};

export function soNormativiEnaki(
  obstojeci: Array<{ vhodniArtikelId: number; kolicina: string | number; vrstniRed: number | null }>,
  novi: NormativInput[],
): boolean {
  const urejeni = [...obstojeci].sort(
    (a, b) => (a.vrstniRed ?? 0) - (b.vrstniRed ?? 0),
  );
  return urejeni.length === novi.length && urejeni.every((item, index) =>
    item.vhodniArtikelId === novi[index]?.vhodniArtikelId
    && Number(item.kolicina) === Number(novi[index]?.kolicina),
  );
}

type PreparedNormativUpdate = {
  expectedRevision: number;
  items: NormativInput[];
  changed: boolean;
};

async function prepareNormativUpdate(
  id: number,
  tenotaId: number,
  body: UpdateNormativBody,
  owner: {
    mealType: "ala_carte" | "prepared" | "composite";
    nabavniArtikel: boolean;
    prodajniArtikel: boolean;
  },
  queryDb: any = db,
): Promise<PreparedNormativUpdate> {
  const expectedRevision = Number(body.expectedRevision);
  const items = body.items;
  const vhodniIds = [...new Set(items.map(item => item.vhodniArtikelId))];
  let validVhodni: Array<{ id: number; ime: string; mealType: "ala_carte" | "prepared" | "composite" }> = [];

  if (items.length > 0) {
    validVhodni = await queryDb.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      mealType: artikliTable.mealType,
    }).from(artikliTable).where(and(
      inArray(artikliTable.id, vhodniIds),
      eq(artikliTable.enotaId, tenotaId),
    ));
    const validIds = new Set(validVhodni.map(item => item.id));
    const manjkajociIds = vhodniIds.filter(itemId => !validIds.has(itemId));
    if (manjkajociIds.length > 0) {
      throw new NormativeRequestError(422, {
        error: "Nekatere sestavine normativa so bile izbrisane ali ne obstajajo",
        manjkajoceSestavine: manjkajociIds,
      });
    }
  }

  if (items.some(item => !Number.isFinite(item.kolicina) || item.kolicina <= 0)) {
    throw new NormativeRequestError(400, { error: "Količina normativa mora biti pozitivna." });
  }
  const allowsSelfNorm = isAllowedOneToOneSelfNorm(owner, id, items);
  if (items.some(item => item.vhodniArtikelId === id) && !allowsSelfNorm) {
    throw new NormativeRequestError(400, {
      error: "Artikel je lahko lastna sestavina samo pri 1 : 1 normativu preprostega nabavnega in prodajnega artikla.",
    });
  }
  if (owner.mealType === "composite") {
    const [multicourseMenu] = items.length === 0
      ? await queryDb.select({ id: multicourseMenusTable.id })
        .from(multicourseMenusTable)
        .where(and(
          eq(multicourseMenusTable.menuArtikelId, id),
          eq(multicourseMenusTable.enotaId, tenotaId),
        ))
        .limit(1)
      : [];
    if (items.length === 0 && requiresClassicNormativ(owner.mealType, Boolean(multicourseMenu))) {
      throw new NormativeRequestError(400, {
        error: "Sestavljeni artikel mora vsebovati vsaj en vhodni artikel.",
      });
    }
    const typeById = new Map(validVhodni.map(article => [article.id, article.mealType]));
    const invalid = vhodniIds.filter(articleId => {
      const type = typeById.get(articleId);
      return type !== "ala_carte" && type !== "prepared";
    });
    if (invalid.length > 0) {
      throw new NormativeRequestError(422, {
        error: "Sestavljeni artikel lahko vsebuje samo à la carte ali pripravljene artikle.",
        manjkajoceSestavine: invalid,
      });
    }
  }

  const existing: Array<{
    artikelId: number;
    vhodniArtikelId: number;
    kolicina: string | number;
    vrstniRed: number;
  }> = await queryDb.select({
    artikelId: normativiTable.artikelId,
    vhodniArtikelId: normativiTable.vhodniArtikelId,
    kolicina: normativiTable.kolicina,
    vrstniRed: normativiTable.vrstniRed,
  }).from(normativiTable);
  const changed = !soNormativiEnaki(
    existing
      .filter(row => row.artikelId === id)
      .map(({ vhodniArtikelId, kolicina, vrstniRed }) => ({
        vhodniArtikelId,
        kolicina,
        vrstniRed,
      })),
    items,
  );
  const graph = new Map<number, number[]>();
  for (const row of existing) {
    if (row.artikelId === id) continue;
    graph.set(row.artikelId, [...(graph.get(row.artikelId) ?? []), row.vhodniArtikelId]);
  }
  for (const item of items) {
    if (allowsSelfNorm && item.vhodniArtikelId === id) continue;
    const seen = new Set<number>();
    const stack = [item.vhodniArtikelId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === id) {
        throw new NormativeRequestError(400, {
          error: "Normativ bi ustvaril krožno sestavo artiklov.",
        });
      }
      if (!seen.has(current)) {
        seen.add(current);
        stack.push(...(graph.get(current) ?? []));
      }
    }
  }

  return { expectedRevision, items, changed };
}

async function validateIngredientTypeChange(
  tx: any,
  artikelId: number,
  enotaId: number,
  nextMealType: "ala_carte" | "prepared" | "composite",
): Promise<void> {
  if (nextMealType !== "composite") return;
  const [usage] = await tx.select({
    parentId: normativiTable.artikelId,
  }).from(normativiTable)
    .innerJoin(artikliTable, eq(artikliTable.id, normativiTable.artikelId))
    .where(and(
      eq(normativiTable.vhodniArtikelId, artikelId),
      eq(artikliTable.enotaId, enotaId),
      eq(artikliTable.mealType, "composite"),
    ))
    .limit(1);
  if (usage) {
    throw new NormativeRequestError(422, {
      error: "Artikla ni mogoče spremeniti v sestavljenega, ker je sestavina drugega sestavljenega artikla.",
    });
  }
}

async function applyPreparedNormativUpdate(
  tx: any,
  id: number,
  tenotaId: number,
  prepared: PreparedNormativUpdate,
): Promise<void> {
  const locked = await tx.execute(
    sql`SELECT normativ_revision AS revision FROM artikli WHERE id = ${id} AND enota_id = ${tenotaId} FOR UPDATE`,
  ) as any;
  const lockedRevision = Number((locked.rows ?? locked)[0]?.revision);
  if (lockedRevision !== prepared.expectedRevision) throw new NormativeStaleError();
  if (!prepared.changed) return;

  await tx.delete(normativiTable).where(eq(normativiTable.artikelId, id));
  if (prepared.items.length > 0) {
    await tx.insert(normativiTable).values(prepared.items.map((item, idx) => ({
      artikelId: id,
      vhodniArtikelId: item.vhodniArtikelId,
      kolicina: String(item.kolicina),
      vrstniRed: idx,
    })));
  }
  await razveljaviAlergeneNadrejenih(id, tx, false);
  await tx.update(artikliTable)
    .set({ normativRevision: lockedRevision + 1 })
    .where(eq(artikliTable.id, id));
}

router.put("/artikli/:id/normativi", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const body = req.body as Partial<UpdateNormativBody> | null;
  if (!body || Array.isArray(body) || !Array.isArray(body.items)
      || !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
    res.status(400).json({ error: "Pričakovana sta seznam normativa in veljavna revizija." }); return;
  }
  const items: NormativInput[] = body.items.filter(
    (item) => item && typeof item.vhodniArtikelId === "number" && typeof item.kolicina === "number"
  );
  let saved: boolean;
  try {
    saved = await db.transaction(async (tx) => {
      await normativRevisionLockTestHook?.({
        artikelId: id,
        operation: "normativ-update",
      });
      await lockNormativeGraph(tx, tenotaId);
      const [owner] = await tx.select({
        id: artikliTable.id,
        mealType: artikliTable.mealType,
        nabavniArtikel: artikliTable.nabavniArtikel,
        prodajniArtikel: artikliTable.prodajniArtikel,
      }).from(artikliTable)
        .where(and(eq(artikliTable.id, id), eq(artikliTable.enotaId, tenotaId)))
        .for("update");
      if (!owner) {
        throw new NormativeRequestError(404, { error: "Artikel ni najden" });
      }
      const prepared = await prepareNormativUpdate(
        id,
        tenotaId,
        { expectedRevision: Number(body.expectedRevision), items },
        owner,
        tx,
      );
      await applyPreparedNormativUpdate(tx, id, tenotaId, prepared);
    }).then(() => true);
  } catch (error) {
    if (error instanceof NormativeStaleError) {
      saved = false;
    } else if (error instanceof NormativeRequestError) {
      res.status(error.status).json(error.responseBody);
      return;
    } else {
      throw error;
    }
  }
  if (saved === false) { res.status(409).json({ code: "NORMATIVE_STALE", error: "Normativ se je medtem spremenil. Osvežite podatke in spremembe vnesite ponovno." }); return; }

  res.sendStatus(204);
});

const EmptyInitialNormativeBody = z.preprocess(
  value => value === undefined ? {} : value,
  z.object({}).strict(),
);
const ApplyInitialNormativeBody = z.object({
  token: z.string().min(1).max(40_000),
  confirmed: z.literal(true),
  classifications: z.array(z.object({
    index: z.number().int().min(0),
    taxCategory: z.enum(["food", "hot_beverage", "cold_beverage", "alcoholic", "other", "vat_super_reduced_5"]),
    addedSugar: z.boolean(),
    rawConfirmed: z.literal(true),
  }).strict()).max(100),
}).strict();

const INITIAL_NORMATIVE_WARNING =
  "Spletno iskanje potrjuje samo URL-je in naslove virov; recepti, sestavine, količine in porcije so ustvarjeni z umetno inteligenco in vsebinsko niso preverjeni v virih. Pred potrditvijo jih ročno preverite.";
const CATALOG_VOLUME_WARNING =
  "Količina je razbrana samo iz naziva prodajnega artikla, brez spletnega recepta. Preverite, da gre za eno samo navedeno pijačo, da je volumen pravilen in da je nabavni artikel ustrezen, preden potrdite normativ.";

function initialIngredientVatRate(
  category: TaxCategory,
  addedSugar: boolean,
  ddvMap: Record<string, string>,
): string {
  const general = Number(ddvMap.ddvSplosnaSt ?? "22");
  const lower = Number(ddvMap.ddvNizjaSt ?? "9.5");
  const reduced = Number(ddvMap.ddvZnizanaSt ?? "5");
  const rate = category === "food" ? lower
    : category === "hot_beverage" || category === "cold_beverage" ? (addedSugar ? general : lower)
      : category === "vat_super_reduced_5" ? reduced
        : general;
  if (!Number.isFinite(rate) || rate < 0 || rate > 999.99) {
    throw new NormativeRequestError(422, { error: "Nastavitve DDV ne vsebujejo veljavnih stopenj za novi artikel." });
  }
  return rate.toFixed(2);
}

function requireCanonicalNormativeUnit(req: Request, res: Response): number | null {
  const enotaId = (req as any).enotaId;
  const header = req.headers["x-enota-id"];
  if (typeof header !== "string" || !/^[1-9]\d*$/u.test(header)) {
    res.status(400).json({ error: "Za pametni predlog normativa izrecno izberite poslovno enoto." });
    return null;
  }
  const requested = Number(header);
  if (!Number.isSafeInteger(requested) || requested !== enotaId) {
    res.status(403).json({ error: "Izbrana poslovna enota se ne ujema z dovoljenim dostopom." });
    return null;
  }
  if (!["admin", "admin_enote", "superadmin"].includes((req as any).vloga)) {
    res.status(403).json({ error: "Za pametni predlog normativa je potrebna vloga upravitelja." });
    return null;
  }
  return requested;
}

function initialUnitMeasure(unit: string | null): { dimension: "mass" | "volume" | "count"; factor: Decimal } | null {
  const normalized = unit?.trim().toLocaleUpperCase("sl").replace(/\.$/u, "");
  if (normalized === "KGM" || normalized === "KG" || normalized === "KG.") return { dimension: "mass", factor: new Decimal(1) };
  if (normalized === "GRM" || normalized === "G" || normalized === "GR") return { dimension: "mass", factor: new Decimal("0.001") };
  if (normalized === "LTR" || normalized === "L" || normalized === "LT") return { dimension: "volume", factor: new Decimal(1) };
  if (normalized === "MLT" || normalized === "ML") return { dimension: "volume", factor: new Decimal("0.001") };
  if (normalized === "KOM" || normalized === "KOS" || normalized === "KOSA" || normalized === "KOSI" || normalized === "PC" || normalized === "PCS") {
    return { dimension: "count", factor: new Decimal(1) };
  }
  return null;
}

function baseForInitialUnit(unit: InitialNormativeUnit): "mass" | "volume" | "count" {
  return unit === "KGM" ? "mass" : unit === "LTR" ? "volume" : "count";
}

function toNormativNumericQuantity(value: Decimal): number {
  if (!value.isFinite() || !value.isPositive() || value.gt("999999.9999") || value.decimalPlaces()! > 4) {
    throw new NormativeRequestError(422, {
      error: "Količine ni mogoče natančno zapisati v normativ (največ štiri decimalna mesta).",
    });
  }
  return value.toNumber();
}

async function resolveInitialNormativeItems(
  queryDb: any,
  enotaId: number,
  items: Array<{ name: string; quantity: string; unit: InitialNormativeUnit; existingArticleId?: number | null }>,
): Promise<Array<{ vhodniArtikelId: number | null; kolicina: number }>> {
  const articles: Array<{
    id: number;
    ime: string;
    imeZaNabavo: string | null;
    enotaMere: string | null;
    nabavniArtikel: boolean;
    prodajniArtikel: boolean;
  }> = await queryDb.select({
    id: artikliTable.id,
    ime: artikliTable.ime,
    imeZaNabavo: artikliTable.imeZaNabavo,
    enotaMere: artikliTable.enotaMere,
    nabavniArtikel: artikliTable.nabavniArtikel,
    prodajniArtikel: artikliTable.prodajniArtikel,
  }).from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
  return items.map(item => {
    const key = normalizeIngredientName(item.name);
    const matches = articles.filter(article =>
      normalizeIngredientName(article.ime) === key
      || (article.imeZaNabavo != null && normalizeIngredientName(article.imeZaNabavo) === key));
    if (matches.length > 1) {
      throw new NormativeRequestError(422, { error: "Ime sestavine se ujema z več artikli; razrešite podvojena imena pred uporabo predloga." });
    }
    const match = matches[0];
    if (!match) {
      if (item.existingArticleId !== undefined && item.existingArticleId !== null) throw new NormativeStaleError();
      return { vhodniArtikelId: null, kolicina: toNormativNumericQuantity(new Decimal(item.quantity)) };
    }
    if (item.existingArticleId !== undefined && item.existingArticleId !== match.id) throw new NormativeStaleError();
    if (!match.nabavniArtikel || match.prodajniArtikel) {
      throw new NormativeRequestError(422, { error: "Ujemajoči se artikel ni izključno nabavni artikel; najprej preverite njegove zastavice." });
    }
    const target = initialUnitMeasure(match.enotaMere);
    if (!target || target.dimension !== baseForInitialUnit(item.unit)) {
      throw new NormativeRequestError(422, { error: "Merska enota obstoječega nabavnega artikla ni združljiva s predlagano sestavino." });
    }
    const quantity = new Decimal(item.quantity).div(target.factor);
    return { vhodniArtikelId: match.id, kolicina: toNormativNumericQuantity(quantity) };
  });
}

router.post("/artikli/:id/normativi/pametni-predlog", requireEnota, async (req, res): Promise<void> => {
  const enotaId = requireCanonicalNormativeUnit(req, res);
  if (enotaId === null) return;
  const artikelId = Number(req.params.id);
  if (!Number.isInteger(artikelId) || artikelId <= 0) { res.status(400).json({ error: "Neveljaven artikel." }); return; }
  if (!EmptyInitialNormativeBody.safeParse(req.body).success) {
    res.status(400).json({ error: "Telo zahteve mora biti prazen objekt." }); return;
  }
  if (!process.env.POS_NORMATIVE_PROPOSAL_SECRET && !process.env.SESSION_SECRET) {
    res.status(503).json({ error: "Podpisni ključ za predloge normativa ni nastavljen." }); return;
  }

  let owner: { revision: number; name: string; taxCategory: string | null; categoryId: number | null } | undefined;
  try {
    owner = await db.transaction(async tx => {
      await lockNormativeGraph(tx, enotaId);
      const [row] = await tx.select({
        id: artikliTable.id,
        name: artikliTable.ime,
        taxCategory: artikliTable.taxCategory,
        categoryId: artikliTable.kategorijaId,
        revision: artikliTable.normativRevision,
        sale: artikliTable.prodajniArtikel,
      }).from(artikliTable)
        .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)))
        .for("update");
      if (!row) throw new NormativeRequestError(404, { error: "Artikel ni najden." });
      if (!row.sale) throw new NormativeRequestError(422, { error: "Pametni predlog ni na voljo za artikle, ki so samo nabavni." });
      const [existingNorm] = await tx.select({ id: normativiTable.id }).from(normativiTable)
        .where(eq(normativiTable.artikelId, artikelId)).limit(1);
      if (existingNorm) throw new NormativeRequestError(409, { error: "Artikel že ima normativ; pametni začetni predlog je dovoljen le za prazen normativ." });
      return { revision: Number(row.revision), name: row.name, taxCategory: row.taxCategory, categoryId: row.categoryId };
    });
  } catch (error) {
    if (error instanceof NormativeRequestError) { res.status(error.status).json(error.responseBody); return; }
    throw error;
  }

  try {
    const catalogItem = singleIngredientDrinkFromName(owner.name, owner.taxCategory);
    if (!catalogItem) {
      const [category] = owner.categoryId === null ? [] : await db.select({ tip: kategorijeTable.tip })
        .from(kategorijeTable)
        .where(and(eq(kategorijeTable.id, owner.categoryId), eq(kategorijeTable.enotaId, enotaId)));
      if (owner.taxCategory !== "food" || (owner.categoryId !== null && category?.tip !== "hrana")) {
        res.status(422).json({ error: "Spletni predlog recepta je na voljo samo za jedi; pijači z odmerkom v nazivu lahko predlagamo eno sestavino." }); return;
      }
    }
    if (!catalogItem && (!process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL || !process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY)) {
      res.status(503).json({ error: "Raziskovanje receptov trenutno ni na voljo, ker konfiguracija LLM manjka." }); return;
    }
    const research = catalogItem
      ? { items: [catalogItem], sources: [] }
      : await getInitialRecipeResearch(enotaId, artikelId, owner.revision, owner.name, async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 45_000);
      try {
        const response = await anthropic.messages.create({
          model: "claude-sonnet-5",
          max_tokens: 8_192,
          system: "Research complete public recipes. Return JSON only. Never invent URLs, quantities, units, servings, recipe results, or yield. Use only two to four recipes actually returned by web search, each from a different approved domain. Every selected recipe must have a complete ingredient list. Include raw ingredients only; do not include prepared or semi-finished components. Quantities must be positive and use only g, kg, ml, l, or kos. Reject ambiguous measures, including cups and spoons.",
          messages: [{
            role: "user",
            content: `Poišči 2–4 popolne javne recepte za jed "${owner.name}" z vsaj dveh različnih domen: bbcgoodfood.com, theguardian.com, seriouseats.com, epicurious.com, allrecipes.com, tasteofhome.com, delish.com, foodnetwork.com, kingarthurbaking.com, jamieoliver.com. Vrni celoten seznam sestavin za vsak recept, število porcij, natančen sourceUrl, količine in enote. Brez ugibanja in brez izpuščanja sestavin; neuporabne recepte izpusti. Odgovori izključno kot {"recipes":[{"sourceUrl":"...","servings":4,"ingredients":[{"name":"...","quantity":100,"unit":"g"}]}]}.`,
          }],
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
        }, { signal: controller.signal, timeout: 45_000 });
        return response.content as unknown[];
      } finally { clearTimeout(timeout); }
      });
    const resolved = await resolveInitialNormativeItems(db, enotaId, research.items);
    const items = research.items.map((item, index) => {
      const existingArticleId = resolved[index]!.vhodniArtikelId;
      return {
        name: item.name,
        quantity: Number(item.quantity),
        unit: item.unit,
        existingArticleId,
        willCreate: existingArticleId === null,
        sourceUrls: item.sourceUrls,
      };
    });
    const token = signInitialNormativeProposal({
      v: 1,
      ...(catalogItem ? { origin: "catalog_volume" as const } : {}),
      enotaId,
      articleId: artikelId,
      revision: owner.revision,
      targetName: owner.name,
      issuedAt: Date.now(),
      items: research.items.map((item, index) => ({
        ...item,
        existingArticleId: resolved[index]!.vhodniArtikelId,
        willCreate: resolved[index]!.vhodniArtikelId === null,
      })),
      sources: research.sources,
    });
    if (!token) { res.status(503).json({ error: "Predloga trenutno ni mogoče varno podpisati." }); return; }
    res.json({
      token,
      articleId: artikelId,
      revision: owner.revision,
      items,
      sources: research.sources,
      warnings: [catalogItem ? CATALOG_VOLUME_WARNING : INITIAL_NORMATIVE_WARNING],
    });
  } catch (error) {
    if (error instanceof NormativeRequestError) { res.status(error.status).json(error.responseBody); return; }
    if (error instanceof NormativeStaleError) {
      res.status(409).json({ code: "NORMATIVE_STALE", error: "Ujemanje sestavine se je spremenilo; ustvarite nov predlog." }); return;
    }
    if (error instanceof InitialNormativeError) {
      const status = error.code === "RESEARCH_BUSY" || error.code === "RESEARCH_RATE_LIMITED" ? 503 : 422;
      const messages: Record<string, string> = {
        RESEARCH_INVALID: "Raziskava ni vrnila pričakovanih strukturiranih podatkov.",
        RESEARCH_INSUFFICIENT_SOURCES: "Najdena nista bila vsaj dva preverljiva recepta iz različnih odobrenih domen.",
        RECIPE_AMBIGUOUS_INGREDIENT: "Recept vsebuje sestavino z nejasno enoto ali pripravljeno/polpripravljeno sestavino.",
        RECIPE_DUPLICATE_INGREDIENT: "Recept vsebuje podvojeno normalizirano sestavino.",
        RECIPE_INVALID_QUANTITY: "Recept vsebuje neveljavno količino.",
        RECIPE_CONFLICTING_UNITS: "Recepti vsebujejo nezdružljive enote za isto sestavino.",
        RECIPE_INCOMPLETE: "AI-predlogi vsebujejo neskladne sezname sestavin; predlog ni bil ustvarjen.",
        RESEARCH_RATE_LIMITED: "Za to poslovno enoto je preveč zahtev za raziskavo. Poskusite pozneje.",
        RESEARCH_BUSY: "Raziskava je trenutno preobremenjena. Poskusite pozneje.",
      };
      res.status(status).json({ error: messages[error.code] ?? "Predloga normativa ni mogoče ustvariti." }); return;
    }
    throw error;
  }
});

router.post("/artikli/:id/normativi/pametni-predlog/uporabi", requireEnota, async (req, res): Promise<void> => {
  const enotaId = requireCanonicalNormativeUnit(req, res);
  if (enotaId === null) return;
  const artikelId = Number(req.params.id);
  if (!Number.isInteger(artikelId) || artikelId <= 0) { res.status(400).json({ error: "Neveljaven artikel." }); return; }
  const parsed = ApplyInitialNormativeBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Za uporabo predloga sta potrebna veljaven token in confirmed: true." }); return; }
  const proposal = verifyInitialNormativeProposal(parsed.data.token);
  if (!proposal || proposal.articleId !== artikelId || proposal.enotaId !== enotaId) {
    res.status(400).json({ error: "Predlog normativa ni veljaven ali je potekel." }); return;
  }
  const newItemIndexes = proposal.items.flatMap((item, index) => item.willCreate ? [index] : []);
  const classifications = parsed.data.classifications;
  const classificationIndexes = classifications.map(classification => classification.index);
  if (new Set(classificationIndexes).size !== classificationIndexes.length
    || classificationIndexes.length !== newItemIndexes.length
    || newItemIndexes.some(index => !classificationIndexes.includes(index))
    || classifications.some(classification => !proposal.items[classification.index]?.willCreate)) {
    res.status(400).json({ error: "Za vsak novi artikel je potrebna natanko ena klasifikacija, za obstoječe artikle pa nobena." }); return;
  }
  if (proposal.items.some(item => item.willCreate && isDetectablyPreparedIngredient(item.name))) {
    res.status(422).json({ error: "Pripravljenega ali polpripravljenega artikla ni dovoljeno ustvariti kot surovo sestavino." }); return;
  }
  if (!process.env.POS_NORMATIVE_PROPOSAL_SECRET && !process.env.SESSION_SECRET) {
    res.status(503).json({ error: "Podpisni ključ za predloge normativa ni nastavljen." }); return;
  }
  try {
    const createdArticleIds = await db.transaction(async tx => {
      await lockNormativeGraph(tx, enotaId);
      await normativRevisionLockTestHook?.({ artikelId, operation: "normativ-update" });
      const [owner] = await tx.select({
        id: artikliTable.id,
        name: artikliTable.ime,
        taxCategory: artikliTable.taxCategory,
        revision: artikliTable.normativRevision,
        sale: artikliTable.prodajniArtikel,
        mealType: artikliTable.mealType,
        nabavniArtikel: artikliTable.nabavniArtikel,
      }).from(artikliTable)
        .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)))
        .for("update");
      if (!owner) throw new NormativeRequestError(404, { error: "Artikel ni najden." });
      if (!owner.sale) throw new NormativeRequestError(422, { error: "Pametni predlog ni na voljo za artikle, ki so samo nabavni." });
      if (Number(owner.revision) !== proposal.revision || owner.name !== proposal.targetName) throw new NormativeStaleError();
      if (proposal.origin === "catalog_volume") {
        const expected = singleIngredientDrinkFromName(owner.name, owner.taxCategory);
        const item = proposal.items[0];
        if (!expected || !item || item.name !== expected.name || item.quantity !== expected.quantity || item.unit !== expected.unit) {
          throw new NormativeStaleError();
        }
      }
      const [existingNorm] = await tx.select({ id: normativiTable.id }).from(normativiTable)
        .where(eq(normativiTable.artikelId, artikelId)).limit(1);
      if (existingNorm) throw new NormativeStaleError();

      const resolved = await resolveInitialNormativeItems(tx, enotaId, proposal.items);
      const createdIds: number[] = [];
      const normativItems: NormativInput[] = [];
      const ddvMap: Record<string, string> = {};
      if (newItemIndexes.length > 0) {
        const globalRows = await tx.select({
          kljuc: nastavitveTable.kljuc,
          vrednost: nastavitveTable.vrednost,
        }).from(nastavitveTable).where(eq(nastavitveTable.enotaId, 0));
        for (const row of globalRows) ddvMap[row.kljuc] = row.vrednost;
      }
      for (let index = 0; index < proposal.items.length; index++) {
        const item = proposal.items[index]!;
        const matchedId = resolved[index]!.vhodniArtikelId;
        if (matchedId !== item.existingArticleId || item.willCreate !== (matchedId === null)) throw new NormativeStaleError();
        let ingredientId = matchedId;
        if (ingredientId === null) {
          const classification = classifications.find(value => value.index === index)!;
          const [created] = await tx.insert(artikliTable).values({
            enotaId,
            ime: item.name,
            imeZaNabavo: item.name,
            cena: "0",
            davek: initialIngredientVatRate(classification.taxCategory, classification.addedSugar, ddvMap),
            nabavniArtikel: true,
            prodajniArtikel: false,
            vrstaArtikla: "material",
            mealType: "ala_carte",
            enotaMere: item.unit,
            taxCategory: classification.taxCategory,
            addedSugar: classification.addedSugar,
          }).returning({ id: artikliTable.id });
          ingredientId = created!.id;
          createdIds.push(ingredientId);
        }
        normativItems.push({ vhodniArtikelId: ingredientId, kolicina: resolved[index]!.kolicina });
      }
      const prepared = await prepareNormativUpdate(
        artikelId,
        enotaId,
        { expectedRevision: proposal.revision, items: normativItems },
        { mealType: owner.mealType, nabavniArtikel: owner.nabavniArtikel, prodajniArtikel: owner.sale },
        tx,
      );
      await applyPreparedNormativUpdate(tx, artikelId, enotaId, prepared);
      return createdIds;
    });
    res.json({ createdArticleIds, normativRevision: proposal.revision + 1 });
  } catch (error) {
    if (error instanceof NormativeStaleError) {
      res.status(409).json({ code: "NORMATIVE_STALE", error: "Artikel ali normativ se je medtem spremenil. Osvežite podatke in ustvarite nov predlog." }); return;
    }
    if (error instanceof NormativeRequestError) { res.status(error.status).json(error.responseBody); return; }
    throw error;
  }
});

router.get("/artikli/:id/normativi/spletne-spremembe", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id);
  const enotaId = (req as any).enotaId as number;
  if (!["admin", "admin_enote", "superadmin"].includes((req as any).vloga)) {
    res.status(403).json({ error: "Za ogled zgodovine normativa je potrebna vloga upravitelja." }); return;
  }
  if (!Number.isInteger(artikelId) || artikelId <= 0) {
    res.status(400).json({ error: "Neveljaven artikel." }); return;
  }

  const [owner] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!owner) { res.status(404).json({ error: "Artikel ni najden." }); return; }

  const result = await db.execute(sql<NormativeChangeHistoryRow>`
    SELECT
      audit.id,
      audit.changed_at AS "changedAt",
      audit.actor_clerk_user_id AS "actorClerkUserId",
      audit.actor_natakar_id AS "actorNatakarId",
      NULLIF(TRIM(CONCAT(n.ime, ' ', n.priimek)), '') AS "actorName",
      audit.ingredient_id AS "ingredientId",
      ingredient.ime AS "ingredientName",
      audit.old_quantity AS "oldQuantity",
      audit.new_quantity AS "newQuantity",
      audit.unit,
      audit.source_url AS "sourceUrl",
      audit.source_title AS "sourceTitle",
      audit.comparison_generated_at AS "comparisonGeneratedAt"
    FROM pos_normative_change_audit audit
    JOIN enote e ON e.id = audit.enota_id
    LEFT JOIN natakari n
      ON n.id = audit.actor_natakar_id
      AND n.company_id = e.company_id
    LEFT JOIN artikli ingredient
      ON ingredient.id = audit.ingredient_id
      AND ingredient.enota_id = audit.enota_id
    WHERE audit.enota_id = ${enotaId}
      AND audit.artikel_id = ${artikelId}
    ORDER BY audit.changed_at DESC, audit.id DESC
    LIMIT 100
  `);

  const rows = result.rows as unknown as NormativeChangeHistoryRow[];
  res.json(rows.map(row => ({
    id: Number(row.id),
    changedAt: new Date(row.changedAt).toISOString(),
    actorClerkUserId: row.actorClerkUserId,
    actorNatakarId: row.actorNatakarId == null ? null : Number(row.actorNatakarId),
    actorName: row.actorName ?? null,
    ingredientId: Number(row.ingredientId),
    ingredientName: row.ingredientName ?? `Artikel #${row.ingredientId}`,
    oldQuantity: Number(row.oldQuantity),
    newQuantity: Number(row.newQuantity),
    unit: row.unit,
    sourceUrl: row.sourceUrl,
    sourceTitle: row.sourceTitle,
    comparisonGeneratedAt: new Date(row.comparisonGeneratedAt).toISOString(),
  })));
});

router.post("/artikli/:id/normativi/spletni-predlogi", requireEnota, async (req, res): Promise<void> => {
  const artikelId = Number(req.params.id);
  const enotaId = (req as any).enotaId as number;
  const requestedEnotaHeader = req.headers["x-enota-id"];
  if (typeof requestedEnotaHeader !== "string" || !/^[1-9]\d*$/.test(requestedEnotaHeader)) {
    res.status(400).json({ error: "Za potrditev predlogov izberite poslovno enoto." }); return;
  }
  const requestedEnotaId = Number(requestedEnotaHeader);
  if (!Number.isSafeInteger(requestedEnotaId) || requestedEnotaId !== enotaId) {
    res.status(403).json({ error: "Izbrana poslovna enota se ne ujema z dovoljenim dostopom." }); return;
  }
  if (!Number.isInteger(artikelId) || artikelId <= 0) { res.status(400).json({ error: "Neveljaven artikel." }); return; }
  if (!["admin", "admin_enote", "superadmin"].includes((req as any).vloga)) {
    res.status(403).json({ error: "Za potrditev predlogov je potrebna vloga upravitelja." }); return;
  }
  const parsed = ApplyNormativeProposalsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Neveljavni predlogi normativa." }); return; }
  if (!process.env.POS_NORMATIVE_PROPOSAL_SECRET && !process.env.SESSION_SECRET) {
    res.status(503).json({ error: "Podpisni ključ za predloge normativa ni nastavljen." }); return;
  }
  const proposals = parsed.data.selections.map(item => verifyNormativeProposal(item.proposalToken));
  if (proposals.some(p => !p) || proposals.some(p => p!.artikelId !== artikelId)) {
    res.status(400).json({ error: "Predlog normativa ni veljaven." }); return;
  }
  const signed = proposals as NonNullable<(typeof proposals)[number]>[];
  if (new Set(signed.map(p => p.normativRowId)).size !== signed.length) {
    res.status(400).json({ error: "Isti normativ je mogoče potrditi le enkrat." }); return;
  }
  if (new Set(signed.map(p => p.expectedRevision)).size !== 1) {
    res.status(400).json({ error: "Predlogi niso iz iste revizije normativa." }); return;
  }
  class StaleProposal extends Error {}
  try {
    const applied = await db.transaction(async (tx) => {
      const owner = await tx.execute(sql`SELECT id, normativ_revision AS revision FROM artikli WHERE id = ${artikelId} AND enota_id = ${enotaId} FOR UPDATE`) as any;
      const ownerRow = (owner.rows ?? owner)[0] as { revision: number } | undefined;
      if (!ownerRow || Number(ownerRow.revision) !== signed[0].expectedRevision) throw new StaleProposal();
      const ids = signed.map(p => p.normativRowId);
      const locked = await tx.execute(sql`
        SELECT n.id AS "normativRowId", n.artikel_id AS "artikelId", n.vhodni_artikel_id AS "ingredientId",
          n.kolicina AS quantity, a.enota_mere AS unit
        FROM normativi n JOIN artikli a ON a.id = n.vhodni_artikel_id
        WHERE n.id IN (${sql.join(ids.map(id => sql`${id}`), sql`, `)}) AND a.enota_id = ${enotaId} FOR UPDATE
      `) as any;
      const rows = (locked.rows ?? locked) as Array<{ normativRowId: number; artikelId: number; ingredientId: number; quantity: string; unit: string | null }>;
      if (rows.length !== signed.length) throw new StaleProposal();
      const byId = new Map(rows.map(row => [Number(row.normativRowId), row]));
      for (const p of signed) {
        const row = byId.get(p.normativRowId);
        if (!row || Number(row.artikelId) !== artikelId || Number(row.ingredientId) !== p.ingredientId
          || row.unit !== p.localUnit || !new Decimal(row.quantity).eq(new Decimal(p.expectedQuantity))) throw new StaleProposal();
      }
      const result = [];
      for (const p of signed) {
        const row = byId.get(p.normativRowId)!;
        const quantity = new Decimal(p.proposedQuantity);
        if (!quantity.isFinite() || !quantity.isPositive() || quantity.gt("999999.9999") || quantity.decimalPlaces()! > 4) throw new StaleProposal();
        await tx.update(normativiTable).set({ kolicina: quantity.toFixed(4) }).where(eq(normativiTable.id, p.normativRowId));
        await tx.insert(posNormativeChangeAuditTable).values({
          enotaId, artikelId, normativRowId: p.normativRowId, ingredientId: p.ingredientId,
          actorClerkUserId: (req as any).clerkUserId, actorNatakarId: (req as any).posActorNatakarId ?? null,
          oldQuantity: new Decimal(row.quantity).toFixed(4), newQuantity: quantity.toFixed(4), unit: p.localUnit,
          sourceUrl: p.sourceUrl, sourceTitle: p.sourceTitle, comparisonGeneratedAt: new Date(p.generatedAt),
        });
        result.push({ normativRowId: p.normativRowId, ingredientId: p.ingredientId, oldQuantity: Number(row.quantity),
          newQuantity: Number(quantity), unit: p.localUnit, sourceUrl: p.sourceUrl, sourceTitle: p.sourceTitle });
      }
      await razveljaviAlergeneNadrejenih(artikelId, tx as any);
      const revision = signed[0].expectedRevision + 1;
      await tx.update(artikliTable).set({ normativRevision: revision }).where(eq(artikliTable.id, artikelId));
      return { result, revision };
    });
    res.json({ applied: applied.result, changed: applied.result.length, revision: applied.revision });
  } catch (error) {
    if (error instanceof StaleProposal) { res.status(409).json({ code: "NORMATIVE_PROPOSAL_STALE", error: "Normativ se je medtem spremenil." }); return; }
    throw error;
  }
});

export default router;
