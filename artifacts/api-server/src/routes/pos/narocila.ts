import { Router, type IRouter, type Request, type Response } from "express";

export function assertNoClaimedMalicaAllocations(claims: readonly unknown[]): void {
  if (claims.length > 0) throw new Error("MALICA_ALLOCATION_CLAIMED");
}
import { aliasedTable, and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { artModSkupineTable, artikliTable, db, dostavaStatusZgodovinaTable, enoteTable, kategorijeTable, kdsDogodkiTable, kdsIzdajaDogodkiTable, kdsNalogiTable, mizeTable, modNormativiTable, modSkupineTable, modifikatorjiTable, multicourseMenuCoursesTable, multicourseMenusTable, narocnikNasloviTable, narocnikiTable, narocilaTable, naseljaTable, nastavitveTable, normativiTable, postavkeTable, prenosiNarocilTable, prostoriTable, racuniTable, rezervacijeMizTable, shranjeniKupciTable, zacetneZalogeTable } from "@workspace/db";
import { AddMulticourseMenuBody, AddMulticourseMenuParams, AddMulticourseMenuResponse } from "@workspace/api-zod";
import { broadcastToDevice, broadcastToUnit } from "../../lib/pos-sse";
import { round2 } from "../../lib/pos-furs";
import { splitMulticourseGross } from "../../lib/multicourse-pricing";
import { getSimDatumOrNow } from "../../lib/sim-datum";
import { cenaPicePoVelikosti, happyHourCenaPicePoVelikosti, izracunajVelikostiPic, privzetaVelikostPice, type PizzaVelikostId } from "../../lib/pica-velikosti";
import { readAll } from "./nastavitve";
import { isHappyHourActiveForArticle, parseHappyHourRules, type HappyHourPravilo } from "../../lib/happy-hour";
import { loadVatRules, resolveRate, resolveSupplyKind, getNastavitveMap, isMenuEligibleTaxCategory, type TaxCategory } from "../../lib/ddv-resolver";
import {
  izracunajPredvidenPrevzem,
  jeNarociloSamoPijaca,
  pickupBeverageEstimateSettingsFromMap,
  pickupEstimateSettingsFromMap,
  samoPijace,
} from "../../lib/pos-pickup-estimate";
import { izracunajCenoDostave, izracunajPredvidenoDostavo, ustvariDostavniSnapshot, ustvariDostavnoPostavko } from "../../lib/pos-dostava-narocila";
import { normalizirajTelefon } from "../../lib/narocniki-telefon";
import { resolveCompositeEtas } from "../../lib/composite-eta";
import {
  assertPreparedFoodAvailability,
  buildModifierAvailabilityRequests,
  businessDateForTimestamp,
  InsufficientPreparedFoodAvailabilityError,
  lockPreparedFoodAvailability,
  loadModifierAvailabilitySnapshots,
} from "../../lib/prepared-food-availability";
import { isPreparedFoodBulkUnit } from "../../lib/prepared-food-units";
import { assertOpenOrderCanChange, jeMizaBlokiranaZaNarocilo, reservationBlockingClause, zakleniMizo } from "../../lib/rezervacijeMiz";
import {
  checkPreviousBusinessDayClosed,
  isPosBusinessDayClosed,
  lockPosBusinessDay,
} from "../../lib/pos-z-helpers";
import { materializirajKdsNaloge } from "./kds";
import { assertKdsOrderNotDispatched, KdsOrderAlreadyDispatchedError, lockKdsOrder } from "../../lib/kds-dispatch";
import { slovenskiDatumZaSporocilo } from "../../lib/slovenian-date-message";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type PodIzbiraInput = { artikelId: number; modifikatorIds: number[] };
type ResolvedPodMod = {
  id: number;
  ime: string;
  cenaDodatek: number;
  sourceArtikelId: number;
  sourceNormQuantity: number;
  availabilityRequirements: Array<{ articleId: number; quantity: number; mealType: "ala_carte" | "prepared" | "composite" }>;
};

async function resolveNestedModifierChoices(
  executor: typeof db | DbTransaction,
  enotaId: number,
  parentModifierId: number,
  podIzbire: PodIzbiraInput[] | undefined,
): Promise<ResolvedPodMod[]> {
  const normRows = await executor.select({
    articleId: modNormativiTable.vhodniArtikelId,
    quantity: modNormativiTable.kolicina,
  }).from(modNormativiTable)
    .innerJoin(artikliTable, eq(modNormativiTable.vhodniArtikelId, artikliTable.id))
    .where(and(
      eq(modNormativiTable.modifikatorId, parentModifierId),
      eq(artikliTable.enotaId, enotaId),
      eq(artikliTable.prodajniArtikel, true),
      eq(artikliTable.aktiven, true),
      sql`${modNormativiTable.kolicina} > 0`,
    ));
  const sourceQuantityByArticle = new Map<number, number>();
  for (const row of normRows) {
    const quantity = Number(row.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error(`Normativ modifikatorja ${parentModifierId} vsebuje neveljavno količino.`);
    }
    sourceQuantityByArticle.set(row.articleId, (sourceQuantityByArticle.get(row.articleId) ?? 0) + quantity);
  }

  const requestedByArticle = new Map<number, number[]>();
  for (const source of podIzbire ?? []) {
    if (!Number.isInteger(source.artikelId) || source.artikelId < 1
      || !Array.isArray(source.modifikatorIds)
      || source.modifikatorIds.some((id) => !Number.isInteger(id) || id < 1)) {
      throw new Error("Neveljavna podizbira modifikatorja.");
    }
    if (requestedByArticle.has(source.artikelId)) {
      throw new Error(`Podvojena podizbira za artikel ${source.artikelId}.`);
    }
    requestedByArticle.set(source.artikelId, source.modifikatorIds);
  }
  for (const articleId of requestedByArticle.keys()) {
    if (!sourceQuantityByArticle.has(articleId)) {
      throw new Error(`Artikel ${articleId} ni pozitiven vhodni artikel normativa modifikatorja ${parentModifierId}.`);
    }
  }

  const resolved: ResolvedPodMod[] = [];
  for (const [sourceArticleId, sourceNormQuantity] of sourceQuantityByArticle) {
    const groups = await executor.select({
      skupinaId: artModSkupineTable.skupinaId,
      obvezna: modSkupineTable.obvezna,
      minIzbir: modSkupineTable.minIzbir,
      maxIzbir: modSkupineTable.maxIzbir,
    }).from(artModSkupineTable)
      .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
      .where(and(
        eq(artModSkupineTable.artikelId, sourceArticleId),
        eq(modSkupineTable.enotaId, enotaId),
      ));
    const selection = requestedByArticle.get(sourceArticleId);
    if (groups.length === 0) {
      if (selection?.length) throw new Error(`Artikel ${sourceArticleId} nima modifikatorskih skupin.`);
      continue;
    }
    if (!selection) {
      const required = groups.find((group) => group.obvezna || group.minIzbir > 0);
      if (required) {
        throw new Error(`Za vhodni artikel ${sourceArticleId} so obvezne podizbire modifikatorja.`);
      }
      continue;
    }
    if (new Set(selection).size !== selection.length) {
      throw new Error(`Podvojeni modifikatorji v podizbiri artikla ${sourceArticleId}.`);
    }
    const groupIds = groups.map((group) => group.skupinaId);
    const selectedMods = selection.length > 0
      ? await executor.select({
        id: modifikatorjiTable.id,
        skupinaId: modifikatorjiTable.skupinaId,
        ime: modifikatorjiTable.ime,
        cenaDodatek: modifikatorjiTable.cenaDodatek,
      }).from(modifikatorjiTable).where(and(
        inArray(modifikatorjiTable.skupinaId, groupIds),
        inArray(modifikatorjiTable.id, selection),
        eq(modifikatorjiTable.aktiven, true),
      ))
      : [];
    const modMap = new Map(selectedMods.map((mod) => [mod.id, mod]));
    if (selection.some((id) => !modMap.has(id))) {
      throw new Error(`Podizbira vsebuje neveljaven, neaktiven ali tuj modifikator za artikel ${sourceArticleId}.`);
    }
    const deeperGroups = selectedMods.length > 0
      ? await executor.select({ modifierId: modNormativiTable.modifikatorId })
        .from(modNormativiTable)
        .innerJoin(artikliTable, eq(modNormativiTable.vhodniArtikelId, artikliTable.id))
        .innerJoin(artModSkupineTable, eq(artModSkupineTable.artikelId, artikliTable.id))
        .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
        .where(and(
          inArray(modNormativiTable.modifikatorId, selectedMods.map((mod) => mod.id)),
          eq(artikliTable.enotaId, enotaId),
          eq(modSkupineTable.enotaId, enotaId),
          sql`${modNormativiTable.kolicina} > 0`,
        ))
      : [];
    if (deeperGroups.length > 0) {
      throw new Error("Podizbire modifikatorjev so podprte samo do ene ravni.");
    }
    const counts = new Map<number, number>();
    for (const mod of selectedMods) counts.set(mod.skupinaId, (counts.get(mod.skupinaId) ?? 0) + 1);
    for (const group of groups) {
      const count = counts.get(group.skupinaId) ?? 0;
      const minRequired = group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir;
      if (count < minRequired) {
        throw new Error(`Skupina ${group.skupinaId} za artikel ${sourceArticleId}: obvezno je izbrati vsaj ${minRequired} modifikator(jev), izbrano: ${count}.`);
      }
      if (group.maxIzbir > 0 && count > group.maxIzbir) {
        throw new Error(`Skupina ${group.skupinaId} za artikel ${sourceArticleId}: izbrali ste preveč modifikatorjev (maks ${group.maxIzbir}).`);
      }
    }
    const snapshots = await loadModifierAvailabilitySnapshots(executor, selectedMods.map((mod) => mod.id));
    for (const mod of selectedMods) {
      resolved.push({
        id: mod.id,
        ime: mod.ime,
        cenaDodatek: Number(mod.cenaDodatek),
        sourceArtikelId: sourceArticleId,
        sourceNormQuantity,
        availabilityRequirements: (snapshots.get(mod.id) ?? []).map((requirement) => ({
          ...requirement,
          quantity: requirement.quantity * sourceNormQuantity,
        })),
      });
    }
  }
  return resolved;
}

class PizzaDoughConfigurationError extends Error {
  readonly code = "PIZZA_DOUGH_CONFIGURATION_INVALID";
}

export function resolveConfiguredPizzaDoughArticleId(
  mapping: {
    normal_dough_article_id: number | string | null;
    small_dough_article_id: number | string | null;
  } | null,
  velikost: PizzaVelikostId,
): number | null {
  if (!mapping) return null;
  if (velikost === "druzinska") {
    throw new Error("Za družinsko pico ni nastavljen ustrezen artikel testa.");
  }
  const articleId = Number(velikost === "mala"
    ? mapping.small_dough_article_id
    : mapping.normal_dough_article_id);
  if (!Number.isInteger(articleId) || articleId <= 0) {
    throw new Error("Za izbrano velikost pice ni nastavljen ustrezen artikel testa.");
  }
  return articleId;
}

async function loadPizzaDoughArticleId(
  tx: DbTransaction,
  enotaId: number,
  velikost: PizzaVelikostId,
): Promise<number | null> {
  const result = await tx.execute(sql`
    SELECT normal_dough_article_id, small_dough_article_id
    FROM pizza_dough_settings
    WHERE enota_id = ${enotaId}
    LIMIT 1
  `);
  const mapping = result.rows[0] as {
    normal_dough_article_id: number | string | null;
    small_dough_article_id: number | string | null;
  } | undefined;
  // No settings row means the dough family is not enabled for this unit.
  let articleId: number | null;
  try {
    articleId = resolveConfiguredPizzaDoughArticleId(mapping ?? null, velikost);
  } catch (error) {
    throw new PizzaDoughConfigurationError(error instanceof Error ? error.message : "Nastavitve testa za pice niso veljavne.");
  }
  if (articleId == null) return null;
  const articleResult = await tx.execute(sql`
    SELECT id
    FROM artikli
    WHERE id = ${articleId}
      AND enota_id = ${enotaId}
      AND meal_type = 'prepared'
      AND prodajni_artikel = false
    LIMIT 1
  `);
  if (articleResult.rows.length === 0) {
    throw new PizzaDoughConfigurationError("Nastavljeni artikel testa mora pripadati poslovni enoti, biti pripravljen artikel in ne sme biti prodajni artikel.");
  }
  return articleId;
}

function izracunajDDVNeskladje(postavke: { kolicina: number; cenaKos: number; skupaj: number; davek: number }[]): { imaNeskladje: boolean; razlika: number } {
  if (postavke.length === 0) return { imaNeskladje: false, razlika: 0 };

  const ddv = round2(postavke.reduce((acc, p) => acc + round2(p.skupaj * p.davek / (100 + p.davek)), 0));

  const vatGroups = new Map<number, number>();
  for (const p of postavke) {
    const lineTotal = round2(p.kolicina * p.cenaKos);
    const taxAmount = round2((lineTotal * p.davek) / (100 + p.davek));
    vatGroups.set(p.davek, (vatGroups.get(p.davek) ?? 0) + taxAmount);
  }
  const skupajDDVSkupin = round2(Array.from(vatGroups.values()).reduce((a, b) => a + b, 0));
  const razlika = round2(Math.abs(skupajDDVSkupin - ddv));

  return { imaNeskladje: razlika > 0.01, razlika };
}

/** Resolves the numerical part of a partial item PATCH without mutating it. */
export function resolvePartialPostavkaNumbers(
  body: Record<string, unknown>,
  lockedQuantity: number,
  lockedPrice: number,
): { kolicina: number; cenaKos: number; skupaj: number } | null {
  const quantity = body.kolicina === undefined ? lockedQuantity : body.kolicina;
  const price = body.cenaKos === undefined ? lockedPrice : body.cenaKos;
  if (typeof quantity !== "number" || !Number.isFinite(quantity) || quantity <= 0
    || typeof price !== "number" || !Number.isFinite(price) || price < 0) return null;
  return { kolicina: quantity, cenaKos: price, skupaj: round2(quantity * price) };
}

const router: IRouter = Router();

type MulticourseConfiguration = {
  izbor: "fixed_four" | "choose_three"; selectionMode?: "fixed" | "choose"; selectionCount?: number | null;
  courses: Array<{ courseNumber: number; foodArtikelId: number; allowedFoodArtikelIds: number[]; allowedWineArtikelIds: number[]; wineRequired?: boolean; informational?: boolean }>;
};

/**
 * The request chooses configured food and wine labels; components and pairing
 * metadata are deliberately materialized from the active, tenant-owned config.
 */
export function resolveMulticourseSelections(
  configuration: MulticourseConfiguration,
  selections: Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null }>,
): Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null; courseSequence: number }> | null {
  // Rows created by pre-generic callers can have the new DB default (`fixed`)
  // without having gone through the data migration. In that specific shape,
  // retain the authoritative legacy choose-three behavior.
  const mode = configuration.izbor === "choose_three" && configuration.selectionMode === "fixed" && configuration.selectionCount == null
    ? "choose"
    : configuration.selectionMode ?? (configuration.izbor === "choose_three" ? "choose" : "fixed");
  const normal = configuration.courses.filter(course => !course.informational);
  const expectedCount = mode === "fixed" ? normal.length : (configuration.selectionCount ?? 3);
  const configuredByNumber = new Map(configuration.courses.map((course) => [course.courseNumber, course]));
  const seen = new Set<number>();
  if (configuration.courses.length < 2 || configuration.courses.length > 20 || configuredByNumber.size !== configuration.courses.length
    || configuration.courses.some((course, index) => course.courseNumber !== index + 1)
    || expectedCount < 1 || expectedCount > normal.length || selections.length !== expectedCount) return null;

  const resolved = selections.map((selection, index) => {
    const course = configuredByNumber.get(selection.courseNumber);
    const foods = course?.allowedFoodArtikelIds.length ? course.allowedFoodArtikelIds : [course?.foodArtikelId];
    if (!course || course.informational || seen.has(selection.courseNumber) || !foods.includes(selection.foodArtikelId)
      || (course.wineRequired !== false && !course.allowedWineArtikelIds.includes(selection.wineArtikelId as number))
      || (course.wineRequired === false && selection.wineArtikelId !== null && !course.allowedWineArtikelIds.includes(selection.wineArtikelId))) {
      return null;
    }
    seen.add(selection.courseNumber);
    return {
      courseNumber: course.courseNumber,
      foodArtikelId: selection.foodArtikelId,
      wineArtikelId: selection.wineArtikelId,
      courseSequence: index + 1,
    };
  });
  if (resolved.some((selection) => selection === null)) return null;
  if (mode === "fixed" && normal.some(course => !seen.has(course.courseNumber))) return null;
  const automatic = configuration.courses.filter(course => course.informational).map((course) => ({
    courseNumber: course.courseNumber, foodArtikelId: course.foodArtikelId, wineArtikelId: null, courseSequence: 0,
  }));
  return [...resolved as Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null; courseSequence: number }>, ...automatic]
    .map((item, index) => ({ ...item, courseSequence: index + 1 })) as any;
}

/** Server-side guard for every staff item/modifier write (nested paths included). */
router.use("/narocila/:id/postavke", async (req, res, next): Promise<void> => {
  if (!["POST", "PATCH", "DELETE"].includes(req.method)) { next(); return; }
  const tenotaId = (req as any).enotaId as number;
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) { res.status(400).json({ error: "Neveljaven ID naročila." }); return; }
  const [narocilo] = await db.select({ mizaId: narocilaTable.mizaId, status: narocilaTable.status })
    .from(narocilaTable).where(and(eq(narocilaTable.id, id), eq(narocilaTable.enotaId, tenotaId)));
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  if (narocilo.status === "odprto" && narocilo.mizaId != null && await jeMizaBlokiranaZaNarocilo(narocilo.mizaId)) {
    req.log.warn({ narociloId: id, mizaId: narocilo.mizaId }, "Order item mutation blocked by imminent reservation");
    res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA" });
    return;
  }
  next();
});

async function fetchPostavke(narociloId: number) {
  const rows = await db
    .select({
      id: postavkeTable.id,
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos,
      cenaKosOriginalna: postavkeTable.cenaKosOriginalna,
      skupaj: postavkeTable.skupaj,
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
      davek: postavkeTable.davek,
      opomba: postavkeTable.opomba,
      kategorijaId: artikliTable.kategorijaId,
      kategorijaIme: kategorijeTable.ime,
      jePica: artikliTable.jePica,
      racunId: postavkeTable.racunId,
      racunStevilka: racuniTable.stevilkaRacuna,
      gostStevilka: postavkeTable.gostStevilka,
      parentPostavkaId: postavkeTable.parentPostavkaId,
      modifikatorId: postavkeTable.modifikatorId,
      modifierSourceArticleId: postavkeTable.modifierSourceArticleId,
      velikostPice: postavkeTable.velikostPice,
      toGo: postavkeTable.toGo,
      jeDelMenija: postavkeTable.jeDelMenija,
      jeEmbalaza: postavkeTable.jeEmbalaza,
      courseNumber: postavkeTable.courseNumber,
      courseSequence: postavkeTable.courseSequence,
      courseNameSnapshot: postavkeTable.courseNameSnapshot,
      pairingGroupId: postavkeTable.pairingGroupId,
       statusPotrditve: postavkeTable.statusPotrditve,
      casPripraveMin: artikliTable.casPripraveMin,
      ustvarjeno: postavkeTable.ustvarjeno,
      pripravljeno: postavkeTable.pripravljeno})
    .from(postavkeTable)
    .leftJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
    .leftJoin(racuniTable, eq(postavkeTable.racunId, racuniTable.id))
    .where(eq(postavkeTable.narociloId, narociloId))
    .orderBy(desc(postavkeTable.id));

  return rows.map((p) => ({
    id: p.id,
    artikelId: p.artikelId,
    ime: p.ime,
    kolicina: p.kolicina,
    cenaKos: Number(p.cenaKos),
    cenaKosOriginalna: p.cenaKosOriginalna != null ? Number(p.cenaKosOriginalna) : null,
    skupaj: Number(p.skupaj),
    alergeni: p.alergeni ?? [],
    alergeniSledi: p.alergeniSledi ?? [],
    alergeniStatus: p.alergeniStatus ?? "nepreverjeno",
    alergeniVir: p.alergeniVir ?? null,
    alergeniOpombaVira: p.alergeniOpombaVira ?? null,
    alergeniDocumentId: p.alergeniDocumentId ?? null,
    alergeniVerifiedBy: p.alergeniVerifiedBy ?? null,
    alergeniVerifiedAt: p.alergeniVerifiedAt?.toISOString() ?? null,
    alergeniRevision: Number(p.alergeniRevision ?? 0),
    alergeniHash: p.alergeniHash ?? null,
    davek: Number(p.davek),
    opomba: p.opomba ?? null,
    kategorijaId: p.kategorijaId ?? null,
    kategorijaIme: p.kategorijaIme ?? null,
    jePica: p.jePica ?? false,
    racunId: p.racunId ?? null,
    racunStevilka: p.racunStevilka ?? null,
    gostStevilka: p.gostStevilka ?? null,
    parentPostavkaId: p.parentPostavkaId ?? null,
    modifikatorId: p.modifikatorId ?? null,
    modifierSourceArticleId: p.modifierSourceArticleId ?? null,
    velikostPice: p.velikostPice ?? null,
    toGo: p.toGo ?? false,
    jeDelMenija: p.jeDelMenija ?? false,
    jeEmbalaza: p.jeEmbalaza ?? false,
    courseNumber: p.courseNumber ?? null,
    courseSequence: p.courseSequence ?? null,
    courseNameSnapshot: p.courseNameSnapshot ?? null,
    pairingGroupId: p.pairingGroupId ?? null,
    statusPotrditve: p.statusPotrditve ?? "ni_potrebno",
    casPripraveMin: Number(p.casPripraveMin ?? 0),
    ustvarjeno: p.ustvarjeno.toISOString(),
    pripravljeno: p.pripravljeno?.toISOString() ?? null}));
}

/**
 * Retrospektivno dopolni DDV revizijsko sled za odprte To Go postavke, ki so
 * nastale pred uvedbo razreševalnika. Zaračunanih vrstic se nikoli ne dotika.
 */
async function uskladiLegacyToGoDdv(
  executor: DbTransaction,
  narociloId: number,
  enotaId: number,
  jeDdvZavezanec: boolean,
): Promise<number> {
  const kandidati = await executor
    .select({
      id: postavkeTable.id,
      davek: postavkeTable.davek,
      toGo: postavkeTable.toGo,
      artikelDavek: artikliTable.davek,
      taxCategory: artikliTable.taxCategory,
      addedSugar: artikliTable.addedSugar,
      jeDelMenija: postavkeTable.jeDelMenija,
    })
    .from(postavkeTable)
    .innerJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(artikliTable.enotaId, enotaId),
      isNull(postavkeTable.parentPostavkaId),
      isNull(postavkeTable.racunId),
      isNull(postavkeTable.appliedRuleId),
    ));

  const toGoKandidati = kandidati.filter((postavka) => postavka.toGo);
  if (toGoKandidati.length === 0) return 0;

  const [vatRules, nastavitve] = await Promise.all([
    loadVatRules(),
    getNastavitveMap(enotaId),
  ]);

  let posodobljenih = 0;
  for (const postavka of toGoKandidati) {
    const resolved = resolveRate({
      supplyKind: "to_go",
      taxCategory: (postavka.taxCategory ?? "food") as TaxCategory,
      addedSugar: Boolean(postavka.addedSugar),
      jeDelMenija: Boolean(postavka.jeDelMenija),
      nastavitve,
      fallbackRate: Number(postavka.artikelDavek),
      jeDdvZavezanec,
    }, vatRules);
    const novDavek = String(resolved.rate);

    // Brez konkretnega pravila ne prepisujemo zgodovinske stopnje z današnjim
    // fallbackom artikla, ker to ne bi ustvarilo preverljive revizijske sledi.
    if (resolved.ruleId == null) continue;

    await executor.update(postavkeTable)
      .set({
        davek: novDavek,
        appliedRuleId: resolved.ruleId,
      })
      .where(and(
        eq(postavkeTable.id, postavka.id),
        eq(postavkeTable.narociloId, narociloId),
        isNull(postavkeTable.racunId),
        isNull(postavkeTable.appliedRuleId),
      ));

    if (novDavek !== String(postavka.davek)) {
      await executor.update(postavkeTable)
        .set({ davek: novDavek })
        .where(and(
          eq(postavkeTable.narociloId, narociloId),
          eq(postavkeTable.parentPostavkaId, postavka.id),
          isNull(postavkeTable.racunId),
        ));
    }
    posodobljenih += 1;
  }

  return posodobljenih;
}

const staraMizaAlias = aliasedTable(mizeTable, "stara_miza");
const novaMizaAlias = aliasedTable(mizeTable, "nova_miza");

async function fetchPrenosi(narociloId: number) {
  const rows = await db
    .select({
      id: prenosiNarocilTable.id,
      narociloId: prenosiNarocilTable.narociloId,
      staraMizaId: prenosiNarocilTable.staraMizaId,
      staraMizaStevilka: staraMizaAlias.stevilka,
      staraMizaIme: staraMizaAlias.ime,
      novaMizaId: prenosiNarocilTable.novaMizaId,
      novaMizaStevilka: novaMizaAlias.stevilka,
      novaMizaIme: novaMizaAlias.ime,
      ustvarjeno: prenosiNarocilTable.ustvarjeno})
    .from(prenosiNarocilTable)
    .leftJoin(staraMizaAlias, eq(prenosiNarocilTable.staraMizaId, staraMizaAlias.id))
    .leftJoin(novaMizaAlias, eq(prenosiNarocilTable.novaMizaId, novaMizaAlias.id))
    .where(eq(prenosiNarocilTable.narociloId, narociloId))
    .orderBy(prenosiNarocilTable.ustvarjeno);

  return rows.map((p) => ({
    id: p.id,
    narociloId: p.narociloId,
    staraMizaId: p.staraMizaId ?? null,
    staraMizaStevilka: p.staraMizaStevilka ?? null,
    staraMizaIme: p.staraMizaIme ?? null,
    novaMizaId: p.novaMizaId ?? null,
    novaMizaStevilka: p.novaMizaStevilka ?? null,
    novaMizaIme: p.novaMizaIme ?? null,
    ustvarjeno: p.ustvarjeno}));
}

export async function getNarociloById(id: number, _davcna: string, tenotaId: number) {
  const [narocilo] = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      prostorId: mizeTable.prostorId,
      prostorIme: prostoriTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      znesekNapitnina: narocilaTable.znesekNapitnina,
      opomba: narocilaTable.opomba,
      toGo: narocilaTable.toGo,
      nacin: narocilaTable.nacin,
       vir: narocilaTable.vir,
      strankaIme: narocilaTable.strankaIme,
      strankaTelefon: narocilaTable.strankaTelefon,
      shranjeniKupecId: narocilaTable.shranjeniKupecId,
      predvidenPrevzem: narocilaTable.predvidenPrevzem,
      predvidenPrevzemRocen: narocilaTable.predvidenPrevzemRocen,
       nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
       narocnikId: narocilaTable.narocnikId,
       dostavaUlica: narocilaTable.dostavaUlica,
       dostavaHisnaStevilka: narocilaTable.dostavaHisnaStevilka,
       dostavaVhod: narocilaTable.dostavaVhod,
       dostavaNadstropje: narocilaTable.dostavaNadstropje,
       dostavaNaseljeNaziv: narocilaTable.dostavaNaseljeNaziv,
       dostavaNaseljeId: narocilaTable.dostavaNaseljeId,
       dostavaNavodilo: narocilaTable.dostavaNavodilo,
       dostavaStoritevId: narocilaTable.dostavaStoritevId,
       dostavaCena: narocilaTable.dostavaCena,
       dostavaCasMin: narocilaTable.dostavaCasMin,
       predvidenaDostava: narocilaTable.predvidenaDostava,
       dostavaStatus: narocilaTable.dostavaStatus,
       dostavaKurirId: narocilaTable.dostavaKurirId,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
    .where(and(eq(narocilaTable.id, id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));

  if (!narocilo) return null;

  const postavke = await fetchPostavke(id);
  const prenosi = await fetchPrenosi(id);

  const ddvNeskladje = izracunajDDVNeskladje(postavke);

  return {
    ...narocilo,
    stevilkaNarocila: narocilo.stevilkaNarocila == null ? null : String(narocilo.stevilkaNarocila),
    skupaj: Number(narocilo.skupaj),
    znesekNapitnina: Number(narocilo.znesekNapitnina ?? 0),
    mizaStevilka: narocilo.mizaStevilka ?? null,
    mizaIme: narocilo.mizaIme ?? null,
    prostorId: narocilo.prostorId ?? null,
    prostorIme: narocilo.prostorIme ?? null,
    opomba: narocilo.opomba ?? null,
    nacin: narocilo.nacin ?? "miza",
    vir: narocilo.vir ?? "osebje",
    strankaIme: narocilo.strankaIme ?? null,
    strankaTelefon: narocilo.strankaTelefon ?? null,
    shranjeniKupecId: narocilo.shranjeniKupecId ?? null,
    predvidenPrevzem: narocilo.predvidenPrevzem?.toISOString() ?? null,
    predvidenPrevzemRocen: narocilo.predvidenPrevzemRocen ?? false,
     nacinIzpolnitve: narocilo.nacinIzpolnitve ?? "prevzem",
     dostavaStatus: narocilo.dostavaStatus ?? null,
     dostavaKurirId: narocilo.dostavaKurirId ?? null,
     narocnikId: narocilo.narocnikId ?? null,
     dostavaUlica: narocilo.dostavaUlica ?? null,
     dostavaHisnaStevilka: narocilo.dostavaHisnaStevilka ?? null,
     dostavaVhod: narocilo.dostavaVhod ?? null,
     dostavaNadstropje: narocilo.dostavaNadstropje ?? null,
     dostavaNaseljeNaziv: narocilo.dostavaNaseljeNaziv ?? null,
     dostavaNaseljeId: narocilo.dostavaNaseljeId ?? null,
     dostavaNavodilo: narocilo.dostavaNavodilo ?? null,
      dostavaStoritevId: narocilo.dostavaStoritevId ?? null,
     dostavaCena: narocilo.dostavaCena == null ? null : Number(narocilo.dostavaCena),
     dostavaCasMin: narocilo.dostavaCasMin ?? null,
     predvidenaDostava: narocilo.predvidenaDostava?.toISOString() ?? null,
    posodobljeno: narocilo.posodobljeno ?? null,
    postavke,
    prenosi,
    ddvNeskladje: ddvNeskladje.imaNeskladje ? ddvNeskladje : null};
}

export async function updateSkupaj(narociloId: number, enotaId: number, executor: typeof db | DbTransaction = db) {
  const postavke = await executor.select({ skupaj: postavkeTable.skupaj })
    .from(postavkeTable)
    .innerJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
    .where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(narocilaTable.enotaId, enotaId),
    ));
  const skupaj = postavke.reduce((acc, p) => acc + Number(p.skupaj), 0);
  await executor.update(narocilaTable).set({ skupaj: String(skupaj.toFixed(2)) }).where(and(
    eq(narocilaTable.id, narociloId),
    eq(narocilaTable.enotaId, enotaId),
  ));
}

class DostavaNapaka extends Error {}

type DostavniArtikelRow = {
  id: number;
  ime: string;
  cena: string;
  davek: string;
  vrstaArtikla: string | null;
};

type RazresenaDostava = {
  narocnik: { id: number; ime: string; telefon: string };
  snapshot: ReturnType<typeof ustvariDostavniSnapshot>;
  artikel: DostavniArtikelRow;
};

function pozitivniId(value: unknown): number | null {
  const id = typeof value === "number" ? value : Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function zahtevanNiz(value: unknown, ime: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new DostavaNapaka(`${ime} je obvezen za dostavo.`);
  }
  return value.trim();
}

async function pridobiDostavnaStoritevId(enotaId: number): Promise<number | null> {
  const [nastavitev] = await db.select({ vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, enotaId), eq(nastavitveTable.kljuc, "dostavaArtikelId")));
  return pozitivniId(nastavitev?.vrednost);
}

async function pridobiDostavniArtikel(enotaId: number): Promise<DostavniArtikelRow> {
  const dostavaArtikelId = await pridobiDostavnaStoritevId(enotaId);
  if (!dostavaArtikelId) throw new DostavaNapaka("Nastavite dostavno storitev.");

  const [artikel] = await db.select({
    id: artikliTable.id,
    ime: artikliTable.ime,
    cena: artikliTable.cena,
    davek: artikliTable.davek,
    vrstaArtikla: artikliTable.vrstaArtikla,
  }).from(artikliTable).where(and(
    eq(artikliTable.id, dostavaArtikelId),
    eq(artikliTable.enotaId, enotaId),
    eq(artikliTable.aktiven, true),
    eq(artikliTable.vrstaArtikla, "storitev"),
  ));
  if (!artikel) throw new DostavaNapaka("Nastavite dostavno storitev.");
  return artikel;
}

function cenaDostaveZaNaselje(
  oddaljenostKm: unknown,
  cenaNaKm: number,
  cenaNaselja: unknown,
): number {
  const fiksnaCena = Number(cenaNaselja);
  if (!Number.isFinite(fiksnaCena) || fiksnaCena < 0) {
    throw new DostavaNapaka("Fiksna cena dostave za izbrano naselje ni veljavna.");
  }
  if (fiksnaCena > 0) return izracunajCenoDostave(cenaNaKm, 0, fiksnaCena);

  const kilometri = Number(oddaljenostKm);
  if (!Number.isFinite(kilometri) || kilometri < 0) {
    throw new DostavaNapaka("Za izbrano naselje nastavite oddaljenost v kilometrih.");
  }
  if (!Number.isFinite(cenaNaKm) || cenaNaKm < 0) {
    throw new DostavaNapaka("Cena dostavne storitve na kilometer ni veljavna.");
  }
  return izracunajCenoDostave(cenaNaKm, kilometri, fiksnaCena);
}

async function razresiNarocnikaZaTelefonskoNarocilo(
  executor: DbTransaction,
  enotaId: number,
  data: Record<string, unknown>,
): Promise<{ id: number; ime: string; telefon: string }> {
  const narocnikId = pozitivniId(data.narocnikId);
  if (narocnikId) {
    const [narocnik] = await executor.select({
      id: narocnikiTable.id,
      ime: narocnikiTable.ime,
      telefon: narocnikiTable.telefon,
    }).from(narocnikiTable).where(and(
      eq(narocnikiTable.id, narocnikId),
      eq(narocnikiTable.enotaId, enotaId),
    ));
    if (!narocnik) throw new DostavaNapaka("Naročnik ni najden v izbrani enoti.");
    return narocnik;
  }

  const telefon = zahtevanNiz(data.strankaTelefon, "Telefonska številka naročnika");
  let telefonNormaliziran: string;
  try {
    telefonNormaliziran = normalizirajTelefon(telefon);
  } catch {
    throw new DostavaNapaka("Telefonska številka naročnika ni veljavna.");
  }
  const [obstojeci] = await executor.select({
    id: narocnikiTable.id,
    ime: narocnikiTable.ime,
    telefon: narocnikiTable.telefon,
  }).from(narocnikiTable).where(and(
    eq(narocnikiTable.enotaId, enotaId),
    eq(narocnikiTable.telefonNormaliziran, telefonNormaliziran),
  ));
  if (obstojeci) return obstojeci;

  const [ustvarjen] = await executor.insert(narocnikiTable).values({
    enotaId,
    ime: zahtevanNiz(data.strankaIme, "Ime naročnika"),
    telefon,
    telefonNormaliziran,
  }).returning({
    id: narocnikiTable.id,
    ime: narocnikiTable.ime,
    telefon: narocnikiTable.telefon,
  });
  return ustvarjen;
}

async function razresiDostavniNaslov(
  executor: DbTransaction,
  enotaId: number,
  narocnikId: number,
  data: Record<string, unknown>,
  cenaNaKm: number,
) {
  const dostavaNaslovId = pozitivniId(data.dostavaNaslovId);
  if (dostavaNaslovId) {
    const [naslov] = await executor.select({
      ulica: narocnikNasloviTable.ulica,
      hisnaStevilka: narocnikNasloviTable.hisnaStevilka,
      vhod: narocnikNasloviTable.vhod,
      nadstropje: narocnikNasloviTable.nadstropje,
      navodilo: narocnikNasloviTable.navodilo,
      naseljeId: narocnikNasloviTable.naseljeId,
      naseljeNaziv: naseljaTable.naziv,
       oddaljenostKm: naseljaTable.oddaljenostKm,
       cenaDostave: naseljaTable.cenaDostave,
      casDostaveMin: naseljaTable.casDostaveMin,
    }).from(narocnikNasloviTable)
      .innerJoin(naseljaTable, eq(narocnikNasloviTable.naseljeId, naseljaTable.id))
      .where(and(
        eq(narocnikNasloviTable.id, dostavaNaslovId),
        eq(narocnikNasloviTable.narocnikId, narocnikId),
        eq(naseljaTable.enotaId, enotaId),
        eq(naseljaTable.aktivno, true),
      ));
    if (!naslov) throw new DostavaNapaka("Dostavni naslov ni najden ali njegovo naselje ni aktivno.");
    return ustvariDostavniSnapshot({
      ...naslov,
       cenaDostave: cenaDostaveZaNaselje(naslov.oddaljenostKm, cenaNaKm, naslov.cenaDostave),
    });
  }

  const rawNaslov = (data.dostavaNaslov && typeof data.dostavaNaslov === "object")
    ? data.dostavaNaslov as Record<string, unknown>
    : null;
  if (!rawNaslov) {
    throw new DostavaNapaka("Za dostavo izberite dostavni naslov ali vnesite novega.");
  }
  const naseljeId = pozitivniId(rawNaslov.naseljeId);
  if (!naseljeId) throw new DostavaNapaka("Naselje dostavnega naslova je obvezno.");
  const [naselje] = await executor.select({
    id: naseljaTable.id,
    naziv: naseljaTable.naziv,
     oddaljenostKm: naseljaTable.oddaljenostKm,
     cenaDostave: naseljaTable.cenaDostave,
    casDostaveMin: naseljaTable.casDostaveMin,
  }).from(naseljaTable).where(and(
    eq(naseljaTable.id, naseljeId),
    eq(naseljaTable.enotaId, enotaId),
    eq(naseljaTable.aktivno, true),
  ));
  if (!naselje) throw new DostavaNapaka("Naselje ni najdeno ali ni aktivno v izbrani enoti.");

  const vrednostiNaslova = {
    narocnikId,
    ulica: zahtevanNiz(rawNaslov.ulica, "Ulica"),
    hisnaStevilka: zahtevanNiz(rawNaslov.hisnaStevilka, "Hišna številka"),
    vhod: typeof rawNaslov.vhod === "string" ? rawNaslov.vhod.trim() || null : null,
    nadstropje: typeof rawNaslov.nadstropje === "string" ? rawNaslov.nadstropje.trim() || null : null,
    naseljeId,
    navodilo: typeof rawNaslov.navodilo === "string" ? rawNaslov.navodilo.trim() || null : null,
    privzet: rawNaslov.privzet === true,
  };
  if (vrednostiNaslova.privzet) {
    await executor.update(narocnikNasloviTable).set({ privzet: false })
      .where(eq(narocnikNasloviTable.narocnikId, narocnikId));
  }
  await executor.insert(narocnikNasloviTable).values(vrednostiNaslova);

  return ustvariDostavniSnapshot({
    ...vrednostiNaslova,
    naseljeNaziv: naselje.naziv,
     cenaDostave: cenaDostaveZaNaselje(naselje.oddaljenostKm, cenaNaKm, naselje.cenaDostave),
    casDostaveMin: naselje.casDostaveMin,
  });
}

async function razresiDostavo(
  executor: DbTransaction,
  enotaId: number,
  data: Record<string, unknown>,
  artikel: DostavniArtikelRow,
  obstojeciNarocnik?: { id: number; ime: string; telefon: string } | null,
): Promise<RazresenaDostava> {
  const narocnik = obstojeciNarocnik ?? await razresiNarocnikaZaTelefonskoNarocilo(executor, enotaId, data);
  const snapshot = await razresiDostavniNaslov(executor, enotaId, narocnik.id, data, Number(artikel.cena));
  return { narocnik, snapshot, artikel };
}

async function sinhronizirajDostavnoPostavko(
  narociloId: number,
  enotaId: number,
  artikel: DostavniArtikelRow,
  cenaDostave: number,
  jeDdvZavezanec: boolean,
  executor: typeof db | DbTransaction = db,
) {
  const postavka = ustvariDostavnoPostavko({
    id: artikel.id,
    ime: artikel.ime,
    davek: Number(artikel.davek),
    vrstaArtikla: artikel.vrstaArtikla,
  }, cenaDostave, jeDdvZavezanec);
  const obstojece = await executor.select({ id: postavkeTable.id })
    .from(postavkeTable)
    .where(and(
      eq(postavkeTable.narociloId, narociloId),
      eq(postavkeTable.artikelId, artikel.id),
      isNull(postavkeTable.parentPostavkaId),
      isNull(postavkeTable.racunId),
    ));

  const vrednosti = {
    ime: postavka.ime,
    kolicina: 1,
    cenaKos: String(postavka.cenaKos),
    cenaKosOriginalna: String(postavka.cenaKosOriginalna),
    skupaj: String(postavka.skupaj),
    davek: String(postavka.davek),
    toGo: false,
    vrstaArtikla: postavka.vrstaArtikla,
    opomba: null,
  };
  if (obstojece[0]) {
    await executor.update(postavkeTable).set(vrednosti).where(and(
      eq(postavkeTable.id, obstojece[0].id),
      eq(postavkeTable.narociloId, narociloId),
    ));
    if (obstojece.length > 1) {
      await executor.delete(postavkeTable).where(and(
        inArray(postavkeTable.id, obstojece.slice(1).map((p) => p.id)),
        eq(postavkeTable.narociloId, narociloId),
      ));
    }
  } else {
    await executor.insert(postavkeTable).values({
      narociloId,
      artikelId: postavka.artikelId,
      ...vrednosti,
    });
  }
  await updateSkupaj(narociloId, enotaId, executor);
}

async function odstraniDostavnoPostavko(narociloId: number, enotaId: number, artikelId: number, executor: DbTransaction) {
  await executor.delete(postavkeTable).where(and(
    eq(postavkeTable.narociloId, narociloId),
    eq(postavkeTable.artikelId, artikelId),
    isNull(postavkeTable.racunId),
  ));
  await updateSkupaj(narociloId, enotaId, executor);
}

async function preracunajDdvPoToGo(
  executor: DbTransaction,
  narociloId: number,
  enotaId: number,
  jeDdvZavezanec: boolean,
) {
  if (!jeDdvZavezanec) return;
  const [vatRules, nastavitve] = await Promise.all([
    loadVatRules(),
    getNastavitveMap(enotaId),
  ]);
  const starsePostavke = await executor
    .select({
      id: postavkeTable.id,
      artikelId: postavkeTable.artikelId,
      davek: postavkeTable.davek,
      appliedRuleId: postavkeTable.appliedRuleId,
      jeDelMenija: postavkeTable.jeDelMenija,
    })
    .from(postavkeTable)
    .where(and(
      eq(postavkeTable.narociloId, narociloId),
      isNull(postavkeTable.parentPostavkaId),
      isNull(postavkeTable.racunId),
      sql`${postavkeTable.artikelId} IS NOT NULL`,
    ));

  for (const postavka of starsePostavke) {
    if (!postavka.artikelId) continue;
    const [artikel] = await executor
      .select({
        davek: artikliTable.davek,
        taxCategory: artikliTable.taxCategory,
        addedSugar: artikliTable.addedSugar,
      })
      .from(artikliTable)
      .where(and(eq(artikliTable.id, postavka.artikelId), eq(artikliTable.enotaId, enotaId)));
    if (!artikel) continue;
    const resolved = resolveRate({
      supplyKind: resolveSupplyKind(false, false),
      taxCategory: ((artikel as Record<string, unknown>).taxCategory ?? "food") as TaxCategory,
      addedSugar: Boolean((artikel as Record<string, unknown>).addedSugar),
      jeDelMenija: Boolean(postavka.jeDelMenija),
      nastavitve,
      fallbackRate: Number(artikel.davek),
      jeDdvZavezanec,
    }, vatRules);
    const novDavek = String(resolved.rate);
    if (novDavek === String(postavka.davek) && resolved.ruleId === postavka.appliedRuleId) continue;
    await executor.update(postavkeTable)
      .set({ davek: novDavek, appliedRuleId: resolved.ruleId ?? undefined })
      .where(eq(postavkeTable.id, postavka.id));
    await executor.update(postavkeTable)
      .set({ davek: novDavek })
      .where(and(
        eq(postavkeTable.narociloId, narociloId),
        eq(postavkeTable.parentPostavkaId, postavka.id),
        isNull(postavkeTable.racunId),
      ));
  }
}

export async function osveziPredvidenPrevzem(narociloId: number, tenotaId: number, referencniCas = new Date()) {
  const [narocilo] = await db
    .select({
      nacin: narocilaTable.nacin,
      nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
      predvidenPrevzemRocen: narocilaTable.predvidenPrevzemRocen,
      predvidenPrevzem: narocilaTable.predvidenPrevzem,
      dostavaCasMin: narocilaTable.dostavaCasMin,
    })
    .from(narocilaTable)
    .where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, tenotaId)));
  if (!narocilo || (
    narocilo.nacin !== "telefon"
    && narocilo.nacin !== "miza"
  )) return;

  let predvidenPrevzem = narocilo.predvidenPrevzem;
  if (!narocilo.predvidenPrevzemRocen) {
    const [ciljnePostavke, cakalnePostavke, nastavitveRows] = await Promise.all([
      db.select({
        artikelId: postavkeTable.artikelId,
        casPripraveMin: artikliTable.casPripraveMin,
        kolicina: postavkeTable.kolicina,
        kategorijaTip: kategorijeTable.tip,
        pripravljeno: postavkeTable.pripravljeno,
      })
        .from(postavkeTable)
        .leftJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
        .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
        .where(and(
          eq(postavkeTable.narociloId, narociloId),
          isNull(postavkeTable.parentPostavkaId),
        )),
      db.select({
        artikelId: postavkeTable.artikelId,
        casPripraveMin: artikliTable.casPripraveMin,
        kolicina: postavkeTable.kolicina,
        kategorijaTip: kategorijeTable.tip,
      })
        .from(postavkeTable)
        .innerJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
        .leftJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
        .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
        .where(and(
          eq(narocilaTable.enotaId, tenotaId),
          eq(narocilaTable.status, "odprto"),
          isNull(postavkeTable.pripravljeno),
          ne(narocilaTable.id, narociloId),
          isNull(postavkeTable.parentPostavkaId),
        )),
      db.select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
        .from(nastavitveTable)
        .where(eq(nastavitveTable.enotaId, tenotaId)),
    ]);
    const nastavitveMap: Record<string, string> = {};
    const etaArticles = await db.select({ id: artikliTable.id, mealType: artikliTable.mealType, casPripraveMin: artikliTable.casPripraveMin })
      .from(artikliTable).where(eq(artikliTable.enotaId, tenotaId));
    const etaNorms = await db.select({ artikelId: normativiTable.artikelId, vhodniArtikelId: normativiTable.vhodniArtikelId })
      .from(normativiTable).innerJoin(artikliTable, eq(artikliTable.id, normativiTable.artikelId))
      .where(eq(artikliTable.enotaId, tenotaId));
    const compositeEtas = resolveCompositeEtas(etaArticles, etaNorms);
    for (const line of [...ciljnePostavke, ...cakalnePostavke]) {
      if (line.artikelId != null) line.casPripraveMin = compositeEtas.get(line.artikelId) ?? line.casPripraveMin;
    }
    for (const row of nastavitveRows) nastavitveMap[row.kljuc] = row.vrednost;
    const dostavaArtikelId = pozitivniId(nastavitveMap["dostavaArtikelId"]);
    // Storitev dostave ne predstavlja priprave hrane in zato ne podaljšuje kuhinjske ocene.
    const brezDostavnePostavke = <T extends { artikelId: number | null }>(rows: T[]) =>
      dostavaArtikelId ? rows.filter((row) => row.artikelId !== dostavaArtikelId) : rows;
    const ciljneBrezDostave = brezDostavnePostavke(ciljnePostavke)
      .filter((postavka) => postavka.pripravljeno == null);
    const jeSamoPijaca = jeNarociloSamoPijaca(ciljneBrezDostave);
    predvidenPrevzem = izracunajPredvidenPrevzem(
      ciljneBrezDostave,
      jeSamoPijaca ? samoPijace(cakalnePostavke) : brezDostavnePostavke(cakalnePostavke),
      jeSamoPijaca ? pickupBeverageEstimateSettingsFromMap(nastavitveMap) : pickupEstimateSettingsFromMap(nastavitveMap),
      referencniCas,
    );
    await db.update(narocilaTable)
      .set({ predvidenPrevzem })
      .where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, tenotaId)));
  }

  const predvidenaDostava = narocilo.nacinIzpolnitve === "dostava"
    ? izracunajPredvidenoDostavo(predvidenPrevzem, narocilo.dostavaCasMin)
    : null;
  await db.update(narocilaTable)
    .set({ predvidenaDostava })
    .where(and(eq(narocilaTable.id, narociloId), eq(narocilaTable.enotaId, tenotaId)));
}

/**
 * Popravi stare, še nezaračunane telefonske postavke, ki so bile ustvarjene
 * pred obveznim To Go pravilom. Nastavljena dostavna storitev je izjema.
 */
async function uskladiToGoTelefonskegaNarocila(
  executor: DbTransaction,
  narociloId: number,
  enotaId: number,
  nacinIzpolnitve: string | null,
  dostavnaStoritevId: number | null,
) {
  // Za staro dostavo brez enoznačno posnete storitve ničesar ne spreminjamo:
  // s tem ne moremo napačno označiti njene dostavne postavke kot To Go.
  if (nacinIzpolnitve === "dostava" && dostavnaStoritevId == null) return;
  const pogoji = [
    eq(postavkeTable.narociloId, narociloId),
    isNull(postavkeTable.racunId),
  ];
  if (dostavnaStoritevId) {
    pogoji.push(or(isNull(postavkeTable.artikelId), ne(postavkeTable.artikelId, dostavnaStoritevId))!);
  }
  await executor.update(postavkeTable)
    .set({ toGo: true })
    .where(and(...pogoji));
}

router.get("/dostava/predogled", async (req, res): Promise<void> => {
  const enotaId = (req as any).enotaId as number;
  const naseljeId = pozitivniId(req.query.naseljeId);
  if (!naseljeId) {
    res.status(400).json({ error: "Izberite veljavno naselje." });
    return;
  }
  try {
    const [storitev, naselje] = await Promise.all([
      pridobiDostavniArtikel(enotaId),
      db.select({
        naziv: naseljaTable.naziv,
        oddaljenostKm: naseljaTable.oddaljenostKm,
       cenaDostave: naseljaTable.cenaDostave,
        casDostaveMin: naseljaTable.casDostaveMin,
      }).from(naseljaTable).where(and(
        eq(naseljaTable.id, naseljeId),
        eq(naseljaTable.enotaId, enotaId),
        eq(naseljaTable.aktivno, true),
      )),
    ]);
    const izbranoNaselje = naselje[0];
    if (!izbranoNaselje) {
      res.status(404).json({ error: "Naselje ni najdeno ali ni aktivno v izbrani enoti." });
      return;
    }
    const cenaNaKm = Number(storitev.cena);
    const oddaljenostKm = Number(izbranoNaselje.oddaljenostKm);
    const cenaNaselja = Number(izbranoNaselje.cenaDostave);
    res.json({
      storitevIme: storitev.ime,
      cenaNaKm,
      oddaljenostKm,
      cenaNaselja,
      cenaDostave: cenaDostaveZaNaselje(oddaljenostKm, cenaNaKm, cenaNaselja),
      casDostaveMin: izbranoNaselje.casDostaveMin,
    });
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Predogleda dostave ni mogoče izračunati." });
  }
});

router.get("/narocila/aktivna", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rows = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      prostorId: mizeTable.prostorId,
      prostorIme: prostoriTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      znesekNapitnina: narocilaTable.znesekNapitnina,
      opomba: narocilaTable.opomba,
      toGo: narocilaTable.toGo,
      nacin: narocilaTable.nacin,
       vir: narocilaTable.vir,
      strankaIme: narocilaTable.strankaIme,
      strankaTelefon: narocilaTable.strankaTelefon,
      shranjeniKupecId: narocilaTable.shranjeniKupecId,
      predvidenPrevzem: narocilaTable.predvidenPrevzem,
      predvidenPrevzemRocen: narocilaTable.predvidenPrevzemRocen,
       nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
       narocnikId: narocilaTable.narocnikId,
       dostavaUlica: narocilaTable.dostavaUlica,
       dostavaHisnaStevilka: narocilaTable.dostavaHisnaStevilka,
       dostavaVhod: narocilaTable.dostavaVhod,
       dostavaNadstropje: narocilaTable.dostavaNadstropje,
       dostavaNaseljeNaziv: narocilaTable.dostavaNaseljeNaziv,
       dostavaNaseljeId: narocilaTable.dostavaNaseljeId,
       dostavaNavodilo: narocilaTable.dostavaNavodilo,
       dostavaCena: narocilaTable.dostavaCena,
       dostavaCasMin: narocilaTable.dostavaCasMin,
       predvidenaDostava: narocilaTable.predvidenaDostava,
       dostavaStatus: narocilaTable.dostavaStatus,
       dostavaKurirId: narocilaTable.dostavaKurirId,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
    .where(and(
      eq(narocilaTable.status, "odprto"),
      or(
        isNull(narocilaTable.dostavaStatus),
        and(
          ne(narocilaTable.dostavaStatus, "preklicano"),
          ne(narocilaTable.dostavaStatus, "dostavljeno"),
        ),
      ),
      sql`true`,
      eq(narocilaTable.enotaId, tenotaId),
    ))
    .orderBy(narocilaTable.ustvarjeno);

  const result = await Promise.all(
    rows.map(async (n) => {
      const postavke = await fetchPostavke(n.id);
      const ddvNeskladje = izracunajDDVNeskladje(postavke);
      return {
        ...n,
        skupaj: Number(n.skupaj),
        znesekNapitnina: Number(n.znesekNapitnina ?? 0),
        mizaStevilka: n.mizaStevilka ?? null,
        mizaIme: n.mizaIme ?? null,
        prostorId: n.prostorId ?? null,
        prostorIme: n.prostorIme ?? null,
        opomba: n.opomba ?? null,
        nacin: n.nacin ?? "miza",
         vir: n.vir ?? "osebje",
        strankaIme: n.strankaIme ?? null,
        strankaTelefon: n.strankaTelefon ?? null,
        shranjeniKupecId: n.shranjeniKupecId ?? null,
        predvidenPrevzem: n.predvidenPrevzem?.toISOString() ?? null,
        predvidenPrevzemRocen: n.predvidenPrevzemRocen ?? false,
         nacinIzpolnitve: n.nacinIzpolnitve ?? "prevzem",
         narocnikId: n.narocnikId ?? null,
         dostavaUlica: n.dostavaUlica ?? null,
         dostavaHisnaStevilka: n.dostavaHisnaStevilka ?? null,
         dostavaVhod: n.dostavaVhod ?? null,
         dostavaNadstropje: n.dostavaNadstropje ?? null,
         dostavaNaseljeNaziv: n.dostavaNaseljeNaziv ?? null,
         dostavaNaseljeId: n.dostavaNaseljeId ?? null,
         dostavaNavodilo: n.dostavaNavodilo ?? null,
         dostavaCena: n.dostavaCena == null ? null : Number(n.dostavaCena),
         dostavaCasMin: n.dostavaCasMin ?? null,
         predvidenaDostava: n.predvidenaDostava?.toISOString() ?? null,
         dostavaStatus: n.dostavaStatus ?? null,
         dostavaKurirId: n.dostavaKurirId ?? null,
        posodobljeno: n.posodobljeno ?? null,
        postavke,
        ddvNeskladje: ddvNeskladje.imaNeskladje ? ddvNeskladje : null};
    })
  );

  res.json(result);
});

router.get("/narocila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  const conditions: ReturnType<typeof eq>[] = [sql`true`, eq(narocilaTable.enotaId, tenotaId)];
  if (query.data.status != null) conditions.push(eq(narocilaTable.status, query.data.status as "odprto" | "zakljuceno" | "preklicano"));
  if (query.data.mizaId != null) conditions.push(eq(narocilaTable.mizaId, Number(query.data.mizaId)));

  const rows = await db
    .select({
      id: narocilaTable.id,
      stevilkaNarocila: narocilaTable.stevilkaNarocila,
      mizaId: narocilaTable.mizaId,
      mizaStevilka: mizeTable.stevilka,
      mizaIme: mizeTable.ime,
      prostorId: mizeTable.prostorId,
      prostorIme: prostoriTable.ime,
      status: narocilaTable.status,
      skupaj: narocilaTable.skupaj,
      opomba: narocilaTable.opomba,
      toGo: narocilaTable.toGo,
      nacin: narocilaTable.nacin,
       vir: narocilaTable.vir,
      strankaIme: narocilaTable.strankaIme,
      strankaTelefon: narocilaTable.strankaTelefon,
      shranjeniKupecId: narocilaTable.shranjeniKupecId,
      predvidenPrevzem: narocilaTable.predvidenPrevzem,
      predvidenPrevzemRocen: narocilaTable.predvidenPrevzemRocen,
       nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
       narocnikId: narocilaTable.narocnikId,
       dostavaUlica: narocilaTable.dostavaUlica,
       dostavaHisnaStevilka: narocilaTable.dostavaHisnaStevilka,
       dostavaVhod: narocilaTable.dostavaVhod,
       dostavaNadstropje: narocilaTable.dostavaNadstropje,
       dostavaNaseljeNaziv: narocilaTable.dostavaNaseljeNaziv,
       dostavaNaseljeId: narocilaTable.dostavaNaseljeId,
       dostavaNavodilo: narocilaTable.dostavaNavodilo,
       dostavaCena: narocilaTable.dostavaCena,
       dostavaCasMin: narocilaTable.dostavaCasMin,
       predvidenaDostava: narocilaTable.predvidenaDostava,
       dostavaStatus: narocilaTable.dostavaStatus,
       dostavaKurirId: narocilaTable.dostavaKurirId,
      ustvarjeno: narocilaTable.ustvarjeno,
      posodobljeno: narocilaTable.posodobljeno})
    .from(narocilaTable)
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
    .where(and(...conditions))
    .orderBy(narocilaTable.ustvarjeno);

  const result = await Promise.all(
    rows.map(async (n) => {
      return {
        ...n,
        skupaj: Number(n.skupaj),
        mizaStevilka: n.mizaStevilka ?? null,
        mizaIme: n.mizaIme ?? null,
        prostorId: n.prostorId ?? null,
        prostorIme: n.prostorIme ?? null,
        opomba: n.opomba ?? null,
        nacin: n.nacin ?? "miza",
         vir: n.vir ?? "osebje",
        strankaIme: n.strankaIme ?? null,
        strankaTelefon: n.strankaTelefon ?? null,
        shranjeniKupecId: n.shranjeniKupecId ?? null,
        predvidenPrevzem: n.predvidenPrevzem?.toISOString() ?? null,
        predvidenPrevzemRocen: n.predvidenPrevzemRocen ?? false,
         nacinIzpolnitve: n.nacinIzpolnitve ?? "prevzem",
         narocnikId: n.narocnikId ?? null,
         dostavaUlica: n.dostavaUlica ?? null,
         dostavaHisnaStevilka: n.dostavaHisnaStevilka ?? null,
         dostavaVhod: n.dostavaVhod ?? null,
         dostavaNadstropje: n.dostavaNadstropje ?? null,
         dostavaNaseljeNaziv: n.dostavaNaseljeNaziv ?? null,
         dostavaNaseljeId: n.dostavaNaseljeId ?? null,
         dostavaNavodilo: n.dostavaNavodilo ?? null,
         dostavaCena: n.dostavaCena == null ? null : Number(n.dostavaCena),
         dostavaCasMin: n.dostavaCasMin ?? null,
         predvidenaDostava: n.predvidenaDostava?.toISOString() ?? null,
         dostavaStatus: n.dostavaStatus ?? null,
         dostavaKurirId: n.dostavaKurirId ?? null,
        posodobljeno: n.posodobljeno ?? null,
        postavke: await fetchPostavke(n.id)};
    })
  );

  res.json(result);
});

router.post("/narocila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  const nacin = (parsed.data as { nacin?: string }).nacin ?? "miza";
  if (nacin !== "miza" && nacin !== "telefon") {
    res.status(400).json({ error: "Način naročila mora biti miza ali telefon" }); return;
  }
  if (nacin === "telefon" && parsed.data.mizaId != null) {
    res.status(400).json({ error: "Telefonsko naročilo ne more biti vezano na mizo" }); return;
  }
  const nacinIzpolnitve = (parsed.data as { nacinIzpolnitve?: string }).nacinIzpolnitve ?? "prevzem";
  if (nacinIzpolnitve !== "prevzem" && nacinIzpolnitve !== "dostava") {
    res.status(400).json({ error: "Način izpolnitve mora biti prevzem ali dostava." }); return;
  }
  if (nacinIzpolnitve === "dostava" && nacin !== "telefon") {
    res.status(400).json({ error: "Dostava je na voljo samo za telefonsko naročilo." }); return;
  }

  const currentYear = new Date().getFullYear();
  const [nabavniArtikel] = await db.select({ id: artikliTable.id })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), eq(artikliTable.nabavniArtikel, true)));
  if (nabavniArtikel) {
    const [zz] = await db.select({ id: zacetneZalogeTable.id })
      .from(zacetneZalogeTable)
      .where(and(eq(zacetneZalogeTable.leto, currentYear), sql`true`, eq(zacetneZalogeTable.enotaId, tenotaId)));
    if (!zz) {
      res.status(400).json({
        error: `Pred prvim naročilom v letu ${currentYear} morate najprej vnesti začetne zaloge.`,
        code: "MISSING_ZACETNE_ZALOGE",
        leto: currentYear});
      return;
    }
  }

  if (parsed.data.mizaId != null) {
    const [miza] = await db.select({ id: mizeTable.id })
      .from(mizeTable)
      .where(and(eq(mizeTable.id, parsed.data.mizaId), sql`true`, eq(mizeTable.enotaId, tenotaId)));
    if (!miza) { res.status(404).json({ error: "Miza ni najdena" }); return; }
  }
  const reservationId = pozitivniId((parsed.data as { rezervacijaId?: unknown }).rezervacijaId);
  if ((parsed.data as { rezervacijaId?: unknown }).rezervacijaId != null && !reservationId) {
    res.status(400).json({ error: "ID rezervacije ni veljaven." }); return;
  }

  const shranjeniKupecId = (parsed.data as { shranjeniKupecId?: number | null }).shranjeniKupecId ?? null;
  let shranjeniKupec: { naziv: string; telefon: string | null } | undefined;
  if (shranjeniKupecId != null) {
    [shranjeniKupec] = await db.select({
      naziv: shranjeniKupciTable.naziv,
      telefon: shranjeniKupciTable.telefon,
    })
      .from(shranjeniKupciTable)
      .where(and(eq(shranjeniKupciTable.id, shranjeniKupecId), eq(shranjeniKupciTable.enotaId, tenotaId)));
    if (!shranjeniKupec) { res.status(404).json({ error: "Shranjeni kupec ni najden" }); return; }
  }

  const predvidenPrevzemRaw = (parsed.data as { predvidenPrevzem?: string | null }).predvidenPrevzem;
  const predvidenPrevzem = predvidenPrevzemRaw ? new Date(predvidenPrevzemRaw) : null;
  if (predvidenPrevzemRaw && Number.isNaN(predvidenPrevzem!.getTime())) {
    res.status(400).json({ error: "Predviden čas prevzema ni veljaven" }); return;
  }
  const predvidenPrevzemRocen = nacin === "telefon" && (
    (parsed.data as { predvidenPrevzemRocen?: boolean }).predvidenPrevzemRocen === true || predvidenPrevzem != null
  );

  const companyId = (req as any).companyId as string;
  const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;
  let dostavniArtikel: DostavniArtikelRow | null = null;
  if (nacinIzpolnitve === "dostava") {
    try {
      // Preveri konfiguracijo pred ustvarjanjem novega naročnika. Če dostava
      // ni nastavljena, poskus ne sme pustiti naročnika brez naročila.
      dostavniArtikel = await pridobiDostavniArtikel(tenotaId);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Dostava ni pravilno nastavljena." });
      return;
    }
  }
  let narocnikZaNarocilo: { id: number; ime: string; telefon: string } | null = null;
  let dostava: RazresenaDostava | null = null;

  let row: typeof narocilaTable.$inferSelect;
  let simDatumNarocilo!: Date;
  let currentBusinessDate!: string;
  try {
  row = await db.transaction(async (tx) => {
    await lockPosBusinessDay(tx, tenotaId);
    simDatumNarocilo = await getSimDatumOrNow(tenotaId);
    currentBusinessDate = await businessDateForTimestamp(simDatumNarocilo, tenotaId, tx);
    if (await isPosBusinessDayClosed(tx, tenotaId, currentBusinessDate)) {
      throw new Error("TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN");
    }
    const previousDayGate = await checkPreviousBusinessDayClosed(tx, tenotaId, currentBusinessDate);
    if (!previousDayGate.allowed) {
      throw Object.assign(new Error("PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN"), {
        previousBusinessDate: previousDayGate.previousBusinessDate,
        missingRegisters: previousDayGate.missingRegisters,
      });
    }
    if (nacin === "telefon") {
      narocnikZaNarocilo = await razresiNarocnikaZaTelefonskoNarocilo(
        tx,
        tenotaId,
        parsed.data as Record<string, unknown>,
      );
    }
    if (nacinIzpolnitve === "dostava") {
      dostava = await razresiDostavo(
        tx,
        tenotaId,
        parsed.data as Record<string, unknown>,
        dostavniArtikel!,
        narocnikZaNarocilo,
      );
    }
    let rezervacijaNarocnikId: number | null = null;
    let porabljenaRezervacijaId: number | null = null;
    if (parsed.data.mizaId != null) {
      if (!await zakleniMizo(tx, parsed.data.mizaId, tenotaId)) throw new Error("MIZA_NE_OBSTAJA");
      if (reservationId) {
        const [rezervacija] = await tx.select({
          id: rezervacijeMizTable.id, narocnikId: rezervacijeMizTable.narocnikId,
        }).from(rezervacijeMizTable).where(and(
          eq(rezervacijeMizTable.id, reservationId),
          eq(rezervacijeMizTable.enotaId, tenotaId),
          eq(rezervacijeMizTable.mizaId, parsed.data.mizaId),
          eq(rezervacijeMizTable.status, "aktivna"),
          sql`${rezervacijeMizTable.zacetek} <= ${new Date(Date.now() + 60 * 60 * 1000)}
              AND ${rezervacijeMizTable.zacetek} > ${new Date(Date.now() - 3 * 60 * 60 * 1000)}`,
        )).for("update");
        if (!rezervacija) throw new Error("REZERVACIJA_NI_NA_VOLJO");
        const [odprtoNarocilo] = await tx.select({ id: narocilaTable.id })
          .from(narocilaTable)
          .where(and(
            eq(narocilaTable.enotaId, tenotaId),
            eq(narocilaTable.mizaId, parsed.data.mizaId),
            eq(narocilaTable.status, "odprto"),
          ))
          .limit(1)
          .for("update");
        if (odprtoNarocilo) throw new Error("REZERVACIJA_MIZA_SE_ZASEDENA");
        porabljenaRezervacijaId = rezervacija.id;
        rezervacijaNarocnikId = rezervacija.narocnikId;
      } else {
        const [blokada] = await tx.select({ id: rezervacijeMizTable.id })
          .from(rezervacijeMizTable).where(reservationBlockingClause(parsed.data.mizaId)).limit(1);
        if (blokada) throw new Error("REZERVACIJA_BLOKIRA_NAROCILO");
      }
    }

    const [created] = await tx.insert(narocilaTable).values({
      enotaId: tenotaId,
      mizaId: parsed.data.mizaId ?? null,
      rezervacijaId: porabljenaRezervacijaId,
      opomba: parsed.data.opomba ?? null,
      status: "odprto",
      skupaj: "0",
      toGo: (parsed.data as { toGo?: boolean }).toGo ?? nacin === "telefon",
      nacin,
      strankaIme: (parsed.data as { strankaIme?: string | null }).strankaIme ?? shranjeniKupec?.naziv ?? dostava?.narocnik.ime ?? null,
      strankaTelefon: (parsed.data as { strankaTelefon?: string | null }).strankaTelefon ?? shranjeniKupec?.telefon ?? dostava?.narocnik.telefon ?? null,
      shranjeniKupecId,
      predvidenPrevzem,
      predvidenPrevzemRocen,
      nacinIzpolnitve,
      narocnikId: narocnikZaNarocilo?.id ?? dostava?.narocnik.id ?? rezervacijaNarocnikId,
      dostavaUlica: dostava?.snapshot.dostavaUlica ?? null,
      dostavaHisnaStevilka: dostava?.snapshot.dostavaHisnaStevilka ?? null,
      dostavaVhod: dostava?.snapshot.dostavaVhod ?? null,
      dostavaNadstropje: dostava?.snapshot.dostavaNadstropje ?? null,
      dostavaNaseljeNaziv: dostava?.snapshot.dostavaNaseljeNaziv ?? null,
      dostavaNaseljeId: dostava?.snapshot.dostavaNaseljeId ?? null,
      dostavaNavodilo: dostava?.snapshot.dostavaNavodilo ?? null,
      dostavaStoritevId: dostava?.artikel.id ?? null,
      dostavaCena: dostava ? String(dostava.snapshot.dostavaCena) : null,
      dostavaCasMin: dostava?.snapshot.dostavaCasMin ?? null,
       dostavaStatus: nacinIzpolnitve === "dostava" ? "prejeto" : null,
      ustvarjeno: simDatumNarocilo,
    }).returning();

    if (nacinIzpolnitve === "dostava") {
      await tx.insert(dostavaStatusZgodovinaTable).values({
        narociloId: created.id,
        enotaId: tenotaId,
        status: "prejeto",
        idempotencyKey: `initial:${created.id}`,
      });
    }

    // Številka naročila in zasedba mize morata uspeti skupaj z vstavitvijo.
    await tx.execute(sql`
      UPDATE narocila
      SET stevilka_narocila = (
        SELECT COALESCE(MAX(n2.stevilka_narocila), 0) + 1
        FROM narocila n2
        JOIN enote e ON e.id = n2.enota_id
        WHERE e.company_id = ${companyId}
          AND n2.id != ${created.id}
      )
      WHERE id = ${created.id}
    `);

    if (porabljenaRezervacijaId != null) {
      await tx.update(rezervacijeMizTable).set({
        status: "porabljena", porabljena: simDatumNarocilo, narociloId: created.id,
      }).where(and(eq(rezervacijeMizTable.id, porabljenaRezervacijaId), eq(rezervacijeMizTable.status, "aktivna")));
    }
    if (parsed.data.mizaId != null) {
      await tx.update(mizeTable).set({
        status: "zasedena",
        rezervacijaNarocnikId: null,
        rezervacijaStrankaIme: null,
        rezervacijaTelefon: null,
        rezervacijaOpomba: null,
        rezervacijaVeljaDo: null,
      }).where(and(
        eq(mizeTable.id, parsed.data.mizaId),
        eq(mizeTable.enotaId, tenotaId),
      ));
    }
    if (created.narocnikId != null) {
      await tx.update(narocnikiTable).set({
        steviloNarocil: sql`${narocnikiTable.steviloNarocil} + 1`,
        zadnjeNarocilo: simDatumNarocilo,
      }).where(and(
        eq(narocnikiTable.id, created.narocnikId),
        eq(narocnikiTable.enotaId, tenotaId),
      ));
    }

    return created;
  });
  } catch (error) {
    if (error instanceof DostavaNapaka) {
      res.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof Error && error.message === "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN") {
      res.status(409).json({
        error: `Poslovni dan ${slovenskiDatumZaSporocilo(currentBusinessDate)} je že zaključen z Z-poročilom. Za ta dan novega naročila ni več mogoče odpreti.`,
        code: error.message,
        businessDate: currentBusinessDate,
      });
      return;
    }
    if (error instanceof Error && error.message === "PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN") {
      const details = error as Error & {
        previousBusinessDate?: string;
        missingRegisters?: Array<{ id: number; name: string }>;
      };
      const names = details.missingRegisters?.map((register) => register.name).join(", ");
      res.status(409).json({
        error: `Pred novim naročilom zaključite prejšnji poslovni dan (${details.previousBusinessDate ? slovenskiDatumZaSporocilo(details.previousBusinessDate) : "neznan datum"}) z Z-poročilom${names ? ` za blagajno: ${names}` : ""}.`,
        code: error.message,
        previousBusinessDate: details.previousBusinessDate ?? null,
        missingRegisters: details.missingRegisters ?? [],
      });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_NAROCILO") {
      req.log.warn({ mizaId: parsed.data.mizaId }, "Order blocked by imminent reservation");
      res.status(409).json({ error: "Novo naročilo je blokirano zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_NI_NA_VOLJO") {
      res.status(409).json({ error: "Izbrana rezervacija ni več aktivna za to mizo.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_MIZA_SE_ZASEDENA") {
      res.status(409).json({
        error: "Na mizi je še odprto naročilo. Najprej ga zaključite ali prestavite na drugo mizo.",
        code: error.message,
      });
      return;
    }
    throw error;
  }

  const ustvarjenaDostava = dostava as RazresenaDostava | null;
  if (ustvarjenaDostava) {
    await sinhronizirajDostavnoPostavko(
      row.id,
      tenotaId,
      ustvarjenaDostava.artikel,
      ustvarjenaDostava.snapshot.dostavaCena,
      jeDdvZavezanec,
    );
  }
  // Pri navadnem walk-in naročilu še ni postavk, zato izračun prevzema nima
  // uporabne informacije, zahteva pa več dodatnih poizvedb. Čas se bo
  // izračunal ob dodajanju prve postavke. Telefonska naročila in dostave
  // ohranijo dosedanji izračun, ker lahko že ob odprtju potrebujejo ETA.
  if (row.nacin === "telefon" || ustvarjenaDostava) {
    await osveziPredvidenPrevzem(row.id, tenotaId, simDatumNarocilo);
  }
  const narocilo = await getNarociloById(row.id, "", tenotaId);
  broadcastToUnit(tenotaId, "update", { type: "narocilo" });
  // Pri praznem naročilu ni KDS postavk. Pri dostavi lahko sinhronizacija
  // zgoraj ustvari dostavno postavko, zato tam ohranimo materializacijo.
  if (ustvarjenaDostava) {
    await materializirajKdsNaloge(row.id, tenotaId);
  }
  res.status(201).json(narocilo);
});

router.get("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const posodobljenih = await db.transaction(async (tx) => {
    await lockKdsOrder(tx, params.data.id);
    const [predaja] = await tx.select({ id: kdsIzdajaDogodkiTable.id })
      .from(kdsIzdajaDogodkiTable)
      .where(and(
        eq(kdsIzdajaDogodkiTable.narociloId, params.data.id),
        eq(kdsIzdajaDogodkiTable.enotaId, tenotaId),
      ));
    const [osnova] = await tx.select({
      status: narocilaTable.status,
      nacin: narocilaTable.nacin,
      nacinIzpolnitve: narocilaTable.nacinIzpolnitve,
      dostavaStoritevId: narocilaTable.dostavaStoritevId,
    })
      .from(narocilaTable)
      .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)));
    if (!osnova || predaja) return 0;
    if (osnova.nacin === "telefon") {
      await uskladiToGoTelefonskegaNarocila(
        tx,
        params.data.id,
        tenotaId,
        osnova.nacinIzpolnitve,
        osnova.dostavaStoritevId,
      );
    }
    return osnova.status === "odprto"
      ? uskladiLegacyToGoDdv(
        tx,
        params.data.id,
        tenotaId,
        (req as any).jeDdvZavezanec ?? true,
      )
      : 0;
  });
  if (posodobljenih > 0) {
    req.log?.info(
      { narociloId: params.data.id, posodobljenih },
      "Legacy To Go VAT lines reconciled",
    );
  }
  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  res.json(narocilo);
});

router.put("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [obstojeceNarocilo] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, params.data.id), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!obstojeceNarocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const updateData: Partial<typeof narocilaTable.$inferInsert> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status as "odprto" | "zakljuceno" | "preklicano";
  if (parsed.data.opomba !== undefined) updateData.opomba = parsed.data.opomba;
  const newToGo = (parsed.data as { toGo?: boolean }).toGo;
  const toGoSpremeni = newToGo !== undefined && newToGo !== obstojeceNarocilo.toGo;
  if (newToGo !== undefined) updateData.toGo = newToGo;

  const requestedNacin = (parsed.data as { nacin?: string }).nacin;
  if (requestedNacin !== undefined && requestedNacin !== "miza" && requestedNacin !== "telefon") {
    res.status(400).json({ error: "Način naročila mora biti miza ali telefon" }); return;
  }
  const naslednjiNacin = requestedNacin ?? obstojeceNarocilo.nacin;
  if (requestedNacin !== undefined) updateData.nacin = requestedNacin;
  const requestedNacinIzpolnitve = (parsed.data as { nacinIzpolnitve?: string }).nacinIzpolnitve;
  if (requestedNacinIzpolnitve !== undefined && requestedNacinIzpolnitve !== "prevzem" && requestedNacinIzpolnitve !== "dostava") {
    res.status(400).json({ error: "Način izpolnitve mora biti prevzem ali dostava." }); return;
  }
  const naslednjiNacinIzpolnitve = requestedNacinIzpolnitve ?? obstojeceNarocilo.nacinIzpolnitve ?? "prevzem";
  if (naslednjiNacinIzpolnitve === "dostava" && naslednjiNacin !== "telefon") {
    res.status(400).json({ error: "Dostava je na voljo samo za telefonsko naročilo." }); return;
  }
  if (requestedNacinIzpolnitve !== undefined) updateData.nacinIzpolnitve = requestedNacinIzpolnitve;

  const requestedMizaId = (parsed.data as { mizaId?: number | null }).mizaId;
  if (naslednjiNacin === "telefon" && requestedMizaId != null) {
    res.status(400).json({ error: "Telefonsko naročilo ne more biti vezano na mizo" }); return;
  }
  const novaMizaId = naslednjiNacin === "telefon"
    ? null
    : requestedMizaId;
  const menjavaMize = novaMizaId !== undefined && novaMizaId !== obstojeceNarocilo.mizaId;

  if (menjavaMize) {
    if (novaMizaId != null) {
      const [novaMiza] = await db.select({ id: mizeTable.id })
        .from(mizeTable)
        .where(and(eq(mizeTable.id, novaMizaId), sql`true`, eq(mizeTable.enotaId, tenotaId)));
      if (!novaMiza) { res.status(404).json({ error: "Nova miza ni najdena" }); return; }
      if (await jeMizaBlokiranaZaNarocilo(novaMizaId)) {
        res.status(409).json({ error: "Prenos na mizo je blokiran zaradi bližajoče se rezervacije.", code: "REZERVACIJA_BLOKIRA_NAROCILO" });
        return;
      }
    }
    updateData.mizaId = novaMizaId ?? null;
  }

  if ("strankaIme" in parsed.data) updateData.strankaIme = (parsed.data as { strankaIme?: string | null }).strankaIme ?? null;
  if ("strankaTelefon" in parsed.data) updateData.strankaTelefon = (parsed.data as { strankaTelefon?: string | null }).strankaTelefon ?? null;
  if ("shranjeniKupecId" in parsed.data) {
    const shranjeniKupecId = (parsed.data as { shranjeniKupecId?: number | null }).shranjeniKupecId ?? null;
    if (shranjeniKupecId != null) {
      const [kupec] = await db.select({ id: shranjeniKupciTable.id })
        .from(shranjeniKupciTable)
        .where(and(eq(shranjeniKupciTable.id, shranjeniKupecId), eq(shranjeniKupciTable.enotaId, tenotaId)));
      if (!kupec) { res.status(404).json({ error: "Shranjeni kupec ni najden" }); return; }
    }
    updateData.shranjeniKupecId = shranjeniKupecId;
  }

  if ("predvidenPrevzem" in parsed.data) {
    const raw = (parsed.data as { predvidenPrevzem?: string | null }).predvidenPrevzem;
    const predvidenPrevzem = raw ? new Date(raw) : null;
    if (raw && Number.isNaN(predvidenPrevzem!.getTime())) {
      res.status(400).json({ error: "Predviden čas prevzema ni veljaven" }); return;
    }
    updateData.predvidenPrevzem = predvidenPrevzem;
    updateData.predvidenPrevzemRocen = predvidenPrevzem != null;
  }
  if ((parsed.data as { predvidenPrevzemRocen?: boolean }).predvidenPrevzemRocen === false) {
    updateData.predvidenPrevzemRocen = false;
  }

  const podatkiDostavePosodobljeni = (
    "narocnikId" in parsed.data
    || "dostavaNaslovId" in parsed.data
    || "dostavaNaslov" in parsed.data
  );
  const prehodNaDostavo = obstojeceNarocilo.nacinIzpolnitve !== "dostava"
    && naslednjiNacinIzpolnitve === "dostava";
  const prehodNaPrevzem = obstojeceNarocilo.nacinIzpolnitve === "dostava"
    && naslednjiNacinIzpolnitve === "prevzem";
  const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;
  let dostavaZaSinhronizacijo: RazresenaDostava | null = null;
  let dostavniArtikelZaRazresitev: DostavniArtikelRow | null = null;
  let dostavniArtikelZaOdstranitev: DostavniArtikelRow | null = null;

  if (naslednjiNacinIzpolnitve === "dostava" && (prehodNaDostavo || podatkiDostavePosodobljeni)) {
    try {
      dostavniArtikelZaRazresitev = await pridobiDostavniArtikel(tenotaId);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Podatki za dostavo niso veljavni." });
      return;
    }
  }

  if (prehodNaPrevzem) {
    try {
      dostavniArtikelZaOdstranitev = await pridobiDostavniArtikel(tenotaId);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Nastavite dostavni artikel." });
      return;
    }
    updateData.narocnikId = null;
    updateData.dostavaUlica = null;
    updateData.dostavaHisnaStevilka = null;
    updateData.dostavaVhod = null;
    updateData.dostavaNadstropje = null;
    updateData.dostavaNaseljeNaziv = null;
    updateData.dostavaNaseljeId = null;
    updateData.dostavaNavodilo = null;
    updateData.dostavaStoritevId = null;
    updateData.dostavaCena = null;
    updateData.dostavaCasMin = null;
    updateData.predvidenaDostava = null;
  }

  const spreminjaStatusAliMizo = parsed.data.status !== undefined || novaMizaId !== undefined;
  const spreminjaSestavo = Boolean(dostavniArtikelZaRazresitev || dostavniArtikelZaOdstranitev || toGoSpremeni);

  try {
    await db.transaction(async (tx) => {
      if (spreminjaSestavo) {
        await lockKdsOrder(tx, params.data.id);
        await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      }
      let transakcijskiStariStatus = obstojeceNarocilo.status;
      let transakcijskaStaraMizaId = obstojeceNarocilo.mizaId;
      let transakcijskaNovaMizaId = novaMizaId !== undefined ? novaMizaId : obstojeceNarocilo.mizaId;
      let transakcijskiKoncniStatus = updateData.status ?? obstojeceNarocilo.status;
      let transakcijskaMenjavaMize = menjavaMize;

      if (spreminjaStatusAliMizo) {
        await lockPosBusinessDay(tx, tenotaId);
        const [zaklenjenoNarocilo] = await tx.select({
          id: narocilaTable.id,
          status: narocilaTable.status,
          mizaId: narocilaTable.mizaId,
          ustvarjeno: narocilaTable.ustvarjeno,
        }).from(narocilaTable)
          .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)))
          .for("update");
        if (!zaklenjenoNarocilo) throw new Error("NAROCILO_NE_OBSTAJA");

        transakcijskiStariStatus = zaklenjenoNarocilo.status;
        transakcijskaStaraMizaId = zaklenjenoNarocilo.mizaId;
        transakcijskaNovaMizaId = novaMizaId !== undefined ? novaMizaId : zaklenjenoNarocilo.mizaId;
        transakcijskiKoncniStatus = updateData.status ?? zaklenjenoNarocilo.status;
        transakcijskaMenjavaMize = novaMizaId !== undefined
          && novaMizaId !== zaklenjenoNarocilo.mizaId;

        const ustvarjaNovoBlokado = transakcijskiKoncniStatus === "odprto" && (
          transakcijskiStariStatus !== "odprto"
          || (transakcijskaMenjavaMize && transakcijskaNovaMizaId != null)
        );
        if (ustvarjaNovoBlokado) {
          const operationTime = await getSimDatumOrNow(tenotaId);
          const businessDate = await businessDateForTimestamp(operationTime, tenotaId, tx);
          if (await isPosBusinessDayClosed(tx, tenotaId, businessDate)) {
            throw new Error("TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN");
          }
          const previousDayGate = await checkPreviousBusinessDayClosed(tx, tenotaId, businessDate);
          if (!previousDayGate.allowed) {
            throw Object.assign(new Error("PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN"), {
              previousBusinessDate: previousDayGate.previousBusinessDate,
              missingRegisters: previousDayGate.missingRegisters,
            });
          }
          if (transakcijskiStariStatus !== "odprto") {
            const izvorniPoslovniDatum = await businessDateForTimestamp(
              zaklenjenoNarocilo.ustvarjeno,
              tenotaId,
              tx,
            );
            if (
              izvorniPoslovniDatum !== businessDate
              && await isPosBusinessDayClosed(tx, tenotaId, izvorniPoslovniDatum)
            ) {
              throw Object.assign(new Error("IZVORNI_POSLOVNI_DAN_JE_ZAKLJUCEN"), {
                originalBusinessDate: izvorniPoslovniDatum,
              });
            }
          }
        }

        const mizeZaZaklep = [...new Set([
          transakcijskaStaraMizaId,
          transakcijskaNovaMizaId,
        ].filter((id): id is number => id != null))].sort((a, b) => a - b);
        for (const mizaId of mizeZaZaklep) {
          if (!await zakleniMizo(tx, mizaId, tenotaId)) {
            if (mizaId === transakcijskaNovaMizaId) throw new Error("NOVA_MIZA_NE_OBSTAJA");
          }
        }
      }
      if (dostavniArtikelZaRazresitev) {
        dostavaZaSinhronizacijo = await razresiDostavo(tx, tenotaId, {
          ...parsed.data,
          narocnikId: (parsed.data as { narocnikId?: unknown }).narocnikId ?? obstojeceNarocilo.narocnikId,
          strankaIme: (parsed.data as { strankaIme?: unknown }).strankaIme ?? obstojeceNarocilo.strankaIme,
          strankaTelefon: (parsed.data as { strankaTelefon?: unknown }).strankaTelefon ?? obstojeceNarocilo.strankaTelefon,
        }, dostavniArtikelZaRazresitev);
        updateData.narocnikId = dostavaZaSinhronizacijo.narocnik.id;
        updateData.dostavaUlica = dostavaZaSinhronizacijo.snapshot.dostavaUlica;
        updateData.dostavaHisnaStevilka = dostavaZaSinhronizacijo.snapshot.dostavaHisnaStevilka;
        updateData.dostavaVhod = dostavaZaSinhronizacijo.snapshot.dostavaVhod;
        updateData.dostavaNadstropje = dostavaZaSinhronizacijo.snapshot.dostavaNadstropje;
        updateData.dostavaNaseljeNaziv = dostavaZaSinhronizacijo.snapshot.dostavaNaseljeNaziv;
        updateData.dostavaNaseljeId = dostavaZaSinhronizacijo.snapshot.dostavaNaseljeId;
        updateData.dostavaNavodilo = dostavaZaSinhronizacijo.snapshot.dostavaNavodilo;
        updateData.dostavaStoritevId = dostavaZaSinhronizacijo.artikel.id;
        updateData.dostavaCena = String(dostavaZaSinhronizacijo.snapshot.dostavaCena);
        updateData.dostavaCasMin = dostavaZaSinhronizacijo.snapshot.dostavaCasMin;
      }
      // Serialize a transfer with reservation creation on the destination.
      if (transakcijskaMenjavaMize && transakcijskaNovaMizaId != null) {
        const [block] = await tx.select({ id: rezervacijeMizTable.id })
          .from(rezervacijeMizTable).where(reservationBlockingClause(transakcijskaNovaMizaId)).limit(1);
        if (block) throw new Error("REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA");
        const [ciljnaMizaJeZasedena] = await tx.select({ id: narocilaTable.id })
          .from(narocilaTable)
          .where(and(
            eq(narocilaTable.enotaId, tenotaId),
            eq(narocilaTable.mizaId, transakcijskaNovaMizaId),
            eq(narocilaTable.status, "odprto"),
            ne(narocilaTable.id, params.data.id),
          ))
          .limit(1);
        if (ciljnaMizaJeZasedena) throw new Error("NOVA_MIZA_JE_ZASEDENA");
      }
      await tx.update(narocilaTable).set(updateData)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)));
      if (dostavaZaSinhronizacijo) {
        await sinhronizirajDostavnoPostavko(
          params.data.id,
          tenotaId,
          dostavaZaSinhronizacijo.artikel,
          dostavaZaSinhronizacijo.snapshot.dostavaCena,
          jeDdvZavezanec,
          tx,
        );
      } else if (dostavniArtikelZaOdstranitev) {
        await odstraniDostavnoPostavko(params.data.id, tenotaId, dostavniArtikelZaOdstranitev.id, tx);
      }
      if (toGoSpremeni && newToGo !== undefined) {
        await preracunajDdvPoToGo(tx, params.data.id, tenotaId, jeDdvZavezanec);
      }

      if (spreminjaStatusAliMizo) {
        const prizadeteMize = [...new Set([
          transakcijskaStaraMizaId,
          transakcijskaNovaMizaId,
        ].filter((id): id is number => id != null))];
        for (const mizaId of prizadeteMize) {
          const [odprtoNaMizi] = await tx.select({ id: narocilaTable.id })
            .from(narocilaTable)
            .where(and(
              eq(narocilaTable.enotaId, tenotaId),
              eq(narocilaTable.mizaId, mizaId),
              eq(narocilaTable.status, "odprto"),
            ))
            .limit(1);
          await tx.update(mizeTable).set(odprtoNaMizi ? {
            status: "zasedena",
            rezervacijaNarocnikId: null,
            rezervacijaStrankaIme: null,
            rezervacijaTelefon: null,
            rezervacijaOpomba: null,
            rezervacijaVeljaDo: null,
          } : {
            status: "prosta",
            rezervacijaNarocnikId: null,
            rezervacijaStrankaIme: null,
            rezervacijaTelefon: null,
            rezervacijaOpomba: null,
            rezervacijaVeljaDo: null,
          }).where(and(eq(mizeTable.id, mizaId), eq(mizeTable.enotaId, tenotaId)));
        }
      }
      if (transakcijskaMenjavaMize) {
        await tx.insert(prenosiNarocilTable).values({
          narociloId: params.data.id,
          enotaId: tenotaId,
          staraMizaId: transakcijskaStaraMizaId ?? null,
          novaMizaId: transakcijskaNovaMizaId ?? null,
        });
      }
    });
  } catch (error) {
    if (error instanceof Error && error.message === "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN") {
      res.status(409).json({ error: "Tekoči poslovni dan je že zaključen z Z-poročilom.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN") {
      const details = error as Error & {
        previousBusinessDate?: string;
        missingRegisters?: Array<{ id: number; name: string }>;
      };
      res.status(409).json({
        error: `Pred ponovnim odprtjem naročila zaključite prejšnji poslovni dan (${details.previousBusinessDate ? slovenskiDatumZaSporocilo(details.previousBusinessDate) : "neznan datum"}) z Z-poročilom.`,
        code: error.message,
        previousBusinessDate: details.previousBusinessDate ?? null,
        missingRegisters: details.missingRegisters ?? [],
      });
      return;
    }
    if (error instanceof Error && error.message === "IZVORNI_POSLOVNI_DAN_JE_ZAKLJUCEN") {
      const details = error as Error & { originalBusinessDate?: string };
      res.status(409).json({
        error: `Naročila iz že zaključenega poslovnega dne (${details.originalBusinessDate ? slovenskiDatumZaSporocilo(details.originalBusinessDate) : "neznan datum"}) ni mogoče ponovno odpreti.`,
        code: error.message,
        originalBusinessDate: details.originalBusinessDate ?? null,
      });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "NOVA_MIZA_JE_ZASEDENA") {
      res.status(409).json({ error: "Ciljna miza ima že odprto naročilo.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "NOVA_MIZA_NE_OBSTAJA") {
      res.status(404).json({ error: "Ciljna miza ni najdena.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "NAROCILO_NE_OBSTAJA") {
      res.status(404).json({ error: "Naročilo ni najdeno.", code: error.message });
      return;
    }
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  if (naslednjiNacin === "telefon" || naslednjiNacin === "miza") {
    await osveziPredvidenPrevzem(params.data.id, tenotaId);
  }


  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.delete("/narocila/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await tx.delete(narocilaTable)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)));
    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }
  broadcastToUnit(tenotaId, "update", { type: "narocilo" });
  res.sendStatus(204);
});

router.post("/narocila/:id/spoji", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const ciljId = params.data.id;
  const virId = parsed.data.virNarociloId;

  if (ciljId === virId) { res.status(400).json({ error: "Ciljno in izvorno naročilo sta enaki" }); return; }

  const [cilj] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, ciljId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!cilj) { res.status(404).json({ error: "Ciljno naročilo ni najdeno" }); return; }
  if (cilj.status !== "odprto") { res.status(400).json({ error: "Ciljno naročilo ni odprto" }); return; }

  const [vir] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, virId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!vir) { res.status(404).json({ error: "Izvorno naročilo ni najdeno" }); return; }
  if (vir.status !== "odprto") { res.status(400).json({ error: "Izvorno naročilo ni odprto" }); return; }

  if (cilj.mizaId == null || vir.mizaId == null || cilj.mizaId !== vir.mizaId) {
    res.status(400).json({ error: "Naročili nista za isto mizo" }); return;
  }

  // Atomiška transakcija: prenos + recalc + brisanje/zapiranje
  try { await db.transaction(async (tx) => {
    const zaklenjenaNarocila = [ciljId, virId].sort((a, b) => a - b);
    for (const narociloId of zaklenjenaNarocila) {
      await lockKdsOrder(tx, narociloId);
    }
    await assertKdsOrderNotDispatched(tx, ciljId, tenotaId);
    await assertKdsOrderNotDispatched(tx, virId, tenotaId);
    await assertOpenOrderCanChange(tx, ciljId, tenotaId);
    await assertOpenOrderCanChange(tx, virId, tenotaId);
    const zaklenjeneVrstice = await tx.select({
      id: narocilaTable.id,
      status: narocilaTable.status,
    }).from(narocilaTable).where(and(
      inArray(narocilaTable.id, [ciljId, virId]),
      eq(narocilaTable.enotaId, tenotaId),
    )).for("update");
    if (zaklenjeneVrstice.length !== 2 || zaklenjeneVrstice.some((narocilo) => narocilo.status !== "odprto")) {
      throw new Error("KDS_MERGE_ORDER_NOT_OPEN");
    }
    // Prestavi neračunane postavke iz virNarociloId → ciljId
    await tx.update(postavkeTable)
      .set({ narociloId: ciljId })
      .where(and(eq(postavkeTable.narociloId, virId), isNull(postavkeTable.racunId)));

    // Posodobi skupaj ciljnega naročila
    const ciljPostavke = await tx.select().from(postavkeTable).where(eq(postavkeTable.narociloId, ciljId));
    const ciljSkupaj = ciljPostavke.reduce((acc, p) => acc + Number(p.skupaj), 0);
    await tx.update(narocilaTable).set({ skupaj: String(ciljSkupaj.toFixed(2)) }).where(eq(narocilaTable.id, ciljId));

    // Preveri, ali ima vir preostale zaračunane postavke
    const virPreostale = await tx.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(eq(postavkeTable.narociloId, virId));
    if (virPreostale.length === 0) {
      // Ni več postavk → zbriši izvorno naročilo
      await tx.delete(narocilaTable).where(eq(narocilaTable.id, virId));
    } else {
      // Ima zaračunane postavke → posodobi skupaj vira in ga zapri
      const virSkupaj = await tx.select().from(postavkeTable).where(eq(postavkeTable.narociloId, virId));
      const virTotal = virSkupaj.reduce((acc, p) => acc + Number(p.skupaj), 0);
      await tx.update(narocilaTable)
        .set({ skupaj: String(virTotal.toFixed(2)), status: "zakljuceno" })
        .where(eq(narocilaTable.id, virId));
    }
  }); } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && error.message === "KDS_MERGE_ORDER_NOT_OPEN") {
      res.status(409).json({ error: "Obe naročili morata biti odprti in pripadati aktivni enoti.", code: error.message });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    throw error;
  }

  const narocilo = await getNarociloById(ciljId, "", tenotaId);
  broadcastToUnit(tenotaId, "update", { type: "narocilo" });
  res.json(narocilo);
});

router.post("/narocila/:id/multicourse", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const params = AddMulticourseMenuParams.safeParse(req.params);
  const body = AddMulticourseMenuBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Zahteva za večhodni meni ni veljavna." });
    return;
  }
  if (
    !Number.isInteger(body.data.quantity)
    || (body.data.gostStevilka != null && (!Number.isInteger(body.data.gostStevilka) || body.data.gostStevilka < 1))
  ) {
    res.status(400).json({ error: "Količina in številka gosta morata biti celi števili." });
    return;
  }

  const [menu] = await db.select().from(multicourseMenusTable).where(and(
    eq(multicourseMenusTable.enotaId, tenotaId),
    eq(multicourseMenusTable.menuArtikelId, body.data.menuArtikelId),
    eq(multicourseMenusTable.aktivno, true),
  ));
  if (!menu) { res.status(404).json({ error: "Večhodni meni ni na voljo." }); return; }
  const configuredCourses = await db.select().from(multicourseMenuCoursesTable)
    .where(eq(multicourseMenuCoursesTable.menuId, menu.id));
  const selections = resolveMulticourseSelections(
    { izbor: menu.izbor, selectionMode: menu.selectionMode, selectionCount: menu.selectionCount, courses: configuredCourses },
    body.data.selections.map(selection => ({ ...selection, wineArtikelId: selection.wineArtikelId ?? null })),
  );
  if (!selections) {
    res.status(400).json({ error: "Izbira hodov ali vin večhodnega menija ni veljavna." });
    return;
  }

  const articleIds = [...new Set([
    menu.menuArtikelId,
    ...selections.flatMap((selection) => [selection.foodArtikelId, selection.wineArtikelId].filter((id): id is number => id !== null)),
  ])];
  const articles = await db.select().from(artikliTable).where(and(
    eq(artikliTable.enotaId, tenotaId),
    eq(artikliTable.aktiven, true),
    inArray(artikliTable.id, articleIds),
  ));
  const articlesById = new Map(articles.map((article) => [article.id, article]));
  const wrapper = articlesById.get(menu.menuArtikelId);
  if (!wrapper || articleIds.some((id) => !articlesById.has(id))) {
    res.status(400).json({ error: "Konfigurirani hod ali vino ni več aktiven v tej enoti." });
    return;
  }

  const [order] = await db.select({
    status: narocilaTable.status,
    ustvarjeno: narocilaTable.ustvarjeno,
  }).from(narocilaTable).where(and(
    eq(narocilaTable.id, params.data.id),
    eq(narocilaTable.enotaId, tenotaId),
  ));
  if (!order) { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  if (order.status !== "odprto") { res.status(409).json({ error: "Naročilo ni odprto." }); return; }

  const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;
  const vatContext = jeDdvZavezanec
    ? await Promise.all([loadVatRules(), getNastavitveMap(tenotaId)])
    : null;
  let davek = jeDdvZavezanec ? Number(wrapper.davek) : 0;
  let appliedRuleId: number | null = null;
  if (vatContext) {
    const [vatRules, nastavitve] = vatContext;
    const resolvedRate = resolveRate({
      supplyKind: resolveSupplyKind(false, false),
      taxCategory: ((wrapper as Record<string, unknown>).taxCategory ?? "food") as TaxCategory,
      addedSugar: Boolean((wrapper as Record<string, unknown>).addedSugar),
      jeDelMenija: Boolean((wrapper as Record<string, unknown>).jeDelMenija)
        && isMenuEligibleTaxCategory(String((wrapper as Record<string, unknown>).taxCategory ?? "")),
      nastavitve,
      fallbackRate: Number(wrapper.davek),
      jeDdvZavezanec,
    }, vatRules);
    davek = resolvedRate.rate;
    appliedRuleId = resolvedRate.ruleId;
  }
  const componentVatById = new Map<number, { rate: number; ruleId: number | null }>();
  for (const component of articles) {
    if (component.id === wrapper.id) continue;
    if (!vatContext) {
      componentVatById.set(component.id, { rate: 0, ruleId: null });
      continue;
    }
    const [vatRules, nastavitve] = vatContext;
    const resolvedRate = resolveRate({
      supplyKind: resolveSupplyKind(false, false),
      taxCategory: ((component as Record<string, unknown>).taxCategory ?? "food") as TaxCategory,
      addedSugar: Boolean((component as Record<string, unknown>).addedSugar),
      jeDelMenija: Boolean((component as Record<string, unknown>).jeDelMenija)
        && isMenuEligibleTaxCategory(String((component as Record<string, unknown>).taxCategory ?? "")),
      nastavitve,
      fallbackRate: Number(component.davek),
      jeDdvZavezanec,
    }, vatRules);
    componentVatById.set(component.id, {
      rate: resolvedRate.rate,
      ruleId: resolvedRate.ruleId,
    });
  }
  const pairingGroupId = `multicourse:${params.data.id}:${crypto.randomUUID()}`;
  const cenaKos = round2(Number(wrapper.cena));
  const split = splitMulticourseGross(cenaKos, Number(menu.foodPricePercent));
  const skupajHrana = round2(split.foodGross * body.data.quantity);
  const skupajVino = round2(split.wineGross * body.data.quantity);
  const selectedWineId = selections.find(selection => selection.wineArtikelId !== null)?.wineArtikelId ?? null;
  if (selectedWineId !== null && split.wineGross <= 0) {
    res.status(400).json({ error: "Vinska spremljava je izbrana, vendar delež cene vina ni nastavljen." });
    return;
  }
  if (split.wineGross > 0 && selectedWineId === null) {
    res.status(400).json({ error: "Meni ima določen delež vina, vendar vinska spremljava ni izbrana." });
    return;
  }
  const wineVat = selectedWineId === null
    ? null
    : componentVatById.get(selectedWineId) ?? null;
  const generatedPizzaSizes = izracunajVelikostiPic(await readAll("", tenotaId));
  const selectedPizzaDefaultSize = privzetaVelikostPice(generatedPizzaSizes);
  const pizzaDoughByArticleId = new Map<number, { articleId: number | null; size: PizzaVelikostId; factor: number }>();

  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      const [locked] = await tx.select({ status: narocilaTable.status }).from(narocilaTable)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId))).for("update");
      if (!locked || locked.status !== "odprto") throw new Error("Naročilo ni odprto.");

      const generatedAvailabilityRequests: Array<{ articleId: number; quantity: number }> = [];
      for (const selection of selections) {
        for (const articleId of [selection.foodArtikelId, selection.wineArtikelId].filter((id): id is number => id !== null)) {
          const component = articlesById.get(articleId)!;
          let factor = 1;
          if (component.jePica) {
            const size = selectedPizzaDefaultSize;
            if (!size) throw new PizzaDoughConfigurationError("Velikosti pic za to poslovno enoto niso nastavljene.");
            factor = size.normativFaktor;
            const doughArticleId = await loadPizzaDoughArticleId(tx, tenotaId, size.id);
            pizzaDoughByArticleId.set(articleId, {
              articleId: doughArticleId,
              size: size.id,
              factor,
            });
            if (doughArticleId != null) {
              generatedAvailabilityRequests.push({
                articleId: doughArticleId,
                quantity: body.data.quantity,
              });
            }
          }
          if (component.mealType !== "ala_carte") {
            generatedAvailabilityRequests.push({ articleId, quantity: body.data.quantity * factor });
          }
        }
      }
      if (generatedAvailabilityRequests.length > 0) {
        const businessDate = await businessDateForTimestamp(order.ustvarjeno, tenotaId, tx);
        await assertPreparedFoodAvailability(tx, tenotaId, businessDate, generatedAvailabilityRequests);
      }

      await tx.insert(postavkeTable).values({
        narociloId: params.data.id, artikelId: wrapper.id,
        ime: split.wineGross > 0 ? `${wrapper.ime} – hrana` : wrapper.ime,
        kolicina: body.data.quantity, cenaKos: String(split.foodGross), cenaKosOriginalna: String(split.foodGross),
        skupaj: String(skupajHrana), davek: String(davek), opomba: body.data.opomba ?? null,
        gostStevilka: body.data.gostStevilka ?? null, vrstaArtikla: wrapper.vrstaArtikla,
        mealType: wrapper.mealType ?? "ala_carte", appliedRuleId: appliedRuleId ?? undefined,
        jeDelMenija: Boolean((wrapper as Record<string, unknown>).jeDelMenija),
        pairingGroupId,
      });
      if (split.wineGross > 0 && wineVat) {
        await tx.insert(postavkeTable).values({
          narociloId: params.data.id, artikelId: wrapper.id,
          ime: `${wrapper.ime} – vinska spremljava`,
          kolicina: body.data.quantity, cenaKos: String(split.wineGross), cenaKosOriginalna: String(split.wineGross),
          skupaj: String(skupajVino), davek: String(wineVat.rate), opomba: null,
          gostStevilka: body.data.gostStevilka ?? null, vrstaArtikla: wrapper.vrstaArtikla,
          mealType: wrapper.mealType ?? "ala_carte", appliedRuleId: wineVat.ruleId ?? undefined,
          jeDelMenija: true, pairingGroupId,
        });
      }
      for (const selection of selections) {
        for (const articleId of [selection.foodArtikelId, selection.wineArtikelId].filter((id): id is number => id !== null)) {
          const component = articlesById.get(articleId)!;
          const componentVat = componentVatById.get(component.id) ?? { rate: 0, ruleId: null };
          const pizzaSnapshot = component.jePica ? pizzaDoughByArticleId.get(component.id) : undefined;
          const [componentLine] = await tx.insert(postavkeTable).values({
            narociloId: params.data.id, artikelId: component.id, ime: component.ime,
            kolicina: body.data.quantity, cenaKos: "0", cenaKosOriginalna: "0", skupaj: "0",
            davek: String(componentVat.rate), opomba: null, gostStevilka: body.data.gostStevilka ?? null,
            vrstaArtikla: component.vrstaArtikla, mealType: component.mealType ?? "ala_carte",
            appliedRuleId: componentVat.ruleId ?? undefined,
            jeDelMenija: true, courseNumber: selection.courseNumber,
            courseSequence: selection.courseSequence,
            courseNameSnapshot: configuredCourses.find(course => course.courseNumber === selection.courseNumber)?.courseName ?? null,
            pairingGroupId,
            velikostPice: pizzaSnapshot?.size,
            normativFaktor: String(pizzaSnapshot?.factor ?? 1),
          }).returning({ id: postavkeTable.id });
          if (pizzaSnapshot?.articleId != null) {
            await tx.execute(sql`
              UPDATE postavke
              SET pizza_dough_article_id = ${pizzaSnapshot.articleId}
              WHERE id = ${componentLine.id}
                AND narocilo_id = ${params.data.id}
                AND parent_postavka_id IS NULL
            `);
          }
        }
      }
      await updateSkupaj(params.data.id, tenotaId, tx);
    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code }); return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message }); return;
    }
    if (error instanceof InsufficientPreparedFoodAvailabilityError) {
      res.status(409).json({ error: error.message, code: error.code, ...error.details }); return;
    }
    if (error instanceof PizzaDoughConfigurationError) {
      res.status(400).json({ error: error.message, code: error.code }); return;
    }
    throw error;
  }

  await osveziPredvidenPrevzem(params.data.id, tenotaId);
  await materializirajKdsNaloge(params.data.id, tenotaId);
  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno." }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.status(201).json(AddMulticourseMenuResponse.parse(narocilo));
});

router.post("/narocila/:id/postavke", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const params = { success: true as const, data: { id: Number(rawId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [artikel] = await db.select().from(artikliTable)
    .where(and(eq(artikliTable.id, parsed.data.artikelId), sql`true`, eq(artikliTable.enotaId, tenotaId)));
  if (!artikel) { res.status(404).json({ error: "Artikel ni najden" }); return; }
  if (artikel.mealType === "prepared" && !artikel.prodajniArtikel && isPreparedFoodBulkUnit(artikel.enotaMere)) {
    res.status(422).json({ error: "Pripravljena jed v kg ali l je neprodajni polizdelek; dodajte jo kot normativ sestavljene jedi ali modifikatorja." });
    return;
  }
  const [multicourseMenu] = await db.select({ id: multicourseMenusTable.id })
    .from(multicourseMenusTable)
    .where(and(
      eq(multicourseMenusTable.enotaId, tenotaId),
      eq(multicourseMenusTable.menuArtikelId, artikel.id),
      eq(multicourseMenusTable.aktivno, true),
    ))
    .limit(1);
  if (multicourseMenu) {
    res.status(409).json({
      error: "Večhodni meni zahteva izbiro hodov in vinske spremljave.",
      code: "MULTICOURSE_SELECTION_REQUIRED",
    });
    return;
  }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (narociloCheck.status !== "odprto") { res.status(409).json({ error: "Naročilo ni odprto" }); return; }
  const jeTelefonskoNarocilo = narociloCheck.nacin === "telefon";
  const dostavnaStoritevId = narociloCheck.dostavaStoritevId ?? (jeTelefonskoNarocilo
    ? await pridobiDostavnaStoritevId(tenotaId)
    : null);
  const postavkaToGo = jeTelefonskoNarocilo
    ? artikel.id !== dostavnaStoritevId
    : (parsed.data as { toGo?: boolean }).toGo ?? false;

  // Happy Hour cena — preveri ali je HH aktiven in artikel ima HH ceno
  let originalCena = Number(artikel.cena);
  let cenaKos = originalCena;
  let jeHappyHourCena = false;
  let jeHappyHourAktiven = false;
  let hhRocno = "auto";
  let hhRules: HappyHourPravilo[] = [];
  if (artikel.happyHourCena != null || artikel.happyHourCenaMala != null || artikel.happyHourCenaDruzinska != null) {
    const hhRows = await db.select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
      .from(nastavitveTable).where(and(eq(nastavitveTable.enotaId, tenotaId)));
    const hhMap: Record<string, string> = {};
    for (const r of hhRows) hhMap[r.kljuc] = r.vrednost;
    hhRocno = hhMap["happyHourRocnoAktiven"] ?? "auto";
    let parsedRules: unknown = [];
    try { parsedRules = JSON.parse(hhMap["happyHourPravila"] ?? "[]"); } catch { parsedRules = []; }
    hhRules = parseHappyHourRules(
      parsedRules,
      hhMap["happyHourOd"] ?? "",
      hhMap["happyHourDo"] ?? "",
      [artikel.id],
    );
  }
  const kolicina = parsed.data.kolicina;
  const zahtevanaVelikostPice = (parsed.data as { velikostPice?: PizzaVelikostId }).velikostPice;
  const aktivneVelikostiPic = artikel.jePica ? izracunajVelikostiPic(await readAll("", tenotaId)) : [];
  if (artikel.jePica && aktivneVelikostiPic.length === 0) {
    res.status(400).json({ error: "Velikosti pic za to poslovno enoto niso nastavljene." });
    return;
  }
  if (!artikel.jePica && zahtevanaVelikostPice !== undefined) {
    res.status(400).json({ error: "Velikost pice je dovoljena samo pri picah." });
    return;
  }
  const izbranaVelikostPice = artikel.jePica
    ? aktivneVelikostiPic.find((velikost) => velikost.id === (zahtevanaVelikostPice ?? privzetaVelikostPice(aktivneVelikostiPic)?.id))
    : undefined;
  if (artikel.jePica && !izbranaVelikostPice) {
    res.status(400).json({ error: "Izbrana velikost pice ni na voljo." });
    return;
  }
  jeHappyHourAktiven = isHappyHourActiveForArticle(
    hhRules,
    artikel.id,
    hhRocno,
    new Date(),
    izbranaVelikostPice?.id,
  );
  if (izbranaVelikostPice) {
    const cenaVelikosti = cenaPicePoVelikosti(artikel, izbranaVelikostPice.id);
    if (cenaVelikosti === null) {
      res.status(400).json({ error: "Za izbrano velikost pice cena ni nastavljena." });
      return;
    }
    originalCena = cenaVelikosti;
    const happyHourCenaVelikosti = happyHourCenaPicePoVelikosti(artikel, izbranaVelikostPice.id);
    if (jeHappyHourAktiven && happyHourCenaVelikosti != null) {
      cenaKos = Number(happyHourCenaVelikosti);
      jeHappyHourCena = true;
    } else {
      cenaKos = cenaVelikosti;
    }
  } else if (jeHappyHourAktiven && artikel.happyHourCena != null) {
    cenaKos = Number(artikel.happyHourCena);
    jeHappyHourCena = true;
  }
  const skupaj = round2(cenaKos * kolicina);
  const gostStevilka = (parsed.data as { gostStevilka?: number | null }).gostStevilka ?? null;
  const parentPostavkaId = (parsed.data as { parentPostavkaId?: number | null }).parentPostavkaId ?? null;
  const samodejniToGoArtikelIds = jeTelefonskoNarocilo && postavkaToGo && parentPostavkaId == null
    ? Array.from(new Set(
        (Array.isArray(artikel.toGoArtikli) ? artikel.toGoArtikli : [])
          .filter((artikelId): artikelId is number => Number.isInteger(artikelId) && artikelId > 0 && artikelId !== artikel.id),
      ))
    : [];
  const samodejniToGoArtikli = samodejniToGoArtikelIds.length > 0
    ? await db.select({
        id: artikliTable.id,
        ime: artikliTable.ime,
        cena: artikliTable.cena,
        kategorijaIme: kategorijeTable.ime,
      }).from(artikliTable)
        .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
        .where(and(
          inArray(artikliTable.id, samodejniToGoArtikelIds),
          eq(artikliTable.enotaId, tenotaId),
          eq(artikliTable.aktiven, true),
        ))
    : [];

  // DDV zavezanec — ko podjetje ni DDV zavezanec (id_za_ddv ne začne s "SI"), je davek vedno 0.
  const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;

  // DDV dedovanje: ko je postavka child (npr. To Go embalaža pod pico), prevzame DDV stopnjo
  // nadrejene postavke (PZDDV — pomožna dobava sledi DDV stopnji glavne dobave).
  // vrsta_artikla dedovanje: child prevzame vrsto starševskega artikla.
  let davekZaPostavko = jeDdvZavezanec ? String(artikel.davek) : "0";
  let vrstaArtiklaZaPostavko: string = artikel.vrstaArtikla ?? "storitev";
  let appliedRuleId: number | null = null;
  let jeEmbalaza = false;
  let jeDelMenijaZaPostavko =
    Boolean((artikel as Record<string, unknown>).jeDelMenija)
    && isMenuEligibleTaxCategory(String((artikel as Record<string, unknown>).taxCategory ?? ""));

  if (parentPostavkaId != null) {
    // Child postavka → podeduje DDV od starša (PZDDV pravilo)
    const [parentPostavka] = await db.select({
      artikelId: postavkeTable.artikelId,
      toGo: postavkeTable.toGo,
      davek: postavkeTable.davek,
      vrstaArtikla: postavkeTable.vrstaArtikla,
      jeDelMenija: postavkeTable.jeDelMenija,
    })
      .from(postavkeTable)
      .where(and(
        eq(postavkeTable.id, parentPostavkaId),
        eq(postavkeTable.narociloId, params.data.id),
      ));
    if (!parentPostavka) {
      res.status(404).json({ error: "Starševska postavka ni najdena v naročilu" });
      return;
    }
    davekZaPostavko = jeDdvZavezanec ? String(parentPostavka.davek) : "0";
    if (parentPostavka.vrstaArtikla) vrstaArtiklaZaPostavko = parentPostavka.vrstaArtikla;
    jeDelMenijaZaPostavko = parentPostavka.jeDelMenija;
    if (parentPostavka.toGo && parentPostavka.artikelId != null) {
      const [parentArtikel] = await db.select({ toGoArtikli: artikliTable.toGoArtikli })
        .from(artikliTable).where(and(
          eq(artikliTable.id, parentPostavka.artikelId),
          eq(artikliTable.enotaId, tenotaId),
        ));
      const [childCategory] = await db.select({ ime: kategorijeTable.ime })
        .from(artikliTable)
        .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
        .where(and(eq(artikliTable.id, artikel.id), eq(artikliTable.enotaId, tenotaId)));
      jeEmbalaza = Array.isArray(parentArtikel?.toGoArtikli)
        && parentArtikel.toGoArtikli.includes(artikel.id)
        && childCategory?.ime?.toLowerCase() === "embalaža";
    }
  } else if (jeDdvZavezanec) {
    // Starševska postavka → DDV razreševalnik
    const [vatRules, nastavitve] = await Promise.all([
      loadVatRules(),
      getNastavitveMap(tenotaId),
    ]);
    // narocilo.toGo se ne upošteva več — DDV določa samo postavka.toGo (oranžni gumb)
    const supplyKind = resolveSupplyKind(false, postavkaToGo);
    const resolved = resolveRate({
      supplyKind,
      taxCategory: ((artikel as Record<string, unknown>).taxCategory ?? "food") as TaxCategory,
      addedSugar: Boolean((artikel as Record<string, unknown>).addedSugar),
      jeDelMenija: jeDelMenijaZaPostavko,
      nastavitve,
      fallbackRate: Number(artikel.davek),
      jeDdvZavezanec,
    }, vatRules);
    davekZaPostavko = String(resolved.rate);
    appliedRuleId = resolved.ruleId;
  }

  // Pre-transaction: validate modifier selections and resolve authoritative DB values
  const izbranModifikatorjiRaw = (parsed.data as {
    izbranModifikatorji?: Array<{ modifikatorId: number; podIzbire?: PodIzbiraInput[] }>;
  }).izbranModifikatorji ?? [];
  if (!Array.isArray(izbranModifikatorjiRaw) || izbranModifikatorjiRaw.some((modifier) =>
    modifier == null
    || !Number.isInteger(modifier.modifikatorId)
    || (modifier.podIzbire !== undefined && !Array.isArray(modifier.podIzbire)))) {
    res.status(400).json({ error: "Neveljaven seznam izbranih modifikatorjev." });
    return;
  }
  type ResolvedMod = {
    skupinaId: number;
    id: number;
    ime: string;
    cenaDodatek: number;
    podIzbire: ResolvedPodMod[];
  };
  let resolvedMods: ResolvedMod[] = [];

  if (parentPostavkaId != null && izbranModifikatorjiRaw.some((modifier) => modifier.podIzbire?.length)) {
    res.status(400).json({ error: "Podizbire modifikatorjev so dovoljene samo na prodajnih postavkah, ne na pomožnih artiklih." });
    return;
  }
  if (!parentPostavkaId) {
    // Load article's assigned modifier groups (tenant-scoped)
    const vezave = await db
      .select({
        skupinaId: artModSkupineTable.skupinaId,
        obvezna: modSkupineTable.obvezna,
        minIzbir: modSkupineTable.minIzbir,
        maxIzbir: modSkupineTable.maxIzbir})
      .from(artModSkupineTable)
      .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
      .where(
        and(
          eq(artModSkupineTable.artikelId, parsed.data.artikelId),
          sql`true`,
          eq(modSkupineTable.enotaId, tenotaId),
        ),
      );

    if (vezave.length > 0 || izbranModifikatorjiRaw.length > 0) {
      const skupinaIds = vezave.map((v) => v.skupinaId);
      const allMods = skupinaIds.length > 0
        ? await db
            .select()
            .from(modifikatorjiTable)
            .where(
              and(
                inArray(modifikatorjiTable.skupinaId, skupinaIds),
                eq(modifikatorjiTable.aktiven, true),
              ),
            )
        : [];
      const modMap = new Map(allMods.map((m) => [m.id, m]));

      // Resolve each requested modifikatorId from DB — reject unknown/foreign/inactive IDs
      for (const req of izbranModifikatorjiRaw) {
        const mod = modMap.get(req.modifikatorId);
        if (!mod) {
          res.status(400).json({ napaka: `Modifikator ${req.modifikatorId} ni veljaven, ni aktiven ali ne pripada temu artiklu` });
          return;
        }
        let podIzbire: ResolvedPodMod[];
        try {
          podIzbire = await resolveNestedModifierChoices(db, tenotaId, mod.id, req.podIzbire);
        } catch (error) {
          res.status(400).json({ error: error instanceof Error ? error.message : "Neveljavna podizbira modifikatorja." });
          return;
        }
        resolvedMods.push({
          skupinaId: mod.skupinaId,
          id: mod.id,
          ime: mod.ime,
          cenaDodatek: Number(mod.cenaDodatek),
          podIzbire,
        });
      }

      // Validate group constraints — runs even when izbranModifikatorjiRaw is empty (required groups)
      const selectedBySkupina = new Map<number, number>();
      for (const m of resolvedMods) {
        selectedBySkupina.set(m.skupinaId, (selectedBySkupina.get(m.skupinaId) ?? 0) + 1);
      }
      for (const v of vezave) {
        const count = selectedBySkupina.get(v.skupinaId) ?? 0;
        // obvezna skupin: vsaj max(1, minIzbir)
        const minRequired = v.obvezna ? Math.max(1, v.minIzbir) : v.minIzbir;
        if (count < minRequired) {
          res.status(400).json({ napaka: `Skupina ${v.skupinaId}: obvezno je izbrati vsaj ${minRequired} modifikator(jev), izbrano: ${count}` });
          return;
        }
        if (v.maxIzbir > 0 && count > v.maxIzbir) {
          res.status(400).json({ napaka: `Skupina ${v.skupinaId}: izbrali ste preveč modifikatorjev (maks ${v.maxIzbir}), izbrano: ${count}` });
          return;
        }
      }
    }
  }

  const napravaIdHeader = req.headers["x-naprava-id"];
  const napravaId = typeof napravaIdHeader === "string" ? napravaIdHeader : null;
  if (parentPostavkaId != null && (artikel.mealType ?? "ala_carte") !== "ala_carte") {
    res.status(400).json({ error: "Pripravljene ali sestavljene hrane ni dovoljeno dodati kot pomožno postavko." });
    return;
  }

  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      const businessDate = await businessDateForTimestamp(narociloCheck.ustvarjeno, tenotaId, tx);
      const doughArticleId = artikel.jePica && parentPostavkaId == null && izbranaVelikostPice
        ? await loadPizzaDoughArticleId(tx, tenotaId, izbranaVelikostPice.id)
        : null;
      const modifierSnapshots = resolvedMods.length > 0
        ? await loadModifierAvailabilitySnapshots(tx, resolvedMods.map((modifier) => modifier.id))
        : new Map();
      if (
        (artikel.mealType ?? "ala_carte") !== "ala_carte"
        || resolvedMods.length > 0
      ) {
        const effectiveQuantity = kolicina * Number(izbranaVelikostPice?.normativFaktor ?? 1);
        const modifierRequests = buildModifierAvailabilityRequests(
          modifierSnapshots,
          resolvedMods.map((modifier) => modifier.id),
          effectiveQuantity,
        );
        for (const modifier of resolvedMods) {
          for (const nested of modifier.podIzbire) {
            for (const requirement of nested.availabilityRequirements) {
              modifierRequests.push({
                articleId: requirement.articleId,
                quantity: requirement.quantity * effectiveQuantity,
              });
            }
          }
        }
        await assertPreparedFoodAvailability(tx, tenotaId, businessDate, [
          { articleId: artikel.id, quantity: effectiveQuantity },
          ...(doughArticleId == null ? [] : [{ articleId: doughArticleId, quantity: kolicina }]),
          ...modifierRequests,
        ]);
      } else if (doughArticleId != null) {
        await assertPreparedFoodAvailability(tx, tenotaId, businessDate, [
          { articleId: doughArticleId, quantity: kolicina },
        ]);
      }
      const [lockedOrder] = await tx.select({ status: narocilaTable.status })
        .from(narocilaTable)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)))
        .for("update");
      if (!lockedOrder || lockedOrder.status !== "odprto") throw new Error("Naročilo ni odprto");

    const [inserted] = await tx.insert(postavkeTable).values({
      narociloId: params.data.id,
      artikelId: artikel.id,
      ime: artikel.ime,
      kolicina,
      cenaKos: String(cenaKos),
      cenaKosOriginalna: String(originalCena),
      skupaj: String(skupaj.toFixed(2)),
      davek: davekZaPostavko,
      opomba: parsed.data.opomba ?? null,
      gostStevilka,
      parentPostavkaId,
      vrstaArtikla: vrstaArtiklaZaPostavko,
      mealType: artikel.mealType ?? "ala_carte",
      appliedRuleId: appliedRuleId ?? undefined,
      jeDelMenija: jeDelMenijaZaPostavko,
      jeEmbalaza,
       velikostPice: izbranaVelikostPice?.id,
       normativFaktor: String(izbranaVelikostPice?.normativFaktor ?? 1),
       toGo: postavkaToGo,
      napravaId}).returning({ id: postavkeTable.id });
    if (doughArticleId != null) {
      await tx.execute(sql`
        UPDATE postavke
        SET pizza_dough_article_id = ${doughArticleId}
        WHERE id = ${inserted.id}
          AND narocilo_id = ${params.data.id}
          AND parent_postavka_id IS NULL
      `);
    }

    // Insert modifier child rows using pre-validated authoritative DB values
    // Modifikatorji dedujejo DDV stopnjo starša (davekZaPostavko že vsebuje razrešeno stopnjo)
    for (const mod of resolvedMods) {
      const cenaMod = round2(mod.cenaDodatek);
      const [insertedModifier] = await tx.insert(postavkeTable).values({
        narociloId: params.data.id,
        artikelId: null,
        modifikatorId: mod.id,
        ime: mod.ime,
        kolicina,
        cenaKos: String(cenaMod.toFixed(2)),
        cenaKosOriginalna: String(cenaMod.toFixed(2)),
        skupaj: String(round2(cenaMod * kolicina).toFixed(2)),
        davek: davekZaPostavko,
        jeDelMenija: jeDelMenijaZaPostavko,
        opomba: null,
        gostStevilka,
        vrstaArtikla: vrstaArtiklaZaPostavko,
          velikostPice: izbranaVelikostPice?.id,
          normativFaktor: String(izbranaVelikostPice?.normativFaktor ?? 1),
          availabilityRequirements: modifierSnapshots.get(mod.id) ?? [],
          toGo: postavkaToGo,
        parentPostavkaId: inserted.id}).returning({ id: postavkeTable.id });
      for (const nested of mod.podIzbire) {
        const nestedPrice = round2(nested.cenaDodatek);
        await tx.insert(postavkeTable).values({
          narociloId: params.data.id,
          artikelId: null,
          modifikatorId: nested.id,
          modifierSourceArticleId: nested.sourceArtikelId,
          ime: nested.ime,
          kolicina,
          cenaKos: String(nestedPrice.toFixed(2)),
          cenaKosOriginalna: String(nestedPrice.toFixed(2)),
          skupaj: String(round2(nestedPrice * kolicina).toFixed(2)),
          davek: davekZaPostavko,
          jeDelMenija: jeDelMenijaZaPostavko,
          opomba: null,
          gostStevilka,
          vrstaArtikla: vrstaArtiklaZaPostavko,
          velikostPice: izbranaVelikostPice?.id,
          normativFaktor: String(nested.sourceNormQuantity),
          availabilityRequirements: nested.availabilityRequirements,
          toGo: postavkaToGo,
          parentPostavkaId: insertedModifier!.id,
        });
      }
    }

    // Telefonski prevzem in dostava sta vedno To Go. Dodaj pripadajoče
    // artikle (npr. embalažo) v isti transakciji kot glavno postavko.
    for (const toGoArtikel of samodejniToGoArtikli) {
      const cenaToGo = Number(toGoArtikel.cena);
      if (!Number.isFinite(cenaToGo) || cenaToGo < 0) continue;
      await tx.insert(postavkeTable).values({
        narociloId: params.data.id,
        artikelId: toGoArtikel.id,
        ime: toGoArtikel.ime,
        kolicina: 1,
        cenaKos: String(cenaToGo),
        cenaKosOriginalna: String(cenaToGo),
        skupaj: String(cenaToGo),
        davek: davekZaPostavko,
        jeDelMenija: jeDelMenijaZaPostavko,
        opomba: null,
        gostStevilka,
        vrstaArtikla: vrstaArtiklaZaPostavko,
        toGo: true,
        jeEmbalaza: toGoArtikel.kategorijaIme?.toLowerCase() === "embalaža",
        parentPostavkaId: inserted.id,
      });
    }

    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    if (error instanceof InsufficientPreparedFoodAvailabilityError) {
      res.status(409).json({ error: error.message, code: error.code, ...error.details });
      return;
    }
    if (error instanceof PizzaDoughConfigurationError) {
      res.status(400).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  await updateSkupaj(params.data.id, tenotaId);
  await osveziPredvidenPrevzem(params.data.id, tenotaId);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  await materializirajKdsNaloge(params.data.id, tenotaId);
  res.status(201).json(narocilo);
});

router.patch("/narocila/:id/postavke/:postavkaId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body as any };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  if (parsed.data.kolicina !== undefined
    && (typeof parsed.data.kolicina !== "number" || !Number.isFinite(parsed.data.kolicina) || parsed.data.kolicina <= 0)) {
    res.status(400).json({ error: "Količina mora biti končno število večje od 0." }); return;
  }
  if (parsed.data.cenaKos !== undefined
    && (typeof parsed.data.cenaKos !== "number" || !Number.isFinite(parsed.data.cenaKos) || parsed.data.cenaKos < 0)) {
    res.status(400).json({ error: "Cena postavke mora biti končno nenegativno število." }); return;
  }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [postavka] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!postavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  if (postavka.racunId != null) {
    res.status(409).json({ error: "Postavke ni mogoče urejati — že je pokrita z računom." });
    return;
  }

  const updatesNumbers = parsed.data.kolicina !== undefined || parsed.data.cenaKos !== undefined;
  // Metadata-only changes deliberately contain no financial fields.  The
  // current values are locked and calculated only below for financial PATCHes.
  const updateSet: Partial<typeof postavkeTable.$inferInsert> = {};
  const parsedGost = (parsed.data as { gostStevilka?: number | null }).gostStevilka;
  if (parsedGost !== undefined) {
    updateSet.gostStevilka = parsedGost;
  }
  const parsedOpomba = (parsed.data as { opomba?: string | null }).opomba;
  if (parsedOpomba !== undefined) {
    updateSet.opomba = parsedOpomba;
  }
  const parsedToGo = (parsed.data as { toGo?: boolean }).toGo;
  const jeTelefonskoNarocilo = narociloCheck.nacin === "telefon";
  const jeDostavnaStoritev = narociloCheck.dostavaStoritevId != null
    && postavka.artikelId === narociloCheck.dostavaStoritevId;
  const koncniToGo = jeTelefonskoNarocilo
    ? !jeDostavnaStoritev
    : parsedToGo;
  if (koncniToGo !== undefined) {
    updateSet.toGo = koncniToGo;
  }

  // Ko se toGo preklopi na starševski postavki, preračunaj DDV
  const jeStarsevskaPostavka = postavka.parentPostavkaId == null && postavka.artikelId != null;
  if (koncniToGo !== undefined && koncniToGo !== (postavka as typeof postavka & { toGo?: boolean }).toGo && jeStarsevskaPostavka) {
    const jeDdvZavezanec: boolean = (req as any).jeDdvZavezanec ?? true;
    if (jeDdvZavezanec && postavka.artikelId != null) {
      const [vatRules, nastavitve] = await Promise.all([loadVatRules(), getNastavitveMap(tenotaId)]);
      const [artRow] = await db.select({ davek: artikliTable.davek, taxCategory: artikliTable.taxCategory, addedSugar: artikliTable.addedSugar, jeDelMenija: artikliTable.jeDelMenija })
        .from(artikliTable).where(and(
          eq(artikliTable.id, postavka.artikelId),
          eq(artikliTable.enotaId, tenotaId),
        ));
      if (artRow) {
        const supplyKind = resolveSupplyKind(false, koncniToGo);
        const resolved = resolveRate({
          supplyKind,
          taxCategory: ((artRow as Record<string, unknown>).taxCategory ?? "food") as TaxCategory,
          addedSugar: Boolean((artRow as Record<string, unknown>).addedSugar),
          jeDelMenija: Boolean(postavka.jeDelMenija),
          nastavitve,
          fallbackRate: Number(artRow.davek),
          jeDdvZavezanec,
        }, vatRules);
        updateSet.davek = String(resolved.rate);
        if (resolved.ruleId != null) (updateSet as Record<string, unknown>).appliedRuleId = resolved.ruleId;
      }
    }
  }

  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      const businessDate = await businessDateForTimestamp(narociloCheck.ustvarjeno, tenotaId, tx);
      await lockPreparedFoodAvailability(tx, tenotaId, businessDate);
      const [lockedPostavka] = await tx.select({
        artikelId: postavkeTable.artikelId,
        kolicina: postavkeTable.kolicina,
        cenaKos: postavkeTable.cenaKos,
        normativFaktor: postavkeTable.normativFaktor,
        mealType: postavkeTable.mealType,
        parentPostavkaId: postavkeTable.parentPostavkaId,
        racunId: postavkeTable.racunId,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.id, params.data.postavkaId),
        eq(postavkeTable.narociloId, params.data.id),
      )).for("update");
      if (!lockedPostavka) throw new Error("Postavka ni najdena");
      if (lockedPostavka.racunId != null) throw new Error("Postavke ni mogoče urejati — že je pokrita z računom.");

      const lockedOldQuantity = Number(lockedPostavka.kolicina);
      const lockedNumbers = resolvePartialPostavkaNumbers(parsed.data, lockedOldQuantity, Number(lockedPostavka.cenaKos));
      if (!lockedNumbers) throw new Error("POSTAVKA_NEVELJAVNA_KOLICINA_ALI_CENA");
      const novaKolicina = lockedNumbers.kolicina;
      if (updatesNumbers) {
        updateSet.kolicina = novaKolicina;
        updateSet.skupaj = String(lockedNumbers.skupaj.toFixed(2));
        if (parsed.data.cenaKos !== undefined) updateSet.cenaKos = String(lockedNumbers.cenaKos.toFixed(2));
      }
      const increase = novaKolicina - lockedOldQuantity;
      if (lockedPostavka.parentPostavkaId == null && lockedPostavka.artikelId != null && increase > 0) {
        const effectiveIncrease = increase * Number(lockedPostavka.normativFaktor ?? 1);
        const modifierRows = await tx.select({
          id: postavkeTable.id,
          modifierId: postavkeTable.modifikatorId,
          availabilityRequirements: postavkeTable.availabilityRequirements,
        })
          .from(postavkeTable)
          .where(and(
            eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
            eq(postavkeTable.narociloId, params.data.id),
            isNull(postavkeTable.artikelId),
          ))
          .for("update");
        const modifierIds = modifierRows
          .map((row) => row.modifierId)
          .filter((modifierId): modifierId is number => modifierId != null);
        const legacyModifierIds = modifierRows
          .filter((row) => row.modifierId != null && row.availabilityRequirements == null)
          .map((row) => row.modifierId!)
        const modifierSnapshots = legacyModifierIds.length > 0
          ? await loadModifierAvailabilitySnapshots(tx, legacyModifierIds)
          : new Map();
        for (const row of modifierRows) {
          if (row.modifierId != null && row.availabilityRequirements != null) {
            modifierSnapshots.set(row.modifierId, row.availabilityRequirements);
          }
        }
        const modifierRequests = buildModifierAvailabilityRequests(
          modifierSnapshots,
          modifierIds,
          effectiveIncrease,
        );
        const nestedRows = modifierRows.length > 0
          ? await tx.select({
            availabilityRequirements: postavkeTable.availabilityRequirements,
          }).from(postavkeTable).where(and(
            inArray(postavkeTable.parentPostavkaId, modifierRows.map((row) => row.id)),
            eq(postavkeTable.narociloId, params.data.id),
            isNull(postavkeTable.artikelId),
          )).for("update")
          : [];
        for (const nested of nestedRows) {
          for (const requirement of nested.availabilityRequirements ?? []) {
            modifierRequests.push({
              articleId: requirement.articleId,
              quantity: requirement.quantity * effectiveIncrease,
            });
          }
        }
        const availabilityRequests = [
          ...((lockedPostavka.mealType ?? "ala_carte") !== "ala_carte"
            ? [{ articleId: lockedPostavka.artikelId, quantity: effectiveIncrease }]
            : []),
          ...modifierRequests,
        ];
        if (lockedPostavka.parentPostavkaId == null) {
          const doughSnapshot = await tx.execute(sql`
            SELECT pizza_dough_article_id
            FROM postavke
            WHERE id = ${params.data.postavkaId}
              AND narocilo_id = ${params.data.id}
            FOR UPDATE
          `);
          const doughArticleId = Number(
            (doughSnapshot.rows[0] as { pizza_dough_article_id: number | string | null } | undefined)
              ?.pizza_dough_article_id,
          );
          // Legacy lines keep a null snapshot and must not start consuming dough retroactively.
          if (Number.isInteger(doughArticleId) && doughArticleId > 0) {
            availabilityRequests.push({ articleId: doughArticleId, quantity: increase });
          }
        }
        if (availabilityRequests.length > 0) {
          await assertPreparedFoodAvailability(tx, tenotaId, businessDate, availabilityRequests);
        }
      }
      const [lockedOrder] = await tx.select({ status: narocilaTable.status })
        .from(narocilaTable)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)))
        .for("update");
      if (!lockedOrder || lockedOrder.status !== "odprto") throw new Error("Naročilo ni odprto");

      await tx.update(postavkeTable)
        .set(updateSet)
        .where(and(
          eq(postavkeTable.id, params.data.postavkaId),
          eq(postavkeTable.narociloId, params.data.id),
        ));

      // Otroci (modifikatorji) dedujejo novo DDV stopnjo starša.
      if (updateSet.davek !== undefined) {
        const directChildren = await tx.select({ id: postavkeTable.id })
          .from(postavkeTable)
          .where(and(
            eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
            eq(postavkeTable.narociloId, params.data.id),
          ));
        await tx.update(postavkeTable)
          .set({ davek: updateSet.davek })
          .where(and(
            or(
              eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
              directChildren.length > 0
                ? inArray(postavkeTable.parentPostavkaId, directChildren.map((row) => row.id))
                : sql`false`,
            ),
            eq(postavkeTable.narociloId, params.data.id),
          ));
      }

      if (lockedOldQuantity !== novaKolicina) {
        const neposredniOtroci = await tx.select({
          id: postavkeTable.id,
          kolicina: postavkeTable.kolicina,
        }).from(postavkeTable).where(and(
          eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
          eq(postavkeTable.narociloId, params.data.id),
        ));
        const vsiOtroci = await tx.select({
          id: postavkeTable.id,
          kolicina: postavkeTable.kolicina,
          cenaKos: postavkeTable.cenaKos,
        }).from(postavkeTable).where(and(
          or(
            eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
            neposredniOtroci.length > 0
              ? inArray(postavkeTable.parentPostavkaId, neposredniOtroci.map((row) => row.id))
              : sql`false`,
          ),
          eq(postavkeTable.narociloId, params.data.id),
        ));
        const parentIds = [params.data.postavkaId, ...neposredniOtroci.map((row) => row.id)];
        for (const otrok of vsiOtroci) {
          const otrokStaraKol = Number(otrok.kolicina);
          const novaKolOtrok = lockedOldQuantity > 0
            ? Math.max(1, Math.round(otrokStaraKol / lockedOldQuantity * novaKolicina))
            : novaKolicina;
          const otrokCenaKos = Number(otrok.cenaKos);
          const otrokNovaSkupaj = round2(otrokCenaKos * novaKolOtrok);
          await tx.update(postavkeTable)
            .set({ kolicina: novaKolOtrok, skupaj: String(otrokNovaSkupaj.toFixed(2)) })
            .where(and(
              eq(postavkeTable.id, otrok.id),
              eq(postavkeTable.narociloId, params.data.id),
              inArray(postavkeTable.parentPostavkaId, parentIds),
            ));
        }
      }
    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    if (error instanceof InsufficientPreparedFoodAvailabilityError) {
      res.status(409).json({ error: error.message, code: error.code, ...error.details });
      return;
    }
    if (error instanceof PizzaDoughConfigurationError) {
      res.status(400).json({ error: error.message, code: error.code });
      return;
    }
    throw error;
  }

  await updateSkupaj(params.data.id, tenotaId);
  await osveziPredvidenPrevzem(params.data.id, tenotaId);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.delete("/narocila/:id/postavke/:postavkaId", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const id = Number(rawId);
  const postavkaId = Number(rawPostavkaId);
  const params = { success: true as const, data: { id, postavkaId } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  // Optimistične vrstice v POS-u imajo začasen negativen ID. Nikoli jih ne
  // posredujamo bazi, saj PostgreSQL integer sicer napako intervala vrne kot 500.
  if (!Number.isSafeInteger(postavkaId) || postavkaId < 1 || postavkaId > 2_147_483_647) {
    res.status(400).json({ error: "Neveljaven ID postavke." });
    return;
  }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [postavkaCheck] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!postavkaCheck) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  if (postavkaCheck.racunId != null) {
    res.status(409).json({ error: "Postavke ni mogoče izbrisati — že je pokrita z računom." });
    return;
  }
  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      if (postavkaCheck.pairingGroupId != null) {
        const lockedGroupRows = await tx.select({
          id: postavkeTable.id,
          racunId: postavkeTable.racunId,
        }).from(postavkeTable).where(and(
          eq(postavkeTable.narociloId, params.data.id),
          eq(postavkeTable.pairingGroupId, postavkaCheck.pairingGroupId),
        )).for("update");
        if (lockedGroupRows.some((row) => row.racunId != null)) {
          throw new Error("MULTICOURSE_GROUP_BILLED");
        }
        const groupPostavkaIds = lockedGroupRows.map((row) => row.id);
        if (groupPostavkaIds.length > 0) {
          const lockedKdsTickets = await tx.select({
            id: kdsNalogiTable.id,
            stanje: kdsNalogiTable.stanje,
          }).from(kdsNalogiTable).where(and(
            eq(kdsNalogiTable.narociloId, params.data.id),
            inArray(kdsNalogiTable.postavkaId, groupPostavkaIds),
          )).for("update");
          const ticketIds = lockedKdsTickets.map((ticket) => ticket.id);
          if (ticketIds.length > 0) {
            const lockedKdsEvents = await tx.select({
              nalogId: kdsDogodkiTable.nalogId,
              zaporedje: kdsDogodkiTable.zaporedje,
              tip: kdsDogodkiTable.tip,
            }).from(kdsDogodkiTable).where(inArray(kdsDogodkiTable.nalogId, ticketIds)).for("update");
            if (lockedKdsTickets.some((ticket) => ticket.stanje === "bumped" || ticket.stanje === "ack")
              || lockedKdsEvents.some((event) => event.tip !== "materializiran")) {
              throw new KdsOrderAlreadyDispatchedError();
            }
            await tx.insert(kdsDogodkiTable).values(lockedKdsTickets.map((ticket) => ({
              nalogId: ticket.id,
              zaporedje: Math.max(0, ...lockedKdsEvents
                .filter((event) => event.nalogId === ticket.id)
                .map((event) => event.zaporedje)) + 1,
              tip: "preklic" as const,
              idempotencyKey: `preklic-paketa:${postavkaCheck.pairingGroupId}`,
            })));
            await tx.update(kdsNalogiTable).set({ stanje: "preklicano" })
              .where(inArray(kdsNalogiTable.id, ticketIds));
          }
        }
        await tx.delete(postavkeTable).where(and(
          eq(postavkeTable.narociloId, params.data.id),
          eq(postavkeTable.pairingGroupId, postavkaCheck.pairingGroupId),
        ));
      } else {
        // Odstrani tudi vnuke (enonivojske podizbire) pred njihovim modifikatorjem.
        const directChildren = await tx.select({ id: postavkeTable.id }).from(postavkeTable).where(and(
          eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
          eq(postavkeTable.narociloId, params.data.id),
        ));
        if (directChildren.length > 0) {
          await tx.delete(postavkeTable).where(and(
            inArray(postavkeTable.parentPostavkaId, directChildren.map((child) => child.id)),
            eq(postavkeTable.narociloId, params.data.id),
          ));
        }
        await tx.delete(postavkeTable).where(and(eq(postavkeTable.parentPostavkaId, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
        await tx.delete(postavkeTable).where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
      }
    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && error.message === "MULTICOURSE_GROUP_BILLED") {
      res.status(409).json({ error: "Večhodnega menija ni mogoče izbrisati — del menija je že pokrit z računom." });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    throw error;
  }

  await updateSkupaj(params.data.id, tenotaId);
  await osveziPredvidenPrevzem(params.data.id, tenotaId);

  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.json(narocilo);
});

router.patch("/narocila/:id/postavke/:postavkaId/pripravljeno", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [postavka] = await db.select({
    id: postavkeTable.id,
    narociloId: postavkeTable.narociloId,
    ime: postavkeTable.ime,
    kolicina: postavkeTable.kolicina,
    opomba: postavkeTable.opomba,
    mizaId: narocilaTable.mizaId,
    napravaId: postavkeTable.napravaId})
    .from(postavkeTable)
    .leftJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id))
    .where(and(
      eq(postavkeTable.id, params.data.postavkaId),
      eq(postavkeTable.narociloId, params.data.id),
      eq(narocilaTable.enotaId, tenotaId),
    ));
  if (!postavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }

  let mizaIme: string | null = null;
  let mizaStevilka: number | null = null;
  let prostorId: number | null = null;
  let prostorIme: string | null = null;
  if (postavka.mizaId) {
    const [miza] = await db.select({
      ime: mizeTable.ime,
      stevilka: mizeTable.stevilka,
      prostorId: mizeTable.prostorId,
      prostorIme: prostoriTable.ime})
      .from(mizeTable)
      .leftJoin(prostoriTable, eq(mizeTable.prostorId, prostoriTable.id))
      .where(eq(mizeTable.id, postavka.mizaId));
    mizaIme = miza?.ime ?? null;
    mizaStevilka = miza?.stevilka ?? null;
    prostorId = miza?.prostorId ?? null;
    prostorIme = miza?.prostorIme ?? null;
  }

  const novoPripravljeno = parsed.data.pripravljeno ? new Date() : null;
  try {
    await db.transaction(async (tx) => {
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      await tx.update(postavkeTable)
        .set({ pripravljeno: novoPripravljeno })
        .where(and(
          eq(postavkeTable.id, params.data.postavkaId),
          eq(postavkeTable.narociloId, params.data.id),
        ));
    });
  } catch (error) {
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({
        error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.",
        code: error.message,
      });
      return;
    }
    throw error;
  }

  if (parsed.data.pripravljeno) {
    const payload = {
      postavkaId: postavka.id,
      narociloId: postavka.narociloId,
      ime: postavka.ime,
      kolicina: postavka.kolicina,
      opomba: postavka.opomba ?? null,
      mizaIme,
      mizaStevilka,
      prostorId,
      prostorIme,
      vir: parsed.data.vir ?? null};
    if (postavka.napravaId) {
      broadcastToDevice(tenotaId, postavka.napravaId, "postavkaPripravljena", payload);
    } else {
      broadcastToUnit(tenotaId, "postavkaPripravljena", payload);
    }
  }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.json({ ok: true });
});

router.post("/narocila/:id/postavke/:postavkaId/modifikatorji", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId as number;
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const rawPostavkaId = Array.isArray(req.params.postavkaId) ? req.params.postavkaId[0] : req.params.postavkaId;
  const params = { success: true as const, data: { id: Number(rawId), postavkaId: Number(rawPostavkaId) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }
  const parsed = { success: true, data: req.body as {
    modifikatorji: Array<{ modifikatorId: number; podIzbire?: PodIzbiraInput[] }>;
    skupineIds?: number[];
  } };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  if (!Array.isArray(parsed.data.modifikatorji) || parsed.data.modifikatorji.some((modifier) =>
    modifier == null
    || !Number.isInteger(modifier.modifikatorId)
    || (modifier.podIzbire !== undefined && !Array.isArray(modifier.podIzbire)))) {
    res.status(400).json({ error: "Neveljaven seznam modifikatorjev." });
    return;
  }

  const narociloCheck = await getNarociloById(params.data.id, "", tenotaId);
  if (!narociloCheck) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }

  const [parentPostavka] = await db.select().from(postavkeTable)
    .where(and(eq(postavkeTable.id, params.data.postavkaId), eq(postavkeTable.narociloId, params.data.id)));
  if (!parentPostavka) { res.status(404).json({ error: "Postavka ni najdena" }); return; }
  if (parentPostavka.racunId != null) { res.status(409).json({ error: "Postavke ni mogoče urejati — že je pokrita z računom." }); return; }
  if (parentPostavka.artikelId == null) { res.status(400).json({ error: "Ta postavka ne more imeti modifikatorjev (nima artikla)." }); return; }

  // Resolve modifikatorji — only allow modifikatorji from groups assigned to this artikel
  const skupineVezave = await db
    .select({ skupinaId: artModSkupineTable.skupinaId })
    .from(artModSkupineTable)
    .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
    .where(and(
      eq(artModSkupineTable.artikelId, parentPostavka.artikelId),
      sql`true`,
      eq(modSkupineTable.enotaId, tenotaId),
    ));
  const skupinaIds = skupineVezave.map((v) => v.skupinaId);
  if (skupinaIds.length === 0) {
    res.status(400).json({ error: "Ta artikel nima modifikatorskih skupin." });
    return;
  }
  if (parsed.data.modifikatorji.length === 0 && (!parsed.data.skupineIds || parsed.data.skupineIds.length === 0)) {
    res.status(400).json({ error: "Seznam modifikatorjev je prazen in ni podanih skupin za brisanje." });
    return;
  }

  const allMods = await db.select().from(modifikatorjiTable)
    .where(and(inArray(modifikatorjiTable.skupinaId, skupinaIds), eq(modifikatorjiTable.aktiven, true)));
  const modMap = new Map(allMods.map((m) => [m.id, m]));

  // Load skupin details for min/maxIzbir validation
  const skupineDetails = await db.select().from(modSkupineTable).where(inArray(modSkupineTable.id, skupinaIds));
  const skupinaMap = new Map(skupineDetails.map((s) => [s.id, s]));

  // Check for duplicate modifikatorId entries in the request
  const reqIds = parsed.data.modifikatorji.map((r: any) => r.modifikatorId);
  if (new Set(reqIds).size !== reqIds.length) {
    res.status(400).json({ error: "Podvojeni modifikatorji v zahtevku." });
    return;
  }

  // Resolve modifiers and group by skupinaId for min/maxIzbir checks
  type ResolvedMod = {
    id: number;
    ime: string;
    cenaDodatek: number;
    davek: string;
    podIzbire: ResolvedPodMod[];
  };
  const resolvedMods: ResolvedMod[] = [];
  const bySkupina = new Map<number, number>();
  for (const req2 of parsed.data.modifikatorji) {
    const mod = modMap.get(req2.modifikatorId);
    if (!mod) {
      res.status(400).json({ error: `Modifikator ${req2.modifikatorId} ni veljaven, ni aktiven ali ne pripada temu artiklu` });
      return;
    }
    bySkupina.set(mod.skupinaId, (bySkupina.get(mod.skupinaId) ?? 0) + 1);
    let podIzbire: ResolvedPodMod[];
    try {
      podIzbire = await resolveNestedModifierChoices(db, tenotaId, mod.id, req2.podIzbire);
    } catch (error) {
      res.status(400).json({ error: error instanceof Error ? error.message : "Neveljavna podizbira modifikatorja." });
      return;
    }
    resolvedMods.push({
      id: mod.id,
      ime: mod.ime,
      cenaDodatek: Number(mod.cenaDodatek),
      davek: parentPostavka.davek,
      podIzbire,
    });
  }

  // Validate maxIzbir per skupin (within the request payload itself)
  for (const [skupinaId, count] of bySkupina) {
    const sk = skupinaMap.get(skupinaId);
    if (sk && Number(sk.maxIzbir) > 0 && count > Number(sk.maxIzbir)) {
      res.status(400).json({ error: `Preveč modifikatorjev za skupino "${sk.ime}": dovoljeno ${sk.maxIzbir}, posredovano ${count}.` });
      return;
    }
  }

  const gostStevilka = (parentPostavka as typeof parentPostavka & { gostStevilka?: number | null }).gostStevilka ?? null;

  // Replace semantics: for each skupinaId in scope (from skupineIds param or inferred from request),
  // delete existing child modifier rows for that skupinaId, then insert the new selection.
  // skupineIds param allows clearing all selections for a group (empty modifikatorji).
  const requestedSkupineIds = parsed.data.skupineIds?.length
    ? parsed.data.skupineIds.filter((sid: any) => skupinaIds.includes(sid))
    : Array.from(bySkupina.keys());
  for (const skupinaId of requestedSkupineIds) {
    const skupina = skupinaMap.get(skupinaId);
    if (!skupina) continue;
    const minimum = skupina.obvezna ? Math.max(1, skupina.minIzbir) : skupina.minIzbir;
    if ((bySkupina.get(skupinaId) ?? 0) < minimum) {
      res.status(400).json({ error: `Za skupino "${skupina.ime}" izberite vsaj ${minimum} možnost(i).` });
      return;
    }
  }
  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, params.data.id);
      await assertKdsOrderNotDispatched(tx, params.data.id, tenotaId);
      await assertOpenOrderCanChange(tx, params.data.id, tenotaId);
      const businessDate = await businessDateForTimestamp(narociloCheck.ustvarjeno, tenotaId, tx);
      await lockPreparedFoodAvailability(tx, tenotaId, businessDate);
      const [lockedOrder] = await tx.select({ status: narocilaTable.status })
        .from(narocilaTable)
        .where(and(eq(narocilaTable.id, params.data.id), eq(narocilaTable.enotaId, tenotaId)))
        .for("update");
      if (!lockedOrder || lockedOrder.status !== "odprto") throw new Error("Naročilo ni odprto");
      const [lockedParent] = await tx.select({
        kolicina: postavkeTable.kolicina,
        normativFaktor: postavkeTable.normativFaktor,
        racunId: postavkeTable.racunId,
        jeDelMenija: postavkeTable.jeDelMenija,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.id, params.data.postavkaId),
        eq(postavkeTable.narociloId, params.data.id),
      )).for("update");
      if (!lockedParent) throw new Error("Postavka ni najdena");
      if (lockedParent.racunId != null) throw new Error("Postavke ni mogoče urejati — že je pokrita z računom.");
      const existingChildMods = requestedSkupineIds.length > 0
        ? await tx.select({
          id: postavkeTable.id,
          modifikatorId: postavkeTable.modifikatorId,
          availabilityRequirements: postavkeTable.availabilityRequirements,
        })
          .from(postavkeTable)
          .where(and(
            eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
            eq(postavkeTable.narociloId, params.data.id),
            isNull(postavkeTable.artikelId),
          ))
          .for("update")
        : [];
      const existingScopedMods = existingChildMods.filter(
        (row) => row.modifikatorId != null
          && requestedSkupineIds.includes(modMap.get(row.modifikatorId)?.skupinaId ?? -1),
      );
      const existingToDelete = existingScopedMods.map((row) => row.id);
      const parentQuantity = Number(lockedParent.kolicina) * Number(lockedParent.normativFaktor ?? 1);
      const oldModifierIds = existingScopedMods
        .map((child) => child.modifikatorId)
        .filter((id): id is number => id != null);
      const legacyOldIds = existingScopedMods
        .filter((child) => child.modifikatorId != null && child.availabilityRequirements == null)
        .map((child) => child.modifikatorId!);
      const existingNestedRows = existingScopedMods.length > 0
        ? await tx.select({
          id: postavkeTable.id,
          availabilityRequirements: postavkeTable.availabilityRequirements,
        }).from(postavkeTable).where(and(
          inArray(postavkeTable.parentPostavkaId, existingScopedMods.map((row) => row.id)),
          eq(postavkeTable.narociloId, params.data.id),
          isNull(postavkeTable.artikelId),
        )).for("update")
        : [];
      const oldSnapshots = await loadModifierAvailabilitySnapshots(tx, legacyOldIds);
      for (const child of existingScopedMods) {
        if (child.modifikatorId != null && child.availabilityRequirements != null) {
          oldSnapshots.set(child.modifikatorId, child.availabilityRequirements);
        }
      }
      const newModifierIds = resolvedMods.map((modifier) => modifier.id);
      const newSnapshots = await loadModifierAvailabilitySnapshots(tx, newModifierIds);
      const oldRequirements = buildModifierAvailabilityRequests(
        oldSnapshots,
        oldModifierIds,
        parentQuantity,
      );
      const newRequirements = buildModifierAvailabilityRequests(
        newSnapshots,
        newModifierIds,
        parentQuantity,
      );
      for (const child of existingNestedRows) {
        for (const requirement of child.availabilityRequirements ?? []) {
          oldRequirements.push({ articleId: requirement.articleId, quantity: requirement.quantity * parentQuantity });
        }
      }
      for (const modifier of resolvedMods) {
        for (const nested of modifier.podIzbire) {
          for (const requirement of nested.availabilityRequirements) {
            newRequirements.push({ articleId: requirement.articleId, quantity: requirement.quantity * parentQuantity });
          }
        }
      }
      const totalsByArticle = (requirements: Array<{ articleId: number; quantity: number }>) => {
        const totals = new Map<number, number>();
        for (const requirement of requirements) {
          totals.set(requirement.articleId, (totals.get(requirement.articleId) ?? 0) + requirement.quantity);
        }
        return totals;
      };
      const oldByArticle = totalsByArticle(oldRequirements);
      const positiveDelta = [...totalsByArticle(newRequirements)]
        .map(([articleId, quantity]) => ({
          articleId,
          quantity: quantity - (oldByArticle.get(articleId) ?? 0),
        }))
        .filter((requirement) => requirement.quantity > 0);
      if (positiveDelta.length > 0) {
        await assertPreparedFoodAvailability(tx, tenotaId, businessDate, positiveDelta);
      }
      if (existingToDelete.length > 0) {
        const descendantIds = existingNestedRows.map((row) => row.id);
        if (descendantIds.length > 0) {
          await tx.delete(postavkeTable).where(and(
            inArray(postavkeTable.id, descendantIds),
            eq(postavkeTable.narociloId, params.data.id),
          ));
        }
        await tx.delete(postavkeTable).where(and(
          inArray(postavkeTable.id, existingToDelete),
          eq(postavkeTable.narociloId, params.data.id),
          eq(postavkeTable.parentPostavkaId, params.data.postavkaId),
        ));
      }
      for (const mod of resolvedMods) {
        const cenaMod = round2(mod.cenaDodatek);
        const [insertedModifier] = await tx.insert(postavkeTable).values({
          narociloId: params.data.id,
          artikelId: null,
          modifikatorId: mod.id,
          ime: mod.ime,
          kolicina: lockedParent.kolicina,
          cenaKos: String(cenaMod.toFixed(2)),
          cenaKosOriginalna: String(cenaMod.toFixed(2)),
          skupaj: String(round2(cenaMod * Number(lockedParent.kolicina)).toFixed(2)),
          davek: mod.davek,
          jeDelMenija: lockedParent.jeDelMenija,
          opomba: null,
          gostStevilka,
          velikostPice: parentPostavka.velikostPice,
          normativFaktor: lockedParent.normativFaktor,
          availabilityRequirements: newSnapshots.get(mod.id) ?? [],
          parentPostavkaId: params.data.postavkaId,
        }).returning({ id: postavkeTable.id });
        for (const nested of mod.podIzbire) {
          const nestedPrice = round2(nested.cenaDodatek);
          await tx.insert(postavkeTable).values({
            narociloId: params.data.id,
            artikelId: null,
            modifikatorId: nested.id,
            modifierSourceArticleId: nested.sourceArtikelId,
            ime: nested.ime,
            kolicina: lockedParent.kolicina,
            cenaKos: String(nestedPrice.toFixed(2)),
            cenaKosOriginalna: String(nestedPrice.toFixed(2)),
            skupaj: String(round2(nestedPrice * Number(lockedParent.kolicina)).toFixed(2)),
            davek: mod.davek,
            jeDelMenija: lockedParent.jeDelMenija,
            opomba: null,
            gostStevilka,
            velikostPice: parentPostavka.velikostPice,
            normativFaktor: String(nested.sourceNormQuantity),
            availabilityRequirements: nested.availabilityRequirements,
            parentPostavkaId: insertedModifier!.id,
          });
        }
      }
    });
  } catch (error) {
    if (error instanceof KdsOrderAlreadyDispatchedError) {
      res.status(409).json({ error: error.message, code: error.code });
      return;
    }
    if (error instanceof Error && error.message === "REZERVACIJA_BLOKIRA_SPREMEMBE_NAROCILA") {
      res.status(409).json({ error: "Spremembe naročila so blokirane zaradi bližajoče se rezervacije.", code: error.message });
      return;
    }
    if (error instanceof InsufficientPreparedFoodAvailabilityError) {
      res.status(409).json({ error: error.message, code: error.code, ...error.details });
      return;
    }
    throw error;
  }

  await updateSkupaj(params.data.id, tenotaId);
  const narocilo = await getNarociloById(params.data.id, "", tenotaId);
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  broadcastToUnit(tenotaId, "update", { type: "narocilo", id: params.data.id });
  res.status(201).json(narocilo);
});

export default router;
