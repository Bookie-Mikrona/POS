import { afterAll, describe, expect, it, vi } from "vitest";

// Only redirect queries to a real transaction; do not replace SQL or its results.
const isolation = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = executor[key];
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-os-empty-year";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import { randomUUID } from "node:crypto";
import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, companyModulesTable, osRolesTable, accountsTable,
  osnovnaSredstvaTable, osDoknjizbeTable, osAmortizacijskeSkupineTable,
  osAmortizacijaNastavitveTable, osAmortizacijaObracunSredstvoTable, osAmortizacijaObracunTable,
} from "@workspace/db";
import router from "./osAmortizacijaKnjizenje";

const app = express();
app.use(express.json(), router);
afterAll(() => pool.end());

async function fixture(run: (companyId: string, url: string) => Promise<void>) {
  const rollback = new Error("rollback OS empty-year fixtures");
  let companyId = "";
  try {
    // Passing the actual Drizzle transaction makes nested transactions savepoints.
    await db.transaction(async tx => {
      isolation.tx = tx;
      const [company] = await db.insert(companiesTable).values({
        podjetjeDavcna: `TEST_OS_EMPTY_YEAR_${randomUUID()}`, naziv: "TEST OS empty year",
      }).returning();
      companyId = company.id;
      await db.insert(companyModulesTable).values({
        companyId, module: "osnovna_sredstva", enabledBy: "TEST-os-empty-year",
      });
      await db.insert(osRolesTable).values({
        companyId, clerkUserId: "TEST-os-empty-year", role: "os_admin",
      });
      const accounts = await db.insert(accountsTable).values([
        { companyId, code: "4300000", name: "Amortizacija", type: "expense" },
        { companyId, code: "0500000", name: "Popravek", type: "asset" },
      ]).returning();
      await db.insert(osAmortizacijaNastavitveTable).values({
        companyId, kontoStroskaId: accounts[0].id, kontoPopravkaId: accounts[1].id,
      });
      await run(companyId, `/os/${companyId}/amortizacija/obracun`);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    isolation.tx = null;
    // Check cleanup outside the transaction even when an assertion fails.
    if (companyId) {
      expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
      expect(await db.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, companyId))).toEqual([]);
      expect(await db.select().from(osnovnaSredstvaTable)
        .where(eq(osnovnaSredstvaTable.companyId, companyId))).toEqual([]);
    }
  }
}

describe("dejanski UPSERT praznega delnega obračuna in prehod v naslednje leto", () => {
  it("shrani zaključen prazen obračun, pri ponovitvi posodobi isto glavo in dovoli naslednje leto", async () => {
    await fixture(async (companyId, url) => {
      let headerId: string | undefined;
      // A different partial month proves the conflict branch updates the existing row.
      for (const doMeseca of [6, 6, 9]) {
        const response = await request(app).post(url).send({ leto: 2024, doMeseca }).expect(201);
        expect(response.body).toMatchObject({
          leto: 2024, doMeseca, status: "zakljucen", steviloSredstev: 0,
        });
        expect(response.body.obracunId).toEqual(expect.any(String));
        headerId ??= response.body.obracunId;
        expect(response.body.obracunId).toBe(headerId);
        const heads = await db.select().from(osAmortizacijaObracunTable)
          .where(eq(osAmortizacijaObracunTable.companyId, companyId));
        expect(heads).toHaveLength(1);
        expect(heads[0]).toMatchObject({
          id: headerId, companyId, leto: 2024, doMeseca, status: "zakljucen",
        });
        expect(await db.select().from(osAmortizacijaObracunSredstvoTable)
          .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, heads[0].id))).toEqual([]);
      }

      const next = await request(app).post(url).send({ leto: 2025, doMeseca: 6 }).expect(201);
      expect(next.body).toMatchObject({ leto: 2025, doMeseca: 6, status: "zakljucen", steviloSredstev: 0 });
      expect(next.body.obracunId).not.toBe(headerId);
      const heads = await db.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, companyId));
      expect(heads).toHaveLength(2);
      expect(heads.find(head => head.leto === 2024)).toMatchObject({
        id: headerId, doMeseca: 9, status: "zakljucen",
      });
      expect(heads.find(head => head.leto === 2025)).toMatchObject({
        id: next.body.obracunId, doMeseca: 6, status: "zakljucen",
      });
    });
  });

  it.each([
    { name: "s pozitivno amortizacijo", grouped: true, activation: "2023-01-01", amount: "600.00" },
    { name: "z ničelno amortizacijo", grouped: true, activation: "2025-01-01", amount: "0.00" },
    { name: "brez skupine in shranjene vrstice", grouped: false, activation: "2023-01-01", amount: null },
  ])("nepopoln obračun s sredstvom $name še vedno blokira naslednje leto", async ({ grouped, activation, amount }) => {
    await fixture(async (companyId, url) => {
      const [group] = await db.insert(osAmortizacijskeSkupineTable).values({
        companyId, koda: "TEST", naziv: "TEST", racunovodskaStonja: "20", davcnaStonja: "20",
      }).returning();
      const [asset] = await db.insert(osnovnaSredstvaTable).values({
        companyId, inventarnaSt: "000001", naziv: "TEST sredstvo",
        skupinaId: grouped ? group.id : null, status: "v_uporabi",
      }).returning();
      await db.insert(osDoknjizbeTable).values({
        sredstvoId: asset.id, seq: 0, nabavnaVrednost: "6000", odpisanaVrednost: "0",
        datumNabave: "2023-01-01", datumAktivacije: activation,
      });
      const first = await request(app).post(url).send({ leto: 2024, doMeseca: 6 }).expect(201);
      // The preview counts only assets with an amortization amount, not the register.
      expect(first.body).toMatchObject({
        status: "odprt", steviloSredstev: amount === "600.00" ? 1 : 0,
      });
      const headsBefore = await db.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, companyId));
      expect(headsBefore).toHaveLength(1);
      expect(headsBefore[0]).toMatchObject({
        id: first.body.obracunId, leto: 2024, doMeseca: 6, status: "odprt",
      });
      const linesBefore = await db.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, headsBefore[0].id));
      if (grouped) {
        expect(linesBefore).toHaveLength(1);
        expect(linesBefore[0]).toMatchObject({ sredstvoId: asset.id, obracunano: amount });
      } else {
        expect(linesBefore).toEqual([]);
      }

      const next = await request(app).post(url).send({ leto: 2025, doMeseca: 6 }).expect(409);
      expect(next.body).toMatchObject({
        code: "PREV_YEAR_NOT_CLOSED", prevLeto: 2024, prevDoMeseca: 6,
      });
      // The rejected request must not create next year's header or change the prior run.
      expect(await db.select().from(osAmortizacijaObracunTable)
        .where(eq(osAmortizacijaObracunTable.companyId, companyId))).toEqual(headsBefore);
      expect(await db.select().from(osAmortizacijaObracunSredstvoTable)
        .where(eq(osAmortizacijaObracunSredstvoTable.obracunId, headsBefore[0].id))).toEqual(linesBefore);
    });
  });
});
