import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, sql } from "drizzle-orm";
import {
  accountingRolesTable,
  companiesTable,
  costCentersTable,
  db,
  enoteTable,
  izmeneTable,
  natakariTable,
  pool,
  posUporabnikiTable,
} from "@workspace/db";

const auth = vi.hoisted(() => ({ userId: "erp-accountant-obracun-ur" }));
const VIEWER_USER_ID = "erp-viewer-obracun-ur";

vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: auth.userId }),
}));

import { requireObracunUrAccess } from "../../middlewares/pos";
import { getObracunUrHandler } from "./izmene";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
let companyId: string;
let enotaId: number;
let natakariId: number;
let izmenaId: number;
let legacyIzmenaId: number;
let renamedIzmenaId: number;
let posCompanyId: string;
let costCenterId: string;

function buildApp() {
  const app = express();
  app.get("/izmene/obracun-ur", requireObracunUrAccess, getObracunUrHandler);
  return app;
}

beforeAll(async () => {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_ERP_UR_${RUN_ID}`,
      naziv: `ERP obračun ur ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  companyId = company!.id;

  const [posCompany] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `SI_TST_POS_UR_${RUN_ID}`,
      naziv: `POS članstvo ${RUN_ID}`,
    })
    .returning({ id: companiesTable.id });
  posCompanyId = posCompany!.id;

  await db.insert(posUporabnikiTable).values({
    clerkUserId: auth.userId,
    companyId: posCompanyId,
    vloga: "admin",
    ime: "POS",
    priimek: "Administrator",
  });

  const [enota] = await db
    .insert(enoteTable)
    .values({ companyId, ime: `ERP enota ${RUN_ID}` })
    .returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [natakar] = await db
    .insert(natakariTable)
    .values({ companyId, ime: "ERP", priimek: `Natakar ${RUN_ID}` })
    .returning({ id: natakariTable.id });
  natakariId = natakar!.id;

  const [costCenter] = await db
    .insert(costCentersTable)
    .values({ companyId, code: "4.100", name: "Zgodovinsko SM" })
    .returning({ id: costCentersTable.id });
  costCenterId = costCenter!.id;

  const [izmena] = await db
    .insert(izmeneTable)
    .values({
      enotaId,
      natakariId,
      costCenterId,
      costCenterCode: "4.100",
      costCenterName: "Zgodovinsko SM",
      zacetek: new Date("2026-08-14T08:00:00.000Z"),
      konec: new Date("2026-08-14T10:30:00.000Z"),
    })
    .returning({ id: izmeneTable.id });
  izmenaId = izmena!.id;

  const [legacyIzmena] = await db
    .insert(izmeneTable)
    .values({
      enotaId,
      natakariId,
      costCenterId,
      zacetek: new Date("2026-08-15T08:00:00.000Z"),
      konec: new Date("2026-08-15T10:30:00.000Z"),
    })
    .returning({ id: izmeneTable.id });
  legacyIzmenaId = legacyIzmena!.id;

  // Enako kot migracija 059: stara izmena dobi oznako, veljavno ob uvedbi.
  await db.execute(sql`
    UPDATE izmene AS i
    SET
      cost_center_code = COALESCE(i.cost_center_code, cc.code),
      cost_center_name = COALESCE(i.cost_center_name, cc.name)
    FROM enote AS e, cost_centers AS cc
    WHERE i.id = ${legacyIzmenaId}
      AND e.id = i.enota_id
      AND cc.id = i.cost_center_id
      AND cc.company_id = e.company_id
      AND i.cost_center_id IS NOT NULL
      AND (i.cost_center_code IS NULL OR i.cost_center_name IS NULL)
  `);

  // Isto SM se lahko kasneje preimenuje/prešifrira; nova izmena mora tvoriti
  // ločeno zgodovinsko skupino, stari dve pa ohranita svojo oznako.
  await db
    .update(costCentersTable)
    .set({ code: "4.200", name: "Preimenovano SM" })
    .where(eq(costCentersTable.id, costCenterId));
  const [renamedIzmena] = await db
    .insert(izmeneTable)
    .values({
      enotaId,
      natakariId,
      costCenterId,
      costCenterCode: "4.200",
      costCenterName: "Preimenovano SM",
      zacetek: new Date("2026-08-16T08:00:00.000Z"),
      konec: new Date("2026-08-16T09:00:00.000Z"),
    })
    .returning({ id: izmeneTable.id });
  renamedIzmenaId = renamedIzmena!.id;

  await db.insert(accountingRolesTable).values({
    clerkUserId: auth.userId,
    companyId,
    role: "accountant",
  });
  await db.insert(accountingRolesTable).values({
    clerkUserId: VIEWER_USER_ID,
    companyId,
    role: "viewer",
  });

  // Sprememba šifranta ne sme spremeniti že odprte izmene.
  await db
    .update(costCentersTable)
    .set({ name: "Novo ime šifranta" })
    .where(eq(costCentersTable.id, costCenterId));
});

afterAll(async () => {
  await db.delete(izmeneTable).where(eq(izmeneTable.id, izmenaId));
  await db.delete(izmeneTable).where(eq(izmeneTable.id, legacyIzmenaId));
  await db.delete(izmeneTable).where(eq(izmeneTable.id, renamedIzmenaId));
  await db.delete(natakariTable).where(eq(natakariTable.id, natakariId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(costCentersTable).where(eq(costCentersTable.id, costCenterId));
  await db.delete(accountingRolesTable).where(and(
    eq(accountingRolesTable.clerkUserId, auth.userId),
    eq(accountingRolesTable.companyId, companyId),
  ));
  await db.delete(accountingRolesTable).where(and(
    eq(accountingRolesTable.clerkUserId, VIEWER_USER_ID),
    eq(accountingRolesTable.companyId, companyId),
  ));
  await db.delete(posUporabnikiTable).where(and(
    eq(posUporabnikiTable.clerkUserId, "erp-accountant-obracun-ur"),
    eq(posUporabnikiTable.companyId, posCompanyId),
  ));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await db.delete(companiesTable).where(eq(companiesTable.id, posCompanyId));
  await pool.end();
});

describe("GET /izmene/obracun-ur — ERP dostop", () => {
  it("računovodji istega podjetja vrne samo zaprte izmene tudi ob POS članstvu v drugi družbi", async () => {
    const response = await supertest(buildApp())
      .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31")
      .set("X-Company-Id", companyId);

    expect(response.status).toBe(200);
    expect(response.body.skupajUr).toBe(6);
    expect(response.body.vrstice).toHaveLength(3);
    expect(response.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId,
      enotaId,
      natakariId,
      ureTrajanja: 2.5,
      smKoda: "4.100",
      smNaziv: "Zgodovinsko SM",
    }));
    expect(response.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: renamedIzmenaId,
      smKoda: "4.200",
      smNaziv: "Preimenovano SM",
      ureTrajanja: 1,
    }));
    expect(response.body.skupine).toEqual(expect.arrayContaining([
      expect.objectContaining({ smKoda: "4.100", smNaziv: "Zgodovinsko SM", skupajUr: 5, steviloIzmen: 2 }),
      expect.objectContaining({ smKoda: "4.200", smNaziv: "Preimenovano SM", skupajUr: 1, steviloIzmen: 1 }),
    ]));
    expect(response.body.poSM).toEqual(expect.arrayContaining([
      expect.objectContaining({ smKoda: "4.100", smNaziv: "Zgodovinsko SM", ur: 5, steviloIzmen: 2 }),
      expect.objectContaining({ smKoda: "4.200", smNaziv: "Preimenovano SM", ur: 1, steviloIzmen: 1 }),
    ]));
    expect(response.body.vrstice).toContainEqual(expect.objectContaining({
      izmenaId: legacyIzmenaId,
      smKoda: "4.100",
      smNaziv: "Zgodovinsko SM",
    }));
  });

  it("ERP viewerju ne razkrije podatkov", async () => {
    auth.userId = VIEWER_USER_ID;
    const response = await supertest(buildApp())
      .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31")
      .set("X-Company-Id", companyId);

    expect(response.status).toBe(403);
    auth.userId = "erp-accountant-obracun-ur";
  });

  it("brez izbrane družbe ne razkrije podatkov", async () => {
    const response = await supertest(buildApp())
      .get("/izmene/obracun-ur?od=2026-08-01&do=2026-08-31");

    expect(response.status).toBe(400);
  });
});