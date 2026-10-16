import { Router, type IRouter } from "express";
import { createHmac } from "node:crypto";
import { and, asc, eq, gte, inArray, isNull, lte, ne, or, sql } from "drizzle-orm";
import {
  artikliTable,
  counterpartiesTable,
  db,
  enoteTable,
  malicaArticleAssignmentsTable,
  malicaDailyIncludedCoursesTable,
  malicaDailyMainItemsTable,
  malicaDailyOffersTable,
  malicaGroupPricesTable,
  malicaGroupsTable,
  malicaPartnerGroupPricesTable,
  malicaBeneficiariesTable,
  malicaContractsTable,
  narocilaTable,
  postavkeTable,
} from "@workspace/db";
import { currentBusinessDate } from "../../lib/prepared-food-availability";
import { beneficiaryHash, beneficiaryToken } from "../../lib/malica-beneficiary-token";
import { isAllowedGroupPriceDate, isFutureBusinessDate, remainingQuantity, requiresHigherGroupConfirmation } from "../../lib/malice-rules";
import type { PosRequest } from "../../middlewares/pos";

const router: IRouter = Router();
const dateOk = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
const id = (value: string | string[] | undefined) => Number(Array.isArray(value) ? value[0] : value);
const unit = (req: any) => (req as PosRequest).enotaId;
const dayBefore = (value: string) => { const d = new Date(`${value}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - 1); return d.toISOString().slice(0, 10); };
async function validPartner(enotaId: number, partnerId: string) {
  const [partner] = await db.select({ id: counterpartiesTable.id }).from(counterpartiesTable)
    .innerJoin(enoteTable, eq(counterpartiesTable.companyId, enoteTable.companyId))
    .where(and(eq(counterpartiesTable.id, partnerId), eq(enoteTable.id, enotaId), or(eq(counterpartiesTable.type, "customer"), eq(counterpartiesTable.type, "both")))).limit(1);
  return Boolean(partner);
}

function mapGroup(row: typeof malicaGroupsTable.$inferSelect) {
  return { id: row.id, enotaId: row.enotaId, code: row.code, name: row.name, sortOrder: row.sortOrder, active: row.active };
}
function mapPrice(row: typeof malicaGroupPricesTable.$inferSelect, currentDate?: string) {
  const status = currentDate
    ? (row.validFrom > currentDate ? "scheduled" : row.validTo && row.validTo < currentDate ? "past" : "active")
    : row.status;
  return { id: row.id, groupId: row.groupId, enotaId: row.enotaId, priceCents: row.priceCents, validFrom: row.validFrom, validTo: row.validTo, status };
}
function mapAssignment(row: typeof malicaArticleAssignmentsTable.$inferSelect) {
  return {
    id: row.id, enotaId: row.enotaId, artikelId: row.artikelId,
    ...(row.velikostPice ? { velikostPice: row.velikostPice } : {}),
    groupId: row.groupId, role: row.role, malicaPriceCents: row.malicaPriceCents,
    autoSyncPrice: row.autoSyncPrice, active: row.active,
  };
}
function mapPartnerPrice(row: typeof malicaPartnerGroupPricesTable.$inferSelect, currentDate: string) {
  const status = row.validFrom > currentDate ? "scheduled" : row.validTo && row.validTo < currentDate ? "past" : "active";
  return { ...row, status };
}
function mapOffer(row: typeof malicaDailyOffersTable.$inferSelect, mainItems: unknown[] = [], includedCourses: unknown[] = []) {
  return { id: row.id, enotaId: row.enotaId, businessDate: row.businessDate, status: row.status, version: row.version, mainItems, includedCourses };
}
function mapMainItem(row: typeof malicaDailyMainItemsTable.$inferSelect, sold = 0) {
  const configured = row.availableQuantity == null ? null : Number(row.availableQuantity);
  return {
    id: row.id, offerId: row.offerId, groupId: row.groupId, artikelId: row.artikelId,
    ...(row.velikostPice ? { velikostPice: row.velikostPice } : {}),
    position: row.position, enabled: row.enabled, articleNameSnapshot: row.articleNameSnapshot,
    priceCentsSnapshot: row.priceCentsSnapshot, availableQuantity: configured,
    remainingQuantity: remainingQuantity(configured, sold),
  };
}
function mapCourse(row: typeof malicaDailyIncludedCoursesTable.$inferSelect, sold = 0) {
  const configured = Number(row.quantity);
  return { id: row.id, offerId: row.offerId, courseType: row.courseType, artikelId: row.artikelId, articleNameSnapshot: row.articleNameSnapshot, quantity: configured, reservedQuantity: Number(row.reservedQuantity), consumedQuantity: Number(row.consumedQuantity), enabled: row.enabled, remainingQuantity: remainingQuantity(configured, sold) };
}
async function offerDetails(offer: typeof malicaDailyOffersTable.$inferSelect) {
  return (await offerDetailsBulk([offer])).get(offer.id)!;
}
async function offerDetailsBulk(offers: Array<typeof malicaDailyOffersTable.$inferSelect>) {
  const offerIds = offers.map(offer => offer.id);
  if (offerIds.length === 0) return new Map<number, ReturnType<typeof mapOffer>>();
  const [mainItems, includedCourses] = await Promise.all([
    db.select().from(malicaDailyMainItemsTable).where(inArray(malicaDailyMainItemsTable.offerId, offerIds)).orderBy(asc(malicaDailyMainItemsTable.position)),
    db.select().from(malicaDailyIncludedCoursesTable).where(inArray(malicaDailyIncludedCoursesTable.offerId, offerIds)),
  ]);
  const mainIds = mainItems.map(item => item.id);
  const courseIds = includedCourses.map(item => item.id);
  const soldRows = mainIds.length || courseIds.length
    ? await db.select({
      mainId: postavkeTable.malicaDailyMainItemId,
      courseId: postavkeTable.malicaDailyCourseId,
      sold: sql<number>`coalesce(sum(${postavkeTable.kolicina}), 0)`,
    }).from(postavkeTable).innerJoin(narocilaTable, eq(postavkeTable.narociloId, narocilaTable.id)).where(and(
      inArray(narocilaTable.enotaId, [...new Set(offers.map(offer => offer.enotaId))]),
      ne(narocilaTable.status, "preklicano"),
      or(
        ...(mainIds.length ? [inArray(postavkeTable.malicaDailyMainItemId, mainIds)] : []),
        ...(courseIds.length ? [inArray(postavkeTable.malicaDailyCourseId, courseIds)] : []),
      ),
    )).groupBy(postavkeTable.malicaDailyMainItemId, postavkeTable.malicaDailyCourseId)
    : [];
  const mainSold = new Map<number, number>();
  const courseSold = new Map<number, number>();
  for (const row of soldRows) {
    if (row.mainId != null) mainSold.set(row.mainId, Number(row.sold));
    if (row.courseId != null) courseSold.set(row.courseId, Number(row.sold));
  }
  return new Map(offers.map(offer => [
    offer.id,
    mapOffer(offer,
      mainItems.filter(item => item.offerId === offer.id).map(item => mapMainItem(item, mainSold.get(item.id) ?? 0)),
      includedCourses.filter(item => item.offerId === offer.id).map(item => mapCourse(item, courseSold.get(item.id) ?? 0))),
  ]));
}
async function effectiveGroupPrice(executor: any, enotaId: number, groupId: number, businessDate: string): Promise<number> {
  const [price] = await executor.select({ priceCents: malicaGroupPricesTable.priceCents }).from(malicaGroupPricesTable)
    .where(and(eq(malicaGroupPricesTable.enotaId, enotaId), eq(malicaGroupPricesTable.groupId, groupId), lte(malicaGroupPricesTable.validFrom, businessDate), or(sql`${malicaGroupPricesTable.validTo} IS NULL`, gte(malicaGroupPricesTable.validTo, businessDate))))
    .orderBy(sql`${malicaGroupPricesTable.validFrom} DESC`).limit(1);
  return price?.priceCents ?? 0;
}

const PIZZA_SIZES = new Set(["mala", "normalna", "druzinska"]);

async function resolveMainItem(executor: any, enotaId: number, item: any) {
  const artikelId = Number(item?.artikelId);
  const requestedSize = item?.velikostPice ?? null;
  if (!Number.isInteger(artikelId) || (requestedSize !== null && !PIZZA_SIZES.has(requestedSize))) {
    throw new Error("Glavna jed ali velikost pice ni veljavna.");
  }
  const [assignment] = await executor.select().from(malicaArticleAssignmentsTable).where(and(
    eq(malicaArticleAssignmentsTable.enotaId, enotaId),
    eq(malicaArticleAssignmentsTable.artikelId, artikelId),
    eq(malicaArticleAssignmentsTable.role, "main"),
    requestedSize === null
      ? isNull(malicaArticleAssignmentsTable.velikostPice)
      : eq(malicaArticleAssignmentsTable.velikostPice, requestedSize),
  ));
  const [article] = await executor.select({
    ime: artikliTable.ime,
    jePica: artikliTable.jePica,
  }).from(artikliTable).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!article || !assignment?.groupId
    || (article.jePica ? requestedSize === null : requestedSize !== null)
    || Number(item.groupId ?? assignment.groupId) !== assignment.groupId) {
    throw new Error("Glavna jed ni veljavno povezana s skupino ali velikostjo.");
  }
  return {
    artikelId,
    groupId: assignment.groupId,
    article,
    velikostPice: requestedSize as "mala" | "normalna" | "druzinska" | null,
  };
}

router.get("/malice/bootstrap", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const currentDate = await currentBusinessDate(enotaId);
  const [groups, assignments, prices] = await Promise.all([
    db.select().from(malicaGroupsTable).where(eq(malicaGroupsTable.enotaId, enotaId)).orderBy(asc(malicaGroupsTable.sortOrder)),
    db.select().from(malicaArticleAssignmentsTable).where(eq(malicaArticleAssignmentsTable.enotaId, enotaId)),
    db.select().from(malicaGroupPricesTable).where(eq(malicaGroupPricesTable.enotaId, enotaId))
      .orderBy(asc(malicaGroupPricesTable.validFrom)),
  ]);
  const currentByGroup = new Map<number, number>();
  for (const price of prices) {
    if (price.validFrom <= currentDate && (!price.validTo || price.validTo >= currentDate)
      && (!currentByGroup.has(price.groupId) || prices[currentByGroup.get(price.groupId)!]!.validFrom < price.validFrom)) {
      currentByGroup.set(price.groupId, prices.indexOf(price));
    }
  }
  res.json({ groups: groups.map(mapGroup), assignments: assignments.map(mapAssignment), prices: prices.map((price, index) => {
    const mapped = mapPrice(price, currentDate);
    return { ...mapped, status: mapped.status === "active" && currentByGroup.get(price.groupId) !== index ? "past" : mapped.status };
  }) });
});

router.get("/malice/articles", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const role = typeof req.query.role === "string" ? req.query.role : undefined;
  const groupId = req.query.groupId == null ? undefined : Number(req.query.groupId);
  if (role && !["none", "main", "soup", "dessert"].includes(role)) {
    res.status(400).json({ error: "Neveljavna vloga artikla." }); return;
  }
  const rows = await db.select().from(malicaArticleAssignmentsTable).where(and(
    eq(malicaArticleAssignmentsTable.enotaId, enotaId),
    ...(role ? [eq(malicaArticleAssignmentsTable.role, role as any)] : []),
    ...(groupId ? [eq(malicaArticleAssignmentsTable.groupId, groupId)] : []),
  ));
  res.json(rows.map(mapAssignment));
});

router.post("/malice/groups/:groupId/prices", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const groupId = id(req.params.groupId);
  const priceCents = Number(req.body?.priceCents);
  const validFrom = req.body?.validFrom;
  if (!Number.isInteger(groupId) || !Number.isInteger(priceCents) || priceCents < 0 || !dateOk(validFrom)) {
    res.status(400).json({ error: "Cena in datum veljavnosti nista veljavna." }); return;
  }
  const currentDate = await currentBusinessDate(enotaId);
  const result = await db.transaction(async (tx) => {
    // Serialise the first-price check for this group so concurrent requests cannot both backdate.
    const [group] = await tx.select().from(malicaGroupsTable)
      .where(and(eq(malicaGroupsTable.id, groupId), eq(malicaGroupsTable.enotaId, enotaId)))
      .for("update");
    if (!group) return { error: "Skupina ne obstaja.", status: 404 as const };
    const [existing] = await tx.select({ id: malicaGroupPricesTable.id }).from(malicaGroupPricesTable)
      .where(and(eq(malicaGroupPricesTable.groupId, groupId), eq(malicaGroupPricesTable.enotaId, enotaId))).limit(1);
    if (!isAllowedGroupPriceDate(validFrom, currentDate, Boolean(existing))) {
      return { error: "Sprememba obstoječe cene lahko začne veljati šele z naslednjim poslovnim dnem.", status: 400 as const };
    }
    const [previous] = await tx.select().from(malicaGroupPricesTable)
      .where(and(eq(malicaGroupPricesTable.groupId, groupId), eq(malicaGroupPricesTable.enotaId, enotaId), lte(malicaGroupPricesTable.validFrom, validFrom)))
      .orderBy(sql`${malicaGroupPricesTable.validFrom} DESC`).limit(1);
    if (requiresHigherGroupConfirmation(group.sortOrder, previous?.priceCents ?? null, priceCents, null)) {
      const [higher] = await tx.select({ id: malicaGroupsTable.id }).from(malicaGroupsTable)
        .where(and(eq(malicaGroupsTable.enotaId, enotaId), eq(malicaGroupsTable.sortOrder, group.sortOrder + 1)));
      const [higherPrice] = higher ? await tx.select().from(malicaGroupPricesTable)
        .where(and(eq(malicaGroupPricesTable.groupId, higher.id), eq(malicaGroupPricesTable.enotaId, enotaId), eq(malicaGroupPricesTable.validFrom, validFrom), inArray(malicaGroupPricesTable.status, ["scheduled", "active"]), sql`${malicaGroupPricesTable.confirmedAt} IS NOT NULL`))
        .limit(1) : [];
      if (!higherPrice || requiresHigherGroupConfirmation(group.sortOrder, previous?.priceCents ?? null, priceCents, higherPrice.priceCents)) return { error: "Pri zvišanju je treba najprej potrditi dražjo skupino Malice.", status: 409 as const };
    }
    const [saved] = await tx.insert(malicaGroupPricesTable).values({
      groupId, enotaId, priceCents, validFrom, status: validFrom > currentDate ? "scheduled" : "active", reason: req.body?.reason ?? null,
      createdBy: (req as unknown as PosRequest).clerkUserId ?? null,
      confirmedBy: (req as unknown as PosRequest).clerkUserId ?? null,
      confirmedAt: new Date(),
    }).returning();
    return { saved };
  });
  if ("error" in result) { res.status(result.status ?? 400).json({ error: result.error }); return; }
  res.status(201).json(mapPrice(result.saved!));
});

router.put("/malice/articles/:articleId/assignment", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const artikelId = id(req.params.articleId);
  const role = req.body?.role;
  const groupId = req.body?.groupId == null ? null : Number(req.body.groupId);
  const velikostPice = req.body?.velikostPice ?? null;
  if (!Number.isInteger(artikelId) || !["none", "main", "soup", "dessert"].includes(role)
    || (role === "main" && !Number.isInteger(groupId))
    || (role !== "main" && groupId !== null)
    || (velikostPice !== null && !PIZZA_SIZES.has(velikostPice))) {
    res.status(400).json({ error: "Vloga in skupina artikla nista veljavni." }); return;
  }
  const [article] = await db.select({
    id: artikliTable.id,
    jePica: artikliTable.jePica,
    cenaMala: artikliTable.cenaMala,
    cenaDruzinska: artikliTable.cenaDruzinska,
  }).from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  if (!article) { res.status(404).json({ error: "Artikel ne obstaja v izbrani enoti." }); return; }
  if (article.jePica !== (velikostPice !== null)
    || (velikostPice === "mala" && article.cenaMala == null)
    || (velikostPice === "druzinska" && article.cenaDruzinska == null)) {
    res.status(400).json({ error: article.jePica
      ? "Izberite velikost pice, ki ima nastavljeno ceno."
      : "Velikosti pice lahko določite samo pri artiklu, ki je pica." });
    return;
  }
  if (role === "main") {
    const [group] = await db.select({ id: malicaGroupsTable.id }).from(malicaGroupsTable).where(and(eq(malicaGroupsTable.id, groupId!), eq(malicaGroupsTable.enotaId, enotaId)));
    if (!group) { res.status(400).json({ error: "Skupina ne pripada izbrani enoti." }); return; }
  }
  let malicaPriceCents = req.body?.malicaPriceCents == null ? null : Number(req.body.malicaPriceCents);
  if (role === "main" && req.body?.autoSyncPrice !== false && malicaPriceCents === null) {
    const [currentPrice] = await db.select({ priceCents: malicaGroupPricesTable.priceCents })
      .from(malicaGroupPricesTable)
      .where(and(eq(malicaGroupPricesTable.enotaId, enotaId), eq(malicaGroupPricesTable.groupId, groupId!), lte(malicaGroupPricesTable.validFrom, await currentBusinessDate(enotaId))))
      .orderBy(sql`${malicaGroupPricesTable.validFrom} DESC`).limit(1);
    malicaPriceCents = currentPrice?.priceCents ?? null;
  }
  const assignmentValues = {
    enotaId, artikelId, velikostPice, role, groupId, autoSyncPrice: req.body?.autoSyncPrice !== false,
    malicaPriceCents,
  };
  const assignmentUpdate = {
    role, groupId, autoSyncPrice: req.body?.autoSyncPrice !== false,
    malicaPriceCents, active: true, updatedAt: new Date(),
  };
  const [saved] = velikostPice === null
    ? await db.insert(malicaArticleAssignmentsTable).values(assignmentValues).onConflictDoUpdate({
      target: [malicaArticleAssignmentsTable.enotaId, malicaArticleAssignmentsTable.artikelId],
      targetWhere: sql`${malicaArticleAssignmentsTable.velikostPice} IS NULL`,
      set: assignmentUpdate,
    }).returning()
    : await db.insert(malicaArticleAssignmentsTable).values(assignmentValues).onConflictDoUpdate({
      target: [malicaArticleAssignmentsTable.enotaId, malicaArticleAssignmentsTable.artikelId, malicaArticleAssignmentsTable.velikostPice],
      targetWhere: sql`${malicaArticleAssignmentsTable.velikostPice} IS NOT NULL`,
      set: assignmentUpdate,
    }).returning();
  await db.update(artikliTable).set({ malicaVloga: role }).where(and(eq(artikliTable.id, artikelId), eq(artikliTable.enotaId, enotaId)));
  res.json(mapAssignment(saved!));
});

router.post("/malice/offers", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const businessDate = req.body?.businessDate;
  const mainItems = Array.isArray(req.body?.mainItems) ? req.body.mainItems : [];
  const includedCourses = Array.isArray(req.body?.includedCourses) ? req.body.includedCourses : [];
  if (!dateOk(businessDate) || mainItems.length === 0) { res.status(400).json({ error: "Datum in glavne jedi so obvezni." }); return; }
  const currentDate = await currentBusinessDate(enotaId);
  if (businessDate < currentDate) { res.status(400).json({ error: "Ponudbe za pretekli poslovni dan ni mogoče ustvariti." }); return; }
  const offer = await db.transaction(async (tx) => {
    const [row] = await tx.insert(malicaDailyOffersTable).values({ enotaId, businessDate }).returning();
    for (const item of mainItems) {
      const resolved = await resolveMainItem(tx, enotaId, item);
      await tx.insert(malicaDailyMainItemsTable).values({
        offerId: row!.id, groupId: resolved.groupId, artikelId: resolved.artikelId,
        velikostPice: resolved.velikostPice,
        position: Number(item.position ?? 0), enabled: item.enabled !== false,
        articleNameSnapshot: resolved.article.ime,
        priceCentsSnapshot: await effectiveGroupPrice(tx, enotaId, resolved.groupId, businessDate),
        availableQuantity: item.availableQuantity == null ? null : String(item.availableQuantity),
      });
    }
    for (const item of includedCourses) {
      const type = item.courseType;
      if (!["soup", "dessert"].includes(type)) throw new Error("Neveljaven tip vključenega hoda.");
      const [article] = await tx.select({ ime: artikliTable.ime, malicaVloga: artikliTable.malicaVloga }).from(artikliTable).where(and(eq(artikliTable.id, Number(item.artikelId)), eq(artikliTable.enotaId, enotaId), eq(artikliTable.malicaVloga, type)));
      if (!article) throw new Error("Artikel ni dovoljen za izbrani hod.");
      await tx.insert(malicaDailyIncludedCoursesTable).values({ offerId: row!.id, courseType: type, artikelId: Number(item.artikelId), articleNameSnapshot: article.ime, quantity: String(item.quantity ?? 0), enabled: item.enabled !== false });
    }
    return row!;
  });
  res.status(201).json(await offerDetails(offer));
});

router.get("/malice/offers", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const from = dateOk(req.query.from) ? String(req.query.from) : "0001-01-01";
  const to = dateOk(req.query.to) ? String(req.query.to) : "9999-12-31";
  const rows = await db.select().from(malicaDailyOffersTable).where(and(eq(malicaDailyOffersTable.enotaId, enotaId), gte(malicaDailyOffersTable.businessDate, from), lte(malicaDailyOffersTable.businessDate, to))).orderBy(asc(malicaDailyOffersTable.businessDate));
  const details = await offerDetailsBulk(rows);
  res.json(rows.map(row => details.get(row.id)!));
});

router.put("/malice/offers/:offerId", async (req, res): Promise<void> => {
  const offerId = id(req.params.offerId);
  const [offer] = await db.select().from(malicaDailyOffersTable).where(and(eq(malicaDailyOffersTable.id, offerId), eq(malicaDailyOffersTable.enotaId, unit(req))));
  if (!offer) { res.status(404).json({ error: "Ponudba ne obstaja." }); return; }
  if (offer.status !== "draft") { res.status(409).json({ error: "Objavljene ponudbe ni mogoče spreminjati." }); return; }
  const hasMainItems = Array.isArray(req.body?.mainItems);
  const hasIncludedCourses = Array.isArray(req.body?.includedCourses);
  const mainItems = hasMainItems ? req.body.mainItems : [];
  const includedCourses = hasIncludedCourses ? req.body.includedCourses : [];
  if (hasMainItems && mainItems.length === 0) { res.status(400).json({ error: "Ponudba mora vsebovati glavno jed." }); return; }
  const saved = await db.transaction(async (tx) => {
    if (!hasMainItems && !hasIncludedCourses) return offer;
    if (hasMainItems) await tx.delete(malicaDailyMainItemsTable).where(eq(malicaDailyMainItemsTable.offerId, offerId));
    if (hasIncludedCourses) await tx.delete(malicaDailyIncludedCoursesTable).where(eq(malicaDailyIncludedCoursesTable.offerId, offerId));
    for (const item of mainItems) {
      const resolved = await resolveMainItem(tx, offer.enotaId, item);
      await tx.insert(malicaDailyMainItemsTable).values({
        offerId, groupId: resolved.groupId, artikelId: resolved.artikelId,
        velikostPice: resolved.velikostPice,
        position: Number(item.position ?? 0), enabled: item.enabled !== false,
        articleNameSnapshot: resolved.article.ime,
        priceCentsSnapshot: await effectiveGroupPrice(tx, offer.enotaId, resolved.groupId, offer.businessDate),
        availableQuantity: item.availableQuantity == null ? null : String(item.availableQuantity),
      });
    }
    for (const item of includedCourses) {
      if (!["soup", "dessert"].includes(item.courseType)) throw new Error("Neveljaven tip vključenega hoda.");
      const [article] = await tx.select({ ime: artikliTable.ime }).from(artikliTable).where(and(eq(artikliTable.id, Number(item.artikelId)), eq(artikliTable.enotaId, offer.enotaId), eq(artikliTable.malicaVloga, item.courseType)));
      if (!article) throw new Error("Artikel ni dovoljen za izbrani hod.");
      await tx.insert(malicaDailyIncludedCoursesTable).values({ offerId, courseType: item.courseType, artikelId: Number(item.artikelId), articleNameSnapshot: article.ime, quantity: String(item.quantity ?? 0), enabled: item.enabled !== false });
    }
    const [updated] = await tx.update(malicaDailyOffersTable).set({ version: offer.version + 1, updatedAt: new Date() }).where(eq(malicaDailyOffersTable.id, offerId)).returning();
    return updated!;
  });
  res.json(await offerDetails(saved));
});

router.post("/malice/offers/:offerId/publish", async (req, res): Promise<void> => {
  const offerId = id(req.params.offerId);
  let offer: typeof malicaDailyOffersTable.$inferSelect | null;
  try {
    offer = await db.transaction(async tx => {
    const [draft] = await tx.select().from(malicaDailyOffersTable).where(and(eq(malicaDailyOffersTable.id, offerId), eq(malicaDailyOffersTable.enotaId, unit(req)), eq(malicaDailyOffersTable.status, "draft"))).for("update");
    if (!draft) return null;
    const [main] = await tx.select({ id: malicaDailyMainItemsTable.id }).from(malicaDailyMainItemsTable).where(and(eq(malicaDailyMainItemsTable.offerId, offerId), eq(malicaDailyMainItemsTable.enabled, true))).limit(1);
    if (!main) throw new Error("Ponudba mora vsebovati vsaj eno omogočeno glavno jed.");
    const [published] = await tx.select({ id: malicaDailyOffersTable.id }).from(malicaDailyOffersTable).where(and(eq(malicaDailyOffersTable.enotaId, draft.enotaId), eq(malicaDailyOffersTable.businessDate, draft.businessDate), eq(malicaDailyOffersTable.status, "published"))).limit(1);
    if (published) throw new Error("Za ta poslovni dan je ponudba že objavljena.");
    const [saved] = await tx.update(malicaDailyOffersTable).set({ status: "published", publishedAt: new Date(), publishedBy: (req as unknown as PosRequest).clerkUserId ?? null, updatedAt: new Date() }).where(and(eq(malicaDailyOffersTable.id, offerId), eq(malicaDailyOffersTable.status, "draft"), eq(malicaDailyOffersTable.version, draft.version))).returning();
      return saved ?? null;
    });
  } catch (error) {
    res.status(409).json({ error: error instanceof Error ? error.message : "Ponudbe ni mogoče objaviti." }); return;
  }
  if (!offer) { res.status(404).json({ error: "Osnutek ponudbe ne obstaja." }); return; }
  res.json(await offerDetails(offer));
});

router.post("/malice/offers/:offerId/close", async (req, res): Promise<void> => {
  const offerId = id(req.params.offerId);
  const [offer] = await db.update(malicaDailyOffersTable).set({ status: "closed", updatedAt: new Date() })
    .where(and(eq(malicaDailyOffersTable.id, offerId), eq(malicaDailyOffersTable.enotaId, unit(req)), eq(malicaDailyOffersTable.status, "published"))).returning();
  if (!offer) { res.status(404).json({ error: "Objavljena ponudba ne obstaja." }); return; }
  res.json(await offerDetails(offer));
});

router.post("/malice/partners/:partnerId/group-prices", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const kupecId = Array.isArray(req.params.partnerId) ? req.params.partnerId[0] : req.params.partnerId;
  const groupId = Number(req.body?.groupId);
  const priceCents = Number(req.body?.priceCents);
  const validFrom = req.body?.validFrom;
  if (!kupecId || !Number.isInteger(groupId) || !Number.isInteger(priceCents) || priceCents < 0 || !dateOk(validFrom)) { res.status(400).json({ error: "Partnerjeva cena ni veljavna." }); return; }
  if (!await validPartner(enotaId, kupecId)) { res.status(404).json({ error: "Partner ne pripada izbrani enoti." }); return; }
  if (!isFutureBusinessDate(validFrom, await currentBusinessDate(enotaId))) { res.status(400).json({ error: "Partnerjeva cena lahko začne veljati šele z naslednjim poslovnim dnem." }); return; }
  const [group] = await db.select({ id: malicaGroupsTable.id }).from(malicaGroupsTable).where(and(eq(malicaGroupsTable.id, groupId), eq(malicaGroupsTable.enotaId, enotaId)));
  if (!group) { res.status(404).json({ error: "Skupina ne obstaja." }); return; }
  const saved = await db.transaction(async tx => {
    // The group row is the stable parent lock: it exists independently of
    // price history, so this also serializes the zero-history case.
    const [lockedGroup] = await tx.select({ id: malicaGroupsTable.id })
      .from(malicaGroupsTable)
      .where(and(eq(malicaGroupsTable.id, groupId), eq(malicaGroupsTable.enotaId, enotaId)))
      .for("update");
    if (!lockedGroup) throw new Error("Skupina ne obstaja.");
    const rows = await tx.select().from(malicaPartnerGroupPricesTable).where(and(eq(malicaPartnerGroupPricesTable.enotaId, enotaId), eq(malicaPartnerGroupPricesTable.kupecId, kupecId), eq(malicaPartnerGroupPricesTable.groupId, groupId))).orderBy(asc(malicaPartnerGroupPricesTable.validFrom)).for("update");
    const predecessor = rows.filter(row => row.validFrom < validFrom).at(-1);
    const successor = rows.find(row => row.validFrom > validFrom);
    const boundedTo = successor ? dayBefore(successor.validFrom) : (req.body?.validTo ?? null);
    if (predecessor) await tx.update(malicaPartnerGroupPricesTable).set({ validTo: dayBefore(validFrom) }).where(eq(malicaPartnerGroupPricesTable.id, predecessor.id));
    const [row] = await tx.insert(malicaPartnerGroupPricesTable).values({ enotaId, kupecId, groupId, priceCents, validFrom, validTo: boundedTo, createdBy: (req as unknown as PosRequest).clerkUserId ?? null })
      .onConflictDoUpdate({ target: [malicaPartnerGroupPricesTable.enotaId, malicaPartnerGroupPricesTable.kupecId, malicaPartnerGroupPricesTable.groupId, malicaPartnerGroupPricesTable.validFrom], set: { priceCents, validTo: boundedTo, active: true, createdBy: (req as unknown as PosRequest).clerkUserId ?? null } }).returning();
    return row!;
  });
  res.json(saved);
});

router.get("/malice/partners/:partnerId/group-prices", async (req, res): Promise<void> => {
  const enotaId = unit(req);
  const kupecId = Array.isArray(req.params.partnerId) ? req.params.partnerId[0] : req.params.partnerId;
  if (!kupecId) { res.status(400).json({ error: "Partner ni veljaven." }); return; }
  if (!await validPartner(enotaId, kupecId)) { res.status(404).json({ error: "Partner ne pripada izbrani enoti." }); return; }
  const rows = await db.select().from(malicaPartnerGroupPricesTable).where(and(
    eq(malicaPartnerGroupPricesTable.enotaId, enotaId),
    eq(malicaPartnerGroupPricesTable.kupecId, kupecId),
  )).orderBy(asc(malicaPartnerGroupPricesTable.groupId));
  const currentDate = await currentBusinessDate(enotaId);
  res.json(rows.map(row => mapPartnerPrice(row, currentDate)));
});

router.get("/malice/partners/:partnerId/contracts", async (req, res): Promise<void> => {
  const enotaId = unit(req); const partnerId = String(req.params.partnerId);
  if (!await validPartner(enotaId, partnerId)) { res.status(404).json({ error: "Partner ne pripada izbrani enoti." }); return; }
  res.json(await db.select().from(malicaContractsTable).where(and(eq(malicaContractsTable.enotaId, enotaId), eq(malicaContractsTable.partnerId, partnerId))).orderBy(asc(malicaContractsTable.validFrom)));
});
router.post("/malice/partners/:partnerId/contracts", async (req, res): Promise<void> => {
  const enotaId = unit(req); const partnerId = String(req.params.partnerId);
  if (!await validPartner(enotaId, partnerId)) { res.status(404).json({ error: "Partner ne pripada izbrani enoti." }); return; }
  const body = req.body ?? {};
  const allowed = new Set(["mode", "splitKind", "splitValue", "higherGroupSurchargeCents", "monthlyCoverageLimitCents", "validFrom", "validTo", "requiresBeneficiary"]);
  if (Object.keys(body).some(key => !allowed.has(key)) || !["partner_all", "guest_reduced_price", "partner_fixed_guest_remainder", "split"].includes(body.mode)
    || !dateOk(body.validFrom) || (body.validTo != null && !dateOk(body.validTo))
    || (body.mode === "partner_fixed_guest_remainder" && (!Number.isInteger(body.splitValue) || body.splitValue <= 0))
    || (body.mode === "split" && !["fixed", "percent"].includes(body.splitKind))
    || (body.mode !== "split" && body.splitKind != null)) {
    res.status(400).json({ error: "Pogodba ni veljavna." }); return;
  }
  const contract = await db.transaction(async tx => {
    const [lock] = await tx.select({ id: malicaGroupsTable.id }).from(malicaGroupsTable).where(eq(malicaGroupsTable.enotaId, enotaId)).limit(1).for("update");
    if (!lock) throw new Error("Enota nima stabilne zaklepne vrstice.");
    const [latest] = await tx.select({ version: malicaContractsTable.version }).from(malicaContractsTable).where(and(eq(malicaContractsTable.enotaId, enotaId), eq(malicaContractsTable.partnerId, partnerId))).orderBy(sql`${malicaContractsTable.version} DESC`).limit(1);
    const version = (latest?.version ?? 0) + 1;
    const overlap = await tx.select({ id: malicaContractsTable.id }).from(malicaContractsTable).where(and(
      eq(malicaContractsTable.enotaId, enotaId), eq(malicaContractsTable.partnerId, partnerId),
      lte(malicaContractsTable.validFrom, body.validTo ?? "9999-12-31"),
      or(isNull(malicaContractsTable.validTo), gte(malicaContractsTable.validTo, body.validFrom)),
    )).limit(1);
    if (overlap.length) throw new Error("Obdobje pogodbe se prekriva z obstoječo pogodbo.");
    const [row] = await tx.insert(malicaContractsTable).values({
      enotaId, partnerId, version, mode: body.mode,
      splitKind: body.splitKind ?? null, splitValue: Number(body.splitValue ?? 0),
      higherGroupSurchargeCents: Number(body.higherGroupSurchargeCents ?? 0),
      monthlyCoverageLimitCents: body.monthlyCoverageLimitCents == null ? null : Number(body.monthlyCoverageLimitCents),
      validFrom: body.validFrom, validTo: body.validTo ?? null, requiresBeneficiary: body.requiresBeneficiary === true,
      createdBy: (req as unknown as PosRequest).clerkUserId ?? null,
    }).returning();
    return row;
  });
  res.status(201).json(contract);
});
router.get("/malice/beneficiaries", async (req, res): Promise<void> => {
  const rows = await db.select({ id: malicaBeneficiariesTable.id, partnerId: malicaBeneficiariesTable.partnerId, identifierType: malicaBeneficiariesTable.identifierType, maskedSuffix: malicaBeneficiariesTable.maskedSuffix, dailyLimit: malicaBeneficiariesTable.dailyLimit, monthlyCoverageOverrideCents: malicaBeneficiariesTable.monthlyCoverageOverrideCents, active: malicaBeneficiariesTable.active }).from(malicaBeneficiariesTable).where(eq(malicaBeneficiariesTable.enotaId, unit(req)));
  res.json(rows);
});
router.post("/malice/beneficiaries", async (req, res): Promise<void> => {
  const enotaId = unit(req); const body = req.body ?? {};
  if (!body.partnerId || !body.identifierType || typeof body.identifier !== "string") { res.status(400).json({ error: "Podatki upravičenca niso veljavni." }); return; }
  if (!await validPartner(enotaId, body.partnerId)) { res.status(404).json({ error: "Partner ne pripada izbrani enoti." }); return; }
  const suffix = body.identifier.length >= 4 ? body.identifier.slice(-4) : undefined;
  const [row] = await db.insert(malicaBeneficiariesTable).values({ enotaId, partnerId: body.partnerId, identifierType: body.identifierType, identifierHash: beneficiaryHash(enotaId, body.partnerId, body.identifierType, body.identifier), maskedSuffix: suffix, dailyLimit: body.dailyLimit ?? null, monthlyCoverageOverrideCents: body.monthlyCoverageOverrideCents ?? null }).returning({ id: malicaBeneficiariesTable.id });
  res.status(201).json(row);
});
router.post("/malice/beneficiaries/resolve", async (req, res): Promise<void> => {
  const body = req.body ?? {};
  if (!body.partnerId || !body.identifierType || typeof body.identifier !== "string") { res.status(400).json({ error: "Identifikator ni veljaven." }); return; }
  const enotaId = unit(req);
  const [row] = await db.select({ id: malicaBeneficiariesTable.id, partnerId: malicaBeneficiariesTable.partnerId, identifierType: malicaBeneficiariesTable.identifierType, maskedSuffix: malicaBeneficiariesTable.maskedSuffix }).from(malicaBeneficiariesTable).where(and(eq(malicaBeneficiariesTable.enotaId, enotaId), eq(malicaBeneficiariesTable.partnerId, body.partnerId), eq(malicaBeneficiariesTable.identifierType, body.identifierType), eq(malicaBeneficiariesTable.identifierHash, beneficiaryHash(enotaId, body.partnerId, body.identifierType, body.identifier)), eq(malicaBeneficiariesTable.active, true)));
  if (!row) { res.status(404).json({ error: "Upravičenec ni najden." }); return; }
  res.json({ ...row, beneficiaryToken: beneficiaryToken(enotaId, row.partnerId, row.id, Math.floor(Date.now() / 1000) + 300) });
});

router.patch("/malice/beneficiaries/:beneficiaryId", async (req, res): Promise<void> => {
  const enotaId = unit(req); const beneficiaryId = Number(req.params.beneficiaryId);
  const [existing] = await db.select().from(malicaBeneficiariesTable).where(and(eq(malicaBeneficiariesTable.id, beneficiaryId), eq(malicaBeneficiariesTable.enotaId, enotaId)));
  if (!existing) { res.status(404).json({ error: "Upravičenec ni najden." }); return; }
  const allowed = ["dailyLimit", "monthlyCoverageOverrideCents", "active"];
  if (Object.keys(req.body ?? {}).some(key => !allowed.includes(key))) { res.status(400).json({ error: "Neveljavna polja upravičenca." }); return; }
  const [row] = await db.update(malicaBeneficiariesTable).set({
    dailyLimit: req.body.dailyLimit === undefined ? existing.dailyLimit : req.body.dailyLimit,
    monthlyCoverageOverrideCents: req.body.monthlyCoverageOverrideCents === undefined ? existing.monthlyCoverageOverrideCents : req.body.monthlyCoverageOverrideCents,
    active: req.body.active === undefined ? existing.active : Boolean(req.body.active),
  }).where(eq(malicaBeneficiariesTable.id, beneficiaryId)).returning({ id: malicaBeneficiariesTable.id, partnerId: malicaBeneficiariesTable.partnerId, active: malicaBeneficiariesTable.active, dailyLimit: malicaBeneficiariesTable.dailyLimit, monthlyCoverageOverrideCents: malicaBeneficiariesTable.monthlyCoverageOverrideCents });
  res.json(row);
});

router.post("/malice/beneficiaries/:beneficiaryId/identifiers", async (req, res): Promise<void> => {
  const enotaId = unit(req); const beneficiaryId = Number(req.params.beneficiaryId);
  const [owner] = await db.select({ partnerId: malicaBeneficiariesTable.partnerId }).from(malicaBeneficiariesTable).where(and(eq(malicaBeneficiariesTable.id, beneficiaryId), eq(malicaBeneficiariesTable.enotaId, enotaId), eq(malicaBeneficiariesTable.active, true)));
  if (!owner || !req.body?.identifierType || typeof req.body.identifier !== "string") { res.status(400).json({ error: "Identifikator ni veljaven." }); return; }
  const hash = beneficiaryHash(enotaId, owner.partnerId, req.body.identifierType, req.body.identifier);
  try {
    const [row] = await db.update(malicaBeneficiariesTable).set({ identifierType: req.body.identifierType, identifierHash: hash, maskedSuffix: req.body.identifier.slice(-4) }).where(eq(malicaBeneficiariesTable.id, beneficiaryId)).returning({ id: malicaBeneficiariesTable.id, partnerId: malicaBeneficiariesTable.partnerId, identifierType: malicaBeneficiariesTable.identifierType, maskedSuffix: malicaBeneficiariesTable.maskedSuffix, active: malicaBeneficiariesTable.active });
    res.json(row);
  } catch (error: any) {
    if (error?.code === "23505") { res.status(409).json({ error: "Identifikator je že v uporabi." }); return; }
    throw error;
  }
});

router.delete("/malice/beneficiaries/:beneficiaryId/identifiers", async (req, res): Promise<void> => {
  const enotaId = unit(req); const beneficiaryId = Number(req.params.beneficiaryId);
  const [row] = await db.update(malicaBeneficiariesTable).set({ active: false }).where(and(eq(malicaBeneficiariesTable.id, beneficiaryId), eq(malicaBeneficiariesTable.enotaId, enotaId))).returning({ id: malicaBeneficiariesTable.id, partnerId: malicaBeneficiariesTable.partnerId, identifierType: malicaBeneficiariesTable.identifierType, maskedSuffix: malicaBeneficiariesTable.maskedSuffix, active: malicaBeneficiariesTable.active });
  if (!row) { res.status(404).json({ error: "Upravičenec ni najden." }); return; }
  res.json(row);
});

router.post("/malice/partners/:partnerId/contracts/:contractId/close", async (req, res): Promise<void> => {
  const enotaId = unit(req); const partnerId = String(req.params.partnerId); const contractId = Number(req.params.contractId);
  const closeDate = req.body?.validTo;
  if (!dateOk(closeDate)) { res.status(400).json({ error: "Datum zaključka ni veljaven." }); return; }
  const result = await db.transaction(async tx => {
    const [group] = await tx.select({ id: malicaGroupsTable.id }).from(malicaGroupsTable).where(eq(malicaGroupsTable.enotaId, enotaId)).limit(1).for("update");
    if (!group) throw new Error("Enota nima zaklepne vrstice.");
    const [row] = await tx.update(malicaContractsTable).set({ validTo: closeDate, active: false }).where(and(eq(malicaContractsTable.id, contractId), eq(malicaContractsTable.enotaId, enotaId), eq(malicaContractsTable.partnerId, partnerId), or(isNull(malicaContractsTable.validTo), gte(malicaContractsTable.validTo, closeDate)))).returning();
    return row;
  });
  if (!result) { res.status(404).json({ error: "Pogodba ni najdena ali je že zaključena." }); return; }
  res.json(result);
});

export default router;