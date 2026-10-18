import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

type Transaction = Parameters<Parameters<typeof import("@workspace/db").db.transaction>[0]>[0];
const isolation = vi.hoisted(() => ({ tx: null as Transaction | null }));

// Keep real PostgreSQL queries, including permission checks, on the same
// transaction connection. Nested transactions would use savepoints.
vi.mock("@workspace/db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...actual,
    db: new Proxy(actual.db, {
      get(target, key) {
        const executor = isolation.tx ?? target;
        const value = Reflect.get(executor, key);
        return typeof value === "function" ? value.bind(executor) : value;
      },
    }),
  };
});
vi.mock("@clerk/express", () => ({
  getAuth: () => ({ userId: "TEST-os-archive" }),
}));
vi.mock("../../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));

import express from "express";
import request from "supertest";
import { inArray } from "drizzle-orm";
import {
  db, pool, companiesTable, companyModulesTable, osRolesTable,
  osnovnaSredstvaTable, osAmortizacijaObracunTable, osAmortizacijaObracunSredstvoTable,
} from "@workspace/db";
import router from "../osAmortizacijaKnjizenje";

const app = express().use(express.json()).use(router);
afterAll(() => pool.end());

describe("GET arhiv obračunov amortizacije — PostgreSQL", () => {
  it("sešteje shranjene decimalne zneske po glavi, ohrani prazne glave in loči podjetji", async () => {
    const companyId = randomUUID();
    const foreignCompanyId = randomUUID();
    const companyIds = [companyId, foreignCompanyId];
    const rollback = new Error("rollback OS archive fixtures");

    try {
      await db.transaction(async (tx) => {
        isolation.tx = tx;
        await db.insert(companiesTable).values(companyIds.map((id) => ({
          id, podjetjeDavcna: `TEST_OS_ARCHIVE_${id}`, naziv: "TEST OS archive",
        })));
        // The same viewer can read both companies: isolation must come from
        // the archive query, not a denial of access to the foreign company.
        await db.insert(companyModulesTable).values(companyIds.map((id) => ({
          companyId: id, module: "osnovna_sredstva" as const, enabledBy: "TEST-os-archive",
        })));
        await db.insert(osRolesTable).values(companyIds.map((id) => ({
          companyId: id, clerkUserId: "TEST-os-archive", role: "os_viewer" as const,
        })));

        const updatedAt = new Date("2026-06-30T12:34:56.000Z");
        // Insert out of year order so the response must explicitly sort.
        const [old, current, empty, foreign, foreignEmpty] = await db
          .insert(osAmortizacijaObracunTable).values([
            { companyId, leto: 2025, doMeseca: 12, status: "zakljucen", updatedAt },
            { companyId, leto: 2026, doMeseca: 6, status: "odprt", updatedAt },
            { companyId, leto: 2024, doMeseca: 12, status: "zakljucen", updatedAt },
            { companyId: foreignCompanyId, leto: 2026, doMeseca: 3, status: "odprt", updatedAt },
            { companyId: foreignCompanyId, leto: 2027, doMeseca: 1, status: "odprt", updatedAt },
          ]).returning();
        const [firstAsset, secondAsset, thirdAsset, foreignAsset] = await db
          .insert(osnovnaSredstvaTable).values([
            { companyId, inventarnaSt: "A", naziv: "Prvo sredstvo" },
            { companyId, inventarnaSt: "B", naziv: "Drugo sredstvo" },
            { companyId, inventarnaSt: "C", naziv: "Tretje sredstvo" },
            { companyId: foreignCompanyId, inventarnaSt: "A", naziv: "Tuja oprema" },
          ]).returning();
        await db.insert(osAmortizacijaObracunSredstvoTable).values([
          { obracunId: current.id, sredstvoId: firstAsset.id, obracunano: "1234.56" },
          { obracunId: current.id, sredstvoId: secondAsset.id, obracunano: "0.10" },
          { obracunId: current.id, sredstvoId: thirdAsset.id, obracunano: "0.20" },
          // Reuse an asset in another year to catch joins/grouping by asset.
          { obracunId: old.id, sredstvoId: firstAsset.id, obracunano: "17.89" },
          { obracunId: foreign.id, sredstvoId: foreignAsset.id, obracunano: "98765.43" },
        ]);
        // No purchase/activation data exists and osnova/stopnja remain zero:
        // the endpoint must sum saved obracunano, not recalculate depreciation.
        const response = await request(app)
          .get(`/os/${companyId}/amortizacija/obracun`).expect(200);
        const expectedHead = (
          head: typeof current, skupajAmortizacija: string,
        ) => ({
          id: head.id, leto: head.leto, doMeseca: head.doMeseca,
          status: head.status, updatedAt: updatedAt.toISOString(), skupajAmortizacija,
        });
        expect(response.body).toEqual([
          expectedHead(current, "1234.86"),
          expectedHead(old, "17.89"),
          expectedHead(empty, "0.00"),
        ]);
        const foreignResponse = await request(app)
          .get(`/os/${foreignCompanyId}/amortizacija/obracun`).expect(200);
        expect(foreignResponse.body).toEqual([
          expectedHead(foreignEmpty, "0.00"),
          expectedHead(foreign, "98765.43"),
        ]);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    } finally {
      isolation.tx = null;
      // Verify rollback through the real pool, even if an assertion failed.
      // Never delete business records or disable append-only protections.
      expect(await db.select({ id: companiesTable.id }).from(companiesTable)
        .where(inArray(companiesTable.id, companyIds))).toEqual([]);
      expect(await db.select({ id: osAmortizacijaObracunTable.id }).from(osAmortizacijaObracunTable)
        .where(inArray(osAmortizacijaObracunTable.companyId, companyIds))).toEqual([]);
      expect(await db.select({ id: osnovnaSredstvaTable.id }).from(osnovnaSredstvaTable)
        .where(inArray(osnovnaSredstvaTable.companyId, companyIds))).toEqual([]);
    }
  });
});
