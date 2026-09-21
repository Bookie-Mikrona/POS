import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  artikliTable, companiesTable, db, enoteTable, multicourseMenuCoursesTable,
  multicourseMenusTable, narocilaTable, pool, postavkeTable,
} from "@workspace/db";
import { loadActiveOrderCourseReferences } from "./glasovni-ukaz";

const run = Math.random().toString(36).slice(2, 10);
let companyId: string, enotaA: number, enotaB: number, orderId: number;
let activeArticleId: number, inactiveArticleId: number, unrepresentedArticleId: number, foreignArticleId: number;

async function article(enotaId: number, name: string) {
  const [row] = await db.insert(artikliTable).values({
    enotaId, ime: `${name} ${run}`, cena: "1", davek: "22", vrstniRed: 1,
  }).returning({ id: artikliTable.id });
  return row!.id;
}

async function menu(enotaId: number, menuArtikelId: number, courseName: string, aktivno = true) {
  const [row] = await db.insert(multicourseMenusTable).values({
    enotaId, menuArtikelId, izbor: "fixed_four", aktivno,
  }).returning({ id: multicourseMenusTable.id });
  await db.insert(multicourseMenuCoursesTable).values({
    menuId: row!.id, courseNumber: 1, courseName, foodArtikelId: menuArtikelId,
  });
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_AGENT_COURSE_${run}`, naziv: `agent course ${run}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  [enotaA, enotaB] = (await db.insert(enoteTable).values([
    { companyId, ime: `agent A ${run}` }, { companyId, ime: `agent B ${run}` },
  ]).returning({ id: enoteTable.id })).map(row => row.id) as [number, number];
  activeArticleId = await article(enotaA, "active");
  inactiveArticleId = await article(enotaA, "inactive");
  unrepresentedArticleId = await article(enotaA, "unrepresented");
  foreignArticleId = await article(enotaB, "foreign");
  await menu(enotaA, activeArticleId, "Ribji hod");
  await menu(enotaA, inactiveArticleId, "Neaktivni hod", false);
  await menu(enotaA, unrepresentedArticleId, "Drugi hod");
  await menu(enotaB, foreignArticleId, "Tuji hod");
  const [order] = await db.insert(narocilaTable).values({
    enotaId: enotaA, stevilkaNarocila: 880000,
  }).returning({ id: narocilaTable.id });
  orderId = order!.id;
  await db.insert(postavkeTable).values([
    { narociloId: orderId, artikelId: activeArticleId, ime: "active", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
    { narociloId: orderId, artikelId: inactiveArticleId, ime: "inactive", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
    // Deliberately represented to prove the loader's menu enota predicate is
    // independent of article/order fixture integrity.
    { narociloId: orderId, artikelId: foreignArticleId, ime: "foreign", kolicina: 1, cenaKos: "1", skupaj: "1", davek: "22" },
  ]);
});

afterAll(async () => {
  await db.delete(postavkeTable).where(eq(postavkeTable.narociloId, orderId));
  await db.delete(narocilaTable).where(eq(narocilaTable.id, orderId));
  await db.delete(multicourseMenusTable).where(inArray(multicourseMenusTable.menuArtikelId, [
    activeArticleId, inactiveArticleId, unrepresentedArticleId, foreignArticleId,
  ]));
  await db.delete(artikliTable).where(inArray(artikliTable.id, [
    activeArticleId, inactiveArticleId, unrepresentedArticleId, foreignArticleId,
  ]));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaA, enotaB]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("loadActiveOrderCourseReferences PostgreSQL integration", () => {
  it("uses only active menu courses represented by the tenant's order", async () => {
    const courses = await loadActiveOrderCourseReferences({
      id: orderId, nacin: "miza", status: "odprto", miza: null, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 3,
      postavke: [
        { id: 1, artikelId: activeArticleId, naziv: "active", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "active-menu" },
        { id: 2, artikelId: inactiveArticleId, naziv: "inactive", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "inactive-menu" },
        { id: 3, artikelId: foreignArticleId, naziv: "foreign", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "foreign-menu" },
        {
          id: 4, artikelId: activeArticleId, naziv: "legacy course", kolicina: 1, skupaj: 0,
          opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "active-menu",
          courseNumber: 1, courseSequence: 1, courseNameSnapshot: null,
        },
      ],
    }, enotaA);
    expect(courses).toEqual([{ courseNumber: 1, courseName: "Ribji hod" }]);
  });

  it("prefers the order snapshot after the active menu course is renamed", async () => {
    const [course] = await db.select({ id: multicourseMenuCoursesTable.id })
      .from(multicourseMenuCoursesTable)
      .innerJoin(multicourseMenusTable, eq(multicourseMenuCoursesTable.menuId, multicourseMenusTable.id))
      .where(eq(multicourseMenusTable.menuArtikelId, activeArticleId));
    const [component] = await db.insert(postavkeTable).values({
      narociloId: orderId,
      artikelId: activeArticleId,
      ime: "snapshotted course",
      kolicina: 1,
      cenaKos: "0",
      skupaj: "0",
      davek: "22",
      pairingGroupId: `snapshot:${run}`,
      courseNumber: 1,
      courseSequence: 1,
      courseNameSnapshot: "Ribji hod",
    }).returning({ id: postavkeTable.id });
    await db.update(multicourseMenuCoursesTable)
      .set({ courseName: "Preimenovan hod" })
      .where(eq(multicourseMenuCoursesTable.id, course!.id));
    try {
      const courses = await loadActiveOrderCourseReferences({
        id: orderId, nacin: "miza", status: "odprto", miza: null, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 3,
        postavke: [
          { id: 1, artikelId: activeArticleId, naziv: "active", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: `snapshot:${run}` },
          {
            id: component!.id, artikelId: activeArticleId, naziv: "snapshotted course",
            kolicina: 1, skupaj: 0, opomba: null, parentPostavkaId: null, racunId: null,
            pairingGroupId: `snapshot:${run}`, courseNumber: 1, courseSequence: 1,
            courseNameSnapshot: "Ribji hod",
          },
        ],
      }, enotaA);
      expect(courses).toEqual([{ courseNumber: 1, courseName: "Ribji hod" }]);
    } finally {
      await db.update(multicourseMenuCoursesTable)
        .set({ courseName: "Ribji hod" })
        .where(eq(multicourseMenuCoursesTable.id, course!.id));
      await db.delete(postavkeTable).where(eq(postavkeTable.id, component!.id));
    }
  });

  it("does not treat a component article that is itself a menu as the ordered menu", async () => {
    const [inactiveMenu] = await db.select({ id: multicourseMenusTable.id })
      .from(multicourseMenusTable)
      .where(eq(multicourseMenusTable.menuArtikelId, inactiveArticleId));
    await db.update(multicourseMenusTable).set({ aktivno: true })
      .where(eq(multicourseMenusTable.id, inactiveMenu!.id));
    try {
      const courses = await loadActiveOrderCourseReferences({
        id: orderId, nacin: "miza", status: "odprto", miza: null, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 1,
        postavke: [
          { id: 1, artikelId: activeArticleId, naziv: "menu", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "ordered-menu" },
          {
            id: 2, artikelId: inactiveArticleId, naziv: "component which is also a menu", kolicina: 1,
            skupaj: 0, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "ordered-menu",
            courseNumber: 1, courseSequence: 1, courseNameSnapshot: null,
          },
        ],
      }, enotaA);
      expect(courses).toEqual([{ courseNumber: 1, courseName: "Ribji hod" }]);
    } finally {
      await db.update(multicourseMenusTable).set({ aktivno: false })
        .where(eq(multicourseMenusTable.id, inactiveMenu!.id));
    }
  });

  it("uses the numeric fallback when represented menus disagree on a legacy course name", async () => {
    const [inactiveMenu] = await db.select({ id: multicourseMenusTable.id })
      .from(multicourseMenusTable)
      .where(eq(multicourseMenusTable.menuArtikelId, inactiveArticleId));
    await db.update(multicourseMenusTable).set({ aktivno: true })
      .where(eq(multicourseMenusTable.id, inactiveMenu!.id));
    try {
      const courses = await loadActiveOrderCourseReferences({
        id: orderId, nacin: "miza", status: "odprto", miza: null, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 2,
        postavke: [
          { id: 1, artikelId: activeArticleId, naziv: "menu A", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "menu-a" },
          { id: 2, artikelId: inactiveArticleId, naziv: "menu B", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "menu-b" },
          {
            id: 3, artikelId: activeArticleId, naziv: "legacy course", kolicina: 1, skupaj: 0,
            opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "menu-a",
            courseNumber: 1, courseSequence: 1, courseNameSnapshot: " ",
          },
        ],
      }, enotaA);
      expect(courses).toEqual([{ courseNumber: 1, courseName: "1. hod" }]);
    } finally {
      await db.update(multicourseMenusTable).set({ aktivno: false })
        .where(eq(multicourseMenusTable.id, inactiveMenu!.id));
    }
  });

  it("uses the numeric fallback when persisted snapshots for one course conflict", async () => {
    const courses = await loadActiveOrderCourseReferences({
      id: orderId, nacin: "miza", status: "odprto", miza: null, strankaIme: null, telefon: null, naslovDostave: null, skupaj: 1,
      postavke: [
        { id: 1, artikelId: activeArticleId, naziv: "menu", kolicina: 1, skupaj: 1, opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "conflict-menu" },
        {
          id: 2, artikelId: activeArticleId, naziv: "first", kolicina: 1, skupaj: 0,
          opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "conflict-menu",
          courseNumber: 1, courseSequence: 1, courseNameSnapshot: "Prvo ime",
        },
        {
          id: 3, artikelId: activeArticleId, naziv: "second", kolicina: 1, skupaj: 0,
          opomba: null, parentPostavkaId: null, racunId: null, pairingGroupId: "conflict-menu",
          courseNumber: 1, courseSequence: 1, courseNameSnapshot: "Drugo ime",
        },
      ],
    }, enotaA);
    expect(courses).toEqual([{ courseNumber: 1, courseName: "1. hod" }]);
  });
});