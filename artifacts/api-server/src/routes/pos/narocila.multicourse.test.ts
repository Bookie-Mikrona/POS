import express from "express";
import supertest from "supertest";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNotNull } from "drizzle-orm";
import {
  artikliTable,
  companiesTable,
  db,
  enoteTable,
  multicourseMenuCoursesTable,
  multicourseMenusTable,
  narocilaTable,
  pool,
  postavkeTable,
} from "@workspace/db";

vi.mock("./kds", () => ({
  materializirajKdsNaloge: vi.fn().mockResolvedValue(undefined),
}));

import narocilaRouter, { resolveMulticourseSelections } from "./narocila";

const configuration = {
  izbor: "fixed_four" as const,
  courses: [
    { courseNumber: 1, foodArtikelId: 11, allowedFoodArtikelIds: [11, 21], allowedWineArtikelIds: [101] },
    { courseNumber: 2, foodArtikelId: 12, allowedFoodArtikelIds: [12], allowedWineArtikelIds: [102] },
    { courseNumber: 3, foodArtikelId: 13, allowedFoodArtikelIds: [13], allowedWineArtikelIds: [103] },
    { courseNumber: 4, foodArtikelId: 14, allowedFoodArtikelIds: [14], allowedWineArtikelIds: [104] },
  ],
};

describe("resolveMulticourseSelections", () => {
  it("server-materializes every configured fixed-four course in request order", () => {
    expect(resolveMulticourseSelections(configuration, [
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103 },
      { courseNumber: 1, foodArtikelId: 21, wineArtikelId: 101 },
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
    ])).toEqual([
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103, courseSequence: 1 },
      { courseNumber: 1, foodArtikelId: 21, wineArtikelId: 101, courseSequence: 2 },
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104, courseSequence: 3 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102, courseSequence: 4 },
    ]);
  });

  it("rejects missing food, food outside the server allowlist, a missing course, or wine outside the server allowlist", () => {
    expect(resolveMulticourseSelections(configuration, [
      { courseNumber: 1, foodArtikelId: 11, wineArtikelId: 101 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103 },
    ])).toBeNull();
    expect(resolveMulticourseSelections(configuration, [
      { courseNumber: 1, foodArtikelId: 999, wineArtikelId: 101 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103 },
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104 },
    ])).toBeNull();
    expect(resolveMulticourseSelections(configuration, [
      { courseNumber: 1, wineArtikelId: 101 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103 },
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104 },
    ] as any)).toBeNull();
    expect(resolveMulticourseSelections(configuration, [
      { courseNumber: 1, foodArtikelId: 11, wineArtikelId: 999 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 3, foodArtikelId: 13, wineArtikelId: 103 },
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104 },
    ])).toBeNull();
  });

  it("allows exactly three distinct configured courses for choose-three", () => {
    expect(resolveMulticourseSelections({ ...configuration, izbor: "choose_three" }, [
      { courseNumber: 4, foodArtikelId: 14, wineArtikelId: 104 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 1, foodArtikelId: 11, wineArtikelId: 101 },
    ])?.map((selection) => selection.courseSequence)).toEqual([1, 2, 3]);
  });

  it("supports a five-course fixed menu, generic choose 3 of 7, optional wine and automatic informational courses", () => {
    const five = { ...configuration, selectionMode: "fixed" as const, courses: [...configuration.courses, { courseNumber: 5, foodArtikelId: 15, allowedFoodArtikelIds: [15], allowedWineArtikelIds: [105] }] };
    expect(resolveMulticourseSelections(five, [...five.courses].map(course => ({ courseNumber: course.courseNumber, foodArtikelId: course.foodArtikelId, wineArtikelId: course.allowedWineArtikelIds[0] })))?.length).toBe(5);
    const seven = { ...five, selectionMode: "choose" as const, selectionCount: 3, courses: [...five.courses, { courseNumber: 6, foodArtikelId: 16, allowedFoodArtikelIds: [16], allowedWineArtikelIds: [] , wineRequired: false }, { courseNumber: 7, foodArtikelId: 17, allowedFoodArtikelIds: [17], allowedWineArtikelIds: [], informational: true, wineRequired: false }] };
    expect(resolveMulticourseSelections(seven, [
      { courseNumber: 1, foodArtikelId: 11, wineArtikelId: 101 },
      { courseNumber: 2, foodArtikelId: 12, wineArtikelId: 102 },
      { courseNumber: 6, foodArtikelId: 16, wineArtikelId: null },
    ])).toEqual(expect.arrayContaining([
      expect.objectContaining({ courseNumber: 7, foodArtikelId: 17, wineArtikelId: null }),
    ]));
  });

  it("rejects noncontiguous and more than twenty courses", () => {
    expect(resolveMulticourseSelections({ ...configuration, selectionMode: "fixed" as const, courses: [{ ...configuration.courses[0], courseNumber: 2 }, ...configuration.courses.slice(1)] }, [])).toBeNull();
    const courses = Array.from({ length: 21 }, (_, index) => ({ courseNumber: index + 1, foodArtikelId: index + 1, allowedFoodArtikelIds: [index + 1], allowedWineArtikelIds: [index + 100] }));
    expect(resolveMulticourseSelections({ izbor: "fixed_four" as const, selectionMode: "fixed" as const, courses }, [])).toBeNull();
  });
});


describe("POST /narocila/:id/multicourse PostgreSQL integration", () => {
  const createdCompanyIds: string[] = [];
  const createdOrderIds: number[] = [];
  const createdMenuIds: number[] = [];

  afterAll(async () => {
    if (createdOrderIds.length) {
      await db.delete(postavkeTable).where(inArray(postavkeTable.narociloId, createdOrderIds));
      await db.delete(narocilaTable).where(inArray(narocilaTable.id, createdOrderIds));
    }
    if (createdMenuIds.length) {
      await db.delete(multicourseMenuCoursesTable).where(inArray(multicourseMenuCoursesTable.menuId, createdMenuIds));
      await db.delete(multicourseMenusTable).where(inArray(multicourseMenusTable.id, createdMenuIds));
    }
    if (createdCompanyIds.length) {
      await db.delete(companiesTable).where(inArray(companiesTable.id, createdCompanyIds));
    }
    await pool.end();
  });

  it("ohrani prvotno ime hoda na notranjih food/wine vrsticah tudi po preimenovanju konfiguracije", async () => {
    const runId = Math.random().toString(36).slice(2, 10);
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `MC_POS_${runId}`,
      naziv: `Multicourse POS ${runId}`,
    }).returning({ id: companiesTable.id });
    createdCompanyIds.push(company!.id);
    const [enota] = await db.insert(enoteTable).values({
      companyId: company!.id,
      ime: `Multicourse enota ${runId}`,
    }).returning({ id: enoteTable.id });
    const articleNames = [
      "Degustacijski meni",
      "Hladna predjed", "Bela spremljava",
      "Glavna jed", "Rdeča spremljava",
      "Sladica", "Sladka spremljava",
    ];
    const articles = await db.insert(artikliTable).values(articleNames.map((ime, index) => ({
      enotaId: enota!.id,
      ime: `${ime} ${runId}`,
      cena: index === 0 ? "80.00" : "10.00",
      davek: index === 2 || index === 4 ? "22.00" : "9.50",
      prodajniArtikel: true,
    }))).returning({ id: artikliTable.id });
    const [menuArtikel, firstFood, firstWine, secondFood, secondWine, thirdFood, thirdWine] = articles;
    const [menu] = await db.insert(multicourseMenusTable).values({
      enotaId: enota!.id,
      menuArtikelId: menuArtikel!.id,
      izbor: "fixed_four",
      selectionMode: "fixed",
      foodPricePercent: "75",
    }).returning({ id: multicourseMenusTable.id });
    createdMenuIds.push(menu!.id);
    const courses = await db.insert(multicourseMenuCoursesTable).values([
      {
        menuId: menu!.id,
        courseNumber: 1,
        courseName: "Pozdrav iz kuhinje",
        foodArtikelId: firstFood!.id,
        allowedFoodArtikelIds: [firstFood!.id],
        allowedWineArtikelIds: [firstWine!.id],
      },
      {
        menuId: menu!.id,
        courseNumber: 2,
        courseName: "Glavni hod",
        foodArtikelId: secondFood!.id,
        allowedFoodArtikelIds: [secondFood!.id],
        allowedWineArtikelIds: [secondWine!.id],
      },
      {
        menuId: menu!.id,
        courseNumber: 3,
        courseName: "Sladki zaključek",
        foodArtikelId: thirdFood!.id,
        allowedFoodArtikelIds: [thirdFood!.id],
        allowedWineArtikelIds: [thirdWine!.id],
      },
    ]).returning({ id: multicourseMenuCoursesTable.id, courseNumber: multicourseMenuCoursesTable.courseNumber });
    const [order] = await db.insert(narocilaTable).values({
      enotaId: enota!.id,
      stevilkaNarocila: 590000,
    }).returning({ id: narocilaTable.id });
    createdOrderIds.push(order!.id);

    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      Object.assign(req, {
        companyId: company!.id,
        enotaId: enota!.id,
        jeDdvZavezanec: false,
        log: { info: () => undefined, warn: () => undefined, error: () => undefined },
      });
      next();
    });
    app.use(narocilaRouter);

    const created = await supertest(app)
      .post(`/narocila/${order!.id}/multicourse`)
      .send({
        menuArtikelId: menuArtikel!.id,
        quantity: 1,
        selections: [
          { courseNumber: 1, foodArtikelId: firstFood!.id, wineArtikelId: firstWine!.id },
          { courseNumber: 2, foodArtikelId: secondFood!.id, wineArtikelId: secondWine!.id },
          { courseNumber: 3, foodArtikelId: thirdFood!.id, wineArtikelId: thirdWine!.id },
        ],
      });
    expect(created.status, JSON.stringify(created.body)).toBe(201);

    const storedComponents = await db.select({
      artikelId: postavkeTable.artikelId,
      courseNumber: postavkeTable.courseNumber,
      courseNameSnapshot: postavkeTable.courseNameSnapshot,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, order!.id),
      isNotNull(postavkeTable.courseNumber),
    ));
    expect(storedComponents).toHaveLength(6);
    expect(storedComponents.filter(row => row.courseNumber === 1)).toEqual(expect.arrayContaining([
      expect.objectContaining({ artikelId: firstFood!.id, courseNameSnapshot: "Pozdrav iz kuhinje" }),
      expect.objectContaining({ artikelId: firstWine!.id, courseNameSnapshot: "Pozdrav iz kuhinje" }),
    ]));
    expect(storedComponents.filter(row => row.courseNumber === 2)).toEqual(expect.arrayContaining([
      expect.objectContaining({ artikelId: secondFood!.id, courseNameSnapshot: "Glavni hod" }),
      expect.objectContaining({ artikelId: secondWine!.id, courseNameSnapshot: "Glavni hod" }),
    ]));
    expect(storedComponents.filter(row => row.courseNumber === 3)).toEqual(expect.arrayContaining([
      expect.objectContaining({ artikelId: thirdFood!.id, courseNameSnapshot: "Sladki zaključek" }),
      expect.objectContaining({ artikelId: thirdWine!.id, courseNameSnapshot: "Sladki zaključek" }),
    ]));

    await Promise.all(courses.map(course => db.update(multicourseMenuCoursesTable)
      .set({ courseName: `Preimenovani hod ${course.courseNumber}` })
      .where(eq(multicourseMenuCoursesTable.id, course.id))));

    const history = await supertest(app).get(`/narocila/${order!.id}`);
    expect(history.status, JSON.stringify(history.body)).toBe(200);
    const historicComponents = history.body.postavke.filter((row: { courseNumber: number | null }) => row.courseNumber != null);
    expect(historicComponents.filter((row: { courseNumber: number }) => row.courseNumber === 1))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ artikelId: firstFood!.id, courseNameSnapshot: "Pozdrav iz kuhinje" }),
        expect.objectContaining({ artikelId: firstWine!.id, courseNameSnapshot: "Pozdrav iz kuhinje" }),
      ]));
    expect(historicComponents.filter((row: { courseNumber: number }) => row.courseNumber === 2))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ artikelId: secondFood!.id, courseNameSnapshot: "Glavni hod" }),
        expect.objectContaining({ artikelId: secondWine!.id, courseNameSnapshot: "Glavni hod" }),
      ]));
    expect(historicComponents.filter((row: { courseNumber: number }) => row.courseNumber === 3))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ artikelId: thirdFood!.id, courseNameSnapshot: "Sladki zaključek" }),
        expect.objectContaining({ artikelId: thirdWine!.id, courseNameSnapshot: "Sladki zaključek" }),
      ]));
  });
});