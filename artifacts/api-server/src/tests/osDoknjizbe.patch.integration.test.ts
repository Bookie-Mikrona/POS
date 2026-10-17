/**
 * Real PATCH → persisted row → register/card regressions.
 * Only authentication is stubbed; SQL, access checks and value calculations are real.
 * Each test uses a fresh tenant inside a rolled-back Drizzle transaction.
 */
import { describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";

type Database = typeof import("@workspace/db").db;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

const scope = vi.hoisted(() => ({ current: null as Transaction | null }));

vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const connection = scope.current ?? target;
        const value = Reflect.get(connection, key);
        return typeof value === "function" ? value.bind(connection) : value;
      },
    }),
  };
});

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: express.Request, _res: express.Response, next: express.NextFunction) => {
    Object.assign(req, { clerkUserId: "test-os-upgrade-editor" });
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import {
  db,
  companiesTable,
  companyModulesTable,
  osRolesTable,
  osnovnaSredstvaTable,
  osDoknjizbeTable,
  osAmortizacijaObracunTable,
  osAmortizacijaObracunSredstvoTable,
} from "@workspace/db";
import router from "../routes/osnovnaSredstva";

const app = express();
app.use(express.json());
app.use(router);

async function isolatedTest(run: (companyId: string) => Promise<void>) {
  const companyId = randomUUID();
  const rollback = new Error("rollback OS regression fixture");
  try {
    await db.transaction(async (tx) => {
      scope.current = tx;
      try {
        await db.insert(companiesTable).values({
          id: companyId,
          podjetjeDavcna: `TEST_OS_PATCH_${companyId}`,
          naziv: "TEST dograditve",
        });
        await db.insert(companyModulesTable).values({
          companyId, module: "osnovna_sredstva", enabledBy: "test-os-upgrade-editor",
        });
        await db.insert(osRolesTable).values({
          companyId, clerkUserId: "test-os-upgrade-editor", role: "os_user",
        });
        await run(companyId);
      } finally {
        scope.current = null;
      }
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  }
  // Verify rollback actually removed the fixture, rather than merely trusting cleanup.
  expect(await db.select({ id: companiesTable.id }).from(companiesTable)
    .where(eq(companiesTable.id, companyId))).toEqual([]);
}

async function createAsset(companyId: string, baseNv: string, baseOv: string) {
  const [asset] = await db.insert(osnovnaSredstvaTable).values({
    companyId, inventarnaSt: "TEST-001", naziv: "Stroj z dograditvijo", status: "v_uporabi",
  }).returning();
  const [base, upgrade] = await db.insert(osDoknjizbeTable).values([
    {
      sredstvoId: asset.id, seq: 0, nabavnaVrednost: baseNv, odpisanaVrednost: baseOv,
      datumNabave: "2023-01-01", datumAktivacije: "2023-01-01", status: "v_uporabi",
    },
    {
      sredstvoId: asset.id, seq: 1, nazivVlaganja: "Dograditev",
      nabavnaVrednost: "2000.00", odpisanaVrednost: "0.00",
      datumNabave: "2024-06-01", datumAktivacije: "2024-06-01", status: "v_uporabi",
    },
  ]).returning();
  return {
    base, upgrade,
    url: `/companies/${companyId}/osnovna-sredstva/${asset.id}`,
    registerUrl: `/companies/${companyId}/osnovna-sredstva-register?leto=2024`,
  };
}

describe("PATCH dograditve seq=1 — shranjevanje in obračun", () => {
  it("medletni register po PATCH vrne novo konNV/konNed in ohrani osnovni nakup", async () => {
    await isolatedTest(async (companyId) => {
      const { base, upgrade, url, registerUrl } = await createAsset(companyId, "10000.00", "3000.00");
      const before = await request(app).get(registerUrl).expect(200);
      expect(before.body.periodo.predogled).toBe(true);
      expect(before.body.osnovnaSredstva).toHaveLength(1);
      expect(before.body.osnovnaSredstva[0]).toMatchObject({
        konNV: "12000.00", konNed: "9000.00", noveNabave: "2000.00",
      });

      const patched = await request(app).patch(`${url}/doknjizbe/${upgrade.id}`)
        .send({ nabavnaVrednost: "3500.00", nazivVlaganja: "Popravljena dograditev" }).expect(200);
      expect(patched.body).toMatchObject({
        id: upgrade.id, seq: 1, nabavnaVrednost: "3500.00",
        nazivVlaganja: "Popravljena dograditev", sedanjaVrednost: "3500.00",
      });
      const [saved] = await db.select().from(osDoknjizbeTable).where(eq(osDoknjizbeTable.id, upgrade.id));
      expect(saved).toEqual({
        ...upgrade, nabavnaVrednost: "3500.00", nazivVlaganja: "Popravljena dograditev",
        updatedAt: expect.any(Date),
      });
      expect(await db.select().from(osDoknjizbeTable).where(eq(osDoknjizbeTable.id, base.id))).toEqual([base]);

      const after = await request(app).get(registerUrl).expect(200);
      expect(after.body.osnovnaSredstva).toHaveLength(1);
      expect(after.body.osnovnaSredstva[0]).toMatchObject({
        steviloDoknjizb: 1, zacNV: "10000.00", zacPV: "3000.00",
        noveNabave: "3500.00", amortObdobja: "0.00", konNV: "13500.00", konNed: "10500.00",
      });
      expect(after.body.seštevki).toMatchObject({ konNV: "13500.00", konNed: "10500.00" });
      const card = await request(app).get(url).expect(200);
      expect(card.body).toMatchObject({ skupnaNabavna: "13500.00", sedanjaVrednostPoObracunu: "10500.00" });
    });
  });

  it("znižanje dograditve ob shranjenem obračunu ohrani obračun in nenegativne vrednosti kartice", async () => {
    await isolatedTest(async (companyId) => {
      const { base, upgrade, url, registerUrl } = await createAsset(companyId, "1000.00", "900.00");
      const [calculation] = await db.insert(osAmortizacijaObracunTable).values({
        companyId, leto: 2024, doMeseca: 12, status: "zakljucen",
      }).returning();
      const [line] = await db.insert(osAmortizacijaObracunSredstvoTable).values({
        obracunId: calculation.id, sredstvoId: base.sredstvoId,
        osnova: "3000.00", stopnja: "20.000", obracunano: "600.00",
      }).returning();

      const before = await request(app).get(url).expect(200);
      expect(before.body).toMatchObject({
        skupnaAmortizacijaObracunana: "600.00", sedanjaVrednostPoObracunu: "1500.00",
      });
      const registerBefore = await request(app).get(registerUrl).expect(200);
      expect(registerBefore.body.periodo.predogled).toBe(false);
      expect(registerBefore.body.osnovnaSredstva[0]).toMatchObject({
        konNV: "3000.00", konNed: "1500.00", amortObdobja: "600.00",
      });

      await request(app).patch(`${url}/doknjizbe/${upgrade.id}`)
        .send({ nabavnaVrednost: "1500.00" }).expect(200);
      const registerAfter = await request(app).get(registerUrl).expect(200);
      expect(registerAfter.body.osnovnaSredstva[0]).toMatchObject({
        konNV: "2500.00", konNed: "1000.00", amortObdobja: "600.00",
      });
      const cardAfter = await request(app).get(url).expect(200);
      expect(cardAfter.body).toMatchObject({
        sedanjaVrednostPoObracunu: "1000.00", skupnaAmortizacijaObracunana: "600.00",
      });

      // 1000 + 100 - 900 - 600 = -400 without the card's zero floor.
      await request(app).patch(`${url}/doknjizbe/${upgrade.id}`)
        .send({ nabavnaVrednost: "100.00" }).expect(200);
      const [saved] = await db.select().from(osDoknjizbeTable).where(eq(osDoknjizbeTable.id, upgrade.id));
      expect(saved).toEqual({ ...upgrade, nabavnaVrednost: "100.00", updatedAt: expect.any(Date) });
      const after = await request(app).get(url).expect(200);
      expect(after.body).toMatchObject({
        skupnaNabavna: "1100.00", skupnaOdpisana: "900.00",
        sedanjaVrednostPredObracunom: "200.00", sedanjaVrednostPoObracunu: "0.00",
        skupnaAmortizacijaObracunana: "600.00",
      });
      expect(after.body.doknjizbe).toHaveLength(2);
      for (const doc of after.body.doknjizbe) {
        expect(Number(doc.sedanjaVrednostPoObracunu)).toBeGreaterThanOrEqual(0);
      }
      expect(after.body.amortizacijskaZgodovina).toEqual(before.body.amortizacijskaZgodovina);
      expect(await db.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.id, calculation.id))).toEqual([calculation]);
      expect(await db.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.id, line.id))).toEqual([line]);
    });
  });
});
