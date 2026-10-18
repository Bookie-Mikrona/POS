import { Router, type IRouter } from "express";
import crypto from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  artModSkupineTable, artikliTable, dailyLunchOfferChoicesTable, dailyLunchOffersTable, dailyLunchSaleSnapshotsTable,
  db, modSkupineTable, modifikatorjiTable, narocilaTable, postavkeTable,
} from "@workspace/db";
import {
  assertPreparedFoodAvailability, buildModifierAvailabilityRequests, currentBusinessDate,
  loadModifierAvailabilitySnapshots, lockPreparedFoodAvailability,
} from "../../lib/prepared-food-availability";
import { assertOpenOrderCanChange } from "../../lib/rezervacijeMiz";
import { assertKdsOrderNotDispatched, lockKdsOrder } from "../../lib/kds-dispatch";
import { materializirajKdsNaloge } from "./kds";
import { updateSkupaj } from "./narocila";

const router: IRouter = Router();
const roles = ["starter", "soup", "main", "dessert"] as const;
type Role = typeof roles[number];
type Mode = "three_course" | "four_course";
const unit = (req: { enotaId?: number } | any) => Number(req.enotaId);

export function resolveDailyLunchTotal(mode: Mode, mainLivePrice: number, baseFlatAmount: number, starterFlatAmount: number) {
  if (![mainLivePrice, baseFlatAmount, starterFlatAmount].every(Number.isFinite) ||
      [mainLivePrice, baseFlatAmount, starterFlatAmount].some((v) => v < 0)) {
    throw new Error("Zneski morajo biti končni nenegativni zneski.");
  }
  return mainLivePrice + baseFlatAmount + (mode === "four_course" ? starterFlatAmount : 0);
}

async function readOffer(id: number, enotaId: number) {
  const [offer] = await db.select().from(dailyLunchOffersTable)
    .where(and(eq(dailyLunchOffersTable.id, id), eq(dailyLunchOffersTable.enotaId, enotaId)));
  if (!offer) return null;
  const choices = await db.select().from(dailyLunchOfferChoicesTable)
    .where(eq(dailyLunchOfferChoicesTable.offerId, id))
    .orderBy(asc(dailyLunchOfferChoicesTable.sortOrder));
  return { ...offer, choices };
}

function validChoices(value: unknown): value is Array<{ role: Role; artikelId: number }> {
  return Array.isArray(value) && value.length > 0 && value.every((choice) =>
    !!choice && roles.includes(choice.role) && Number.isInteger(choice.artikelId),
  );
}

async function choicesBelongToUnit(enotaId: number, choices: Array<{ role: Role; artikelId: number }>) {
  const ids = [...new Set(choices.map((choice) => choice.artikelId))];
  const rows = await db.select().from(artikliTable).where(and(
    eq(artikliTable.enotaId, enotaId), inArray(artikliTable.id, ids),
  ));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.length > 0 && ids.every((id) => {
    const article = byId.get(id);
    return !!article && article.aktiven && article.prodajniArtikel && !article.nabavniArtikel &&
      article.taxCategory === "food";
  });
}

type LunchModifier = { id: number; ime: string; cenaDodatek: number };

/** Validates the chosen modifiers of every course against the dish's own modifier groups. */
async function resolveLunchModifiers(
  exec: typeof db, enotaId: number, selected: Partial<Record<Role, number>>,
  required: readonly Role[], raw: unknown,
): Promise<Map<Role, LunchModifier[]>> {
  const body = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const result = new Map<Role, LunchModifier[]>();
  for (const role of required) {
    const ids = body[role];
    if (ids !== undefined && (!Array.isArray(ids) || !ids.every((id) => Number.isInteger(id)))) {
      throw new Error("Neveljaven seznam izbranih modifikatorjev.");
    }
    const chosenIds = [...new Set((ids as number[] | undefined) ?? [])];
    const groups = await exec.select({
      skupinaId: artModSkupineTable.skupinaId, obvezna: modSkupineTable.obvezna,
      minIzbir: modSkupineTable.minIzbir, maxIzbir: modSkupineTable.maxIzbir,
    }).from(artModSkupineTable)
      .innerJoin(modSkupineTable, eq(artModSkupineTable.skupinaId, modSkupineTable.id))
      .where(and(eq(artModSkupineTable.artikelId, selected[role]!), eq(modSkupineTable.enotaId, enotaId)));
    const mods = groups.length
      ? await exec.select().from(modifikatorjiTable).where(and(
        inArray(modifikatorjiTable.skupinaId, groups.map((group) => group.skupinaId)),
        eq(modifikatorjiTable.aktiven, true)))
      : [];
    const byId = new Map(mods.map((mod) => [mod.id, mod]));
    const chosen = chosenIds.map((id) => {
      const mod = byId.get(id);
      if (!mod) throw new Error(`Modifikator ${id} ni veljaven za izbrano jed.`);
      return mod;
    });
    for (const group of groups) {
      const count = chosen.filter((mod) => mod.skupinaId === group.skupinaId).length;
      const min = group.obvezna ? Math.max(1, group.minIzbir) : group.minIzbir;
      if (count < min) throw new Error("Izberite vse obvezne modifikatorje (npr. meso, prilogo, solato) za vsako jed.");
      if (group.maxIzbir > 0 && count > group.maxIzbir) throw new Error("Izbrali ste preveč modifikatorjev v skupini.");
    }
    result.set(role, chosen.map((mod) => ({ id: mod.id, ime: mod.ime, cenaDodatek: Number(mod.cenaDodatek) })));
  }
  return result;
}

router.get("/daily-lunch-offers", async (req, res): Promise<void> => {
  const offers = await db.select().from(dailyLunchOffersTable)
    .where(eq(dailyLunchOffersTable.enotaId, unit(req)))
    .orderBy(asc(dailyLunchOffersTable.businessDate), asc(dailyLunchOffersTable.id));
  const choices = offers.length ? await db.select().from(dailyLunchOfferChoicesTable)
    .where(inArray(dailyLunchOfferChoicesTable.offerId, offers.map((offer) => offer.id)))
    .orderBy(asc(dailyLunchOfferChoicesTable.sortOrder)) : [];
  res.json({ offers: offers.map((offer) => ({
    ...offer, choices: choices.filter((choice) => choice.offerId === offer.id),
  })) });
});

router.post("/daily-lunch-offers", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  const choices = body.choices;
  if (typeof body.businessDate !== "string" || !validChoices(choices)) {
    res.status(400).json({ error: "Poslovni datum in izbire so obvezni." }); return;
  }
  const required = roles.filter((role) => role !== "starter");
  if (!required.every((role) => choices.some((choice) => choice.role === role)) ||
      new Set(choices.map((choice) => `${choice.role}:${choice.artikelId}`)).size !== choices.length ||
      !(await choicesBelongToUnit(unit(req), choices))) {
    res.status(400).json({ error: "Ponudba mora vsebovati veljavne jedi, juho, glavno jed in sladico." }); return;
  }
  const base = Number(body.baseFlatAmount ?? 8);
  const starter = Number(body.starterFlatAmount ?? 10);
  if (!Number.isFinite(base) || base < 0 || !Number.isFinite(starter) || starter < 0) {
    res.status(400).json({ error: "Ceni morata biti nenegativni števili." }); return;
  }
  try {
    const offer = await db.transaction(async (tx) => {
      const [created] = await tx.insert(dailyLunchOffersTable).values({
        enotaId: unit(req), businessDate: body.businessDate,
        baseFlatAmount: base.toFixed(2), starterFlatAmount: starter.toFixed(2),
      }).returning();
      await tx.insert(dailyLunchOfferChoicesTable).values(choices.map((choice, index) => ({
        offerId: created.id, role: choice.role, artikelId: choice.artikelId, sortOrder: index,
      })));
      return created;
    });
    res.status(201).json({ offer: await readOffer(offer.id, unit(req)) });
  } catch {
    res.status(409).json({ error: "Ponudba za ta datum že obstaja." });
  }
});

router.put("/daily-lunch-offers/:offerId", async (req, res): Promise<void> => {
  const id = Number(req.params.offerId);
  const [existing] = await db.select().from(dailyLunchOffersTable).where(and(
    eq(dailyLunchOffersTable.id, id), eq(dailyLunchOffersTable.enotaId, unit(req)),
  ));
  const choices = req.body?.choices;
  if (!existing) { res.status(404).json({ error: "Ponudba kosila ne obstaja." }); return; }
  if (existing.status !== "draft") { res.status(409).json({ error: "Objavljene ponudbe ni mogoče spreminjati." }); return; }
  if (!validChoices(choices) || !roles.filter((role) => role !== "starter").every((role) => choices.some((choice) => choice.role === role)) ||
      !(await choicesBelongToUnit(unit(req), choices))) {
    res.status(400).json({ error: "Izbire jedi niso veljavne." }); return;
  }
  const base = Number(req.body?.baseFlatAmount ?? existing.baseFlatAmount);
  const starter = Number(req.body?.starterFlatAmount ?? existing.starterFlatAmount);
  const updated = await db.transaction(async (tx) => {
    const [row] = await tx.update(dailyLunchOffersTable).set({
      baseFlatAmount: base.toFixed(2), starterFlatAmount: starter.toFixed(2),
    }).where(eq(dailyLunchOffersTable.id, id)).returning();
    await tx.delete(dailyLunchOfferChoicesTable).where(eq(dailyLunchOfferChoicesTable.offerId, id));
    await tx.insert(dailyLunchOfferChoicesTable).values(choices.map((choice, index) => ({
      offerId: id, role: choice.role, artikelId: choice.artikelId, sortOrder: index,
    })));
    return row;
  });
  res.json({ offer: await readOffer(updated.id, unit(req)) });
});

async function changeOffer(req: { params: { offerId: string }; enotaId?: number }, res: { status: (code: number) => { json: (value: unknown) => void }; json: (value: unknown) => void }, nextStatus: "published" | "closed") {
  const id = Number(req.params.offerId);
  const [offer] = await db.select().from(dailyLunchOffersTable).where(and(eq(dailyLunchOffersTable.id, id), eq(dailyLunchOffersTable.enotaId, unit(req))));
  if (!offer) { res.status(404).json({ error: "Ponudba ne obstaja." }); return; }
  if (nextStatus === "published" && offer.status !== "draft" || nextStatus === "closed" && offer.status !== "published") {
    res.status(409).json({ error: "Prehod statusa ponudbe ni dovoljen." }); return;
  }
  const [updated] = await db.update(dailyLunchOffersTable).set({ status: nextStatus }).where(eq(dailyLunchOffersTable.id, id)).returning();
  res.json({ offer: await readOffer(updated.id, unit(req)) });
}
router.post("/daily-lunch-offers/:offerId/publish", (req, res) => { void changeOffer(req, res, "published"); });
router.post("/daily-lunch-offers/:offerId/close", (req, res) => { void changeOffer(req, res, "closed"); });

router.post("/daily-lunch-offers/:offerId/quote", async (req, res): Promise<void> => {
  const offer = await readOffer(Number(req.params.offerId), unit(req));
  const mode = req.body?.mode as Mode;
  const selected = req.body?.selectedDishes as Partial<Record<Role, number>> | undefined;
  if (!offer || offer.status !== "published") { res.status(404).json({ error: "Objavljena ponudba ne obstaja." }); return; }
  if (offer.businessDate !== await currentBusinessDate(unit(req))) { res.status(409).json({ error: "Ponudba ni za današnji poslovni datum." }); return; }
  const required = mode === "four_course" ? roles : mode === "three_course" ? roles.filter((role) => role !== "starter") : [];
  if (!required.length || !selected || !required.every((role) => Number.isInteger(selected[role]))) {
    res.status(400).json({ error: "Izberite jed za vsak obvezni hod." }); return;
  }
  if (required.some((role) => !offer.choices.some((choice) => choice.role === role && choice.artikelId === selected[role]))) {
    res.status(400).json({ error: "Izbrana jed ni v dnevni ponudbi." }); return;
  }
  const rows = await db.select().from(artikliTable).where(inArray(artikliTable.id, required.map((role) => selected[role]!)));
  const main = rows.find((row) => row.id === selected.main);
  if (!main) { res.status(409).json({ error: "Glavna jed ni več na voljo." }); return; }
  let modifiers: Map<Role, LunchModifier[]>;
  try { modifiers = await resolveLunchModifiers(db, unit(req), selected, required, req.body?.modifiers); }
  catch (error) { res.status(400).json({ error: error instanceof Error ? error.message : "Neveljavni modifikatorji." }); return; }
  const modifiersTotal = [...modifiers.values()].flat().reduce((sum, mod) => sum + mod.cenaDodatek, 0);
  const total = resolveDailyLunchTotal(mode, Number(main.cena), Number(offer.baseFlatAmount), Number(offer.starterFlatAmount)) + modifiersTotal;
  res.json({ offerId: offer.id, businessDate: offer.businessDate, mode, selectedDishes: selected,
    mainLivePrice: main.cena, baseFlatAmount: offer.baseFlatAmount,
    starterFlatAmount: mode === "four_course" ? offer.starterFlatAmount : "0.00",
    modifiersTotal: modifiersTotal.toFixed(2), total: total.toFixed(2) });
});

router.post("/narocila/:id/daily-lunch", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const orderId = Number(req.params.id);
  const offerId = Number(req.body?.offerId);
  const mode = req.body?.mode as Mode;
  const selected = req.body?.selectedDishes as Partial<Record<Role, number>> | undefined;
  const idempotencyKey = typeof req.body?.idempotencyKey === "string" ? req.body.idempotencyKey : "";
  const required = mode === "four_course" ? roles : mode === "three_course" ? roles.filter((role) => role !== "starter") : [];
  if (!Number.isInteger(orderId) || orderId < 1 || !Number.isInteger(offerId) || offerId < 1 ||
      !required.length || !selected || !idempotencyKey || !required.every((role) => Number.isInteger(selected[role]))) {
    res.status(400).json({ error: "Ponudba, izbrane jedi in ključ ponovljivosti so obvezni." }); return;
  }
  let duplicate = false;
  try {
    await db.transaction(async (tx) => {
      await lockKdsOrder(tx, orderId);
      await assertKdsOrderNotDispatched(tx, orderId, enotaId);
      await assertOpenOrderCanChange(tx, orderId, enotaId);
      const [existing] = await tx.select({ id: postavkeTable.id }).from(postavkeTable).where(and(
        eq(postavkeTable.narociloId, orderId), eq(postavkeTable.idempotencyKey, idempotencyKey),
      )).limit(1);
      if (existing) { duplicate = true; return; }
      const [order] = await tx.select().from(narocilaTable).where(and(
        eq(narocilaTable.id, orderId), eq(narocilaTable.enotaId, enotaId),
      )).for("update");
      if (!order || order.status !== "odprto") throw new Error("Naročilo ni odprto.");
      const [offer] = await tx.select().from(dailyLunchOffersTable).where(and(
        eq(dailyLunchOffersTable.id, offerId), eq(dailyLunchOffersTable.enotaId, enotaId),
        eq(dailyLunchOffersTable.businessDate, await currentBusinessDate(enotaId)),
        eq(dailyLunchOffersTable.status, "published"),
      )).for("update");
      if (!offer) throw new Error("Objavljena ponudba kosila ne obstaja.");
      const choices = await tx.select().from(dailyLunchOfferChoicesTable).where(eq(dailyLunchOfferChoicesTable.offerId, offer.id));
      if (required.some((role) => !choices.some((choice) => choice.role === role && choice.artikelId === selected[role]))) {
        throw new Error("Izbrana jed ni v ponudbi.");
      }
      await lockPreparedFoodAvailability(tx, enotaId, offer.businessDate);
      const ids = required.map((role) => selected[role]!);
      const articles = await tx.select().from(artikliTable).where(and(
        eq(artikliTable.enotaId, enotaId), inArray(artikliTable.id, ids),
      )).for("update");
      const byId = new Map(articles.map((article) => [article.id, article]));
      if (articles.length !== new Set(ids).size || articles.some((article) =>
        !article.aktiven || !article.prodajniArtikel || article.nabavniArtikel || article.taxCategory !== "food")) {
        throw new Error("Izbrana jed ni več prodajna hrana.");
      }
      const lunchModifiers = await resolveLunchModifiers(tx as unknown as typeof db, enotaId, selected, required, req.body?.modifiers);
      const modifierIds = [...lunchModifiers.values()].flat().map((mod) => mod.id);
      const modifierSnapshots = modifierIds.length > 0 ? await loadModifierAvailabilitySnapshots(tx, modifierIds) : new Map();
      await assertPreparedFoodAvailability(tx, enotaId, offer.businessDate, [
        ...[...new Set(ids)].map((articleId) => ({ articleId, quantity: ids.filter((id) => id === articleId).length })),
        ...buildModifierAvailabilityRequests(modifierSnapshots, modifierIds, 1),
      ]);
      const insertModifiers = async (role: Role, parentId: number, article: typeof artikliTable.$inferSelect) => {
        for (const mod of lunchModifiers.get(role) ?? []) {
          const price = mod.cenaDodatek.toFixed(2);
          await tx.insert(postavkeTable).values({
            narociloId: orderId, artikelId: null, modifikatorId: mod.id, ime: mod.ime, kolicina: 1,
            cenaKos: price, cenaKosOriginalna: price, skupaj: price, davek: String(article.davek),
            jeDelMenija: true, vrstaArtikla: article.vrstaArtikla,
            availabilityRequirements: modifierSnapshots.get(mod.id) ?? [], parentPostavkaId: parentId,
          });
        }
      };
      const main = byId.get(selected.main!);
      if (!main) throw new Error("Glavna jed ni veljavna.");
      const total = resolveDailyLunchTotal(mode, Number(main.cena), Number(offer.baseFlatAmount), Number(offer.starterFlatAmount));
      const pairingGroupId = `daily-lunch:${orderId}:${crypto.randomUUID()}`;
      const orderedRoles: Role[] = mode === "four_course" ? ["starter", "soup", "dessert"] : ["soup", "dessert"];
      const [anchor] = await tx.insert(postavkeTable).values({
        narociloId: orderId, artikelId: main.id, ime: main.ime, kolicina: 1,
        cenaKos: total.toFixed(2), cenaKosOriginalna: total.toFixed(2), skupaj: total.toFixed(2),
        davek: String(main.davek), mealType: main.mealType, vrstaArtikla: main.vrstaArtikla,
        jeDelMenija: true, pairingGroupId, idempotencyKey,
        courseNumber: mode === "four_course" ? 3 : 2, courseSequence: mode === "four_course" ? 3 : 2,
        courseNameSnapshot: "main", availabilityRequirements: [{ articleId: main.id, quantity: 1, mealType: main.mealType }],
      }).returning({ id: postavkeTable.id });
      await insertModifiers("main", anchor.id, main);
      await tx.insert(dailyLunchSaleSnapshotsTable).values({
        postavkaId: anchor.id, narociloId: orderId, offerId: offer.id, businessDate: offer.businessDate, mode,
        selectedDishes: selected, mainLivePrice: main.cena, baseFlatAmount: offer.baseFlatAmount,
        starterFlatAmount: mode === "four_course" ? offer.starterFlatAmount : "0.00",
        total: total.toFixed(2), vatRequirements: required.map((role) => ({ role, articleId: selected[role]!, vatRate: byId.get(selected[role]!)!.davek })),
        availabilityRequirements: required.map((role) => ({ articleId: selected[role]!, quantity: 1, mealType: byId.get(selected[role]!)!.mealType })),
        pairingGroupId,
      });
      for (const role of orderedRoles) {
        const article = byId.get(selected[role]!);
        if (!article) throw new Error("Izbrana jed ne obstaja.");
        const courseNumber = role === "starter" ? 1 : role === "soup" ? (mode === "four_course" ? 2 : 1) : (mode === "four_course" ? 4 : 3);
        const [courseRow] = await tx.insert(postavkeTable).values({
          narociloId: orderId, artikelId: article.id, ime: article.ime, kolicina: 1,
          cenaKos: "0.00", cenaKosOriginalna: "0.00", skupaj: "0.00", davek: String(article.davek),
          mealType: article.mealType, vrstaArtikla: article.vrstaArtikla, jeDelMenija: true, pairingGroupId,
          courseNumber, courseSequence: courseNumber, courseNameSnapshot: role,
          availabilityRequirements: [{ articleId: article.id, quantity: 1, mealType: article.mealType }],
        }).returning({ id: postavkeTable.id });
        await insertModifiers(role, courseRow.id, article);
      }
      await updateSkupaj(orderId, enotaId, tx);
      await materializirajKdsNaloge(orderId, enotaId, tx);
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Kosila ni mogoče dodati." }); return;
  }
  res.status(duplicate ? 200 : 201).json({ orderId, idempotencyKey, duplicate });
});

export default router;