/**
 * Integracijski testi za per-podjetje bizBox nastavitve (DEL B):
 *   GET /bizbox-nastavitve
 *   PUT /bizbox-nastavitve
 *   DELETE /bizbox-nastavitve
 *
 * Pokrivamo:
 *  BN-1   GET brez nastavitev → gesloNastavljeno=false
 *  BN-2   PUT z geslom → geslo šifrirano v DB (ni plaintext)
 *  BN-3   GET po PUT → gesloNastavljeno=true; geslo se NE vrne
 *  BN-4   PUT brez novega gesla (ohranitev obstoječega) → uspeh
 *  BN-5   PUT brez gesla ob prvem shranjevanju → 400
 *  BN-6   DELETE → po brisanju GET vrne gesloNastavljeno=false
 *  BN-7   Per-podjetje: drugi companyId ne dobi nastavitev prvega
 *  BN-8   Dešifriranje: šifropis v DB se pravilno dešifrira nazaj v plaintext
 *  BN-9   Role guard: GET kot uporabnik → 403
 *  BN-10  Role guard: GET kot admin_enote → 200 (bralni dostop dovoljen)
 *  BN-11  Role guard: PUT kot admin_enote → 403 (pisalni dostop zavrnjen)
 *  BN-12  Role guard: PUT kot admin → 200
 *  BN-13  Role guard: DELETE kot admin_enote → 403
 *  BN-14  Geslo v DB nikoli ni plaintext (potrdi BN-2 s ločenim scenarijem)
 */

import { afterAll, beforeAll, beforeEach, describe, it, expect } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq } from "drizzle-orm";
import {
  db,
  pool,
  companiesTable,
  enoteTable,
  bizboxNastavitveTable,
} from "@workspace/db";
import bizboxNastavitveRouter from "./bizbox-nastavitve";

// ── Test identifikatorji ──────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let companyId2: string;
let enotaId2: number;

// ── Express app s simuliranim POS middleware ──────────────────────────────────
// vloga: "admin" | "admin_enote" | "uporabnik" | "superadmin"
function buildApp(cId: string, eId: number, vloga = "admin") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = cId;
    (req as any).enotaId   = eId;
    (req as any).vloga     = vloga;
    (req as any).log = {
      info: () => {}, warn: () => {}, debug: () => {}, error: () => {},
    };
    next();
  });
  app.use(bizboxNastavitveRouter);
  return app;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  process.env["BIZBOX_ENC_KEY"] = "test-bizbox-enc-key-za-teste-32-znakov!!";

  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `BN_TST_${RUN_ID}_A`,
    naziv: `Test bizBox Nastavitve ${RUN_ID} A`,
  }).returning({ id: companiesTable.id });
  companyId = c!.id;

  const [e] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota BN ${RUN_ID} A`,
  }).returning({ id: enoteTable.id });
  enotaId = e!.id;

  const [c2] = await db.insert(companiesTable).values({
    podjetjeDavcna: `BN_TST_${RUN_ID}_B`,
    naziv: `Test bizBox Nastavitve ${RUN_ID} B`,
  }).returning({ id: companiesTable.id });
  companyId2 = c2!.id;

  const [e2] = await db.insert(enoteTable).values({
    companyId: companyId2,
    ime: `Enota BN ${RUN_ID} B`,
  }).returning({ id: enoteTable.id });
  enotaId2 = e2!.id;
});

afterAll(async () => {
  delete process.env["BIZBOX_ENC_KEY"];
  await db.delete(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId)).catch(() => {});
  await db.delete(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId2)).catch(() => {});
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId)).catch(() => {});
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId2)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId2)).catch(() => {});
  await pool.end();
});

beforeEach(async () => {
  await db.delete(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId)).catch(() => {});
  await db.delete(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId2)).catch(() => {});
});

// ── Osnovna CRUD ──────────────────────────────────────────────────────────────

describe("GET /bizbox-nastavitve", () => {
  it("BN-1: brez nastavitev → gesloNastavljeno=false, bizboxUser=''", async () => {
    const res = await supertest(buildApp(companyId, enotaId)).get("/bizbox-nastavitve");
    expect(res.status).toBe(200);
    expect(res.body.gesloNastavljeno).toBe(false);
    expect(res.body.bizboxUser).toBe("");
    expect(res.body.bizboxOkolje).toBe("test");
    // geslo se nikoli ne vrne
    expect(res.body.bizboxPassEnc).toBeUndefined();
    expect(res.body.bizboxPass).toBeUndefined();
  });
});

describe("PUT /bizbox-nastavitve", () => {
  it("BN-2: PUT z geslom → šifrirano v DB", async () => {
    const res = await supertest(buildApp(companyId, enotaId))
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "user@test.si", bizboxPass: "TajnoGeslo123!", bizboxOkolje: "test" });

    expect(res.status).toBe(200);
    expect(res.body.uspeh).toBe(true);

    const [row] = await db.select().from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));
    expect(row).toBeDefined();
    expect(row!.bizboxUser).toBe("user@test.si");
    expect(row!.bizboxPassEnc).not.toBe("TajnoGeslo123!");
    expect(row!.bizboxPassEnc).not.toContain("TajnoGeslo123!");
    expect(row!.bizboxPassEnc.split(":")).toHaveLength(3);
  });

  it("BN-3: GET po PUT → gesloNastavljeno=true; geslo se NE vrne", async () => {
    const app = buildApp(companyId, enotaId);
    await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "u@zzi.si", bizboxPass: "SuperSkrivno!", bizboxOkolje: "prod" });

    const res = await supertest(app).get("/bizbox-nastavitve");
    expect(res.status).toBe(200);
    expect(res.body.gesloNastavljeno).toBe(true);
    expect(res.body.bizboxUser).toBe("u@zzi.si");
    expect(res.body.bizboxOkolje).toBe("prod");
    // geslo NIKOLI v odgovoru
    expect(res.body.bizboxPassEnc).toBeUndefined();
    expect(res.body.bizboxPass).toBeUndefined();
    expect(Object.values(res.body)).not.toContain("SuperSkrivno!");
  });

  it("BN-4: PUT brez gesla (ohranitev obstoječega) → šifropis se ne spremeni", async () => {
    const app = buildApp(companyId, enotaId);
    await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "orig@test.si", bizboxPass: "PrvoGeslo!", bizboxOkolje: "test" });

    const [rowPred] = await db.select().from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));
    const passEncPred = rowPred!.bizboxPassEnc;

    const res = await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "novName@test.si", bizboxOkolje: "prod" });

    expect(res.status).toBe(200);
    const [rowPo] = await db.select().from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));
    expect(rowPo!.bizboxUser).toBe("novName@test.si");
    expect(rowPo!.bizboxOkolje).toBe("prod");
    expect(rowPo!.bizboxPassEnc).toBe(passEncPred);
  });

  it("BN-5: PUT brez gesla ob prvem shranjevanju → 400", async () => {
    const res = await supertest(buildApp(companyId, enotaId))
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "u@test.si", bizboxOkolje: "test" });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geslo|bizboxPass/i);
  });
});

describe("DELETE /bizbox-nastavitve", () => {
  it("BN-6: DELETE → nastavitve odstranjene; GET vrne gesloNastavljeno=false", async () => {
    const app = buildApp(companyId, enotaId);
    await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "brisem@test.si", bizboxPass: "GesloZaBris!", bizboxOkolje: "test" });

    const del = await supertest(app).delete("/bizbox-nastavitve");
    expect(del.status).toBe(200);
    expect(del.body.izbrisan).toBe(true);

    const res = await supertest(app).get("/bizbox-nastavitve");
    expect(res.body.gesloNastavljeno).toBe(false);
  });
});

describe("Per-podjetje izolacija", () => {
  it("BN-7: nastavitve companyId A niso vidne z companyId B", async () => {
    const appA = buildApp(companyId, enotaId);
    const appB = buildApp(companyId2, enotaId2);

    await supertest(appA).put("/bizbox-nastavitve")
      .send({ bizboxUser: "podjetjeA@test.si", bizboxPass: "GesloA123!", bizboxOkolje: "test" });

    const resB = await supertest(appB).get("/bizbox-nastavitve");
    expect(resB.body.gesloNastavljeno).toBe(false);
    expect(resB.body.bizboxUser).toBe("");
  });
});

describe("Šifriranje in dešifriranje", () => {
  it("BN-8: geslo v DB se pravilno dešifrira nazaj v plaintext", async () => {
    const app = buildApp(companyId, enotaId);
    const testGeslo = "PravoGeslo999_BN8";
    await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "api@bizbox.si", bizboxPass: testGeslo, bizboxOkolje: "prod" });

    const [row] = await db.select().from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));
    expect(row).toBeDefined();

    // Direktno dešifriranje z isto ključem
    const { desifrirajBizboxGeslo } = await import("../../lib/kripto-bizbox");
    const desifriraноGeslo = desifrirajBizboxGeslo(row!.bizboxPassEnc);
    expect(desifriraноGeslo).toBe(testGeslo);
    expect(row!.bizboxPassEnc).not.toBe(testGeslo);
  });

  it("BN-14: geslo v DB nikoli ni plaintext (razlicen scenarij)", async () => {
    const app = buildApp(companyId, enotaId);
    const testGeslo = "TajnoGeslo_Plaintext_Test_123_BN14";
    await supertest(app).put("/bizbox-nastavitve")
      .send({ bizboxUser: "test@test.si", bizboxPass: testGeslo, bizboxOkolje: "test" });

    const [row] = await db.select({ passEnc: bizboxNastavitveTable.bizboxPassEnc })
      .from(bizboxNastavitveTable).where(eq(bizboxNastavitveTable.companyId, companyId));

    expect(row).toBeDefined();
    expect(row!.passEnc).not.toBe(testGeslo);
    expect(row!.passEnc).not.toContain(testGeslo);
    // Tri base64 segmenti (iv:tag:ciphertext)
    const deli = row!.passEnc.split(":");
    expect(deli).toHaveLength(3);
    deli.forEach(d => {
      expect(Buffer.from(d, "base64").length).toBeGreaterThan(0);
    });
  });
});

// ── Role guard ────────────────────────────────────────────────────────────────

describe("Role guard — branje (GET)", () => {
  it("BN-9: GET kot uporabnik → 403", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "uporabnik"))
      .get("/bizbox-nastavitve");
    expect(res.status).toBe(403);
  });

  it("BN-10: GET kot admin_enote → 200 (bralni dostop dovoljen)", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "admin_enote"))
      .get("/bizbox-nastavitve");
    expect(res.status).toBe(200);
  });
});

describe("Role guard — pisanje (PUT)", () => {
  it("BN-11: PUT kot admin_enote → 403 (pisalni dostop zavrnjen)", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "admin_enote"))
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "x@test.si", bizboxPass: "geslo123!", bizboxOkolje: "test" });
    expect(res.status).toBe(403);
  });

  it("BN-12: PUT kot admin → 200", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "admin"))
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "admin@test.si", bizboxPass: "AdminGeslo!", bizboxOkolje: "test" });
    expect(res.status).toBe(200);
  });

  it("BN-12b: PUT kot superadmin → 200", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "superadmin"))
      .put("/bizbox-nastavitve")
      .send({ bizboxUser: "super@test.si", bizboxPass: "SuperGeslo!", bizboxOkolje: "test" });
    expect(res.status).toBe(200);
  });
});

describe("Role guard — brisanje (DELETE)", () => {
  it("BN-13: DELETE kot admin_enote → 403", async () => {
    const res = await supertest(buildApp(companyId, enotaId, "admin_enote"))
      .delete("/bizbox-nastavitve");
    expect(res.status).toBe(403);
  });
});
