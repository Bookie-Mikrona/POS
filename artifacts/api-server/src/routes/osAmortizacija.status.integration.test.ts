import { afterAll, describe, expect, it, vi } from "vitest";

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
    req.clerkUserId = "TEST-os-status";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, companyModulesTable, osRolesTable, accountsTable,
  osnovnaSredstvaTable, osDoknjizbeTable, osAmortizacijskeSkupineTable,
  osAmortizacijaNastavitveTable, osAmortizacijaObracunSredstvoTable, osAmortizacijaObracunTable,
} from "@workspace/db";
import router from "./osAmortizacijaKnjizenje";
import sredstvaRouter from "./osnovnaSredstva";

const app = express();
app.use(express.json(), router, sredstvaRouter);
afterAll(() => pool.end());

describe("status sredstva ob zaključku letnega obračuna", () => {
  it("shrani izračunani status po amortizaciji, ohrani izločitve in ne podvoji odpisa", async () => {
    const rollback = new Error("rollback OS status fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_OS_STATUS_${Date.now()}`, naziv: "TEST OS status",
        }).returning();
        companyId = company.id;
        await db.insert(companyModulesTable).values({
          companyId, module: "osnovna_sredstva", enabledBy: "TEST-os-status",
        });
        await db.insert(osRolesTable).values({ companyId, clerkUserId: "TEST-os-status", role: "os_admin" });
        const accounts = await db.insert(accountsTable).values([
          { companyId, code: "4300000", name: "Amortizacija", type: "expense" },
          { companyId, code: "0500000", name: "Popravek", type: "asset" },
        ]).returning();
        await db.insert(osAmortizacijaNastavitveTable).values({
          companyId, kontoStroskaId: accounts[0].id, kontoPopravkaId: accounts[1].id,
        });
        const [group] = await db.insert(osAmortizacijskeSkupineTable).values({
          companyId, koda: "TEST", naziv: "TEST", racunovodskaStonja: "100", davcnaStonja: "100",
        }).returning();
        const [halfRateGroup] = await db.insert(osAmortizacijskeSkupineTable).values({
          companyId, koda: "HALF", naziv: "50 %", racunovodskaStonja: "50", davcnaStonja: "50",
        }).returning();
        const [previousRun] = await db.insert(osAmortizacijaObracunTable).values({
          companyId, leto: 2025, doMeseca: 12, status: "zakljucen",
        }).returning();
        const cases = [
          { name: "polni odpis", status: "v_uporabi", active: true, expected: "odpisano" },
          { name: "dograditev", status: "odpisano", active: true, expected: "v_uporabi", upgrade: true },
          { name: "brez aktivacije", status: "odpisano", active: false, expected: "v_teku" },
          { name: "izločeno", status: "izloceno", active: true, expected: "izloceno" },
          { name: "odtujeno", status: "v_uporabi", active: true, expected: "izloceno", disposed: true },
          { name: "neznan status", status: "pokvarjeno", active: true, expected: "odpisano" },
          { name: "prejšnji obračun", status: "v_uporabi", active: true, expected: "odpisano", previous: true },
          { name: "neamortizljivi del", status: "v_uporabi", active: true, expected: "v_uporabi", residual: true },
        ];
        const fixtures = [];
        for (const [index, item] of cases.entries()) {
          const [asset] = await db.insert(osnovnaSredstvaTable).values({
            companyId, inventarnaSt: String(index), naziv: item.name, skupinaId: item.previous ? halfRateGroup.id : group.id,
            status: item.status, datumOdtujitve: item.disposed ? "2026-06-01" : null,
          }).returning();
          await db.insert(osDoknjizbeTable).values({
            sredstvoId: asset.id, seq: 0, nabavnaVrednost: "1200", odpisanaVrednost: "0",
            datumNabave: "2025-01-01", datumAktivacije: item.active ? "2025-01-01" : null,
            neamortizljiviDelPct: item.residual ? "10" : "0",
          });
          if (item.previous) {
            await db.insert(osAmortizacijaObracunSredstvoTable).values({
              obracunId: previousRun.id, sredstvoId: asset.id, osnova: "1200", stopnja: "50", obracunano: "600",
            });
          }
          if (item.upgrade) {
            await db.insert(osDoknjizbeTable).values({
              sredstvoId: asset.id, seq: 1, nabavnaVrednost: "1200", odpisanaVrednost: "0",
              datumNabave: "2026-12-01", datumAktivacije: "2026-12-01",
            });
          }
          fixtures.push({ id: asset.id, ...item });
        }
        const [foreignCompany] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_OS_STATUS_FOREIGN_${Date.now()}`, naziv: "TEST foreign",
        }).returning();
        const [foreignAsset] = await db.insert(osnovnaSredstvaTable).values({
          companyId: foreignCompany.id, inventarnaSt: "0", naziv: "TEST foreign", status: "v_uporabi",
        }).returning();

        const url = `/os/${companyId}/amortizacija/obracun`;
        await request(app).post(url).send({ leto: 2026, doMeseca: 6 }).expect(201);
        expect((await db.select().from(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.id, fixtures[0].id)))[0].status)
          .toBe("v_uporabi");
        for (let attempt = 0; attempt < 2; attempt++) {
          const response = await request(app).post(url).send({ leto: 2026, doMeseca: 12 }).expect(201);
          expect(response.body.status).toBe("zakljucen");
          const saved = await db.select().from(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.companyId, companyId));
          for (const fixture of fixtures) {
            expect(saved.find(row => row.id === fixture.id)?.status, fixture.name).toBe(fixture.expected);
          }
          const baseUrl = `/companies/${companyId}/osnovna-sredstva`;
          const register = (await request(app).get(`${baseUrl}?includeIzloceno=true`).expect(200)).body.osnovnaSredstva;
          for (const fixture of fixtures) {
            expect(register.find((row: any) => row.id === fixture.id)?.status, fixture.name).toBe(fixture.expected);
            const card = (await request(app).get(`${baseUrl}/${fixture.id}`).expect(200)).body;
            expect(card.status, fixture.name).toBe(fixture.expected);
          }
          for (const status of ["odpisano", "v_uporabi", "v_teku", "izloceno"]) {
            const filtered = (await request(app).get(`${baseUrl}?status=${status}`).expect(200)).body.osnovnaSredstva;
            expect(filtered.map((row: any) => row.id).sort())
              .toEqual(fixtures.filter(fixture => fixture.expected === status).map(fixture => fixture.id).sort());
          }
          const [line] = await db.select().from(osAmortizacijaObracunSredstvoTable)
            .where(eq(osAmortizacijaObracunSredstvoTable.sredstvoId, fixtures[0].id));
          expect(line.obracunano).toBe("1200.00");
          const [purchase] = await db.select().from(osDoknjizbeTable)
            .where(eq(osDoknjizbeTable.sredstvoId, fixtures[0].id));
          expect(purchase.odpisanaVrednost).toBe("0.00");
        }
        expect((await db.select().from(osnovnaSredstvaTable).where(eq(osnovnaSredstvaTable.id, foreignAsset.id)))[0].status)
          .toBe("v_uporabi");
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
    }
    expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toEqual([]);
  });
});
