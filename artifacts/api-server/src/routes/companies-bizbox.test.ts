/**
 * Integracijski testi za skupne company-level endpointe:
 *   GET  /companies/:id/eracun-nastavitve
 *   PATCH /companies/:id/eracun-nastavitve
 *   GET  /companies/:id/bizbox-nastavitve
 *   PUT  /companies/:id/bizbox-nastavitve
 *   DELETE /companies/:id/bizbox-nastavitve
 *
 * Pokriva:
 *  CB-1   GET eracun — ERP owner dobi svoja polja
 *  CB-2   GET eracun — POS admin dobi svoja polja
 *  CB-3   GET eracun — superadmin dobi polja
 *  CB-4   GET eracun — nepovezan uporabnik dobi 403
 *  CB-5   GET eracun — ERP owner ne dobi tujega podjetja (403)
 *  CB-6   PATCH eracun — ERP owner uspešno posodobi
 *  CB-7   PATCH eracun — POS admin uspešno posodobi
 *  CB-8   PATCH eracun — nepooblaščen dobi 403
 *  CB-9   PATCH eracun — neznano polje (whitelist) se ne posreduje v DB
 *  CB-10  GET bizbox — privzeto gesloNastavljeno=false
 *  CB-11  PUT bizbox — ERP owner nastavi poverilnice
 *  CB-12  PUT bizbox — POS admin nastavi poverilnice
 *  CB-13  GET bizbox — geslo se NIKOLI ne vrne v odgovoru
 *  CB-14  PUT bizbox — brez gesla ob prvem shranjevanju = 400
 *  CB-15  DELETE bizbox — poverilnice se brišejo
 *  CB-16  PUT bizbox — nepooblaščen dobi 403
 *  CB-MW-1 resolvePodjetjeSkrbnik — vrne null za neznano podjetje
 */

import { afterAll, beforeAll, describe, it, expect, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, and } from "drizzle-orm";
import {
  db,
  pool,
  companiesTable,
  accountingRolesTable,
  posUporabnikiTable,
  bizboxNastavitveTable,
} from "@workspace/db";
import companiesBizboxRouter, { resolvePodjetjeSkrbnik } from "./companies-bizbox";

// ── Mock requireAuth — nadomestimo s trivialnim next() middleware ─────────────
vi.mock("./companies-bizbox", async (importOriginal) => {
  return importOriginal();
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => next(),
}));

// ── Test identifikatorji ──────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

const CLERK_ERP_OWNER   = `test-erp-owner-${RUN_ID}`;
const CLERK_POS_ADMIN   = `test-pos-admin-${RUN_ID}`;
const CLERK_SUPERADMIN  = `test-superadmin-${RUN_ID}`;
const CLERK_NOBODY      = `test-nobody-${RUN_ID}`;
const CLERK_ERP_OWNER2  = `test-erp-owner2-${RUN_ID}`;

let companyId: string;
let companyId2: string;

// ── Express test app ──────────────────────────────────────────────────────────
function buildApp(clerkUserId: string) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res: any, next: any) => {
    req.clerkUserId = clerkUserId;
    req.log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
    next();
  });
  app.use(companiesBizboxRouter);
  return app;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  // Superadmin prek env var
  process.env["SUPER_ADMIN_IDS"] = CLERK_SUPERADMIN;
  process.env["BIZBOX_ENC_KEY"]  = "test-bizbox-enc-key-za-teste-32-znakov!!";

  // Podjetje 1
  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `CB_TST_${RUN_ID}_A`,
    naziv: `Test companiesBizbox ${RUN_ID} A`,
    eRacunOmrezje: "BizBox",
    eRacunNaslov:  "SI56 0000 0000 0000 000",
    eRacunEmail:   "eracun@test.si",
    eRacunSifraPu: "001",
    eRacunBic:     "BSLJSI2X",
  }).returning({ id: companiesTable.id });
  companyId = c!.id;

  // Podjetje 2
  const [c2] = await db.insert(companiesTable).values({
    podjetjeDavcna: `CB_TST_${RUN_ID}_B`,
    naziv: `Test companiesBizbox ${RUN_ID} B`,
  }).returning({ id: companiesTable.id });
  companyId2 = c2!.id;

  // ERP owner za podjetje 1
  await db.insert(accountingRolesTable).values({
    clerkUserId: CLERK_ERP_OWNER,
    companyId,
    role: "owner",
  }).onConflictDoNothing();

  // ERP owner za podjetje 2 (za cross-company test)
  await db.insert(accountingRolesTable).values({
    clerkUserId: CLERK_ERP_OWNER2,
    companyId: companyId2,
    role: "owner",
  }).onConflictDoNothing();

  // POS admin za podjetje 1
  await db.insert(posUporabnikiTable).values({
    clerkUserId: CLERK_POS_ADMIN,
    companyId,
    ime: "POS",
    priimek: "Admin Test",
    vloga: "admin",
    aktiven: true,
  }).onConflictDoNothing();
});

afterAll(async () => {
  // Počisti po testu
  for (const cId of [companyId, companyId2]) {
    if (!cId) continue;
    await db.delete(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, cId));
  }
  if (companyId) {
    await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId));
    await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.companyId, companyId));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  }
  if (companyId2) {
    await db.delete(accountingRolesTable).where(eq(accountingRolesTable.companyId, companyId2));
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId2));
  }
  await pool.end();
});

// ── e-Račun nastavitve testi ──────────────────────────────────────────────────
describe("GET /companies/:id/eracun-nastavitve", () => {
  it("CB-1 ERP owner dobi e-račun polja", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .get(`/companies/${companyId}/eracun-nastavitve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      eRacunOmrezje: "BizBox",
      eRacunNaslov:  "SI56 0000 0000 0000 000",
      eRacunEmail:   "eracun@test.si",
      eRacunBic:     "BSLJSI2X",
    });
    // Geslo ni v odgovoru (e-račun nima gesla, a preverimo da ni nobenih presežnih polj)
    expect(res.body).not.toHaveProperty("naziv");
    expect(res.body).not.toHaveProperty("podjetjeDavcna");
  });

  it("CB-2 POS admin dobi e-račun polja", async () => {
    const res = await supertest(buildApp(CLERK_POS_ADMIN))
      .get(`/companies/${companyId}/eracun-nastavitve`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ eRacunOmrezje: "BizBox" });
  });

  it("CB-3 Superadmin dobi e-račun polja", async () => {
    const res = await supertest(buildApp(CLERK_SUPERADMIN))
      .get(`/companies/${companyId}/eracun-nastavitve`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("eRacunOmrezje");
  });

  it("CB-4 Nepovezan uporabnik dobi 403", async () => {
    const res = await supertest(buildApp(CLERK_NOBODY))
      .get(`/companies/${companyId}/eracun-nastavitve`);
    expect(res.status).toBe(403);
  });

  it("CB-5 ERP owner podjetja 1 ne dobi podatkov podjetja 2", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .get(`/companies/${companyId2}/eracun-nastavitve`);
    expect(res.status).toBe(403);
  });
});

describe("PATCH /companies/:id/eracun-nastavitve", () => {
  it("CB-6 ERP owner uspešno posodobi e-račun polja", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .patch(`/companies/${companyId}/eracun-nastavitve`)
      .send({ eRacunOmrezje: "PEPPOL", eRacunBic: "LJBASI2X" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ eRacunOmrezje: "PEPPOL", eRacunBic: "LJBASI2X" });
    // Povrni nazaj (ne zahtevamo tega v testu, dovolj da 200)
  });

  it("CB-7 POS admin uspešno posodobi e-račun polja", async () => {
    const res = await supertest(buildApp(CLERK_POS_ADMIN))
      .patch(`/companies/${companyId}/eracun-nastavitve`)
      .send({ eRacunEmail: "nov@test.si" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ eRacunEmail: "nov@test.si" });
  });

  it("CB-8 Nepooblaščen dobi 403", async () => {
    const res = await supertest(buildApp(CLERK_NOBODY))
      .patch(`/companies/${companyId}/eracun-nastavitve`)
      .send({ eRacunOmrezje: "ZZI" });
    expect(res.status).toBe(403);
  });

  it("CB-9 Whitelist: neznano polje se ignorira, zahteva uspe", async () => {
    // naziv je company polje, ne sme biti posredovano
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .patch(`/companies/${companyId}/eracun-nastavitve`)
      .send({ naziv: "HEKER", eRacunBic: "BSLJSI2X" });
    // Zahteva mora uspeti (200) a naziv ni bila posodobljena prek tega endpointa
    expect(res.status).toBe(200);
    // Preverimo da naziv v DB ni bil spremenjen
    const [company] = await db.select({ naziv: companiesTable.naziv })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    expect(company?.naziv).not.toBe("HEKER");
  });
});

// ── bizBox nastavitve testi ───────────────────────────────────────────────────
describe("GET /companies/:id/bizbox-nastavitve (privzeto)", () => {
  it("CB-10 Prvič: gesloNastavljeno=false", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .get(`/companies/${companyId}/bizbox-nastavitve`);
    expect(res.status).toBe(200);
    expect(res.body.gesloNastavljeno).toBe(false);
  });
});

describe("PUT /companies/:id/bizbox-nastavitve", () => {
  it("CB-11 ERP owner nastavi poverilnice", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .put(`/companies/${companyId}/bizbox-nastavitve`)
      .send({ bizboxUser: "erp@zzi.si", bizboxPass: "TajnoGeslo123", bizboxOkolje: "test" });
    expect(res.status).toBe(200);
    expect(res.body.uspeh).toBe(true);
    expect(res.body.gesloNastavljeno).toBe(true);

    // Preveri da geslo v DB ni shranjeno v čistopisu
    const [row] = await db.select({ passEnc: bizboxNastavitveTable.bizboxPassEnc })
      .from(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId));
    expect(row?.passEnc).not.toBe("TajnoGeslo123");
    expect(row?.passEnc).toBeTruthy();
  });

  it("CB-12 POS admin nastavi poverilnice (nov user)", async () => {
    const res = await supertest(buildApp(CLERK_POS_ADMIN))
      .put(`/companies/${companyId}/bizbox-nastavitve`)
      .send({ bizboxUser: "pos@zzi.si", bizboxPass: "PosGeslo456" });
    expect(res.status).toBe(200);
    expect(res.body.uspeh).toBe(true);
  });

  it("CB-14 Brez gesla ob prvem shranjevanju = 400 (za čisto podjetje 2)", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER2))
      .put(`/companies/${companyId2}/bizbox-nastavitve`)
      .send({ bizboxUser: "user2@zzi.si" /* brez gesla, ni obstoječega zapisa */ });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geslo/i);
  });

  it("CB-16 Nepooblaščen dobi 403", async () => {
    const res = await supertest(buildApp(CLERK_NOBODY))
      .put(`/companies/${companyId}/bizbox-nastavitve`)
      .send({ bizboxUser: "heker@zzi.si", bizboxPass: "geslo" });
    expect(res.status).toBe(403);
  });
});

describe("GET /companies/:id/bizbox-nastavitve (po PUT)", () => {
  it("CB-13 Geslo se NIKOLI ne vrne v odgovoru", async () => {
    const res = await supertest(buildApp(CLERK_ERP_OWNER))
      .get(`/companies/${companyId}/bizbox-nastavitve`);
    expect(res.status).toBe(200);
    expect(res.body.gesloNastavljeno).toBe(true);
    expect(res.body).not.toHaveProperty("bizboxPassEnc");
    expect(res.body).not.toHaveProperty("bizboxPass");
    expect(res.body.bizboxUser).toBeTruthy();
  });
});

describe("DELETE /companies/:id/bizbox-nastavitve", () => {
  it("CB-15 ERP owner izbriše poverilnice — po brisanju gesloNastavljeno=false", async () => {
    const resDel = await supertest(buildApp(CLERK_ERP_OWNER))
      .delete(`/companies/${companyId}/bizbox-nastavitve`);
    expect(resDel.status).toBe(200);
    expect(resDel.body.uspeh).toBe(true);

    const resGet = await supertest(buildApp(CLERK_ERP_OWNER))
      .get(`/companies/${companyId}/bizbox-nastavitve`);
    expect(resGet.status).toBe(200);
    expect(resGet.body.gesloNastavljeno).toBe(false);
  });
});

describe("resolvePodjetjeSkrbnik helper", () => {
  it("CB-MW-1 Vrne null za neznan clerkUserId / podjetje", async () => {
    const vloga = await resolvePodjetjeSkrbnik("neobstajajoc-user", companyId);
    expect(vloga).toBeNull();
  });
});
