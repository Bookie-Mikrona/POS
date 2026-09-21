import { Router, type IRouter } from "express";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  artikliTable,
  db,
  multicourseMenuCoursesTable,
  multicourseMenusTable,
  qrWaiterRequestsTable,
} from "@workspace/db";

const router: IRouter = Router();

function enotaId(req: any): number {
  return Number(req.enotaId);
}

type MulticourseCourseInput = {
  courseNumber: number; courseName?: string; foodArtikelId: number; allowedFoodArtikelIds?: number[];
  allowedWineArtikelIds: number[]; wineRequired?: boolean; informational?: boolean;
};

function allowedFoodIds(course: MulticourseCourseInput): number[] {
  return [...new Set(course.allowedFoodArtikelIds?.length ? course.allowedFoodArtikelIds : [course.foodArtikelId])];
}

function validCourses(value: unknown): value is MulticourseCourseInput[] {
  return Array.isArray(value) && value.length >= 2 && value.length <= 20
    && new Set(value.map((course: any) => course?.courseNumber)).size === value.length
    && value.every((course: any) => Number.isInteger(course?.courseNumber) && course.courseNumber >= 1
      && course.courseNumber <= 20 && Number.isInteger(course.foodArtikelId) && course.foodArtikelId > 0
      && (course.courseName === undefined || (typeof course.courseName === "string" && course.courseName.trim().length > 0))
      && (course.wineRequired === undefined || typeof course.wineRequired === "boolean")
      && (course.informational === undefined || typeof course.informational === "boolean")
      && !(course.informational === true && course.wineRequired === true)
      && (course.allowedFoodArtikelIds === undefined || (Array.isArray(course.allowedFoodArtikelIds)
        && course.allowedFoodArtikelIds.length > 0
        && course.allowedFoodArtikelIds.includes(course.foodArtikelId)
        && course.allowedFoodArtikelIds.every((id: unknown) => Number.isInteger(id) && (id as number) > 0)))
      && Array.isArray(course.allowedWineArtikelIds)
      && course.allowedWineArtikelIds.every((id: unknown) => Number.isInteger(id) && (id as number) > 0))
    && value.every((course: any, index) => course.courseNumber === index + 1);
}

function selection(body: Record<string, unknown>): { mode: "fixed" | "choose"; count: number | null; izbor: "fixed_four" | "choose_three" } | null {
  const legacy = body.izbor === "fixed_four" ? { mode: "fixed" as const, count: null, izbor: "fixed_four" as const }
    : body.izbor === "choose_three" ? { mode: "choose" as const, count: 3, izbor: "choose_three" as const } : null;
  const mode = body.selectionMode ?? body.selection_mode;
  if (mode === undefined) return legacy;
  if (mode !== "fixed" && mode !== "choose") return null;
  const count = body.selectionCount ?? body.selection_count ?? (mode === "choose" ? null : null);
  if (mode === "choose" && (!Number.isInteger(count) || (count as number) < 1 || (count as number) > 20)) return null;
  return { mode, count: mode === "choose" ? count as number : null, izbor: mode === "choose" && count === 3 ? "choose_three" : "fixed_four" };
}

function foodPricePercent(body: Record<string, unknown>): number | null {
  const value = Number(body.foodPricePercent ?? body.food_price_percent ?? 100);
  return Number.isFinite(value) && value >= 0 && value <= 100
    && Math.round(value * 100) === value * 100 ? value : null;
}

function hasRequiredWine(courses: MulticourseCourseInput[]): boolean {
  return courses.some(course =>
    course.informational !== true
    && course.wineRequired !== false
    && course.allowedWineArtikelIds.length > 0);
}

async function validCourseArticles(unitId: number, courses: MulticourseCourseInput[]): Promise<boolean> {
  const foodIds = [...new Set(courses.flatMap(course => allowedFoodIds(course)))];
  const wineIds = [...new Set(courses.flatMap(course => course.allowedWineArtikelIds))];
  const ids = [...new Set([...foodIds, ...wineIds])];
  const articles = ids.length
    ? await db.select({
      id: artikliTable.id,
      prodajniArtikel: artikliTable.prodajniArtikel,
      nabavniArtikel: artikliTable.nabavniArtikel,
      mealType: artikliTable.mealType,
      taxCategory: artikliTable.taxCategory,
    }).from(artikliTable).where(and(
      eq(artikliTable.enotaId, unitId),
      inArray(artikliTable.id, ids),
    ))
    : [];
  const byId = new Map(articles.map(article => [article.id, article]));
  return ids.every(id => byId.has(id))
    && foodIds.every(id => {
      const article = byId.get(id);
      return article?.nabavniArtikel !== true
        && (article?.mealType !== "prepared" || article?.prodajniArtikel === true)
        && article?.taxCategory === "food";
    })
    && wineIds.every(id => {
      const article = byId.get(id);
      return article?.prodajniArtikel !== false && article?.taxCategory === "alcoholic";
    });
}

async function readMenus(unitId: number) {
  const menus = await db.select().from(multicourseMenusTable)
    .where(eq(multicourseMenusTable.enotaId, unitId)).orderBy(asc(multicourseMenusTable.id));
  if (!menus.length) return [];
  const courses = await db.select().from(multicourseMenuCoursesTable)
    .where(inArray(multicourseMenuCoursesTable.menuId, menus.map(menu => menu.id)))
    .orderBy(asc(multicourseMenuCoursesTable.courseNumber));
  return menus.map(menu => ({
    ...menu,
    courses: courses.filter(course => course.menuId === menu.id).map(course => ({
      courseNumber: course.courseNumber,
      courseName: course.courseName,
      foodArtikelId: course.foodArtikelId,
      allowedFoodArtikelIds: course.allowedFoodArtikelIds.length ? course.allowedFoodArtikelIds : [course.foodArtikelId],
      allowedWineArtikelIds: course.allowedWineArtikelIds,
      wineRequired: course.wineRequired,
      informational: course.informational,
    })),
  }));
}

/** Unit-scoped staff configuration for QR multicourse menus. */
router.get("/multicourse-menus", async (req, res): Promise<void> => {
  res.json(await readMenus(enotaId(req)));
});

router.post("/multicourse-menus", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown>;
  const configuredSelection = body && selection(body);
  const configuredFoodPercent = body && foodPricePercent(body);
  if (!body || !configuredSelection || !Number.isInteger(body.menuArtikelId)
    || configuredFoodPercent === null || !validCourses(body.courses)) {
    res.status(400).json({ error: "Konfiguracija večhodnega menija ni veljavna." }); return;
  }
  const courses = body.courses as MulticourseCourseInput[];
  if (body.aktivno !== false && configuredFoodPercent === 100 && hasRequiredWine(courses)) {
    res.status(400).json({ error: "Aktivni meni z obvezno vinsko spremljavo mora imeti določen delež cene vina." }); return;
  }
  if (configuredSelection.mode === "choose" && configuredSelection.count! > courses.filter(course => !course.informational).length) {
    res.status(400).json({ error: "Število izbir ne sme preseči števila običajnih hodov." }); return;
  }
  const unitId = enotaId(req);
  const [wrapper] = await db.select({ id: artikliTable.id }).from(artikliTable)
    .where(and(eq(artikliTable.enotaId, unitId), eq(artikliTable.id, body.menuArtikelId as number)));
  if (!wrapper || !(await validCourseArticles(unitId, courses))) {
    res.status(400).json({ error: "Dovoljene jedi ne smejo biti nabavne surovine ali neprodajni polizdelki; dovoljena vina morajo biti prodajni alkoholni artikli iz izbrane enote." }); return;
  }
  try {
    const created = await db.transaction(async tx => {
      const [menu] = await tx.insert(multicourseMenusTable).values({
        enotaId: unitId, menuArtikelId: body.menuArtikelId as number, izbor: configuredSelection.izbor,
        selectionMode: configuredSelection.mode, selectionCount: configuredSelection.count,
        foodPricePercent: String(configuredFoodPercent),
        aktivno: body.aktivno !== false,
      }).returning();
      await tx.insert(multicourseMenuCoursesTable).values(courses.map(course => ({
        menuId: menu!.id, courseNumber: course.courseNumber, foodArtikelId: course.foodArtikelId,
        courseName: course.courseName?.trim() || `${course.courseNumber}. hod`,
        allowedFoodArtikelIds: allowedFoodIds(course),
        allowedWineArtikelIds: [...new Set(course.allowedWineArtikelIds)],
        wineRequired: course.informational ? false : course.wineRequired !== false,
        informational: course.informational === true,
      })));
      return menu!;
    });
    res.status(201).json((await readMenus(unitId)).find(menu => menu.id === created.id));
  } catch {
    res.status(409).json({ error: "Za ta meni je konfiguracija že ustvarjena." });
  }
});

router.put("/multicourse-menus/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id); const body = req.body as Record<string, unknown>; const unitId = enotaId(req);
  const configuredSelection = body && selection(body);
  const configuredFoodPercent = body && foodPricePercent(body);
  if (!Number.isInteger(id) || !body || !configuredSelection || configuredFoodPercent === null || !validCourses(body.courses)) {
    res.status(400).json({ error: "Konfiguracija večhodnega menija ni veljavna." }); return;
  }
  const courses = body.courses as MulticourseCourseInput[];
  if (body.aktivno !== false && configuredFoodPercent === 100 && hasRequiredWine(courses)) {
    res.status(400).json({ error: "Aktivni meni z obvezno vinsko spremljavo mora imeti določen delež cene vina." }); return;
  }
  if (configuredSelection.mode === "choose" && configuredSelection.count! > courses.filter(course => !course.informational).length) {
    res.status(400).json({ error: "Število izbir ne sme preseči števila običajnih hodov." }); return;
  }
  if (!(await validCourseArticles(unitId, courses))) {
    res.status(400).json({ error: "Dovoljene jedi ne smejo biti nabavne surovine ali neprodajni polizdelki; dovoljena vina morajo biti prodajni alkoholni artikli iz izbrane enote." }); return;
  }
  const [existing] = await db.select({ id: multicourseMenusTable.id }).from(multicourseMenusTable)
    .where(and(eq(multicourseMenusTable.id, id), eq(multicourseMenusTable.enotaId, unitId)));
  if (!existing) { res.status(404).json({ error: "Meni ni najden." }); return; }
  await db.transaction(async tx => {
    await tx.update(multicourseMenusTable).set({ izbor: configuredSelection.izbor, selectionMode: configuredSelection.mode, selectionCount: configuredSelection.count, foodPricePercent: String(configuredFoodPercent), aktivno: body.aktivno !== false }).where(eq(multicourseMenusTable.id, id));
    await tx.delete(multicourseMenuCoursesTable).where(eq(multicourseMenuCoursesTable.menuId, id));
    await tx.insert(multicourseMenuCoursesTable).values(courses.map(course => ({
      menuId: id, courseNumber: course.courseNumber, foodArtikelId: course.foodArtikelId,
      courseName: course.courseName?.trim() || `${course.courseNumber}. hod`,
      allowedFoodArtikelIds: allowedFoodIds(course), allowedWineArtikelIds: [...new Set(course.allowedWineArtikelIds)],
      wineRequired: course.informational ? false : course.wineRequired !== false, informational: course.informational === true,
    })));
  });
  res.json((await readMenus(unitId)).find(menu => menu.id === id));
});

router.delete("/multicourse-menus/:id", async (req, res): Promise<void> => {
  const result = await db.delete(multicourseMenusTable).where(and(eq(multicourseMenusTable.id, Number(req.params.id)), eq(multicourseMenusTable.enotaId, enotaId(req)))).returning({ id: multicourseMenusTable.id });
  if (!result.length) { res.status(404).json({ error: "Meni ni najden." }); return; }
  res.status(204).end();
});

router.get("/qr-waiter-requests", async (req, res): Promise<void> => {
  const stanje = req.query.stanje;
  if (stanje !== undefined && !["caka", "potrjeno", "zakljuceno"].includes(String(stanje))) { res.status(400).json({ error: "Neveljavno stanje." }); return; }
  const rows = await db.select().from(qrWaiterRequestsTable).where(and(eq(qrWaiterRequestsTable.enotaId, enotaId(req)), ...(stanje ? [eq(qrWaiterRequestsTable.stanje, stanje as any)] : []))).orderBy(asc(qrWaiterRequestsTable.ustvarjeno));
  res.json(rows);
});

router.patch("/qr-waiter-requests/:id", async (req: any, res): Promise<void> => {
  const stanje = req.body?.stanje;
  if (!["potrjeno", "zakljuceno"].includes(stanje)) { res.status(400).json({ error: "Neveljavno stanje." }); return; }
  const now = new Date();
  const [updated] = await db.update(qrWaiterRequestsTable).set({
    stanje, ...(stanje === "potrjeno" ? { potrjeno: now } : { zakljuceno: now }),
    actorClerkUserId: req.clerkUserId ?? null,
  }).where(and(eq(qrWaiterRequestsTable.id, Number(req.params.id)), eq(qrWaiterRequestsTable.enotaId, enotaId(req)))).returning();
  if (!updated) { res.status(404).json({ error: "Zahtevek ni najden." }); return; }
  res.json(updated);
});

export default router;