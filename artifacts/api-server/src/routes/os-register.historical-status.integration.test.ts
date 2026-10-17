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
    req.clerkUserId = "TEST-os-historical-status";
    next();
  },
}));
vi.mock("../middlewares/requireSuperAdmin", () => ({ isSuperAdmin: () => false }));
vi.mock("../lib/report-pdf", async importOriginal => ({
  ...await importOriginal<typeof import("../lib/report-pdf")>(),
  generateOsRegisterPdf: vi.fn(async () => Buffer.from("%PDF-test")),
}));

import express from "express";
import request from "supertest";
import { eq } from "drizzle-orm";
import {
  db, pool, companiesTable, companyModulesTable, osRolesTable,
  osnovnaSredstvaTable, osDoknjizbeTable, osAmortizacijaObracunTable,
} from "@workspace/db";
import { generateOsRegisterPdf } from "../lib/report-pdf";
import { resolveStatusSredstvo } from "./osHelpers";
import sredstvaRouter from "./osnovnaSredstva";

const app = express();
app.use(sredstvaRouter);
afterAll(() => pool.end());

describe("historical asset status at the reporting cutoff", () => {
  const totals = { nabavna: 1200, odpisana: 0, hasAktivirana: true };

  it("ignores a future disposal and its saved status, but preserves current and undated exclusions", () => {
    expect(resolveStatusSredstvo("izloceno", totals, "2026-07-31", "2025-12-31")).toBe("v_uporabi");
    expect(resolveStatusSredstvo("izloceno", totals, "2026-07-31", "2026-07-30")).toBe("v_uporabi");
    expect(resolveStatusSredstvo("v_uporabi", totals, "2026-07-31", "2026-07-31")).toBe("izloceno");
    expect(resolveStatusSredstvo("v_uporabi", totals, "2026-07-31")).toBe("izloceno");
    expect(resolveStatusSredstvo("izloceno", totals, null, "2025-12-31")).toBe("izloceno");
    expect(resolveStatusSredstvo("izloceno", { ...totals, obracunaniOdpisi: 1200 },
      "2026-07-31", "2025-12-31")).toBe("odpisano");
    expect(resolveStatusSredstvo("izloceno", { ...totals, hasAktivirana: false },
      "2026-07-31", "2025-12-31")).toBe("v_teku");
  });

  it("keeps later-disposed assets in historical JSON and export filters, including an earlier month of the disposal year", async () => {
    const rollback = new Error("rollback historical asset status fixtures");
    let companyId = "";
    try {
      await db.transaction(async tx => {
        isolation.tx = tx;
        const [company] = await db.insert(companiesTable).values({
          podjetjeDavcna: `TEST_OS_HISTORY_${crypto.randomUUID()}`, naziv: "TEST OS history",
        }).returning();
        companyId = company.id;
        await db.insert(companyModulesTable).values({
          companyId, module: "osnovna_sredstva", enabledBy: "TEST-os-historical-status",
        });
        await db.insert(osRolesTable).values({
          companyId, clerkUserId: "TEST-os-historical-status", role: "os_admin",
        });
        const [run] = await db.insert(osAmortizacijaObracunTable).values({
          companyId, leto: 2026, doMeseca: 6, status: "osnutek",
        }).returning();
        const assets = [];
        for (const status of ["izloceno", "v_uporabi"]) {
          const [asset] = await db.insert(osnovnaSredstvaTable).values({
            companyId, inventarnaSt: status, naziv: `TEST disposal ${status}`,
            status, datumOdtujitve: "2026-07-31",
          }).returning();
          assets.push(asset);
          await db.insert(osDoknjizbeTable).values({
            sredstvoId: asset.id, seq: 0, nabavnaVrednost: "1200", odpisanaVrednost: "0",
            datumNabave: "2024-01-01", datumAktivacije: "2024-01-01",
          });
        }
        const ids = assets.map(asset => asset.id).sort();
        const base = `/companies/${companyId}`;
        for (const year of [2025, 2026]) {
          for (const filter of ["", "&status=v_uporabi", "&includeIzloceno=true"]) {
            const query = `?leto=${year}${filter}`;
            const response = await request(app).get(`${base}/osnovna-sredstva-register${query}`).expect(200);
            expect(response.body.periodo.datumKonca).toBe(year === 2025 ? "2025-12-31" : "2026-06-30");
            expect(response.body.osnovnaSredstva.map((row: any) => row.id).sort()).toEqual(ids);
            for (const row of response.body.osnovnaSredstva) {
              expect(row).toMatchObject({ status: "v_uporabi", izlocitveNV: "0.00", konNV: "1200.00" });
            }
            vi.mocked(generateOsRegisterPdf).mockClear();
            await request(app).get(`${base}/os-register/pdf${query}`).expect(200);
            expect(generateOsRegisterPdf).toHaveBeenCalledTimes(1);
            const exported = vi.mocked(generateOsRegisterPdf).mock.calls[0][0].vrstice;
            expect(exported.map(row => row.inventarnaSt).sort()).toEqual(["izloceno", "v_uporabi"]);
            for (const row of exported) expect(row).toMatchObject({ status: "v_uporabi", konNV: "1200.00" });
          }
          const excluded = await request(app)
            .get(`${base}/osnovna-sredstva-register?leto=${year}&status=izloceno`).expect(200);
          expect(excluded.body.osnovnaSredstva).toEqual([]);
          vi.mocked(generateOsRegisterPdf).mockClear();
          await request(app).get(`${base}/os-register/pdf?leto=${year}&status=izloceno`).expect(200);
          expect(vi.mocked(generateOsRegisterPdf).mock.calls[0][0].vrstice).toEqual([]);
        }
        // At the exact cutoff the disposal applies, including when the header status is stale.
        await db.update(osAmortizacijaObracunTable).set({ doMeseca: 7 })
          .where(eq(osAmortizacijaObracunTable.id, run.id));
        for (const filter of ["&status=izloceno", "&includeIzloceno=true"]) {
          const response = await request(app)
            .get(`${base}/osnovna-sredstva-register?leto=2026${filter}`).expect(200);
          expect(response.body.osnovnaSredstva).toHaveLength(2);
          for (const row of response.body.osnovnaSredstva) {
            expect(row).toMatchObject({ status: "izloceno", izlocitveNV: "1200.00", konNV: "0.00" });
          }
          vi.mocked(generateOsRegisterPdf).mockClear();
          await request(app).get(`${base}/os-register/pdf?leto=2026${filter}`).expect(200);
          const exported = vi.mocked(generateOsRegisterPdf).mock.calls[0][0].vrstice;
          expect(exported).toHaveLength(2);
          for (const row of exported) expect(row).toMatchObject({ status: "izloceno", konNV: "0.00" });
        }
        for (const filter of ["", "&status=v_uporabi"]) {
          const response = await request(app)
            .get(`${base}/osnovna-sredstva-register?leto=2026${filter}`).expect(200);
          expect(response.body.osnovnaSredstva).toEqual([]);
          vi.mocked(generateOsRegisterPdf).mockClear();
          await request(app).get(`${base}/os-register/pdf?leto=2026${filter}`).expect(200);
          expect(vi.mocked(generateOsRegisterPdf).mock.calls[0][0].vrstice).toEqual([]);
        }
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
